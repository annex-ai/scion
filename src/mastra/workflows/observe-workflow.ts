// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Observe Workflow
 *
 * First stage of the Observe → Reflect → Coach adaptation pipeline.
 * Scans conversation threads and extracts raw observations.
 *
 * Pipeline:
 *   acquireLock → collectThreads → extractObservations → storeObservations → releaseLock
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { type ObservationOutput, observationOutputSchema } from "../agents/observer";
import { acquireLock, releaseLock } from "../lib/adaptation-lock";
import {
  ensureAdaptationDirs,
  generateId,
  loadState,
  saveObservations,
  updateMetrics,
  updateState,
} from "../lib/adaptation-storage";
import type { Observation, ObservationType } from "../lib/adaptation-types";
import { getAdaptationConfig } from "../lib/config";
import { chunkArray, extractTextContent, isToolCallOnly } from "../lib/reflection-utils";

// ============================================================================
// Schemas
// ============================================================================

const workflowInputSchema = z.object({
  resourceId: z.string().default("interactive-agent"),
});

const lockStepOutputSchema = z.object({
  acquired: z.boolean(),
  resourceId: z.string(),
});

const collectOutputSchema = z.object({
  resourceId: z.string(),
  exchanges: z.array(
    z.object({
      threadId: z.string(),
      messageId: z.string(),
      userMessage: z.string(),
      assistantResponse: z.string(),
      timestamp: z.string(),
    }),
  ),
  threadsScanned: z.number(),
  messagesScanned: z.number(),
});

const extractOutputSchema = z.object({
  resourceId: z.string(),
  observations: z.array(
    z.object({
      id: z.string(),
      threadId: z.string(),
      messageId: z.string(),
      timestamp: z.string(),
      type: z.string(),
      content: z.string(),
      context: z.string(),
      confidence: z.number(),
    }),
  ),
  threadsScanned: z.number(),
  messagesScanned: z.number(),
});

const workflowOutputSchema = z.object({
  observationsCreated: z.number(),
  threadsScanned: z.number(),
  messagesScanned: z.number(),
  summary: z.string(),
});

// ============================================================================
// Step 1: Acquire Lock
// ============================================================================

const acquireLockStep = createStep({
  id: "acquire-lock",
  description: "Acquire the observe workflow lock to prevent concurrent runs",
  inputSchema: workflowInputSchema,
  outputSchema: lockStepOutputSchema,

  execute: async ({ inputData }) => {
    ensureAdaptationDirs();
    const acquired = await acquireLock("observe");
    if (!acquired) {
      console.log("[Observe Workflow] Could not acquire lock, another instance is running");
    }
    return { acquired, resourceId: inputData.resourceId };
  },
});

// ============================================================================
// Step 2: Collect Threads
// ============================================================================

const collectThreadsStep = createStep({
  id: "collect-threads",
  description: "Collect unprocessed conversation exchanges from memory threads",
  inputSchema: lockStepOutputSchema,
  outputSchema: collectOutputSchema,

  execute: async ({ inputData, mastra }) => {
    if (!inputData.acquired) {
      return {
        resourceId: inputData.resourceId,
        exchanges: [],
        threadsScanned: 0,
        messagesScanned: 0,
      };
    }

    const config = await getAdaptationConfig();
    const state = await loadState();
    const processedIds = new Set(state.processedMessageIds);

    const storage = mastra?.getStorage();
    if (!storage) {
      console.warn("[Observe Workflow] No storage available");
      return {
        resourceId: inputData.resourceId,
        exchanges: [],
        threadsScanned: 0,
        messagesScanned: 0,
      };
    }

    const memoryStore = await storage.getStore("memory");
    if (!memoryStore) {
      console.warn("[Observe Workflow] No memory store available");
      return {
        resourceId: inputData.resourceId,
        exchanges: [],
        threadsScanned: 0,
        messagesScanned: 0,
      };
    }

    const threadsResult = await memoryStore.listThreads({
      filter: { resourceId: inputData.resourceId },
      perPage: false,
    });

    const threads = threadsResult.threads;
    console.log(`[Observe Workflow] Scanning ${threads.length} threads`);

    const exchanges: z.infer<typeof collectOutputSchema>["exchanges"] = [];
    let messagesScanned = 0;
    let threadsScanned = 0;

    for (const thread of threads) {
      const threadId = (thread.metadata?.threadKey as string) || thread.id;

      const messagesResult = await memoryStore.listMessages({
        threadId: thread.id,
        perPage: false,
        orderBy: { field: "createdAt", direction: "ASC" },
      });

      const messages = messagesResult.messages;
      if (!messages || messages.length === 0) continue;
      threadsScanned++;

      let lastUserMessage: string | null = null;

      for (const message of messages) {
        messagesScanned++;

        if (message.role === "user") {
          lastUserMessage = extractTextContent(message);
          continue;
        }

        if (message.role !== "assistant") continue;
        if (processedIds.has(message.id)) continue;

        const assistantText = extractTextContent(message);
        if (assistantText.length < 50) continue;
        if (isToolCallOnly(message)) continue;
        if (!lastUserMessage || lastUserMessage.trim().length === 0) continue;

        exchanges.push({
          threadId,
          messageId: message.id,
          userMessage: lastUserMessage.slice(0, 2000),
          assistantResponse: assistantText.slice(0, 2000),
          timestamp: message.createdAt?.toISOString() || new Date().toISOString(),
        });

        lastUserMessage = null;

        if (exchanges.length >= config.max_messages_per_run) break;
      }

      if (exchanges.length >= config.max_messages_per_run) break;
    }

    console.log(`[Observe Workflow] Collected ${exchanges.length} exchanges from ${threadsScanned} threads`);

    return {
      resourceId: inputData.resourceId,
      exchanges,
      threadsScanned,
      messagesScanned,
    };
  },
});

