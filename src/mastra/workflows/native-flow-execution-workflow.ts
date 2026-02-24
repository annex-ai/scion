// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Native Flow Execution Workflow
 *
 * Executes Kimi flow skills (SKILL.md) by compiling them to Mastra workflows.
 * This workflow is registered with the interactive agent and automatically
 * becomes available as the "nativeFlow" tool.
 *
 * Pattern:
 * 1. Find skill file from workspace (.agent/skills/)
 * 2. Compile SKILL.md → Mastra workflow
 * 3. Execute the compiled workflow
 * 4. Handle suspend/resume for decision nodes
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { compileSkillToWorkflow } from "./native-flow-compiler";

/**
 * Workspace-based skill file discovery
 *
 * Searches for flow skills in the configured workspace paths.
 * Uses process.cwd() as the workspace root (matching the agent's Workspace config).
 */
export async function findFlowInWorkspace(
  flowName: string,
  explicitPath?: string,
  workingDir?: string,
): Promise<{ skillFile: string; workspaceRoot: string }> {
  // Use explicit path if provided
  if (explicitPath) {
    const resolvedPath = resolve(explicitPath);

    // Check if it's a direct SKILL.md file path
    if (existsSync(resolvedPath) && resolvedPath.endsWith("SKILL.md")) {
      return {
        skillFile: resolvedPath,
        workspaceRoot: dirname(dirname(resolvedPath)),
      };
    }

    // Check if it's a directory containing SKILL.md
    const skillFileInDir = join(resolvedPath, "SKILL.md");
    if (existsSync(skillFileInDir)) {
      return {
        skillFile: skillFileInDir,
        workspaceRoot: dirname(resolvedPath),
      };
    }

    throw new Error(`Skill file not found at explicit path: ${explicitPath}`);
  }

  // Workspace-based discovery from process.cwd()
  const workspaceRoot = workingDir || process.cwd();

  // Standard workspace skill paths (matching agent's Workspace config)
  const skillPaths = [
    // Primary: skills/ at workspace root
    join(workspaceRoot, "skills", flowName, "SKILL.md"),
    join(workspaceRoot, "skills", flowName.toLowerCase(), "SKILL.md"),

    // Legacy paths for backward compatibility
    join(workspaceRoot, ".agent", "skills", flowName, "SKILL.md"),
    join(workspaceRoot, ".kimi", "skills", flowName, "SKILL.md"),
    join(workspaceRoot, ".claude", "skills", flowName, "SKILL.md"),
  ];

  // Find first existing skill file
  for (const skillFile of skillPaths) {
    if (existsSync(skillFile)) {
      return { skillFile, workspaceRoot };
    }
  }

  // Skill not found
  const searchedPaths = skillPaths.map((p) => `  - ${p}`).join("\n");
  throw new Error(
    `Flow skill "${flowName}" not found in workspace.\n\nWorkspace root: ${workspaceRoot}\n\nSearched paths:\n${searchedPaths}\n\nTo fix:\n  1. Create skill at: ${join(workspaceRoot, "skills", flowName, "SKILL.md")}\n  2. Or provide explicit skillPath parameter`,
  );
}

// Input schema
const inputSchema = z.object({
  flowName: z.string().describe("Name of the flow skill to execute"),
  userRequest: z.string().describe("The user request to process"),
  skillPath: z.string().optional().describe("Explicit path to skill file"),
  workingDir: z.string().optional().describe("Working directory"),
  resume: z.boolean().optional().describe("Resume a suspended execution"),
  executionId: z.string().optional().describe("Execution ID when resuming"),
  choice: z.string().optional().describe("Selected option when resuming"),
});

// Tool call schema for audit trail
const toolCallSchema = z.object({
  toolName: z.string(),
  args: z.any(),
  result: z.any().optional(),
});

// Step audit schema
const stepAuditSchema = z.object({
  stepId: z.string(),
  status: z.string(),
  output: z.string().optional(),
  toolCalls: z.array(toolCallSchema).optional(),
});

// Output schema
const outputSchema = z.object({
  status: z.enum(["completed", "suspended", "error"]),
  result: z.string().optional(),
  executionId: z.string().optional(),
  decisionQuestion: z.string().optional(),
  options: z.array(z.string()).optional(),
  error: z.string().optional(),
  executionPath: z.array(z.string()),
  decisions: z.array(
    z.object({
      node: z.string(),
      choice: z.string(),
    }),
  ),
  audit: z.array(stepAuditSchema).optional(),
});

// State schema for tracking execution
const stateSchema = z.object({
  skillFile: z.string().optional(),
  compiledWorkflow: z.any().optional(),
  runResult: z.any().optional(),
});

