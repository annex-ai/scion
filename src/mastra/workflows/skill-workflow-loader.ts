// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Skill Workflow Loader
 *
 * Scans workspace at server startup and compiles all flow skills to Mastra workflows.
 * This enables build-time compilation rather than runtime compilation, providing:
 * - Faster execution (no per-request parsing)
 * - Fail-fast validation (errors at startup, not runtime)
 * - Full Mastra Studio visibility with per-step tracing
 * - Native loop support via .dowhile()
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Workflow } from "@mastra/core/workflows";
import { compileSkillToWorkflow } from "./native-flow-compiler";
import { isFlowSkill, parseSkillFile } from "./native-flow-compiler/skill-parser";

export interface LoadedSkillWorkflow {
  /** Workflow ID (skill-{folder-name}) */
  id: string;
  /** Human-readable name from skill frontmatter */
  name: string;
  /** Compiled Mastra workflow */
  workflow: Workflow;
  /** Path to the source SKILL.md file */
  skillPath: string;
}

export interface SkillLoadResult {
  /** Successfully compiled workflows */
  workflows: Map<string, LoadedSkillWorkflow>;
  /** Skills that failed to compile */
  errors: Array<{
    folder: string;
    skillPath: string;
    error: string;
  }>;
}

/**
 * Scan workspace and compile all flow skills to workflows.
 * Called once at server startup.
 *
 * @param workspaceRoot - Root directory of the workspace
 * @returns Map of folder name to compiled workflow info
 */
export async function loadSkillWorkflows(workspaceRoot: string): Promise<SkillLoadResult> {
  const result: SkillLoadResult = {
    workflows: new Map(),
    errors: [],
  };

  // Directories to scan for skills
  const skillDirs = [join(workspaceRoot, "skills"), join(workspaceRoot, ".agent", "skills")];

  for (const skillDir of skillDirs) {
    if (!existsSync(skillDir)) {
      continue;
    }

    let skillFolders: string[];
    try {
      skillFolders = readdirSync(skillDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      console.warn(`[skill-loader] Could not read skill directory: ${skillDir}`);
      continue;
    }

    for (const folder of skillFolders) {
      const skillPath = join(skillDir, folder, "SKILL.md");

      // Skip if no SKILL.md exists
      if (!existsSync(skillPath)) {
        continue;
      }

      // Skip non-flow skills (standard skills don't need workflow compilation)
      if (!isFlowSkill(skillPath)) {
        continue;
      }

      try {
        const skill = parseSkillFile(skillPath);
        const workflowId = `skill-${folder}`;

        const workflow = compileSkillToWorkflow(skillPath, {
          id: workflowId,
          name: skill.frontmatter.name || folder,
          description: skill.frontmatter.description || "",
        });

        result.workflows.set(folder, {
          id: workflowId,
          name: skill.frontmatter.name || folder,
          workflow,
          skillPath,
        });

        console.log(`[skill-loader] Compiled: ${folder} -> ${workflowId}`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        result.errors.push({
          folder,
          skillPath,
          error: errorMessage,
        });

        // Log but don't block server startup
        console.error(`[skill-loader] Failed to compile ${folder}:`, errorMessage);
        console.error(`[skill-loader] Skipping ${folder} - use Dynamic Router for this skill`);
      }
    }
  }

  // Summary log
  const compiledCount = result.workflows.size;
  const errorCount = result.errors.length;

  if (compiledCount > 0 || errorCount > 0) {
    console.log(`[skill-loader] Summary: ${compiledCount} compiled, ${errorCount} errors`);
  }

  return result;
}

/**
 * Get a compiled workflow by skill folder name.
 *
 * @param workflows - Map from loadSkillWorkflows
 * @param folderName - Skill folder name (e.g., "bug-investigator-flow")
 * @returns The loaded workflow info, or undefined if not found
 */
export function getSkillWorkflow(
  workflows: Map<string, LoadedSkillWorkflow>,
  folderName: string,
): LoadedSkillWorkflow | undefined {
  return workflows.get(folderName);
}

/**
 * Convert loaded workflows to a record for Mastra registration.
 *
 * @param workflows - Map from loadSkillWorkflows
 * @returns Record of workflow ID to workflow, suitable for Mastra({ workflows: {...} })
 */
export function toWorkflowsRecord(workflows: Map<string, LoadedSkillWorkflow>): Record<string, Workflow> {
  const record: Record<string, Workflow> = {};

  for (const [_, loaded] of workflows) {
    record[loaded.id] = loaded.workflow;
  }

  return record;
}
