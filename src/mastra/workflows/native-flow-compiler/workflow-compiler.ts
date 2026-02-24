// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Workflow Compiler
 *
 * Compiles a Flow AST into a native Mastra workflow.
 *
 * Mapping:
 * - BEGIN node -> Entry point step
 * - Task nodes -> Agent/tool step with LLM call
 * - Decision nodes -> Step with suspend() for user choice using resumeData
 * - END node -> Final step with result
 * - Back-edges (loops) -> .dowhile() with nested workflow
 *
 * Mastra v1.x Patterns Used:
 * - createStep() for all steps (not new Step())
 * - stateSchema for shared workflow state
 * - suspendSchema/resumeSchema for decision steps
 * - suspendData to access original suspend payload on resume
 * - .dowhile() for loop patterns with back-edges
 */

import { RequestContext } from "@mastra/core/request-context";
import type { AnyWorkflow, Step, Workflow } from "@mastra/core/workflows";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { type FlowAst, type FlowEdge, type FlowNode, FlowNodeKind, type ParsedSkill } from "./ast-types";
import { CompiledWorkflowError, DecisionExecutionError, LoopExecutionError, TaskExecutionError } from "./errors";
import { parseMermaidFlowchart, validateFlowAst } from "./mermaid-parser";
import { parseSkillFile } from "./skill-parser";

/**
 * Retry configuration for workflow steps (Mastra best practice)
 */
export interface RetryConfig {
  /** Number of retry attempts */
  attempts: number;
  /** Delay between retries in milliseconds */
  delay: number;
}

/**
 * Lifecycle callback parameters for workflow completion
 */
export interface OnFinishParams {
  runId: string;
  status: "success" | "error" | "suspended";
  result?: any;
  error?: Error;
}

/**
 * Lifecycle callback parameters for step errors
 */
export interface OnErrorParams {
  runId: string;
  error: Error;
  stepId?: string;
}

/**
 * Options for compiling a workflow
 */
export interface CompileOptions {
  /** Workflow ID */
  id: string;

  /** Workflow name */
  name?: string;

  /** Workflow description */
  description?: string;

  /** Enable tracing */
  enableTracing?: boolean;

  /**
   * Step execution handler for task nodes
   * If not provided, a placeholder will be used
   */
  executeTask?: (taskLabel: string, userRequest: string, context: Record<string, any>) => Promise<string>;

  /**
   * Retry configuration for transient failures (Mastra best practice)
   * @default { attempts: 3, delay: 1000 }
   */
  retryConfig?: RetryConfig;

  /**
   * Maximum loop iterations before safety exit
   * @default 100
   */
  maxLoopIterations?: number;

  /**
   * Lifecycle callback when workflow finishes (success or error)
   */
  onFinish?: (params: OnFinishParams) => Promise<void>;

  /**
   * Lifecycle callback when a step encounters an error
   */
  onError?: (params: OnErrorParams) => Promise<void>;
}

// Global state schema for tracking execution across all steps
export const workflowStateSchema = z.object({
  executionPath: z.array(z.string()).default([]),
  decisions: z
    .array(
      z.object({
        node: z.string(),
        choice: z.string(),
      }),
    )
    .default([]),
  context: z.record(z.string(), z.any()).optional(),
  userRequest: z.string().optional(),
});

// Input schema for workflow
export const workflowInputSchema = z.object({
  userRequest: z.string().describe("The user request to process"),
  context: z.record(z.string(), z.any()).optional().describe("Additional context"),
});

// Output schema for workflow (includes status/error per Mastra best practice)
export const workflowOutputSchema = z.object({
  result: z.string().describe("The final result"),
  executionPath: z.array(z.string()).describe("Nodes executed"),
  decisions: z
    .array(
      z.object({
        node: z.string(),
        choice: z.string(),
      }),
    )
    .describe("User decisions made during execution"),
  status: z.enum(["success", "error", "suspended"]).default("success").describe("Workflow execution status"),
  error: z.string().optional().describe("Error message if status is error"),
});

// Output schema for task steps (includes status/error per Mastra best practice)
export const taskOutputSchema = z.object({
  result: z.string().describe("Task execution result"),
  status: z.enum(["success", "error"]).default("success").describe("Task execution status"),
  error: z.string().optional().describe("Error message if status is error"),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string(),
        args: z.any(),
        result: z.any().optional(),
      }),
    )
    .optional(),
  nextNode: z.string().optional(),
});

