// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Flow Loader
 *
 * Scans workspace at server startup and compiles all flows to Mastra workflows.
 * This enables build-time compilation rather than runtime compilation, providing:
 * - Faster execution (no per-request parsing)
 * - Fail-fast validation (errors at startup, not runtime)
 * - Full Mastra Studio visibility with per-step tracing
 * - Native loop support via .dowhile()
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Workflow } from "@mastra/core/workflows";
import { compileFlowToWorkflow, isFlowFile, parseFlowFile } from "./compiler";
import type { CompiledFlow, FlowError, FlowLoadResult, FlowLoaderConfig } from "./types";

/**
 * Scan workspace and compile all flows to workflows.
 * Called once at server startup.
 *
 * @param config - Flow loader configuration
 * @returns Map of flow ID to compiled flow info
 */
export async function loadFlows(config: FlowLoaderConfig): Promise<FlowLoadResult> {
  const result: FlowLoadResult = {
    flows: new Map(),
    errors: [],
  };

  const basePath = config.basePath || process.cwd();
  const flowPaths = config.paths.map((p) => resolve(basePath, p));

  for (const flowDir of flowPaths) {
    if (!existsSync(flowDir)) {
      console.warn(`[flow-loader] Flow directory not found: ${flowDir}`);
      continue;
    }

    let flowFolders: string[];
    try {
      flowFolders = readdirSync(flowDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      console.warn(`[flow-loader] Could not read flow directory: ${flowDir}`);
      continue;
    }

    for (const folder of flowFolders) {
      const flowPath = join(flowDir, folder, "FLOW.md");

      // Skip if no FLOW.md exists
      if (!existsSync(flowPath)) {
        // Check for old SKILL.md for migration warning
        const oldSkillPath = join(flowDir, folder, "SKILL.md");
        if (existsSync(oldSkillPath)) {
          console.warn(`[flow-loader] Deprecated: Found SKILL.md in ${folder}. Rename to FLOW.md for flow files.`);
        }
        continue;
      }

      // Skip non-flow files (must have Mermaid flowchart)
      if (!isFlowFile(flowPath)) {
        console.warn(`[flow-loader] Skipping ${folder}: No valid Mermaid flowchart found`);
        continue;
      }

      try {
        const parsed = parseFlowFile(flowPath);
        const workflowId = `flow-${folder}`;

        const workflow = compileFlowToWorkflow(flowPath, {
          id: workflowId,
          name: parsed.frontmatter.name || folder,
          description: parsed.frontmatter.description || "",
        });

        const compiled: CompiledFlow = {
          id: workflowId,
          name: parsed.frontmatter.name || folder,
          description: parsed.frontmatter.description || "",
          workflow,
          flowPath,
          flowId: folder,
        };

        result.flows.set(folder, compiled);
        console.log(`[flow-loader] Compiled: ${folder} -> ${workflowId}`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        const flowError: FlowError = {
          folder,
          flowPath,
          error: errorMessage,
        };
        result.errors.push(flowError);

        // Log but don't block server startup
        console.error(`[flow-loader] Failed to compile ${folder}:`, errorMessage);
      }
    }
  }

  // Summary log
  const compiledCount = result.flows.size;
  const errorCount = result.errors.length;

  if (compiledCount > 0 || errorCount > 0) {
    console.log(`[flow-loader] Summary: ${compiledCount} compiled, ${errorCount} errors`);
  }

  return result;
}

/**
 * Get a compiled flow by flow ID.
 *
 * @param flows - Map from loadFlows
 * @param flowId - Flow folder name (e.g., "bug-investigator-flow")
 * @returns The compiled flow, or undefined if not found
 */
export function getFlow(flows: Map<string, CompiledFlow>, flowId: string): CompiledFlow | undefined {
  return flows.get(flowId);
}

/**
 * Convert loaded flows to a record for Mastra registration.
 *
 * @param flows - Map from loadFlows
 * @returns Record of workflow ID to workflow, suitable for Mastra({ workflows: {...} })
 */
export function toWorkflowsRecord(flows: Map<string, CompiledFlow>): Record<string, Workflow> {
  const record: Record<string, Workflow> = {};

  for (const [_, compiled] of flows) {
    record[compiled.id] = compiled.workflow;
  }

  return record;
}

/**
 * List all available flows (for CLI/UI)
 *
 * @param flows - Map from loadFlows
 * @returns Array of flow metadata
 */
export function listFlows(flows: Map<string, CompiledFlow>): Array<{
  id: string;
  name: string;
  description: string;
  triggers: string[];
}> {
  return Array.from(flows.values()).map((flow) => ({
    id: flow.flowId,
    name: flow.name,
    description: flow.description,
    triggers: [], // Could be extracted from frontmatter
  }));
}
