// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Mermaid Flowchart Parser
 *
 * Parses Mermaid flowchart syntax into an AST that can be
 * compiled to a Mastra workflow.
 *
 * Supports:
 * - flowchart TD (top-down)
 * - Node types: [], (), {}, ([BEGIN]), ([END])
 * - Edges: -->, -->|label|
 */

import type { CompilationError, FlowAst, FlowEdge, FlowNode, FlowNodeKind, ValidationResult } from "./ast-types";

/**
 * Parse a Mermaid flowchart into AST
 */
export function parseMermaidFlowchart(diagram: string): FlowAst {
  const lines = diagram
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%") && !line.startsWith("%"));

  // Remove flowchart TD line
  if (lines[0]?.match(/^flowchart\s+(TD|TB|BT|RL|LR)/i)) {
    lines.shift();
  }

  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  for (const line of lines) {
    // Parse edge: A --> B or A -->|label| B
    // Supports shape syntax: A([BEGIN]) --> B[Task] or A -->|label| B
    // The regex now handles labels with spaces by matching up to the arrow for src
    // and from the arrow to end of line for dst
    const edgeMatch = line.match(/^(.+?)\s*-->(?:\|([^|]*)\|)?\s*(.+)$/);
    if (edgeMatch) {
      const [, srcRaw, label, dstRaw] = edgeMatch;

      // Extract node IDs (remove shape syntax like ([...]), [...], {...}, (...))
      const src = extractNodeId(srcRaw.trim());
      const dst = extractNodeId(dstRaw.trim());

      // Infer nodes from edge if not explicitly defined
      if (!nodes.has(src)) {
        nodes.set(src, inferNode(src, srcRaw.trim()));
      }
      if (!nodes.has(dst)) {
        nodes.set(dst, inferNode(dst, dstRaw.trim()));
      }

      edges.push({
        src,
        dst,
        label: label?.trim() || null,
        raw: line,
      });
      continue;
    }

    // Parse node definition: A[label] or B{label} or C([label])
    const nodeMatch = line.match(/^([^\s]+)(\[[^\]]*\]|\{[^}]*\}|\(\[[^\]]*\]\)|\([^)]*\))$/);
    if (nodeMatch) {
      const [, id, shape] = nodeMatch;
      const node = parseNode(id.trim(), shape.trim(), line);
      nodes.set(id.trim(), node);
    }
  }

  // Group edges by source
  const edgesBySrc = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const existing = edgesBySrc.get(edge.src) || [];
    existing.push(edge);
    edgesBySrc.set(edge.src, existing);
  }

  // Find begin and end nodes
  const beginNode = findBeginNode(nodes);
  const endNode = findEndNode(nodes);

  return {
    nodes,
    edges: edgesBySrc,
    beginNode,
    endNode,
  };
}

/**
 * Parse a node definition from Mermaid syntax
 */
function parseNode(id: string, shape: string, raw: string): FlowNode {
  let label: string;
  let kind: FlowNodeKind;

  // ([label]) - Stadium shape (BEGIN/END)
  if (shape.startsWith("([")) {
    label = shape.slice(2, -2).trim();
    const labelLower = label.toLowerCase();
    if (labelLower === "begin") {
      kind = "begin";
    } else if (labelLower === "end") {
      kind = "end";
    } else {
      kind = "task";
    }
  }
  // [label] - Rectangle (task)
  else if (shape.startsWith("[") && shape.endsWith("]")) {
    label = shape.slice(1, -1).trim();
    kind = "task";
  }
  // {label} - Diamond (decision)
  else if (shape.startsWith("{") && shape.endsWith("}")) {
    label = shape.slice(1, -1).trim();
    kind = "decision";
  }
  // (label) - Rounded rectangle (task)
  else if (shape.startsWith("(") && shape.endsWith(")")) {
    label = shape.slice(1, -1).trim();
    kind = "task";
  } else {
    label = shape;
    kind = "task";
  }

  return {
    id,
    label,
    kind,
    raw,
  };
}

/**
 * Extract node ID from raw node reference (removes shape syntax)
 * e.g., "A([BEGIN])" -> "A", "B[Task]" -> "B", "C{Decision}" -> "C"
 */
function extractNodeId(raw: string): string {
  // Match ID followed by shape syntax
  const match = raw.match(/^([^([{]+)(?:\(\[[^\]]*\]\)|\[[^\]]*\]|\{[^}]*\}|\([^)]*\))?$/);
  if (match) {
    return match[1].trim();
  }
  return raw.trim();
}

/**
 * Infer node type from implicit node (appears in edge but not defined)
 * Uses raw shape syntax to determine node type
 */
