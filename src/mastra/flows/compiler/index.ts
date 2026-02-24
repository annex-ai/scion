// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Flow Compiler
 *
 * Compiles Kimi flows (FLOW.md with Mermaid diagrams) to native Mastra workflows.
 *
 * ## Usage
 *
 * ```typescript
 * import { compileFlowToWorkflow, parseFlowFile, parseMermaidFlowchart } from './compiler';
 *
 * // Compile a flow to a Mastra workflow
 * const workflow = compileFlowToWorkflow('path/to/flow/FLOW.md', {
 *   id: 'my-flow',
 *   name: 'My Flow',
 * });
 *
 * // Execute the workflow
 * const result = await workflow.execute({
 *   userRequest: 'Do something',
 * });
 *
 * // Or use the lower-level APIs
 * const flow = parseFlowFile('path/to/flow/FLOW.md');
 * const ast = parseMermaidFlowchart(flow.mermaidDiagram);
 * const workflow = compileFlowAst(ast, flow, { id: 'my-flow' });
 * ```
 */

// AST Types
export type {
  CompilationError,
  FlowAst,
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  ParsedSkill,
  ValidationResult,
} from "./ast-types";
// Error Types (Mastra best practice: domain-specific errors)
export {
  CompiledWorkflowError,
  DecisionExecutionError,
  LoopExecutionError,
  TaskExecutionError,
  WorkflowCompilationError,
} from "./errors";

// Flow Parser
export {
  getFlowMetadata,
  isFlowFile,
  parseFlowContent,
  parseFlowFile,
} from "./flow-parser";
// Mermaid Parser
export {
  getExecutionPath,
  parseMermaidFlowchart,
  validateFlowAst,
} from "./mermaid-parser";
// Workflow Compiler
// Loop detection exports (for testing)
export {
  type CompileOptions,
  compileFlowAst,
  compileFlowToWorkflow,
  compileParsedFlow,
  createSimpleWorkflow,
  detectLoops,
  extractLoopInfo,
  findPathNodes,
  type LoopInfo,
  type OnErrorParams,
  type OnFinishParams,
  type RetryConfig,
  taskOutputSchema,
  topologicalSortWithLoops,
  workflowInputSchema,
  workflowOutputSchema,
  workflowStateSchema,
} from "./workflow-compiler";
