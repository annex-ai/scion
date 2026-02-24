// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Reflection Workflow
 *
 * Replaces ReflectorProcessor (output processor) + ReflectionService (CRON in gateway).
 * Registered on the interactive agent as a tool it can self-trigger.
 *
 * Pipeline:
 *   collectMessages → analyzePatterns → aggregateAndWrite
 *
 * All LLM calls run inside Mastra's execution context (tracing, model routing, observability).
 */

import { readFile } from "node:fs/promises";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { getReflectionConfig, resolveConfigPath } from "../lib/config";
import {
  type AggregatedPattern,
  type Heuristic,
  type RawPattern,
  type ReflectorAnalysis,
  buildBatchPrompt,
  chunkArray,
  extractReasoningContent,
  extractTextContent,
  generateHeuristics,
  isToolCallOnly,
  loadState,
  mergeAggregatedPatterns,
  mergeHeuristics,
  mergePatterns,
  parseReflectionsMd,
  reflectorAnalysisSchema,
  saveState,
  writeReflections,
} from "../lib/reflection-utils";

// ============================================================================
// Schemas
// ============================================================================

const exchangeSchema = z.object({
  query: z.string(),
  response: z.string(),
  reasoning: z.string().optional(),
  sourceThread: z.string(),
  messageId: z.string(),
});

const collectOutputSchema = z.object({
  pairs: z.array(exchangeSchema),
  processedIds: z.array(z.string()),
  threadsScanned: z.number(),
  messagesScanned: z.number(),
});

const rawPatternSchema = z.object({
  type: z.enum(["attention_signal", "noise_pattern", "decision_marker"]),
  description: z.string(),
  evidence: z.string(),
  confidence: z.number(),
  sourceThread: z.string(),
  timestamp: z.string(),
});

const insightSchema = z.object({
  whatWorked: z.string(),
  whatToRemember: z.string(),
  curationSuggestions: z.array(z.string()),
  sourceThread: z.string(),
});

const analyzeOutputSchema = z.object({
  rawPatterns: z.array(rawPatternSchema),
  insights: z.array(insightSchema),
  processedIds: z.array(z.string()),
  threadsScanned: z.number(),
  messagesScanned: z.number(),
});

const workflowInputSchema = z.object({
  resourceId: z.string().default("interactive-agent"),
});

const workflowOutputSchema = z.object({
  patternsCount: z.number(),
  heuristicsCount: z.number(),
  summary: z.string(),
});

// ============================================================================
// Step 1: Collect Messages
// ============================================================================

