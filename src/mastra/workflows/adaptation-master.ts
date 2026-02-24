// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Adaptation Master Workflow
 *
 * Orchestrates the full adaptation pipeline: Observe → Reflect → Coach.
 * Runs as a background workflow, typically scheduled via cron.
 *
 * Each stage is idempotent and can be rerun safely:
 * - Locks are released via try/finally
 * - State updates only on success
 * - Manual retry continues from the failure point
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { getAdaptationConfig } from "../lib/config";
import { ensureAdaptationDirs, updateMetrics } from "../lib/adaptation-storage";

// ============================================================================
// Schemas
// ============================================================================

const workflowInputSchema = z.object({
  resourceId: z.string().default("interactive-agent"),
  stage: z.enum(["all", "observe", "reflect", "coach"]).default("all"),
});

const observeResultSchema = z.object({
  resourceId: z.string(),
  stage: z.string(),
  observeResult: z.object({
    observationsCreated: z.number(),
    threadsScanned: z.number(),
    messagesScanned: z.number(),
    summary: z.string(),
  }).nullable(),
});

const reflectResultSchema = z.object({
  resourceId: z.string(),
  stage: z.string(),
  observeResult: z.any().nullable(),
  reflectResult: z.object({
    patternsCreated: z.number(),
    patternsReinforced: z.number(),
    patternsStaled: z.number(),
    patternsArchived: z.number(),
    patternsActive: z.number(),
    observationsProcessed: z.number(),
    summary: z.string(),
  }).nullable(),
});

const workflowOutputSchema = z.object({
  observeResult: z.any().nullable(),
  reflectResult: z.any().nullable(),
  coachResult: z.any().nullable(),
  summary: z.string(),
});

// ============================================================================
// Step 1: Run Observe Workflow
// ============================================================================

const runObserveStep = createStep({
  id: "run-observe",
  description: "Execute the observe workflow",
  inputSchema: workflowInputSchema,
  outputSchema: observeResultSchema,

  execute: async ({ inputData, mastra }) => {
    const { resourceId, stage } = inputData;

    if (stage !== "all" && stage !== "observe") {
      console.log(`[Adaptation Master] Skipping observe stage (running ${stage} only)`);
      return {
        resourceId,
        stage,
        observeResult: null,
      };
    }

    const config = await getAdaptationConfig();
    if (!config.enabled) {
      console.log("[Adaptation Master] Adaptation is disabled");
      return {
        resourceId,
        stage,
        observeResult: null,
      };
    }

    ensureAdaptationDirs();

    try {
      console.log("[Adaptation Master] Starting observe stage");
      const workflow = mastra?.getWorkflow("observe-workflow");

      if (!workflow) {
        console.error("[Adaptation Master] observe-workflow not found");
        return {
          resourceId,
          stage,
          observeResult: null,
        };
      }

      const run = await workflow.createRun();
      const result = await run.start({ inputData: { resourceId } });

      const observeResult = (result.steps?.["release-lock"] as any)?.output ?? null;

      console.log(
        `[Adaptation Master] Observe complete: ${observeResult?.summary ?? "no result"}`,
      );

      return {
        resourceId,
        stage,
        observeResult,
      };
    } catch (error) {
      console.error("[Adaptation Master] Observe stage failed:", error);
      return {
        resourceId,
        stage,
        observeResult: null,
      };
    }
  },
});

// ============================================================================
// Step 2: Run Reflect Workflow
// ============================================================================