/**
 * Compile a skill file to a Mastra workflow
 */
export function compileSkillToWorkflow(skillPath: string, options: CompileOptions): AnyWorkflow {
  const skill = parseSkillFile(skillPath);
  return compileParsedSkill(skill, options);
}

/**
 * Compile a parsed skill to a Mastra workflow
 */
export function compileParsedSkill(skill: ParsedSkill, options: CompileOptions): AnyWorkflow {
  const ast = parseMermaidFlowchart(skill.mermaidDiagram);
  return compileFlowAst(ast, skill, options);
}

interface StepConfig {
  id: string;
  node: FlowNode;
  outgoingEdges: FlowEdge[];
  incomingEdges: FlowEdge[];
  isDecision: boolean;
  isTerminal: boolean;
  isBegin: boolean;
}

/**
 * Information about a detected loop in the flow graph
 */
interface LoopInfo {
  /** Node where loop condition is evaluated (decision node) */
  conditionNode: string;
  /** Nodes that form the loop body (in execution order) */
  bodyNodes: string[];
  /** Edge label that continues the loop (e.g., "Yes") */
  continueLabel: string;
  /** Edge label that exits the loop (e.g., "No") */
  exitLabel: string;
  /** Node after the loop (where exit edge leads) */
  exitNode: string;
  /** Node that the continue edge loops back to */
  loopBackTarget: string;
}

/**
 * Compile a Flow AST to a Mastra workflow
 */
export function compileFlowAst(ast: FlowAst, skill: ParsedSkill, options: CompileOptions): AnyWorkflow {
  const stepConfigs = new Map<string, StepConfig>();
  const steps = new Map<string, Step<any, any, any, any, any, any, any, any>>();

  // First pass: Create step configs for all nodes
  for (const [nodeId, node] of ast.nodes) {
    stepConfigs.set(nodeId, createStepConfig(nodeId, node, ast));
  }

  // Second pass: Create Mastra steps with proper state management
  for (const [nodeId, node] of ast.nodes) {
    const step = createMastraStep(nodeId, node, ast, skill, stepConfigs, options);
    steps.set(nodeId, step);
  }

  // Create workflow with state schema
  const workflow = createWorkflow({
    id: options.id,
    description: options.description || skill.frontmatter.description || "",
    inputSchema: workflowInputSchema,
    outputSchema: workflowOutputSchema,
    stateSchema: workflowStateSchema,
    steps: Array.from(steps.values()),
  });

  // Build execution graph using Mastra's control flow methods
  buildExecutionGraph(workflow as any, ast, steps, stepConfigs, options);

  return workflow as AnyWorkflow;
}

function createStepConfig(nodeId: string, node: FlowNode, ast: FlowAst): StepConfig {
  const outgoingEdges = ast.edges.get(nodeId) || [];

  // Find incoming edges
  const incomingEdges: FlowEdge[] = [];
  for (const [src, edges] of ast.edges) {
    for (const edge of edges) {
      if (edge.dst === nodeId) {
        incomingEdges.push(edge);
      }
    }
  }

  return {
    id: nodeId,
    node,
    outgoingEdges,
    incomingEdges,
    isDecision: node.kind === "decision",
    isTerminal: node.kind === "end",
    isBegin: node.kind === "begin",
  };
}

/**
 * Create a Mastra step for a flow node using createStep()
 */