/**
 * Step 1: Load and compile the skill
 * Passes through all input fields needed by execute step
 */
const compileStep = createStep({
  id: "compile-skill",
  description: "Find and compile the skill file to a Mastra workflow",
  inputSchema,
  outputSchema: z.object({
    workflow: z.any(),
    userRequest: z.string(),
    resume: z.boolean().optional(),
    executionId: z.string().optional(),
    choice: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const { flowName, skillPath, workingDir, userRequest, resume, executionId, choice } = inputData;

    // Find the skill file using workspace-based discovery
    const { skillFile } = await findFlowInWorkspace(flowName, skillPath, workingDir);

    // Compile to workflow
    const workflow = compileSkillToWorkflow(skillFile, {
      id: flowName.replace(/\s+/g, "-").toLowerCase(),
      name: flowName,
      description: `Compiled ${flowName} skill from ${skillFile}`,
    });

    // Pass through all fields needed by execute step
    return {
      workflow,
      userRequest,
      resume,
      executionId,
      choice,
    };
  },
});

/**
 * Step 2: Execute the compiled workflow
 */
const executeStep = createStep({
  id: "execute-workflow",
  description: "Execute the compiled workflow",
  inputSchema: z.object({
    workflow: z.any(),
    userRequest: z.string(),
    resume: z.boolean().optional(),
    executionId: z.string().optional(),
    choice: z.string().optional(),
  }),
  outputSchema: z.object({
    result: z.any(),
  }),
  execute: async ({ inputData, mastra }) => {
    const { workflow, userRequest, resume, executionId, choice } = inputData;

    // Register mastra instance with the compiled workflow
    // This allows the workflow's steps to access mastra.getAgent(), etc.
    if (mastra && workflow.__registerMastra) {
      workflow.__registerMastra(mastra);
    }

    // Create run
    const run = await workflow.createRun();

    // Execute or resume
    let result: unknown;
    if (resume && executionId) {
      result = await run.resume({
        resumeData: { choice },
      });
    } else {
      result = await run.start({
        inputData: { userRequest },
      });
    }

    return { result };
  },
});

/**
 * Build audit trail from step outputs
 */
function buildAuditTrail(steps: Record<string, any>): Array<{
  stepId: string;
  status: string;
  output?: string;
  toolCalls?: Array<{ toolName: string; args: any; result?: any }>;
}> {
  return Object.entries(steps || {}).map(([stepId, step]: [string, any]) => ({
    stepId,
    status: step.status || "unknown",
    output: step.output?.result,
    toolCalls: step.output?.toolCalls,
  }));
}

/**
 * Step 3: Format the result
 */
const formatResultStep = createStep({
  id: "format-result",
  description: "Format the execution result",
  inputSchema: z.object({
    result: z.any(),
  }),
  outputSchema,
  execute: async ({ inputData }) => {
    const { result } = inputData;

    // Build audit trail from all step outputs
    const audit = buildAuditTrail(result.steps);

    // Handle different statuses
    switch (result.status) {
      case "suspended": {
        const suspendedStep = Object.values(result.steps || {}).find((step: any) => step.status === "suspended") as any;

        return {
          status: "suspended" as const,
          executionId: result.runId,
          decisionQuestion: suspendedStep?.suspendPayload?.question || "Please make a selection",
          options: suspendedStep?.suspendPayload?.options?.map((o: any) => o.value) || [],
          executionPath: Object.keys(result.steps || {}),
          decisions: [],
          audit,
        };
      }

      case "success":
        return {
          status: "completed" as const,
          result: result.result || "Workflow completed successfully",
          executionPath: Object.keys(result.steps || {}),
          decisions: [],
          audit,
        };

      case "failed":
      case "error":
        return {
          status: "error" as const,
          error: result.error || "Workflow execution failed",
          executionPath: Object.keys(result.steps || {}),
          decisions: [],
          audit,
        };

      default:
        return {
          status: "error" as const,
          error: `Unknown status: ${result.status}`,
          executionPath: [],
          decisions: [],
          audit: [],
        };
    }
  },
});

/**
 * Native Flow Execution Workflow
 *
 * This workflow compiles and executes Kimi flow skills.
 * When registered with an agent, Mastra automatically exposes it as a tool.
 */
export const nativeFlowExecutionWorkflow = createWorkflow({
  id: "nativeFlow",
  description:
    "Execute a Kimi flow skill natively as a Mastra workflow. This compiles SKILL.md files to native Mastra workflows for full observability and Studio integration. Use this when you need to execute a deterministic flow skill with step-level debugging and state persistence.",
  inputSchema,
  outputSchema,
  stateSchema,
})
  .then(compileStep)
  .then(executeStep)
  .then(formatResultStep)
  .commit();