// ============================================================================
// Step 3: Extract Observations
// ============================================================================

const extractObservationsStep = createStep({
  id: "extract-observations",
  description: "Call observer agent to extract observations from exchanges",
  inputSchema: collectOutputSchema,
  outputSchema: extractOutputSchema,

  execute: async ({ inputData, mastra }) => {
    const { resourceId, exchanges, threadsScanned, messagesScanned } = inputData;

    if (exchanges.length === 0) {
      console.log("[Observe Workflow] No exchanges to analyze");
      return {
        resourceId,
        observations: [],
        threadsScanned,
        messagesScanned,
      };
    }

    const observer = mastra?.getAgentById("observer-agent");
    if (!observer) {
      console.error("[Observe Workflow] Observer agent not found");
      return {
        resourceId,
        observations: [],
        threadsScanned,
        messagesScanned,
      };
    }

    const config = await getAdaptationConfig();
    const batches = chunkArray(exchanges, config.observer_batch_size);
    const allObservations: Observation[] = [];

    console.log(`[Observe Workflow] Analyzing ${exchanges.length} exchanges in ${batches.length} batches`);

    for (const batch of batches) {
      try {
        const prompt = formatBatchPrompt(batch);
        const response = await observer.generate(prompt, {
          structuredOutput: { schema: observationOutputSchema },
          modelSettings: { temperature: 0 },
        });

        const output = response.object as ObservationOutput;

        if (output?.observations) {
          for (const obs of output.observations) {
            // Map exchangeIndex (1-based) to the correct exchange
            const exchangeIdx = Math.max(0, Math.min((obs.exchangeIndex ?? 1) - 1, batch.length - 1));
            const exchange = batch[exchangeIdx];
            allObservations.push({
              id: generateId(),
              threadId: exchange.threadId,
              messageId: exchange.messageId,
              timestamp: new Date().toISOString(),
              type: obs.type as ObservationType,
              content: obs.content,
              context: obs.context,
              confidence: obs.confidence,
            });
          }
        }
      } catch (error) {
        console.error("[Observe Workflow] Batch analysis failed:", error);
      }
    }

    console.log(`[Observe Workflow] Extracted ${allObservations.length} observations`);

    return {
      resourceId,
      observations: allObservations,
      threadsScanned,
      messagesScanned,
    };
  },
});

// ============================================================================
// Step 4: Store Observations
// ============================================================================

const storeObservationsStep = createStep({
  id: "store-observations",
  description: "Write observations to pending directory and update state",
  inputSchema: extractOutputSchema,
  outputSchema: workflowOutputSchema,

  execute: async ({ inputData }) => {
    const { observations, threadsScanned, messagesScanned } = inputData;
    const startTime = Date.now();

    if (observations.length === 0) {
      // Still update state to track processed messages
      await updateState({
        lastObserveRun: new Date().toISOString(),
        runCount: (await loadState()).runCount + 1,
      });

      return {
        observationsCreated: 0,
        threadsScanned,
        messagesScanned,
        summary: "No observations found",
      };
    }

    // Save observations to pending directory
    await saveObservations(observations as Observation[]);

    // Update processed message IDs
    const state = await loadState();
    const newProcessedIds = [...new Set([...state.processedMessageIds, ...observations.map((o) => o.messageId)])].slice(
      -1000,
    ); // Keep last 1000 IDs

    await updateState({
      lastObserveRun: new Date().toISOString(),
      processedMessageIds: newProcessedIds,
      runCount: state.runCount + 1,
    });

    // Update metrics
    const byType: Record<string, number> = {};
    for (const obs of observations) {
      byType[obs.type] = (byType[obs.type] || 0) + 1;
    }

    await updateMetrics("observe", {
      lastRun: new Date().toISOString(),
      lastDuration: Date.now() - startTime,
      threadsScanned,
      observationsCreated: observations.length,
      byType: byType as any,
    });

    const summary = `Created ${observations.length} observations from ${threadsScanned} threads`;
    console.log(`[Observe Workflow] ${summary}`);

    return {
      observationsCreated: observations.length,
      threadsScanned,
      messagesScanned,
      summary,
    };
  },
});

// ============================================================================
// Step 5: Release Lock (always runs)
// ============================================================================

const releaseLockStep = createStep({
  id: "release-lock",
  description: "Release the observe workflow lock",
  inputSchema: workflowOutputSchema,
  outputSchema: workflowOutputSchema,

  execute: async ({ inputData }) => {
    await releaseLock("observe");
    return inputData;
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function formatBatchPrompt(
  exchanges: Array<{
    threadId: string;
    messageId: string;
    userMessage: string;
    assistantResponse: string;
    timestamp: string;
  }>,
): string {
  const sections = exchanges.map((ex, i) => {
    return `--- Exchange ${i + 1} (thread: ${ex.threadId}) ---
User: "${ex.userMessage}"
Assistant: "${ex.assistantResponse}"`;
  });

  return `Analyze the following conversation exchanges and extract any notable observations.

${sections.join("\n\n")}

Extract observations about user frustrations, corrections, preferences, workflow issues, or coaching opportunities.
For each observation, specify the exchangeIndex (1-based) indicating which exchange it came from.
Return an empty array if there are no notable signals.`;
}

// ============================================================================
// Workflow Composition
// ============================================================================

export const observeWorkflow = createWorkflow({
  id: "observe-workflow",
  description: "Observe stage: scan threads and extract observations",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(acquireLockStep)
  .then(collectThreadsStep)
  .then(extractObservationsStep)
  .then(storeObservationsStep)
  .then(releaseLockStep)
  .commit();