function inferNode(id: string, raw: string): FlowNode {
  const idLower = id.toLowerCase();

  // Check for stadium shape ([...]) indicating BEGIN/END
  const stadiumMatch = raw.match(/^[^\s]*\(\[([^\]]*)\]\)$/);
  if (stadiumMatch) {
    const label = stadiumMatch[1].trim();
    const labelLower = label.toLowerCase();

    if (labelLower === "begin" || idLower === "begin") {
      return {
        id,
        label: "BEGIN",
        kind: "begin",
        raw: `${id}([BEGIN])`,
      };
    }

    if (labelLower === "end" || idLower === "end") {
      return {
        id,
        label: "END",
        kind: "end",
        raw: `${id}([END])`,
      };
    }

    // Stadium shape with other label -> treat as task
    return {
      id,
      label,
      kind: "task",
      raw,
    };
  }

  // Check for diamond shape {...} indicating decision
  if (raw.includes("{")) {
    const diamondMatch = raw.match(/^[^\s]*\{([^}]*)\}$/);
    if (diamondMatch) {
      return {
        id,
        label: diamondMatch[1].trim(),
        kind: "decision",
        raw,
      };
    }
  }

  // Check for rectangle shape [...]
  if (raw.includes("[")) {
    const rectMatch = raw.match(/^[^\s]*\[([^\]]*)\]$/);
    if (rectMatch) {
      return {
        id,
        label: rectMatch[1].trim(),
        kind: "task",
        raw,
      };
    }
  }

  // Check ID-based inference for plain node IDs
  if (idLower === "begin") {
    return {
      id,
      label: "BEGIN",
      kind: "begin",
      raw: `${id}([BEGIN])`,
    };
  }

  if (idLower === "end") {
    return {
      id,
      label: "END",
      kind: "end",
      raw: `${id}([END])`,
    };
  }

  return {
    id,
    label: id,
    kind: "task",
    raw: `${id}[${id}]`,
  };
}

/**
 * Find the BEGIN node
 */
function findBeginNode(nodes: Map<string, FlowNode>): string {
  for (const [id, node] of nodes) {
    if (node.kind === "begin") {
      return id;
    }
  }

  // Fallback: first node with "begin" in label (case insensitive)
  for (const [id, node] of nodes) {
    if (node.label.toLowerCase() === "begin") {
      return id;
    }
  }

  throw new Error("No BEGIN node found in flowchart");
}

/**
 * Find the END node
 */
function findEndNode(nodes: Map<string, FlowNode>): string {
  for (const [id, node] of nodes) {
    if (node.kind === "end") {
      return id;
    }
  }

  // Fallback: first node with "end" in label (case insensitive)
  for (const [id, node] of nodes) {
    if (node.label.toLowerCase() === "end") {
      return id;
    }
  }

  throw new Error("No END node found in flowchart");
}

/**
 * Validate the parsed flow AST
 */
export function validateFlowAst(ast: FlowAst): ValidationResult {
  const errors: CompilationError[] = [];
  const warnings: string[] = [];

  // Check for BEGIN node
  let hasBegin = false;
  for (const node of ast.nodes.values()) {
    if (node.kind === "begin") {
      hasBegin = true;
      break;
    }
  }
  if (!hasBegin) {
    errors.push({
      type: "missing_begin",
      message: "Flow must have exactly one BEGIN node",
    });
  }

  // Check for END node
  let hasEnd = false;
  for (const node of ast.nodes.values()) {
    if (node.kind === "end") {
      hasEnd = true;
      break;
    }
  }
  if (!hasEnd) {
    errors.push({
      type: "missing_end",
      message: "Flow must have exactly one END node",
    });
  }

  // Check decision nodes have labeled edges
  for (const [nodeId, node] of ast.nodes) {
    if (node.kind === "decision") {
      const outgoingEdges = ast.edges.get(nodeId) || [];

      if (outgoingEdges.length <= 1) {
        // Single exit from decision is OK (simple condition)
        continue;
      }

      // Multiple exits must have labels
      const unlabeledEdges = outgoingEdges.filter((e) => !e.label);
      if (unlabeledEdges.length > 0) {
        errors.push({
          type: "unlabeled_decision_edge",
          message: `Decision node "${node.label}" has ${unlabeledEdges.length} unlabeled edge(s)`,
          nodeId,
        });
      }

      // Check for duplicate labels
      const labels = outgoingEdges.map((e) => e.label).filter(Boolean);
      const uniqueLabels = new Set(labels);
      if (labels.length !== uniqueLabels.size) {
        errors.push({
          type: "duplicate_edge_label",
          message: `Decision node "${node.label}" has duplicate edge labels`,
          nodeId,
        });
      }
    }
  }

  // Check reachability (all nodes should be reachable from BEGIN)
  const reachable = new Set<string>();
  const queue = [ast.beginNode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const outgoingEdges = ast.edges.get(current) || [];
    for (const edge of outgoingEdges) {
      queue.push(edge.dst);
    }
  }

  for (const nodeId of ast.nodes.keys()) {
    if (!reachable.has(nodeId) && nodeId !== ast.beginNode) {
      const node = ast.nodes.get(nodeId)!;
      errors.push({
        type: "unreachable_node",
        message: `Node "${node.label}" (${nodeId}) is not reachable from BEGIN`,
        nodeId,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get execution path from BEGIN to END
 */
export function getExecutionPath(ast: FlowAst): string[] {
  const path: string[] = [];
  const visited = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);

    path.push(nodeId);

    if (nodeId === ast.endNode) {
      return true;
    }

    const outgoingEdges = ast.edges.get(nodeId) || [];
    for (const edge of outgoingEdges) {
      if (dfs(edge.dst)) {
        return true;
      }
    }

    path.pop();
    return false;
  }

  dfs(ast.beginNode);
  return path;
}