const collectMessagesStep = createStep({
  id: "collect-messages",
  description: "Read unprocessed query/response pairs from memory threads",
  inputSchema: workflowInputSchema,
  outputSchema: collectOutputSchema,

  execute: async ({ inputData, mastra }) => {
    const config = await getReflectionConfig();
    const statePath = resolveConfigPath(config.reflection_state_path);
    const state = await loadState(statePath);
    const processedIds = new Set(state.processedMessageIds);

    const storage = mastra?.getStorage();
    if (!storage) {
      console.warn("[Reflection Workflow] No storage available, returning empty");
      return { pairs: [], processedIds: [], threadsScanned: 0, messagesScanned: 0 };
    }

    const memoryStore = await storage.getStore("memory");
    if (!memoryStore) {
      console.warn("[Reflection Workflow] No memory store available, returning empty");
      return { pairs: [], processedIds: [], threadsScanned: 0, messagesScanned: 0 };
    }
    const threadsResult = await memoryStore.listThreads({
      filter: { resourceId: inputData.resourceId },
      perPage: false, // fetch all
    });

    const threads = threadsResult.threads;
    console.log(`[Reflection Workflow] Scanning ${threads.length} threads for resource ${inputData.resourceId}`);

    const pairs: z.infer<typeof exchangeSchema>[] = [];
    const newProcessedIds: string[] = [];
    let messagesScanned = 0;
    let threadsScanned = 0;

    for (const thread of threads) {
      const sourceThread = (thread.metadata?.threadKey as string) || thread.id;

      const messagesResult = await memoryStore.listMessages({
        threadId: thread.id,
        perPage: false,
        orderBy: { field: "createdAt", direction: "ASC" },
      });

      const messages = messagesResult.messages;
      if (!messages || messages.length === 0) continue;
      threadsScanned++;

      // Pair user queries with following assistant responses
      let lastUserQuery: string | null = null;

      for (const message of messages) {
        messagesScanned++;

        if (message.role === "user") {
          lastUserQuery = extractTextContent(message);
          continue;
        }

        if (message.role !== "assistant") continue;
        if (processedIds.has(message.id)) continue;

        const assistantText = extractTextContent(message);

        // Skip very short or tool-only messages
        if (assistantText.length < 50) continue;
        if (isToolCallOnly(message)) continue;

        // Need a preceding user query to form a pair
        if (!lastUserQuery || lastUserQuery.trim().length === 0) continue;

        const reasoning = extractReasoningContent(message);

        pairs.push({
          query: lastUserQuery,
          response: assistantText.slice(0, 2000),
          reasoning: reasoning ? reasoning.slice(0, 1000) : undefined,
          sourceThread,
          messageId: message.id,
        });

        newProcessedIds.push(message.id);

        // Reset so same query isn't paired twice
        lastUserQuery = null;

        if (pairs.length >= config.max_messages_per_run) break;
      }

      if (pairs.length >= config.max_messages_per_run) break;
    }

    console.log(
      `[Reflection Workflow] Collected ${pairs.length} pairs from ${threadsScanned} threads, ${messagesScanned} messages scanned`,
    );

    // Include previously processed IDs so we can save them all in the final step
    const allProcessedIds = [...state.processedMessageIds, ...newProcessedIds];

    return {
      pairs,
      processedIds: allProcessedIds,
      threadsScanned,
      messagesScanned,
    };
  },
});

// ============================================================================
// Step 2: Analyze Patterns
// ============================================================================

const analyzePatternsStep = createStep({
  id: "analyze-patterns",
  description: "Call reflector agent to analyze exchanges in batches",
  inputSchema: collectOutputSchema,
  outputSchema: analyzeOutputSchema,

  execute: async ({ inputData, mastra }) => {
    const { pairs, processedIds, threadsScanned, messagesScanned } = inputData;

    if (pairs.length === 0) {
      console.log("[Reflection Workflow] No pairs to analyze, skipping");
      return { rawPatterns: [], insights: [], processedIds, threadsScanned, messagesScanned };
    }

    // Load existing patterns so the LLM can skip known observations
    const config = await getReflectionConfig();
    const reflectionsPath = resolveConfigPath(config.reflections_md_path);
    let existingPatterns: AggregatedPattern[] = [];
    let existingHeuristics: Heuristic[] = [];
    try {
      const content = await readFile(reflectionsPath, "utf-8");
      const existing = parseReflectionsMd(content);
      existingPatterns = existing.patterns;
      existingHeuristics = existing.heuristics;
      console.log(
        `[Reflection Workflow] Loaded ${existingPatterns.length} existing patterns, ${existingHeuristics.length} heuristics as context`,
      );
    } catch {
      // REFLECTIONS.md doesn't exist yet — no existing context
    }

    const reflector = mastra!.getAgentById("reflector-agent");
    const batches = chunkArray(pairs, 5);
    const allPatterns: RawPattern[] = [];
    const allInsights: z.infer<typeof insightSchema>[] = [];

    console.log(`[Reflection Workflow] Analyzing ${pairs.length} pairs in ${batches.length} batches`);

    for (const batch of batches) {
      try {
        const response = await reflector.generate(buildBatchPrompt(batch, existingPatterns, existingHeuristics), {
          structuredOutput: { schema: reflectorAnalysisSchema },
          modelSettings: { temperature: 0 },
        });

        const analysis = response.object as ReflectorAnalysis;

        if (analysis?.patterns) {
          for (const pattern of analysis.patterns) {
            // Attribute pattern to the first thread in the batch
            const sourceThread = batch[0].sourceThread;
            allPatterns.push({
              ...pattern,
              sourceThread,
              timestamp: new Date().toISOString(),
            });
          }
        }

        if (analysis?.insights) {
          allInsights.push({
            ...analysis.insights,
            sourceThread: batch[0].sourceThread,
          });
        }
      } catch (error) {
        console.error("[Reflection Workflow] Batch analysis failed:", error);
        // Continue with remaining batches
      }
    }

    console.log(`[Reflection Workflow] Extracted ${allPatterns.length} patterns, ${allInsights.length} insights`);

    return {
      rawPatterns: allPatterns,
      insights: allInsights,
      processedIds,
      threadsScanned,
      messagesScanned,
    };
  },
});