function createMastraStep(
  nodeId: string,
  node: FlowNode,
  ast: FlowAst,
  skill: ParsedSkill,
  stepConfigs: Map<string, StepConfig>,
  options: CompileOptions,
): Step<any, any, any, any, any, any, any, any> {
  const config = stepConfigs.get(nodeId)!;

  if (node.kind === "begin") {
    // BEGIN node: Initialize execution state
    return createStep({
      id: nodeId,
      description: node.label,
      inputSchema: workflowInputSchema,
      outputSchema: z.object({
        initialized: z.boolean(),
      }),
      // State is initialized via initialState in run.start()
      execute: async ({ inputData }) => {
        return { initialized: true };
      },
    });
  }

  if (node.kind === "end") {
    // END node: Finalize execution with proper status handling
    return createStep({
      id: nodeId,
      description: node.label,
      inputSchema: z.object({}).passthrough(), // Accepts any input
      outputSchema: workflowOutputSchema,
      stateSchema: workflowStateSchema,
      execute: async ({ inputData, state }) => {
        // Get the previous step's result from state
        const prevNodeId = config.incomingEdges[0]?.src;
        let result = "Task completed";
        let status: "success" | "error" | "suspended" = "success";
        let errorMessage: string | undefined;

        // Try to get result from previous step in inputData
        if (prevNodeId && inputData && typeof inputData === "object") {
          const prevResult = (inputData as any).result;
          if (prevResult) {
            result = prevResult;
          }

          // Check if previous step had an error
          if ((inputData as any).status === "error") {
            status = "error";
            errorMessage = (inputData as any).error;
          }
        }

        const output = {
          result,
          executionPath: [...(state?.executionPath || []), nodeId],
          decisions: state?.decisions || [],
          status,
          ...(errorMessage && { error: errorMessage }),
        };

        // Call onFinish callback if provided
        if (options.onFinish) {
          await options.onFinish({
            runId: "unknown", // Will be available at runtime
            status,
            result: output,
            error: errorMessage ? new Error(errorMessage) : undefined,
          });
        }

        return output;
      },
    });
  }

  if (node.kind === "decision") {
    // Decision node: Suspend for user choice using resumeData pattern
    // Includes try-catch per Mastra best practice
    const choices = config.outgoingEdges.map((e) => ({
      label: e.label || "Continue",
      nextNode: e.dst,
    }));

    return createStep({
      id: nodeId,
      description: node.label,
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({
        choice: z.string(),
        nextNode: z.string(),
        shouldContinue: z.boolean().optional(), // For loop support
        status: z.enum(["success", "error"]).default("success"),
        error: z.string().optional(),
      }),
      stateSchema: workflowStateSchema,
      // Schema for data passed to suspend()
      suspendSchema: z.object({
        decisionNode: z.string(),
        question: z.string(),
        options: z.array(
          z.object({
            value: z.string(),
            label: z.string(),
          }),
        ),
      }),
      // Schema for data passed to resume()
      resumeSchema: z.object({
        choice: z.string(),
      }),
      execute: async ({ state, setState, suspend, resumeData, suspendData }) => {
        try {
          // On resume, resumeData contains the choice
          if (resumeData?.choice) {
            const choice = resumeData.choice;
            const selectedChoice = choices.find((c) => c.label === choice);

            if (!selectedChoice) {
              const availableChoices = choices.map((c) => c.label);
              const decisionError = new DecisionExecutionError(
                `Invalid choice: ${choice}. Available: ${availableChoices.join(", ")}`,
                options.id,
                nodeId,
                availableChoices,
                choice,
              );

              console.error(`[workflow-compiler] ${decisionError.message}`);

              if (options.onError) {
                await options.onError({
                  runId: "unknown",
                  error: decisionError,
                  stepId: nodeId,
                });
              }

              return {
                choice: "",
                nextNode: "",
                shouldContinue: false,
                status: "error" as const,
                error: decisionError.message,
              };
            }

            // Update state with the decision
            await setState({
              ...state,
              executionPath: [...(state?.executionPath || []), nodeId],
              decisions: [...(state?.decisions || []), { node: nodeId, choice }],
            });

            return {
              choice,
              nextNode: selectedChoice.nextNode,
              // For loop support: check if this choice continues the loop
              shouldContinue: true,
              status: "success" as const,
            };
          }

          // First execution: suspend for user decision
          await suspend({
            decisionNode: nodeId,
            question: node.label,
            options: choices.map((c) => ({
              value: c.label,
              label: c.label,
            })),
          });

          // Will not reach here when suspended
          return { choice: "", nextNode: "", shouldContinue: false, status: "success" as const };
        } catch (error) {
          // Handle unexpected errors during decision execution
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[workflow-compiler] Decision step ${nodeId} error: ${errorMessage}`);

          if (options.onError) {
            await options.onError({
              runId: "unknown",
              error: error instanceof Error ? error : new Error(errorMessage),
              stepId: nodeId,
            });
          }

          return {
            choice: "",
            nextNode: "",
            shouldContinue: false,
            status: "error" as const,
            error: errorMessage,
          };
        }
      },
    });
  }

  // Task node: Execute with Task Agent using createStep (not new Step)
  // Wrapped in try-catch per Mastra best practice
  return createStep({
    id: nodeId,
    description: node.label,
    inputSchema: z.object({}).passthrough(),
    outputSchema: taskOutputSchema,
    stateSchema: workflowStateSchema,
    execute: async ({ state, setState, mastra }) => {
      const nextNode = config.outgoingEdges[0]?.dst;

      try {
        // Build prompt for the task
        const prompt = `## Task: ${node.label}

## User Request:
${state?.userRequest || ""}

Execute this task step and report what you did.`;

        // Get the Task Agent from Mastra
        const agent = mastra?.getAgentById("task-agent");
        if (!agent) {
          // Fall back to placeholder if agent not available
          const taskExecutor = options.executeTask || defaultExecuteTask;
          const result = await taskExecutor(node.label, state?.userRequest || "", state?.context || {});

          await setState({
            ...state,
            executionPath: [...(state?.executionPath || []), nodeId],
          });

          return { result, status: "success" as const, nextNode };
        }

        // Call the Task Agent with general-purpose subagent type
        const requestContext = new RequestContext();
        requestContext.set("subagent-type", "general-purpose");

        const response = await agent.generate(prompt, { requestContext });

        // Update state with execution path
        await setState({
          ...state,
          executionPath: [...(state?.executionPath || []), nodeId],
        });

        // Extract tool calls from response
        const toolCalls = response.toolCalls?.map((tc: any) => ({
          toolName: tc.toolName,
          args: tc.args,
          result: tc.result,
        }));

        return {
          result: response.text || "Task completed",
          status: "success" as const,
          toolCalls,
          nextNode,
        };
      } catch (error) {
        // Create domain-specific error
        const taskError = new TaskExecutionError(
          `Task "${node.label}" failed: ${error instanceof Error ? error.message : String(error)}`,
          options.id,
          nodeId,
          node.label,
          error instanceof Error ? error : undefined,
        );

        // Log error for observability
        console.error(`[workflow-compiler] ${taskError.message}`);

        // Call onError callback if provided
        if (options.onError) {
          await options.onError({
            runId: "unknown", // Will be available at runtime
            error: taskError,
            stepId: nodeId,
          });
        }

        return {
          result: "",
          status: "error" as const,
          error: taskError.message,
          nextNode,
        };
      }
    },
  });
}

// ============================================================================
// Loop Detection and Graph Analysis
// ============================================================================

/**
 * Detect loops (back-edges) in the flow graph using DFS.
 * A back-edge is an edge that points to an ancestor in the DFS tree.
 */
function detectLoops(ast: FlowAst): LoopInfo[] {
  const loops: LoopInfo[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const discoveryOrder = new Map<string, number>();
  let order = 0;

  function dfs(nodeId: string): void {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    discoveryOrder.set(nodeId, order++);

    const edges = ast.edges.get(nodeId) || [];
    for (const edge of edges) {
      if (!visited.has(edge.dst)) {
        dfs(edge.dst);
      } else if (recursionStack.has(edge.dst)) {
        // Back-edge found: nodeId -> edge.dst forms a loop
        const loop = extractLoopInfo(ast, nodeId, edge.dst, edge.label);
        if (loop) {
          loops.push(loop);
        }
      }
    }

    recursionStack.delete(nodeId);
  }

  dfs(ast.beginNode);
  return loops;
}

/**
 * Extract detailed loop information from a detected back-edge.
 */
function extractLoopInfo(
  ast: FlowAst,
  fromNode: string, // Node with the back-edge (usually decision)
  toNode: string, // Target of back-edge (loop entry point)
  continueLabel: string | null,
): LoopInfo | null {
  const node = ast.nodes.get(fromNode);

  // Loops typically originate from decision nodes
  if (node?.kind !== "decision") {
    // Non-decision loop - less common, but handle it
    return {
      conditionNode: fromNode,
      bodyNodes: findPathNodes(ast, toNode, fromNode),
      continueLabel: continueLabel || "Continue",
      exitLabel: "Exit",
      exitNode: "", // Will need to be determined
      loopBackTarget: toNode,
    };
  }

  const edges = ast.edges.get(fromNode) || [];
  const continueEdge = edges.find((e) => e.dst === toNode);
  const exitEdge = edges.find((e) => e.dst !== toNode);

  if (!continueEdge) {
    return null;
  }

  // Find all nodes in loop body (from toNode to fromNode)
  const bodyNodes = findPathNodes(ast, toNode, fromNode);

  return {
    conditionNode: fromNode,
    bodyNodes,
    continueLabel: continueEdge.label || "Continue",
    exitLabel: exitEdge?.label || "Exit",
    exitNode: exitEdge?.dst || ast.endNode,
    loopBackTarget: toNode,
  };
}

/**
 * Find all nodes on the path from startNode to endNode (exclusive of endNode).
 * Used to determine loop body nodes.
 */
function findPathNodes(ast: FlowAst, startNode: string, endNode: string): string[] {
  const pathNodes: string[] = [];
  const visited = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (nodeId === endNode) {
      return true;
    }

    if (visited.has(nodeId)) {
      return false;
    }

    visited.add(nodeId);
    pathNodes.push(nodeId);

    const edges = ast.edges.get(nodeId) || [];
    for (const edge of edges) {
      if (dfs(edge.dst)) {
        return true;
      }
    }

    pathNodes.pop();
    return false;
  }

  dfs(startNode);
  return pathNodes;
}

/**
 * Topological sort with loop handling.
 * Excludes back-edges from the sort to break cycles.
 */
function topologicalSortWithLoops(ast: FlowAst, loops: LoopInfo[]): string[] {
  const backEdges = new Set<string>();
  for (const loop of loops) {
    // Mark the back-edge as: conditionNode -> loopBackTarget
    backEdges.add(`${loop.conditionNode}->${loop.loopBackTarget}`);
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>(); // For cycle detection in non-loop edges

  function visit(nodeId: string): void {
    if (visited.has(nodeId)) {
      return;
    }
    if (temp.has(nodeId)) {
      // This shouldn't happen if loops are detected correctly
      return;
    }

    temp.add(nodeId);

    const edges = ast.edges.get(nodeId) || [];
    for (const edge of edges) {
      const edgeKey = `${nodeId}->${edge.dst}`;
      // Skip back-edges to avoid cycles
      if (!backEdges.has(edgeKey)) {
        visit(edge.dst);
      }
    }

    temp.delete(nodeId);
    visited.add(nodeId);
    result.unshift(nodeId); // Add to front for correct order
  }

  visit(ast.beginNode);

  // Ensure all nodes are included (in case of disconnected subgraphs)
  for (const nodeId of ast.nodes.keys()) {
    if (!visited.has(nodeId)) {
      visit(nodeId);
    }
  }

  return result;
}

// ============================================================================
// Execution Graph Building
// ============================================================================

/**
 * Build execution graph using Mastra's control flow methods.
 * Supports: .then(), .branch() for decisions, .dowhile() for loops
 */
function buildExecutionGraph(
  workflow: AnyWorkflow,
  ast: FlowAst,
  steps: Map<string, Step<any, any, any, any, any, any, any, any>>,
  stepConfigs: Map<string, StepConfig>,
  options: CompileOptions,
): void {
  // Detect loops in the graph
  const loops = detectLoops(ast);
  const loopConditionNodes = new Set(loops.map((l) => l.conditionNode));
  const loopBodyNodes = new Set(loops.flatMap((l) => l.bodyNodes));

  // Get topological order (with loops broken)
  const sortedNodes = topologicalSortWithLoops(ast, loops);

  // Track what we've added to the chain
  const processedNodes = new Set<string>();
  const processedLoops = new Set<string>();

  // Build the workflow chain
  let isFirstStep = true;

  for (const nodeId of sortedNodes) {
    const step = steps.get(nodeId);
    const config = stepConfigs.get(nodeId);

    if (!step || !config) {
      continue;
    }

    // Skip loop body nodes - they're handled by buildLoop
    if (loopBodyNodes.has(nodeId) && !loopConditionNodes.has(nodeId)) {
      continue;
    }

    // Handle loop condition nodes with .dowhile()
    const loop = loops.find((l) => l.conditionNode === nodeId);
    if (loop && !processedLoops.has(loop.conditionNode)) {
      buildLoop(workflow, loop, steps, ast, options, isFirstStep);
      processedLoops.add(loop.conditionNode);
      processedNodes.add(nodeId);
      isFirstStep = false;
      continue;
    }

    // Skip already processed nodes
    if (processedNodes.has(nodeId)) {
      continue;
    }

    // Handle decision nodes (non-loop) with .branch()
    if (config.isDecision && config.outgoingEdges.length > 1 && !loop) {
      if (isFirstStep) {
        workflow.then(step);
      } else {
        workflow.then(step);
      }
      buildBranch(workflow, config, steps, ast);
      processedNodes.add(nodeId);
      isFirstStep = false;
      continue;
    }

    // Linear node - add with .then()
    workflow.then(step);
    processedNodes.add(nodeId);
    isFirstStep = false;
  }

  // Commit the workflow
  workflow.commit();
}

/**
 * Build a loop using .dowhile() with a nested workflow for the loop body.
 * Includes try-catch and error handling per Mastra best practices.
 */
function buildLoop(
  workflow: AnyWorkflow,
  loop: LoopInfo,
  steps: Map<string, Step<any, any, any, any, any, any, any, any>>,
  ast: FlowAst,
  options: CompileOptions,
  isFirstInChain: boolean,
): void {
  // For simple loops, we can use dowhile directly with the decision step
  // The decision step will suspend for user choice, and we check the choice
  // to determine whether to continue looping

  const MAX_ITERATIONS = options.maxLoopIterations || 100;

  // Get all steps for the loop body (excluding the decision node itself)
  const bodySteps = loop.bodyNodes
    .map((nodeId) => steps.get(nodeId))
    .filter((s): s is Step<any, any, any, any, any, any, any, any> => s !== undefined);

  const decisionStep = steps.get(loop.conditionNode);

  if (!decisionStep) {
    console.warn(`[workflow-compiler] Decision step not found for loop: ${loop.conditionNode}`);
    return;
  }

  // Create a combined step that runs the body and then the decision
  // Wrapped in try-catch per Mastra best practice
  const loopBodyStep = createStep({
    id: `loop-iteration-${loop.conditionNode}`,
    description: `Loop iteration for ${loop.conditionNode}`,
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({
      result: z.string().optional(),
      choice: z.string().optional(),
      shouldContinue: z.boolean(),
      status: z.enum(["success", "error"]).default("success"),
      error: z.string().optional(),
    }),
    stateSchema: workflowStateSchema,
    suspendSchema: z.object({
      decisionNode: z.string(),
      question: z.string(),
      options: z.array(
        z.object({
          value: z.string(),
          label: z.string(),
        }),
      ),
    }),
    resumeSchema: z.object({
      choice: z.string(),
    }),
    execute: async (ctx) => {
      const { state, setState, suspend, resumeData, mastra } = ctx;

      try {
        // Execute body steps sequentially
        let lastResult = "";
        for (const bodyNodeId of loop.bodyNodes) {
          const bodyNode = ast.nodes.get(bodyNodeId);
          if (!bodyNode) continue;

          // Execute task
          if (bodyNode.kind === "task") {
            try {
              const taskExecutor = options.executeTask || defaultExecuteTask;
              lastResult = await taskExecutor(bodyNode.label, state?.userRequest || "", state?.context || {});

              await setState({
                ...state,
                executionPath: [...(state?.executionPath || []), bodyNodeId],
              });
            } catch (taskError) {
              // Create domain-specific error for task failure in loop
              const error = new TaskExecutionError(
                `Loop task "${bodyNode.label}" failed: ${taskError instanceof Error ? taskError.message : String(taskError)}`,
                options.id,
                bodyNodeId,
                bodyNode.label,
                taskError instanceof Error ? taskError : undefined,
              );

              console.error(`[workflow-compiler] ${error.message}`);

              if (options.onError) {
                await options.onError({
                  runId: "unknown",
                  error,
                  stepId: bodyNodeId,
                });
              }

              return {
                result: "",
                choice: "",
                shouldContinue: false,
                status: "error" as const,
                error: error.message,
              };
            }
          }
        }

        // Now handle the decision
        if (resumeData?.choice) {
          const choice = resumeData.choice;
          const shouldContinue = choice === loop.continueLabel;

          await setState({
            ...state,
            executionPath: [...(state?.executionPath || []), loop.conditionNode],
            decisions: [...(state?.decisions || []), { node: loop.conditionNode, choice }],
          });

          return {
            result: lastResult,
            choice,
            shouldContinue,
            status: "success" as const,
          };
        }

        // Suspend for decision
        const decisionNode = ast.nodes.get(loop.conditionNode);
        await suspend({
          decisionNode: loop.conditionNode,
          question: decisionNode?.label || "Continue?",
          options: [
            { value: loop.continueLabel, label: loop.continueLabel },
            { value: loop.exitLabel, label: loop.exitLabel },
          ],
        });

        return {
          result: lastResult,
          choice: "",
          shouldContinue: false,
          status: "success" as const,
        };
      } catch (error) {
        // Handle unexpected errors in loop body
        const loopError = new LoopExecutionError(
          `Loop body failed: ${error instanceof Error ? error.message : String(error)}`,
          options.id,
          loop.conditionNode,
          0, // Iteration count not available here
          error instanceof Error ? error : undefined,
        );

        console.error(`[workflow-compiler] ${loopError.message}`);

        if (options.onError) {
          await options.onError({
            runId: "unknown",
            error: loopError,
            stepId: `loop-iteration-${loop.conditionNode}`,
          });
        }

        return {
          result: "",
          choice: "",
          shouldContinue: false,
          status: "error" as const,
          error: loopError.message,
        };
      }
    },
  });

  // Add the dowhile to the workflow
  workflow.dowhile(loopBodyStep, async ({ inputData, iterationCount }: { inputData: any; iterationCount: number }) => {
    // Safety limit - exit loop if max iterations reached
    if (iterationCount >= MAX_ITERATIONS) {
      const loopError = new LoopExecutionError(
        `Loop ${loop.conditionNode} reached max iterations (${MAX_ITERATIONS})`,
        options.id,
        loop.conditionNode,
        iterationCount,
      );

      console.warn(`[workflow-compiler] ${loopError.message}`);

      if (options.onError) {
        await options.onError({
          runId: "unknown",
          error: loopError,
          stepId: loop.conditionNode,
        });
      }

      return false;
    }

    // Exit loop on error status
    if (inputData?.status === "error") {
      console.error(`[workflow-compiler] Loop body error: ${inputData.error}`);
      return false;
    }

    // Continue if the user chose to continue
    return inputData?.shouldContinue === true;
  });
}

/**
 * Build branches for decision nodes using .branch()
 */
function buildBranch(
  workflow: AnyWorkflow,
  config: StepConfig,
  steps: Map<string, Step<any, any, any, any, any, any, any, any>>,
  ast: FlowAst,
): void {
  const branches: Array<
    readonly [(ctx: { inputData: any }) => Promise<boolean>, Step<any, any, any, any, any, any, any, any>]
  > = [];

  for (const edge of config.outgoingEdges) {
    const targetStep = steps.get(edge.dst);
    if (!targetStep) {
      continue;
    }

    const label = edge.label || "Continue";

    branches.push([
      async ({ inputData }: { inputData: any }) => {
        return inputData?.choice === label;
      },
      targetStep,
    ] as const);
  }

  if (branches.length > 0) {
    workflow.branch(branches as any);
  }
}

/**
 * Default task execution (placeholder)
 */
async function defaultExecuteTask(
  taskLabel: string,
  userRequest: string,
  context: Record<string, any>,
): Promise<string> {
  // This is a placeholder - in production this would:
  // 1. Load the appropriate agent
  // 2. Call the agent with the task prompt
  // 3. Return the result
  return `Task "${taskLabel}" completed for: ${userRequest}`;
}

/**
 * Create a simple linear workflow from a skill
 * (Simplified version for initial testing)
 */
export function createSimpleWorkflow(skillPath: string, options?: Partial<CompileOptions>): AnyWorkflow {
  const skill = parseSkillFile(skillPath);
  const ast = parseMermaidFlowchart(skill.mermaidDiagram);

  // Validate the AST
  const { valid, errors } = validateFlowAst(ast);
  if (!valid) {
    throw new Error(`Invalid flow: ${errors.map((e) => e.message).join(", ")}`);
  }

  return compileFlowAst(ast, skill, {
    id: skill.frontmatter.name.replace(/\s+/g, "-").toLowerCase(),
    description: skill.frontmatter.description,
    ...options,
  });
}

// ============================================================================
// Exports for testing
// ============================================================================

export { detectLoops, extractLoopInfo, findPathNodes, topologicalSortWithLoops };

export type { LoopInfo };