const runReflectStep = createStep({
  id: "run-reflect",
  description: "Execute the reflect workflow",
  inputSchema: observeResultSchema,
  outputSchema: reflectResultSchema,

  execute: async ({ inputData, mastra }) => {
    const { resourceId, stage, observeResult } = inputData;

    if (stage !== "all" && stage !== "reflect") {
      console.log(`[Adaptation Master] Skipping reflect stage (running ${stage} only)`);
      return {
        resourceId,
        stage,
        observeResult,
        reflectResult: null,
      };
    }

    try {
      console.log("[Adaptation Master] Starting reflect stage");
      const workflow = mastra?.getWorkflow("reflect-workflow");

      if (!workflow) {
        console.error("[Adaptation Master] reflect-workflow not found");
        return {
          resourceId,
          stage,
          observeResult,
          reflectResult: null,
        };
      }

      const run = await workflow.createRun();
      const result = await run.start({ inputData: { resourceId } });

      const reflectResult = (result.steps?.["release-lock"] as any)?.output ?? null;

      console.log(
        `[Adaptation Master] Reflect complete: ${reflectResult?.summary ?? "no result"}`,
      );

      return {
        resourceId,
        stage,
        observeResult,
        reflectResult,
      };
    } catch (error) {
      console.error("[Adaptation Master] Reflect stage failed:", error);
      return {
        resourceId,
        stage,
        observeResult,
        reflectResult: null,
      };
    }
  },
});

// ============================================================================
// Step 3: Run Coach Workflow
// ============================================================================

const runCoachStep = createStep({
  id: "run-coach",
  description: "Execute the coach workflow",
  inputSchema: reflectResultSchema,
  outputSchema: workflowOutputSchema,

  execute: async ({ inputData, mastra }) => {
    const { resourceId, stage, observeResult, reflectResult } = inputData;

    if (stage !== "all" && stage !== "coach") {
      console.log(`[Adaptation Master] Skipping coach stage (running ${stage} only)`);
      return {
        observeResult,
        reflectResult,
        coachResult: null,
        summary: buildSummary(observeResult, reflectResult, null),
      };
    }

    const config = await getAdaptationConfig();
    if (!config.coaching_enabled) {
      console.log("[Adaptation Master] Coaching is disabled");
      return {
        observeResult,
        reflectResult,
        coachResult: null,
        summary: buildSummary(observeResult, reflectResult, null),
      };
    }

    try {
      console.log("[Adaptation Master] Starting coach stage");
      const workflow = mastra?.getWorkflow("coach-workflow");

      if (!workflow) {
        console.error("[Adaptation Master] coach-workflow not found");
        return {
          observeResult,
          reflectResult,
          coachResult: null,
          summary: buildSummary(observeResult, reflectResult, null),
        };
      }

      const run = await workflow.createRun();
      const result = await run.start({ inputData: { resourceId } });

      const coachResult = (result.steps?.["release-lock"] as any)?.output ?? null;

      console.log(
        `[Adaptation Master] Coach complete: ${coachResult?.summary ?? "no result"}`,
      );

      return {
        observeResult,
        reflectResult,
        coachResult,
        summary: buildSummary(observeResult, reflectResult, coachResult),
      };
    } catch (error) {
      console.error("[Adaptation Master] Coach stage failed:", error);
      return {
        observeResult,
        reflectResult,
        coachResult: null,
        summary: buildSummary(observeResult, reflectResult, null),
      };
    }
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function buildSummary(
  observeResult: any,
  reflectResult: any,
  coachResult: any,
): string {
  const parts: string[] = [];

  if (observeResult) {
    parts.push(`Observe: ${observeResult.observationsCreated} observations`);
  }

  if (reflectResult) {
    parts.push(
      `Reflect: ${reflectResult.patternsCreated} created, ${reflectResult.patternsReinforced} reinforced`,
    );
  }

  if (coachResult) {
    parts.push(`Coach: ${coachResult.suggestionsGenerated} suggestions`);
  }

  if (parts.length === 0) {
    return "No stages executed";
  }

  return parts.join(" | ");
}

// ============================================================================
// Workflow Composition
// ============================================================================

export const adaptationMasterWorkflow = createWorkflow({
  id: "adaptation",
  description: "Run the full adaptation pipeline: observe → reflect → coach",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(runObserveStep)
  .then(runReflectStep)
  .then(runCoachStep)
  .commit();
