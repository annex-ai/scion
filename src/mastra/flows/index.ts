// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Flows System
 *
 * Executable workflows compiled from FLOW.md files with Mermaid diagrams.
 *
 * ## Usage
 *
 * ```typescript
 * import { loadFlows, getFlow, toWorkflowsRecord } from './flows';
 *
 * // Load all flows at startup
 * const result = await loadFlows({
 *   paths: ['.agent/flows'],
 *   basePath: process.cwd(),
 * });
 *
 * // Register with Mastra
 * const workflows = toWorkflowsRecord(result.flows);
 *
 * // Get a specific flow
 * const flow = getFlow(result.flows, 'bug-investigator');
 * ```
 */

// Compiler
export {
  compileFlowAst,
  compileFlowToWorkflow,
  compileParsedFlow,
  createSimpleWorkflow,
  getExecutionPath,
  getFlowMetadata,
  isFlowFile,
  parseFlowContent,
  parseFlowFile,
  parseMermaidFlowchart,
  validateFlowAst,
} from "./compiler";
// Error types
export {
  CompiledWorkflowError,
  DecisionExecutionError,
  LoopExecutionError,
  TaskExecutionError,
  WorkflowCompilationError,
} from "./compiler/errors";
// Loader
export {
  getFlow,
  listFlows,
  loadFlows,
  toWorkflowsRecord,
} from "./loader";
// Types
export type {
  CompiledFlow,
  CompileOptions,
  FlowAst,
  FlowDefinition,
  FlowEdge,
  FlowError,
  FlowFrontmatter,
  FlowLoaderConfig,
  // Compiler types
  FlowNode,
  FlowNodeKind,
  OnErrorParams,
  OnFinishParams,
  ParsedFlow,
  RetryConfig,
} from "./types";
