// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Dynamic Flow Router Workflow
 *
 * Executes Kimi flow skills using runtime state machine traversal.
 * Mirrors Kimi Flow Runner's internal behavior exactly.
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import type { FlowAst, FlowNodeKind, ParsedSkill } from "./native-flow-compiler/ast-types";
import { findFlowInWorkspace } from "./native-flow-execution-workflow";

// ============================================================================
// Error Types
// ============================================================================

export class FlowRouterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FlowRouterError";
  }
}

export class FlowNotFoundError extends FlowRouterError {
  constructor(flowName: string, searchedPaths: string[]) {
    super(`Flow skill "${flowName}" not found in workspace`, "FLOW_NOT_FOUND", { flowName, searchedPaths });
    this.name = "FlowNotFoundError";
  }
}

export class FlowParseError extends FlowRouterError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "FLOW_PARSE_ERROR", details);
    this.name = "FlowParseError";
  }
}

export class FlowExecutionError extends FlowRouterError {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly nodeLabel: string,
    details?: Record<string, unknown>,
  ) {
    super(message, "FLOW_EXECUTION_ERROR", { nodeId, nodeLabel, ...details });
    this.name = "FlowExecutionError";
  }
}

export class MaxMovesExceededError extends FlowRouterError {
  constructor(maxMoves: number, executionPath: string[]) {
    super(`Flow execution exceeded maximum moves (${maxMoves})`, "MAX_MOVES_EXCEEDED", {
      maxMoves,
      executionPath,
      moveCount: executionPath.length,
    });
    this.name = "MaxMovesExceededError";
  }
}

// ============================================================================
// Schemas
// ============================================================================

const flowStateSchema = z.object({
  currentNodeId: z.string(),
  executionPath: z.array(z.string()).default([]),
  moves: z.number().default(0),
  decisions: z
    .array(
      z.object({
        nodeId: z.string(),
        choice: z.string(),
        timestamp: z.string(),
      }),
    )
    .default([]),
  nodeResults: z.record(z.string(), z.string()).default({}),
  userRequest: z.string(),
  context: z.record(z.string(), z.any()).default({}),
  flowGraph: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        kind: z.enum(["begin", "end", "task", "decision"]),
      }),
    ),
    edges: z.array(
      z.object({
        src: z.string(),
        dst: z.string(),
        label: z.string().nullable(),
      }),
    ),
    beginId: z.string(),
    endId: z.string(),
  }),
});

const inputSchema = z.object({
  flowName: z.string().min(1, "Flow name is required"),
  userRequest: z.string().min(1, "User request is required"),
  skillPath: z.string().optional(),
  workingDir: z.string().optional(),
  resume: z.boolean().default(false),
  choice: z.string().optional(),
  executionState: z.any().optional(),
  context: z.record(z.string(), z.any()).optional(),
});

const outputSchema = z.object({
  status: z.enum(["completed", "suspended", "error"]),
  result: z.string().optional(),
  executionPath: z.array(z.string()),
  decisions: z.array(
    z.object({
      nodeId: z.string(),
      choice: z.string(),
    }),
  ),
  finalNode: z.string().optional(),
  error: z.string().optional(),
  metadata: z
    .object({
      moves: z.number(),
      skillName: z.string(),
    })
    .optional(),
});

// ============================================================================
// Helper: Validate and parse skill
// ============================================================================

async function loadAndParseSkill(flowName: string, skillPath: string | undefined, workingDir: string | undefined) {
  let skillFile: string;
  let workspaceRoot: string;

  try {
    const result = await findFlowInWorkspace(flowName, skillPath, workingDir);
    skillFile = result.skillFile;
    workspaceRoot = result.workspaceRoot;
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      throw new FlowNotFoundError(
        flowName,
        error.message
          .match(/Searched paths:([\s\S]+?)(?=To fix:)/)?.[1]
          ?.trim()
          .split("\n") || [],
      );
    }
    throw new FlowRouterError(`Failed to find flow skill: ${error.message}`, "SKILL_DISCOVERY_ERROR", {
      flowName,
      skillPath,
      workingDir,
    });
  }

  // Parse skill file
  const { parseSkillFile } = await import("./native-flow-compiler/skill-parser");
  let skill: ParsedSkill;
  try {
    skill = parseSkillFile(skillFile);
  } catch (error: any) {
    throw new FlowParseError(`Failed to parse skill file "${skillFile}": ${error.message}`, {
      skillFile,
      error: error.message,
    });
  }

  // Validate it's a flow skill
  if (skill.frontmatter.type !== "flow") {
    throw new FlowParseError(`Skill "${flowName}" is not a flow skill (type: ${skill.frontmatter.type})`, {
      skillFile,
      type: skill.frontmatter.type,
    });
  }

  // Parse Mermaid diagram
  const { parseMermaidFlowchart } = await import("./native-flow-compiler/mermaid-parser");
  let ast: FlowAst;
  try {
    ast = parseMermaidFlowchart(skill.mermaidDiagram);
  } catch (error: any) {
    throw new FlowParseError(`Failed to parse Mermaid diagram in "${skillFile}": ${error.message}`, {
      skillFile,
      mermaidDiagram: skill.mermaidDiagram,
    });
  }

  // Validate AST
  const { validateFlowAst } = await import("./native-flow-compiler/mermaid-parser");
  const validation = validateFlowAst(ast);
  if (!validation.valid) {
    throw new FlowParseError(
      `Invalid flow diagram in "${skillFile}": ${validation.errors.map((e) => e.message).join(", ")}`,
      { skillFile, errors: validation.errors },
    );
  }

  return { skill, ast, skillFile, workspaceRoot };
}

