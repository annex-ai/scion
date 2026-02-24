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

// Loader
export {
  loadFlows,
  getFlow,
  toWorkflowsRecord,
  listFlows,
} from "./loader";

// Compiler
export {
  compileFlowToWorkflow,
  compileParsedFlow,
  compileFlowAst,
  createSimpleWorkflow,
  parseFlowFile,
  parseFlowContent,
  isFlowFile,
  getFlowMetadata,
  parseMermaidFlowchart,
  validateFlowAst,
  getExecutionPath,
} from "./compiler";

// Types
export type {
  FlowFrontmatter,
  ParsedFlow,
  FlowDefinition,
  CompiledFlow,
  FlowError,
  FlowLoaderConfig,
  // Compiler types
  FlowNode,
  FlowNodeKind,
  FlowEdge,
  FlowAst,
  CompileOptions,
  RetryConfig,
  OnFinishParams,
  OnErrorParams,
} from "./types";

// Error types
export {
  CompiledWorkflowError,
  TaskExecutionError,
  LoopExecutionError,
  DecisionExecutionError,
  WorkflowCompilationError,
} from "./compiler/errors";
