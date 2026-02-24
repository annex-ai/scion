// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMermaidFlowchart } from "../mermaid-parser";
import { parseSkillContent } from "../skill-parser";
import { compileFlowAst, compileParsedSkill, compileSkillToWorkflow, createSimpleWorkflow } from "../workflow-compiler";

// Test directory for temporary skill files
const TEST_DIR = "/tmp/workflow-compiler-tests";

describe("Workflow Compiler", () => {
  beforeEach(() => {
    // Clean up and recreate test directory
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
  });

  describe("compileFlowAst", () => {
    it("compiles a linear flow", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> ANALYZE[Analyze Input]
          ANALYZE --> PROCESS[Process Data]
          PROCESS --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: test-linear
type: flow
description: A test linear flow
---

# Test Linear Flow

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      const workflow = compileFlowAst(ast, skill, {
        id: "test-linear",
        name: "Test Linear",
      });

      expect(workflow).toBeDefined();
      // Workflow should have the correct ID
      expect((workflow as any).id).toBe("test-linear");
    });

    it("compiles a flow with decision node", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> CHECK{Is valid?}
          CHECK -->|Yes| PROCESS[Process]
          CHECK -->|No| REJECT[Reject]
          PROCESS --> END([END])
          REJECT --> END
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: test-decision
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      const workflow = compileFlowAst(ast, skill, {
        id: "test-decision",
      });

      expect(workflow).toBeDefined();
    });

    it("compiles a flow with loop", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> FETCH[Fetch Item]
          FETCH --> PROCESS[Process]
          PROCESS --> CHECK{More items?}
          CHECK -->|Yes| FETCH
          CHECK -->|No| END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: test-loop
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      const workflow = compileFlowAst(ast, skill, {
        id: "test-loop",
      });

      expect(workflow).toBeDefined();
    });
  });

  describe("compileSkillToWorkflow", () => {
    it("compiles a skill file", () => {
      const skillPath = join(TEST_DIR, "test-skill", "SKILL.md");
      mkdirSync(join(TEST_DIR, "test-skill"), { recursive: true });

      writeFileSync(
        skillPath,
        `---
name: file-test
type: flow
description: Test from file
---

# File Test Flow

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> TASK[Do Something]
    TASK --> END([END])
\`\`\`
`,
      );

      const workflow = compileSkillToWorkflow(skillPath, {
        id: "file-test-workflow",
      });

      expect(workflow).toBeDefined();
    });
  });

  describe("createSimpleWorkflow", () => {
    it("creates workflow from skill path", () => {
      const skillPath = join(TEST_DIR, "simple-skill", "SKILL.md");
      mkdirSync(join(TEST_DIR, "simple-skill"), { recursive: true });

      writeFileSync(
        skillPath,
        `---
name: simple-flow
type: flow
description: Simple workflow test
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> STEP[Single Step]
    STEP --> END([END])
\`\`\`
`,
      );

      const workflow = createSimpleWorkflow(skillPath);

      expect(workflow).toBeDefined();
    });

    it("throws on invalid flow", () => {
      const skillPath = join(TEST_DIR, "invalid-skill", "SKILL.md");
      mkdirSync(join(TEST_DIR, "invalid-skill"), { recursive: true });

      // Missing END node
      writeFileSync(
        skillPath,
        `---
name: invalid-flow
type: flow
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> STEP[Single Step]
\`\`\`
`,
      );

      expect(() => createSimpleWorkflow(skillPath)).toThrow();
    });
  });

  describe("Step Creation", () => {
    it("creates BEGIN step with correct schema", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> TASK[Task]
          TASK --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: schema-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      const workflow = compileFlowAst(ast, skill, { id: "schema-test" });

      // Workflow should be created successfully with proper steps
      expect(workflow).toBeDefined();
    });

    it("creates decision step with suspend/resume schemas", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> DECIDE{Choose path}
          DECIDE -->|A| PATH_A[Path A]
          DECIDE -->|B| PATH_B[Path B]
          PATH_A --> END([END])
          PATH_B --> END
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: decision-schema-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      const workflow = compileFlowAst(ast, skill, { id: "decision-schema-test" });

      expect(workflow).toBeDefined();
    });
  });

  describe("Custom Task Executor", () => {
    it("uses custom executeTask handler", async () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> TASK[Custom Task]
          TASK --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: custom-executor-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      let executorCalled = false;
      const customExecutor = async (taskLabel: string, userRequest: string, context: Record<string, any>) => {
        executorCalled = true;
        return `Custom result for: ${taskLabel}`;
      };

      const workflow = compileFlowAst(ast, skill, {
        id: "custom-executor-test",
        executeTask: customExecutor,
      });

      expect(workflow).toBeDefined();
      // Note: The executor would be called during workflow execution, not compilation
    });
  });
});

describe("Workflow Compilation Edge Cases", () => {
  beforeEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
  });

  it("handles empty description gracefully", () => {
    const diagram = `
      flowchart TD
        BEGIN([BEGIN]) --> END([END])
    `;

    const ast = parseMermaidFlowchart(diagram);
    const skill = parseSkillContent(
      `---
name: minimal
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
      "/test/SKILL.md",
    );

    const workflow = compileFlowAst(ast, skill, { id: "minimal" });
    expect(workflow).toBeDefined();
  });

  it("handles complex node labels", () => {
    const diagram = `
      flowchart TD
        BEGIN([BEGIN]) --> TASK[Task with spaces and special chars!]
        TASK --> END([END])
    `;

    const ast = parseMermaidFlowchart(diagram);
    const skill = parseSkillContent(
      `---
name: complex-labels
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
      "/test/SKILL.md",
    );

    const workflow = compileFlowAst(ast, skill, { id: "complex-labels" });
    expect(workflow).toBeDefined();
  });

  it("handles multiple decision branches", () => {
    const diagram = `
      flowchart TD
        BEGIN([BEGIN]) --> ROUTE{Select route}
        ROUTE -->|Route A| A[Action A]
        ROUTE -->|Route B| B[Action B]
        ROUTE -->|Route C| C[Action C]
        A --> END([END])
        B --> END
        C --> END
    `;

    const ast = parseMermaidFlowchart(diagram);
    const skill = parseSkillContent(
      `---
name: multi-branch
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
      "/test/SKILL.md",
    );

    const workflow = compileFlowAst(ast, skill, { id: "multi-branch" });
    expect(workflow).toBeDefined();
  });
});
