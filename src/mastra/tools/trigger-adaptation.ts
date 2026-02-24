// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Trigger Adaptation Tool
 *
 * Manually triggers the adaptation pipeline (observe → reflect → coach).
 * Can run the full pipeline or individual stages.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { releaseLock } from "../lib/adaptation-lock";

export const triggerAdaptationTool = createTool({
  id: "trigger-adaptation",
  description: "Manually trigger the adaptation pipeline (observe → reflect → coach)",
  inputSchema: z.object({
    stage: z
      .enum(["all", "observe", "reflect", "coach"])
      .optional()
      .default("all")
      .describe("Which stage to run: all, observe, reflect, or coach"),
    resourceId: z.string().optional().default("interactive-agent").describe("Resource ID to process"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    stage: z.string(),
    summary: z.string(),
    observeResult: z.any().nullable().optional(),
    reflectResult: z.any().nullable().optional(),
    coachResult: z.any().nullable().optional(),
  }),

  execute: async ({ stage, resourceId }, context) => {
    const mastra = context?.mastra;

    if (!mastra) {
      return {
        success: false,
        stage: stage ?? "all",
        summary: "Mastra instance not available",
      };
    }

    try {
      const workflow = mastra.getWorkflow("adaptation");

      if (!workflow) {
        return {
          success: false,
          stage: stage ?? "all",
          summary: "Adaptation workflow not found",
        };
      }

      console.log(`[trigger-adaptation] Starting ${stage} stage for ${resourceId}`);

      const run = await workflow.createRun();
      const result = await run.start({
        inputData: { resourceId, stage },
      });

      // Get the final output
      const output = (result.steps?.["run-coach"] as any)?.output;

      if (!output) {
        return {
          success: false,
          stage,
          summary: "Workflow completed but no output",
        };
      }

      return {
        success: true,
        stage,
        summary: output.summary,
        observeResult: output.observeResult,
        reflectResult: output.reflectResult,
        coachResult: output.coachResult,
      };
    } catch (error) {
      console.error("[trigger-adaptation] Error:", error);

      // Clean up any locks that might be held due to workflow failure
      // This prevents lock staleness from blocking future runs
      try {
        if (stage === "all" || stage === "observe") {
          await releaseLock("observe");
        }
        if (stage === "all" || stage === "reflect") {
          await releaseLock("reflect");
        }
        if (stage === "all" || stage === "coach") {
          await releaseLock("coach");
        }
      } catch (lockError) {
        console.warn("[trigger-adaptation] Failed to clean up locks:", lockError);
      }

      return {
        success: false,
        stage,
        summary: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