// ============================================================================
// Step 3: Aggregate and Write
// ============================================================================

const aggregateAndWriteStep = createStep({
  id: "aggregate-and-write",
  description: "Merge, deduplicate patterns and write REFLECTIONS.md",
  inputSchema: analyzeOutputSchema,
  outputSchema: workflowOutputSchema,

  execute: async ({ inputData }) => {
    const { rawPatterns, insights, processedIds, threadsScanned, messagesScanned } = inputData;

    if (rawPatterns.length === 0 && insights.length === 0) {
      console.log("[Reflection Workflow] No patterns to aggregate");

      // Still save state so processed IDs are tracked
      const config = await getReflectionConfig();
      const statePath = resolveConfigPath(config.reflection_state_path);
      await saveState(
        {
          lastRunAt: new Date().toISOString(),
          processedMessageIds: processedIds,
        },
        statePath,
      );

      return {
        patternsCount: 0,
        heuristicsCount: 0,
        summary: "No new patterns found",
      };
    }

    // Aggregate new patterns from this run
    const newAggregated = mergePatterns(rawPatterns);

    // Generate heuristics from this run's insights
    const allSuggestions = insights.flatMap((i) =>
      i.curationSuggestions.map((s) => ({ suggestion: s, source: i.sourceThread })),
    );
    const newHeuristics = generateHeuristics(allSuggestions);

    // Load existing REFLECTIONS.md and merge
    const config = await getReflectionConfig();
    const reflectionsPath = resolveConfigPath(config.reflections_md_path);

    let existingContent = "";
    try {
      existingContent = await readFile(reflectionsPath, "utf-8");
    } catch {
      // File doesn't exist yet — start fresh
    }

    const existing = parseReflectionsMd(existingContent);
    const combinedPatterns = mergeAggregatedPatterns(existing.patterns, newAggregated);
    const combinedHeuristics = mergeHeuristics(existing.heuristics, newHeuristics);

    console.log(
      `[Reflection Workflow] Merged ${rawPatterns.length} raw → ${newAggregated.length} new + ${existing.patterns.length} existing = ${combinedPatterns.length} patterns, ${combinedHeuristics.length} heuristics`,
    );

    // Write merged REFLECTIONS.md
    const result = await writeReflections(
      combinedPatterns,
      combinedHeuristics,
      rawPatterns.length,
      messagesScanned,
      threadsScanned,
      reflectionsPath,
    );

    // Save state
    const statePath = resolveConfigPath(config.reflection_state_path);
    await saveState(
      {
        lastRunAt: new Date().toISOString(),
        processedMessageIds: processedIds,
      },
      statePath,
    );

    return {
      patternsCount: result.patternsCount,
      heuristicsCount: result.heuristicsCount,
      summary: result.summary,
    };
  },
});

// ============================================================================
// Compose Workflow
// ============================================================================

export const reflectionWorkflow = createWorkflow({
  id: "reflection",
  description:
    "Analyze past conversations to extract patterns and improve future context curation. Run this after completing a multi-step task, after 10+ exchanges, or when the same type of question keeps recurring. Writes patterns to REFLECTIONS.md.",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(collectMessagesStep)
  .then(analyzePatternsStep)
  .then(aggregateAndWriteStep)
  .commit();
