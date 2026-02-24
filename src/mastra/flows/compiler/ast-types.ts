// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * AST Types for Mermaid Flowchart
 *
 * Represents the parsed structure of a Mermaid flowchart
 * that can be compiled to a Mastra workflow.
 */

export type FlowNodeKind = "begin" | "end" | "task" | "decision";

export interface FlowNode {
  /** Unique node ID (e.g., "A", "B", "decision1") */
  id: string;

  /** Human-readable label (e.g., "Analyze Task", "Complex?") */
  label: string;

  /** Node type */
  kind: FlowNodeKind;

  /** Raw Mermaid definition for this node */
  raw: string;
}

export interface FlowEdge {
  /** Source node ID */
  src: string;

  /** Destination node ID */
  dst: string;

  /** Edge label for decision branches (e.g., "Yes", "No", "Simple") */
  label: string | null;

  /** Raw Mermaid definition for this edge */
  raw: string;
}

export interface FlowAst {
  /** All nodes in the flow */
  nodes: Map<string, FlowNode>;

  /** Edges grouped by source node */
  edges: Map<string, FlowEdge[]>;

  /** Entry point node ID */
  beginNode: string;

  /** Exit point node ID */
  endNode: string;
}

export interface ParsedSkill {
  /** Frontmatter metadata */
  frontmatter: {
    name: string;
    description: string;
    type: "flow" | "standard";
    [key: string]: any;
  };

  /** Instructions text (excluding Mermaid) */
  instructions: string;

  /** Mermaid diagram text */
  mermaidDiagram: string;

  /** Full path to skill file */
  skillPath: string;
}

export interface CompilationError {
  /** Error type */
  type:
    | "missing_begin"
    | "missing_end"
    | "unreachable_node"
    | "unlabeled_decision_edge"
    | "duplicate_edge_label"
    | "parse_error";

  /** Human-readable message */
  message: string;

  /** Related node ID (if applicable) */
  nodeId?: string;

  /** Related edge (if applicable) */
  edge?: FlowEdge;
}

export interface ValidationResult {
  /** Whether the flow is valid */
  valid: boolean;

  /** Validation errors (if any) */
  errors: CompilationError[];

  /** Warnings (non-fatal issues) */
  warnings: string[];
}
