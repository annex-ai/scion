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
  FlowNode,
  FlowNodeKind,
  FlowEdge,
  FlowAst,
  ParsedSkill,
  CompilationError,
  ValidationResult,
} from "./ast-types";

// Mermaid Parser
export {
  parseMermaidFlowchart,
  validateFlowAst,
  getExecutionPath,
} from "./mermaid-parser";

// Flow Parser
export {
  parseFlowFile,
  parseFlowContent,
  isFlowFile,
  getFlowMetadata,
} from "./flow-parser";

// Workflow Compiler
export {
  compileFlowToWorkflow,
  compileParsedFlow,
  compileFlowAst,
  createSimpleWorkflow,
  type CompileOptions,
  type RetryConfig,
  type OnFinishParams,
  type OnErrorParams,
} from "./workflow-compiler";
export {
  workflowStateSchema,
  workflowInputSchema,
  workflowOutputSchema,
  taskOutputSchema,
} from "./workflow-compiler";

// Error Types (Mastra best practice: domain-specific errors)
export {
  CompiledWorkflowError,
  TaskExecutionError,
  LoopExecutionError,
  DecisionExecutionError,
  WorkflowCompilationError,
} from "./errors";

// Loop detection exports (for testing)
export {
  detectLoops,
  extractLoopInfo,
  findPathNodes,
  topologicalSortWithLoops,
  type LoopInfo,
} from "./workflow-compiler";
