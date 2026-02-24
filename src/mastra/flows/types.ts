// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Flow Types
 *
 * Defines the type system for Flows - executable workflows compiled from
 * FLOW.md files with Mermaid diagrams.
 *
 * Flows are distinct from Skills:
 * - Flows = Executable processes (Mermaid → Mastra workflows)
 * - Skills = Instructional knowledge (markdown guidance)
 */

import type { Workflow } from "@mastra/core/workflows";

// ============================================================================
// Flow Definition Types
// ============================================================================

/**
 * Flow frontmatter metadata from FLOW.md YAML
 */
export interface FlowFrontmatter {
  /** Flow name (1-64 chars, lowercase, hyphens) */
  name: string;
  /** Description of what this flow does */
  description?: string;
  /** Flow version */
  version?: string;
  /** Keywords for discovery */
  tags?: string[];
  /** Trigger words/phrases that activate this flow */
  triggers?: string[];
  /** Model override for this flow */
  model?: string;
  /** Additional arbitrary metadata */
  [key: string]: unknown;
}

/**
 * Parsed flow content from FLOW.md
 */
export interface ParsedFlow {
  /** Frontmatter metadata */
  frontmatter: FlowFrontmatter;
  /** Markdown body (instructions, steps) */
  instructions: string;
  /** Mermaid flowchart diagram (if present) */
  mermaidDiagram: string;
  /** Path to source file */
  flowPath: string;
}

/**
 * A loaded flow ready for compilation
 */
export interface FlowDefinition {
  /** Flow identifier (folder name) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Parsed content */
  parsed: ParsedFlow;
  /** Path to FLOW.md */
  flowPath: string;
  /** Path to flow directory */
  baseDir: string;
  /** Source directory (for debugging) */
  source: string;
}

// ============================================================================
// Compiled Flow Types
// ============================================================================

/**
 * A compiled Mastra workflow from a flow
 */
export interface CompiledFlow {
  /** Workflow ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Compiled Mastra workflow */
  workflow: Workflow;
  /** Source flow path */
  flowPath: string;
  /** Original flow ID */
  flowId: string;
}

/**
 * Result of loading flows from disk
 */
export interface FlowLoadResult {
  /** Successfully compiled flows */
  flows: Map<string, CompiledFlow>;
  /** Flows that failed to compile */
  errors: FlowError[];
}

/**
 * Error during flow loading/compilation
 */
export interface FlowError {
  /** Flow folder name */
  folder: string;
  /** Path to FLOW.md */
  flowPath: string;
  /** Error message */
  error: string;
}

// ============================================================================
// Flow Loader Configuration
// ============================================================================

/**
 * Configuration for the flow loader
 */
export interface FlowLoaderConfig {
  /** Directories to scan for flows */
  paths: string[];
  /** Base path for relative paths */
  basePath?: string;
  /** Auto-compile flows on load */
  autoCompile?: boolean;
}

// ============================================================================
// Re-exports from compiler (for convenience)
// ============================================================================

export type {
  CompilationError,
  FlowAst,
  FlowEdge,
  // AST Types
  FlowNode,
  FlowNodeKind,
  ValidationResult,
} from "./compiler/ast-types";

export type {
  CompileOptions,
  OnErrorParams,
  OnFinishParams,
  RetryConfig,
} from "./compiler/workflow-compiler";