// ============================================================================
// Helper: Execute task node
// ============================================================================

async function executeTask(
  node: { id: string; label: string; kind: FlowNodeKind },
  state: z.infer<typeof flowStateSchema>,
  mastra: any,
): Promise<string> {
  const history = state.executionPath
    .map((id) => {
      const n = state.flowGraph.nodes.find((n) => n.id === id);
      const result = state.nodeResults[id];
      return `  - ${n?.label || id}${result ? `: ${result.substring(0, 100)}` : ""}`;
    })
    .join("\n");

  const prompt = `## Task: ${node.label}

## User Request:
${state.userRequest}

## Execution History:
${history || "  (none)"}

Execute this task and summarize what you did.`;

  // Try to get task agent from mastra
  const agent = mastra?.getAgentById("task-agent");

  if (!agent) {
    const availableAgents = mastra?.listAgents().map((a: { id: string }) => a.id) || [];
    throw new FlowExecutionError("Task agent not available - required for task execution", node.id, node.label, {
      availableAgents,
    });
  }

  try {
    const response = await agent.generate(prompt);
    const result = response.text?.trim();

    if (!result) {
      throw new FlowExecutionError("Task agent returned empty response", node.id, node.label);
    }

    return result;
  } catch (error: any) {
    if (error instanceof FlowExecutionError) throw error;

    throw new FlowExecutionError(`Task execution failed: ${error.message}`, node.id, node.label, {
      originalError: error.message,
    });
  }
}

// ============================================================================
// Flow Router Step
// ============================================================================

