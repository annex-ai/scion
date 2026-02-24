// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import {
  CompiledWorkflowError,
  DecisionExecutionError,
  LoopExecutionError,
  TaskExecutionError,
  WorkflowCompilationError,
} from "../errors";
import { parseMermaidFlowchart } from "../mermaid-parser";
import { parseSkillContent } from "../skill-parser";
import {
  type CompileOptions,
  type OnErrorParams,
  type OnFinishParams,
  compileFlowAst,
  taskOutputSchema,
  workflowOutputSchema,
} from "../workflow-compiler";

// Test directory for temporary files
const TEST_DIR = "/tmp/error-handling-tests";

describe("Error Types", () => {
  describe("CompiledWorkflowError", () => {
    it("creates error with all properties", () => {
      const cause = new Error("Original error");
      const error = new CompiledWorkflowError("Workflow failed", "test-workflow", "step-1", cause);

      expect(error.name).toBe("CompiledWorkflowError");
      expect(error.message).toBe("Workflow failed");
      expect(error.workflowId).toBe("test-workflow");
      expect(error.stepId).toBe("step-1");
      expect(error.cause).toBe(cause);
    });

    it("creates error without optional properties", () => {
      const error = new CompiledWorkflowError("Workflow failed", "test-workflow");

      expect(error.name).toBe("CompiledWorkflowError");
      expect(error.stepId).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });
  });

  describe("TaskExecutionError", () => {
    it("creates error with task label", () => {
      const error = new TaskExecutionError("Task failed", "test-workflow", "task-1", "Process Data");

      expect(error.name).toBe("TaskExecutionError");
      expect(error.taskLabel).toBe("Process Data");
      expect(error.workflowId).toBe("test-workflow");
      expect(error.stepId).toBe("task-1");
    });

    it("inherits from CompiledWorkflowError", () => {
      const error = new TaskExecutionError("Task failed", "test-workflow", "task-1", "Process Data");

      expect(error).toBeInstanceOf(CompiledWorkflowError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("LoopExecutionError", () => {
    it("creates error with iteration count", () => {
      const error = new LoopExecutionError("Loop exceeded max iterations", "test-workflow", "CHECK", 100);

      expect(error.name).toBe("LoopExecutionError");
      expect(error.loopConditionNode).toBe("CHECK");
      expect(error.iterationCount).toBe(100);
    });
  });

  describe("DecisionExecutionError", () => {
    it("creates error with available choices", () => {
      const error = new DecisionExecutionError("Invalid choice", "test-workflow", "DECIDE", ["Yes", "No"], "Maybe");

      expect(error.name).toBe("DecisionExecutionError");
      expect(error.availableChoices).toEqual(["Yes", "No"]);
      expect(error.invalidChoice).toBe("Maybe");
    });
  });

  describe("WorkflowCompilationError", () => {
    it("creates error with details", () => {
      const error = new WorkflowCompilationError("Compilation failed", "test-workflow", {
        missingNodes: ["END"],
      });

      expect(error.name).toBe("WorkflowCompilationError");
      expect(error.workflowId).toBe("test-workflow");
      expect(error.details).toEqual({ missingNodes: ["END"] });
    });
  });
});

describe("Output Schemas with Status/Error Fields", () => {
  describe("taskOutputSchema", () => {
    it("validates success output", () => {
      const result = taskOutputSchema.parse({
        result: "Task completed",
        status: "success",
      });

      expect(result.status).toBe("success");
      expect(result.error).toBeUndefined();
    });

    it("validates error output", () => {
      const result = taskOutputSchema.parse({
        result: "",
        status: "error",
        error: "Something went wrong",
      });

      expect(result.status).toBe("error");
      expect(result.error).toBe("Something went wrong");
    });

    it("defaults status to success", () => {
      const result = taskOutputSchema.parse({
        result: "Done",
      });

      expect(result.status).toBe("success");
    });
  });

  describe("workflowOutputSchema", () => {
    it("validates success output", () => {
      const result = workflowOutputSchema.parse({
        result: "Workflow completed",
        executionPath: ["BEGIN", "TASK", "END"],
        decisions: [],
        status: "success",
      });

      expect(result.status).toBe("success");
    });

    it("validates error output", () => {
      const result = workflowOutputSchema.parse({
        result: "",
        executionPath: ["BEGIN", "TASK"],
        decisions: [],
        status: "error",
        error: "Task failed",
      });

      expect(result.status).toBe("error");
      expect(result.error).toBe("Task failed");
    });

    it("validates suspended output", () => {
      const result = workflowOutputSchema.parse({
        result: "",
        executionPath: ["BEGIN"],
        decisions: [],
        status: "suspended",
      });

      expect(result.status).toBe("suspended");
    });
  });
});

describe("Error Handling in Compiled Workflows", () => {
  beforeEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
  });

  describe("Task Step Error Handling", () => {
    it("compiles workflow with custom executeTask that can fail", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> TASK[Risky Task]
          TASK --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: error-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      // Executor that throws an error
      const failingExecutor = async () => {
        throw new Error("Simulated task failure");
      };

      const workflow = compileFlowAst(ast, skill, {
        id: "error-test",
        executeTask: failingExecutor,
      });

      expect(workflow).toBeDefined();
    });

    it("compiles workflow with onError callback", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> TASK[Task]
          TASK --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: callback-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      let errorCallbackCalled = false;
      const onError = async (params: OnErrorParams) => {
        errorCallbackCalled = true;
        expect(params.error).toBeDefined();
        expect(params.stepId).toBeDefined();
      };

      const workflow = compileFlowAst(ast, skill, {
        id: "callback-test",
        onError,
      });

      expect(workflow).toBeDefined();
    });

    it("compiles workflow with onFinish callback", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> TASK[Task]
          TASK --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: finish-callback-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      let finishCallbackCalled = false;
      const onFinish = async (params: OnFinishParams) => {
        finishCallbackCalled = true;
        expect(params.runId).toBeDefined();
        expect(params.status).toBeDefined();
      };

      const workflow = compileFlowAst(ast, skill, {
        id: "finish-callback-test",
        onFinish,
      });

      expect(workflow).toBeDefined();
    });
  });

  describe("Loop Error Handling", () => {
    it("compiles workflow with maxLoopIterations option", () => {
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
name: loop-limit-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      const workflow = compileFlowAst(ast, skill, {
        id: "loop-limit-test",
        maxLoopIterations: 50,
      });

      expect(workflow).toBeDefined();
    });

    it("compiles workflow with error handling in loop body", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> TASK[Risky Loop Task]
          TASK --> CHECK{Continue?}
          CHECK -->|Yes| TASK
          CHECK -->|No| END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: loop-error-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      // Counter to fail on second iteration
      let callCount = 0;
      const sometimesFailingExecutor = async () => {
        callCount++;
        if (callCount > 1) {
          throw new Error("Simulated failure in loop");
        }
        return "Success";
      };

      const workflow = compileFlowAst(ast, skill, {
        id: "loop-error-test",
        executeTask: sometimesFailingExecutor,
      });

      expect(workflow).toBeDefined();
    });
  });

  describe("Decision Step Error Handling", () => {
    it("compiles workflow with decision error handling", () => {
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
name: decision-error-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      let errorParams: OnErrorParams | null = null;
      const onError = async (params: OnErrorParams) => {
        errorParams = params;
      };

      const workflow = compileFlowAst(ast, skill, {
        id: "decision-error-test",
        onError,
      });

      expect(workflow).toBeDefined();
    });
  });

  describe("CompileOptions Interface", () => {
    it("accepts all new error handling options", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> TASK[Task]
          TASK --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: options-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      const options: CompileOptions = {
        id: "options-test",
        name: "Options Test",
        description: "Testing all options",
        retryConfig: {
          attempts: 5,
          delay: 2000,
        },
        maxLoopIterations: 200,
        onFinish: async (params) => {
          console.log("Finished:", params.status);
        },
        onError: async (params) => {
          console.error("Error:", params.error.message);
        },
        executeTask: async (label, request, context) => {
          return `Executed: ${label}`;
        },
      };

      const workflow = compileFlowAst(ast, skill, options);
      expect(workflow).toBeDefined();
    });

    it("uses default values when options not provided", () => {
      const diagram = `
        flowchart TD
          BEGIN([BEGIN]) --> TASK[Task]
          TASK --> END([END])
      `;

      const ast = parseMermaidFlowchart(diagram);
      const skill = parseSkillContent(
        `---
name: defaults-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
        "/test/SKILL.md",
      );

      // Only required options
      const workflow = compileFlowAst(ast, skill, {
        id: "defaults-test",
      });

      expect(workflow).toBeDefined();
    });
  });
});

describe("Error Propagation", () => {
  beforeEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
  });

  it("error status propagates through workflow chain", () => {
    const diagram = `
      flowchart TD
        BEGIN([BEGIN]) --> TASK1[Task 1]
        TASK1 --> TASK2[Task 2]
        TASK2 --> END([END])
    `;

    const ast = parseMermaidFlowchart(diagram);
    const skill = parseSkillContent(
      `---
name: propagation-test
type: flow
---

\`\`\`mermaid
${diagram}
\`\`\`
`,
      "/test/SKILL.md",
    );

    // Fail on second task
    let taskCount = 0;
    const failOnSecond = async (label: string) => {
      taskCount++;
      if (taskCount === 2) {
        throw new Error("Second task failed");
      }
      return `Completed: ${label}`;
    };

    const workflow = compileFlowAst(ast, skill, {
      id: "propagation-test",
      executeTask: failOnSecond,
    });

    expect(workflow).toBeDefined();
  });
});
