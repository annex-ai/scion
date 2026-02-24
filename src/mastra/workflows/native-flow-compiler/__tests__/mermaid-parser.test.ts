// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { describe, expect, it } from "vitest";
import type { FlowAst } from "../ast-types";
import { getExecutionPath, parseMermaidFlowchart, validateFlowAst } from "../mermaid-parser";

describe("Mermaid Parser", () => {
  describe("parseMermaidFlowchart", () => {
    it("parses a simple flowchart", () => {
      const diagram = `
        flowchart TD
          A([BEGIN]) --> B[Analyze]
          B --> C([END])
      `;

      const ast = parseMermaidFlowchart(diagram);

      expect(ast.nodes.size).toBe(3);
      expect(ast.beginNode).toBe("A");
      expect(ast.endNode).toBe("C");
      expect(ast.nodes.get("A")?.kind).toBe("begin");
      expect(ast.nodes.get("B")?.kind).toBe("task");
      expect(ast.nodes.get("C")?.kind).toBe("end");
    });

    it("parses decision nodes", () => {
      const diagram = `
        flowchart TD
          A([BEGIN]) --> B{Complex?}
          B -->|Yes| C[Delegate]
          B -->|No| D[Execute]
          C --> E([END])
          D --> E
      `;

      const ast = parseMermaidFlowchart(diagram);

      expect(ast.nodes.get("B")?.kind).toBe("decision");
      expect(ast.nodes.get("B")?.label).toBe("Complex?");

      const edges = ast.edges.get("B") || [];
      expect(edges.length).toBe(2);
      expect(edges[0].label).toBe("Yes");
      expect(edges[1].label).toBe("No");
    });

    it("handles implicit node definitions", () => {
      const diagram = `
        flowchart TD
          A([BEGIN]) --> B
          B --> C([END])
      `;

      const ast = parseMermaidFlowchart(diagram);

      expect(ast.nodes.has("A")).toBe(true);
      expect(ast.nodes.has("B")).toBe(true);
      expect(ast.nodes.has("C")).toBe(true);
      expect(ast.nodes.get("A")?.kind).toBe("begin");
      expect(ast.nodes.get("C")?.kind).toBe("end");
    });
  });

  describe("validateFlowAst", () => {
    it("validates a correct flow", () => {
      const diagram = `
        flowchart TD
          A([BEGIN]) --> B[Task]
          B --> C([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const result = validateFlowAst(ast);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("detects missing BEGIN via validation", () => {
      // Create a minimal AST without a proper BEGIN node
      const ast = {
        nodes: new Map([
          ["A", { id: "A", label: "Task", kind: "task" as const, raw: "A[Task]" }],
          ["B", { id: "B", label: "END", kind: "end" as const, raw: "B([END])" }],
        ]),
        edges: new Map([["A", [{ src: "A", dst: "B", label: null, raw: "A --> B" }]]]),
        beginNode: "A",
        endNode: "B",
      } satisfies FlowAst;

      const result = validateFlowAst(ast);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "missing_begin")).toBe(true);
    });

    it("detects unlabeled decision edges", () => {
      // Create AST with unlabeled decision edges
      const ast = {
        nodes: new Map([
          ["A", { id: "A", label: "BEGIN", kind: "begin" as const, raw: "A([BEGIN])" }],
          ["B", { id: "B", label: "Decision", kind: "decision" as const, raw: "B{Decision}" }],
          ["C", { id: "C", label: "Path 1", kind: "task" as const, raw: "C[Path 1]" }],
          ["D", { id: "D", label: "Path 2", kind: "task" as const, raw: "D[Path 2]" }],
          ["E", { id: "E", label: "END", kind: "end" as const, raw: "E([END])" }],
        ]),
        edges: new Map([
          ["A", [{ src: "A", dst: "B", label: null, raw: "A --> B" }]],
          [
            "B",
            [
              { src: "B", dst: "C", label: null, raw: "B --> C" },
              { src: "B", dst: "D", label: null, raw: "B --> D" },
            ],
          ],
          ["C", [{ src: "C", dst: "E", label: null, raw: "C --> E" }]],
          ["D", [{ src: "D", dst: "E", label: null, raw: "D --> E" }]],
        ]),
        beginNode: "A",
        endNode: "E",
      } satisfies FlowAst;

      const result = validateFlowAst(ast);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "unlabeled_decision_edge")).toBe(true);
    });

    it("detects unreachable nodes", () => {
      // Create AST with unreachable nodes
      const ast = {
        nodes: new Map([
          ["A", { id: "A", label: "BEGIN", kind: "begin" as const, raw: "A([BEGIN])" }],
          ["B", { id: "B", label: "Reachable", kind: "task" as const, raw: "B[Reachable]" }],
          ["C", { id: "C", label: "END", kind: "end" as const, raw: "C([END])" }],
          ["D", { id: "D", label: "Unreachable", kind: "task" as const, raw: "D[Unreachable]" }],
          ["E", { id: "E", label: "Also Unreachable", kind: "task" as const, raw: "E[Also Unreachable]" }],
        ]),
        edges: new Map([
          ["A", [{ src: "A", dst: "B", label: null, raw: "A --> B" }]],
          ["B", [{ src: "B", dst: "C", label: null, raw: "B --> C" }]],
          ["D", [{ src: "D", dst: "E", label: null, raw: "D --> E" }]],
        ]),
        beginNode: "A",
        endNode: "C",
      } satisfies FlowAst;

      const result = validateFlowAst(ast);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "unreachable_node")).toBe(true);
    });
  });

  describe("getExecutionPath", () => {
    it("finds path from BEGIN to END", () => {
      // Create a well-formed AST
      const ast = {
        nodes: new Map([
          ["A", { id: "A", label: "BEGIN", kind: "begin" as const, raw: "A([BEGIN])" }],
          ["B", { id: "B", label: "Step 1", kind: "task" as const, raw: "B[Step 1]" }],
          ["C", { id: "C", label: "Step 2", kind: "task" as const, raw: "C[Step 2]" }],
          ["D", { id: "D", label: "END", kind: "end" as const, raw: "D([END])" }],
        ]),
        edges: new Map([
          ["A", [{ src: "A", dst: "B", label: null, raw: "A --> B" }]],
          ["B", [{ src: "B", dst: "C", label: null, raw: "B --> C" }]],
          ["C", [{ src: "C", dst: "D", label: null, raw: "C --> D" }]],
        ]),
        beginNode: "A",
        endNode: "D",
      } satisfies FlowAst;

      const path = getExecutionPath(ast);

      expect(path).toEqual(["A", "B", "C", "D"]);
    });

    it("throws on missing BEGIN node", () => {
      const diagram = `
        flowchart TD
          A[Task] --> B[Task]
          B --> C([END])
      `;

      expect(() => parseMermaidFlowchart(diagram)).toThrow("No BEGIN node found");
    });

    it("throws on missing END node", () => {
      const diagram = `
        flowchart TD
          A([BEGIN]) --> B[Task]
          B --> C[Task]
      `;

      expect(() => parseMermaidFlowchart(diagram)).toThrow("No END node found");
    });

    it("handles decision nodes in path", () => {
      // Create AST with decision node
      const ast = {
        nodes: new Map([
          ["A", { id: "A", label: "BEGIN", kind: "begin" as const, raw: "A([BEGIN])" }],
          ["B", { id: "B", label: "Decision", kind: "decision" as const, raw: "B{Decision}" }],
          ["C", { id: "C", label: "Path A", kind: "task" as const, raw: "C[Path A]" }],
          ["D", { id: "D", label: "Path B", kind: "task" as const, raw: "D[Path B]" }],
          ["E", { id: "E", label: "END", kind: "end" as const, raw: "E([END])" }],
        ]),
        edges: new Map([
          ["A", [{ src: "A", dst: "B", label: null, raw: "A --> B" }]],
          [
            "B",
            [
              { src: "B", dst: "C", label: "Yes", raw: "B -->|Yes| C" },
              { src: "B", dst: "D", label: "No", raw: "B -->|No| D" },
            ],
          ],
          ["C", [{ src: "C", dst: "E", label: null, raw: "C --> E" }]],
          ["D", [{ src: "D", dst: "E", label: null, raw: "D --> E" }]],
        ]),
        beginNode: "A",
        endNode: "E",
      } satisfies FlowAst;

      const path = getExecutionPath(ast);

      // Should take first branch (Yes -> C)
      expect(path).toEqual(["A", "B", "C", "E"]);
    });
  });
});