const flowRouterStep = createStep({
  id: "flow-router",
  description: "Execute flow nodes dynamically using state machine",
  inputSchema,
  outputSchema,
  stateSchema: flowStateSchema,

  suspendSchema: z.object({
    nodeId: z.string(),
    nodeLabel: z.string(),
    question: z.string(),
    options: z.array(
      z.object({
        value: z.string(),
        label: z.string(),
      }),
    ),
    executionPath: z.array(z.string()),
  }),

  resumeSchema: z.object({
    choice: z.string(),
  }),

  execute: async ({ inputData, state, setState, suspend, resumeData, mastra }) => {
    // Validate input
    const parseResult = inputSchema.safeParse(inputData);
    if (!parseResult.success) {
      throw new FlowRouterError(`Invalid input: ${parseResult.error.message}`, "INVALID_INPUT", {
        errors: parseResult.error.issues,
      });
    }

    let flowState: z.infer<typeof flowStateSchema>;

    // Initialize or restore
    if (inputData.resume && inputData.executionState) {
      // Validate execution state
      const stateParse = flowStateSchema.safeParse(inputData.executionState);
      if (!stateParse.success) {
        throw new FlowRouterError("Invalid execution state for resume", "INVALID_RESUME_STATE", {
          errors: stateParse.error.issues,
        });
      }

      flowState = {
        ...stateParse.data,
        currentNodeId: stateParse.data.currentNodeId,
      };
    } else {
      // Load and parse skill
      const { ast, skill, skillFile } = await loadAndParseSkill(
        inputData.flowName,
        inputData.skillPath,
        inputData.workingDir,
      );

      flowState = {
        currentNodeId: ast.beginNode,
        executionPath: [],
        moves: 0,
        decisions: [],
        nodeResults: {},
        userRequest: inputData.userRequest,
        context: inputData.context || {},
        flowGraph: {
          nodes: Array.from(ast.nodes.values()).map((n) => ({
            id: n.id,
            label: n.label,
            kind: n.kind,
          })),
          edges: Array.from(ast.edges.entries()).flatMap(([src, edges]) =>
            edges.map((e) => ({
              src: e.src,
              dst: e.dst,
              label: e.label,
            })),
          ),
          beginId: ast.beginNode,
          endId: ast.endNode,
        },
      };
    }

    await setState(flowState);

    // Main execution loop
    const MAX_MOVES = 1000;

    while (true) {
      const { flowGraph, currentNodeId, moves } = flowState;
      const node = flowGraph.nodes.find((n) => n.id === currentNodeId);

      if (!node) {
        throw new FlowExecutionError(`Node "${currentNodeId}" not found in flow graph`, currentNodeId, "unknown", {
          availableNodes: flowGraph.nodes.map((n) => n.id),
        });
      }

      const edges = flowGraph.edges.filter((e) => e.src === currentNodeId);

      // END node
      if (node.kind === "end") {
        return {
          status: "completed" as const,
          result:
            flowState.nodeResults[flowState.executionPath[flowState.executionPath.length - 1]] ||
            "Flow completed successfully",
          executionPath: [...flowState.executionPath, currentNodeId],
          decisions: flowState.decisions,
          finalNode: currentNodeId,
          metadata: { moves: flowState.moves, skillName: inputData.flowName },
        };
      }

      // BEGIN node - just transition
      if (node.kind === "begin") {
        const nextEdge = edges[0];
        if (!nextEdge) {
          throw new FlowExecutionError("BEGIN node has no outgoing edges", currentNodeId, node.label);
        }

        flowState = {
          ...flowState,
          currentNodeId: nextEdge.dst,
          executionPath: [...flowState.executionPath, currentNodeId],
        };
        await setState(flowState);
        continue;
      }

      // Max moves check
      if (moves >= MAX_MOVES) {
        throw new MaxMovesExceededError(MAX_MOVES, flowState.executionPath);
      }

      flowState = { ...flowState, moves: moves + 1 };

      // DECISION node
      if (node.kind === "decision") {
        // Handle resume with choice
        if (resumeData?.choice) {
          const choice = resumeData.choice;
          const matchingEdge = edges.find((e) => e.label === choice);

          if (!matchingEdge) {
            const availableChoices = edges.map((e) => e.label).filter(Boolean);
            throw new FlowRouterError(
              `Invalid choice "${choice}". Available: ${availableChoices.join(", ") || "none"}`,
              "INVALID_CHOICE",
              { nodeId: currentNodeId, nodeLabel: node.label, choice, availableChoices },
            );
          }

          flowState = {
            ...flowState,
            currentNodeId: matchingEdge.dst,
            executionPath: [...flowState.executionPath, currentNodeId],
            decisions: [
              ...flowState.decisions,
              {
                nodeId: currentNodeId,
                choice,
                timestamp: new Date().toISOString(),
              },
            ],
          };
          await setState(flowState);
          resumeData = undefined;
          continue;
        }

        // Validate edges exist
        if (edges.length === 0) {
          throw new FlowExecutionError("Decision node has no outgoing edges", currentNodeId, node.label);
        }

        // Suspend for user choice
        await suspend({
          nodeId: currentNodeId,
          nodeLabel: node.label,
          question: node.label,
          options: edges.map((e) => ({
            value: e.label || "Continue",
            label: e.label || "Continue",
          })),
          executionPath: flowState.executionPath,
        });

        // Suspended - this won't actually execute due to suspend
        return {
          status: "suspended" as const,
          executionPath: flowState.executionPath,
          decisions: flowState.decisions,
          metadata: { moves: flowState.moves, skillName: inputData.flowName },
        };
      }

      // TASK node
      let taskResult: string;
      try {
        taskResult = await executeTask(node, flowState, mastra);
      } catch (error: any) {
        if (error instanceof FlowExecutionError) throw error;

        throw new FlowExecutionError(`Unexpected error executing task: ${error.message}`, currentNodeId, node.label, {
          originalError: error.message,
          stack: error.stack,
        });
      }

      // Transition to next node
      const nextEdge = edges[0];
      if (!nextEdge) {
        throw new FlowExecutionError("Task node has no outgoing edges", currentNodeId, node.label);
      }

      flowState = {
        ...flowState,
        currentNodeId: nextEdge.dst,
        executionPath: [...flowState.executionPath, currentNodeId],
        nodeResults: {
          ...flowState.nodeResults,
          [currentNodeId]: taskResult,
        },
      };
      await setState(flowState);
    }
  },
});

// ============================================================================
// Workflow with Error Handling
// ============================================================================

export const dynamicFlowRouterWorkflow = createWorkflow({
  id: "dynamicFlow",
  inputSchema,
  outputSchema,
  stateSchema: flowStateSchema,
})
  .then(flowRouterStep)
  .commit();

// ============================================================================
// Exports
// ============================================================================

export type FlowState = z.infer<typeof flowStateSchema>;
export type FlowInput = z.infer<typeof inputSchema>;
export type FlowOutput = z.infer<typeof outputSchema>;
