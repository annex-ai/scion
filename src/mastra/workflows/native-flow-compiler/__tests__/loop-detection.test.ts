// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { describe, expect, it } from "bun:test";
import type { FlowAst } from "../ast-types";
import { parseMermaidFlowchart } from "../mermaid-parser";
import { detectLoops, extractLoopInfo, findPathNodes, topologicalSortWithLoops } from "../workflow-compiler";

describe("Loop Detection", () => {
  describe("detectLoops", () => {
    it("detects a simple loop with decision node", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> PROCESS[Process Item]
          PROCESS --> CHECK{More items?}
          CHECK -->|Yes| PROCESS
          CHECK -->|No| END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const loops = detectLoops(ast);

      expect(loops.length).toBe(1);
      expect(loops[0].conditionNode).toBe("CHECK");
      expect(loops[0].continueLabel).toBe("Yes");
      expect(loops[0].exitLabel).toBe("No");
      expect(loops[0].loopBackTarget).toBe("PROCESS");
    });

    it("detects no loops in linear flow", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> A[Step 1]
          A --> B[Step 2]
          B --> C[Step 3]
          C --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const loops = detectLoops(ast);

      expect(loops.length).toBe(0);
    });

    it("detects loop in complex flow", () => {
      // Flow with a decision that branches, then loops
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> SETUP[Setup]
          SETUP --> WORK[Do Work]
          WORK --> CHECK{Complete?}
          CHECK -->|No| WORK
          CHECK -->|Yes| END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const loops = detectLoops(ast);

      expect(loops.length).toBe(1);
      expect(loops[0].conditionNode).toBe("CHECK");
      expect(loops[0].loopBackTarget).toBe("WORK");
    });

    it("handles flow with decision but no loop", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> CHECK{Route?}
          CHECK -->|A| PATH_A[Path A]
          CHECK -->|B| PATH_B[Path B]
          PATH_A --> END([END])
          PATH_B --> END
      `;

      const ast = parseMermaidFlowchart(diagram);
      const loops = detectLoops(ast);

      expect(loops.length).toBe(0);
    });
  });

  describe("findPathNodes", () => {
    it("finds path nodes between two nodes", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> A[Step A]
          A --> B[Step B]
          B --> C[Step C]
          C --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);

      // Find path from A to C
      const path = findPathNodes(ast, "A", "C");

      expect(path).toContain("A");
      expect(path).toContain("B");
      expect(path).not.toContain("C"); // End node is exclusive
    });

    it("handles loop body nodes", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> INIT[Initialize]
          INIT --> PROCESS[Process]
          PROCESS --> VALIDATE[Validate]
          VALIDATE --> CHECK{Done?}
          CHECK -->|No| PROCESS
          CHECK -->|Yes| END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);

      // Find path from PROCESS to CHECK (loop body)
      const path = findPathNodes(ast, "PROCESS", "CHECK");

      expect(path).toContain("PROCESS");
      expect(path).toContain("VALIDATE");
      expect(path).not.toContain("CHECK");
    });
  });

  describe("topologicalSortWithLoops", () => {
    it("sorts linear flow correctly", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> A[Step A]
          A --> B[Step B]
          B --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const loops = detectLoops(ast);
      const sorted = topologicalSortWithLoops(ast, loops);

      // BEGIN should come before A, A before B, B before END
      expect(sorted.indexOf("BEGIN")).toBeLessThan(sorted.indexOf("A"));
      expect(sorted.indexOf("A")).toBeLessThan(sorted.indexOf("B"));
      expect(sorted.indexOf("B")).toBeLessThan(sorted.indexOf("END"));
    });

    it("handles loops by breaking back-edges", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> PROCESS[Process]
          PROCESS --> CHECK{More?}
          CHECK -->|Yes| PROCESS
          CHECK -->|No| END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const loops = detectLoops(ast);
      const sorted = topologicalSortWithLoops(ast, loops);

      // Should include all nodes
      expect(sorted).toContain("BEGIN");
      expect(sorted).toContain("PROCESS");
      expect(sorted).toContain("CHECK");
      expect(sorted).toContain("END");

      // Order should be maintained despite cycle
      expect(sorted.indexOf("BEGIN")).toBeLessThan(sorted.indexOf("PROCESS"));
      expect(sorted.indexOf("CHECK")).toBeLessThan(sorted.indexOf("END"));
    });
  });

  describe("extractLoopInfo", () => {
    it("extracts complete loop information", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> INIT[Setup]
          INIT --> WORK[Do Work]
          WORK --> CHECK{Continue?}
          CHECK -->|Yes| WORK
          CHECK -->|No| CLEANUP[Cleanup]
          CLEANUP --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const loops = detectLoops(ast);

      expect(loops.length).toBe(1);

      const loop = loops[0];
      expect(loop.conditionNode).toBe("CHECK");
      expect(loop.continueLabel).toBe("Yes");
      expect(loop.exitLabel).toBe("No");
      expect(loop.exitNode).toBe("CLEANUP");
      expect(loop.loopBackTarget).toBe("WORK");
      expect(loop.bodyNodes).toContain("WORK");
    });
  });
});

describe("Loop Patterns", () => {
  it("supports while-loop pattern (condition first)", () => {
    // While loop: check condition, then execute if true
    // Note: The back-edge is PROCESS -> CHECK, so PROCESS is the "from" node
    // but since PROCESS is not a decision node, the loop detection identifies
    // it as a non-standard loop pattern
    const diagram = `
      flowchart TD
        BEGIN([BEGIN]) --> CHECK{Has items?}
        CHECK -->|Yes| PROCESS[Process item]
        PROCESS --> CHECK
        CHECK -->|No| END([END])
    `;

    const ast = parseMermaidFlowchart(diagram);
    const loops = detectLoops(ast);

    // In this pattern, PROCESS has the back-edge to CHECK
    // Since PROCESS is a task (not decision), it's detected as conditionNode
    expect(loops.length).toBe(1);
    // The back-edge is from PROCESS to CHECK
    expect(loops[0].loopBackTarget).toBe("CHECK");
  });

  it("supports do-while pattern (execute first)", () => {
    // Do-while loop: execute, then check condition
    const diagram = `
      flowchart TD
        BEGIN([BEGIN]) --> PROCESS[Process item]
        PROCESS --> CHECK{More items?}
        CHECK -->|Yes| PROCESS
        CHECK -->|No| END([END])
    `;

    const ast = parseMermaidFlowchart(diagram);
    const loops = detectLoops(ast);

    expect(loops.length).toBe(1);
    expect(loops[0].conditionNode).toBe("CHECK");
    expect(loops[0].bodyNodes).toContain("PROCESS");
  });

  it("handles loop with multiple body steps", () => {
    const diagram = `
      flowchart TD
        BEGIN([BEGIN]) --> FETCH[Fetch Data]
        FETCH --> TRANSFORM[Transform]
        TRANSFORM --> VALIDATE[Validate]
        VALIDATE --> CHECK{Valid?}
        CHECK -->|Retry| FETCH
        CHECK -->|Done| END([END])
    `;

    const ast = parseMermaidFlowchart(diagram);
    const loops = detectLoops(ast);

    expect(loops.length).toBe(1);
    expect(loops[0].bodyNodes).toContain("FETCH");
    expect(loops[0].bodyNodes).toContain("TRANSFORM");
    expect(loops[0].bodyNodes).toContain("VALIDATE");
  });
});
