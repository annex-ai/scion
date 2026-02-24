// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSkillWorkflow, loadSkillWorkflows, toWorkflowsRecord } from "../skill-workflow-loader";

// Test directory for temporary skill files
const TEST_DIR = "/tmp/skill-loader-tests";

describe("Skill Workflow Loader", () => {
  beforeEach(() => {
    // Clean up and recreate test directory
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
    } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, ".agent", "skills"), { recursive: true });
    mkdirSync(join(TEST_DIR, "skills"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {}
  });

  describe("loadSkillWorkflows", () => {
    it("loads flow skills from .agent/skills directory", async () => {
      // Create a test flow skill
      const skillDir = join(TEST_DIR, ".agent", "skills", "test-flow");
      mkdirSync(skillDir, { recursive: true });

      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: test-flow
type: flow
description: A test flow skill
---

# Test Flow

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> TASK[Do Task]
    TASK --> END([END])
\`\`\`
`,
      );

      const result = await loadSkillWorkflows(TEST_DIR);

      expect(result.workflows.size).toBe(1);
      expect(result.errors.length).toBe(0);
      expect(result.workflows.has("test-flow")).toBe(true);

      const loaded = result.workflows.get("test-flow");
      expect(loaded?.id).toBe("skill-test-flow");
      expect(loaded?.name).toBe("test-flow");
    });

    it("loads flow skills from skills directory", async () => {
      // Create a test flow skill in the skills directory
      const skillDir = join(TEST_DIR, "skills", "my-skill");
      mkdirSync(skillDir, { recursive: true });

      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: my-skill
type: flow
description: Another test skill
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> ACTION[Perform Action]
    ACTION --> END([END])
\`\`\`
`,
      );

      const result = await loadSkillWorkflows(TEST_DIR);

      expect(result.workflows.size).toBe(1);
      expect(result.workflows.has("my-skill")).toBe(true);
    });

    it("skips non-flow skills", async () => {
      // Create a standard (non-flow) skill
      const skillDir = join(TEST_DIR, ".agent", "skills", "standard-skill");
      mkdirSync(skillDir, { recursive: true });

      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: standard-skill
type: standard
description: A standard skill (no flowchart)
---

# Standard Skill

This is a regular skill without a flow diagram.
`,
      );

      const result = await loadSkillWorkflows(TEST_DIR);

      expect(result.workflows.size).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it("handles compilation errors gracefully", async () => {
      // Create a skill with invalid flow (missing END node)
      const skillDir = join(TEST_DIR, ".agent", "skills", "invalid-flow");
      mkdirSync(skillDir, { recursive: true });

      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: invalid-flow
type: flow
description: An invalid flow
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> TASK[Task]
\`\`\`
`,
      );

      const result = await loadSkillWorkflows(TEST_DIR);

      expect(result.workflows.size).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].folder).toBe("invalid-flow");
    });

    it("loads multiple skills", async () => {
      // Create two flow skills
      const skill1Dir = join(TEST_DIR, ".agent", "skills", "skill-one");
      const skill2Dir = join(TEST_DIR, ".agent", "skills", "skill-two");

      mkdirSync(skill1Dir, { recursive: true });
      mkdirSync(skill2Dir, { recursive: true });

      const flowTemplate = (name: string) => `---
name: ${name}
type: flow
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> TASK[Task for ${name}]
    TASK --> END([END])
\`\`\`
`;

      writeFileSync(join(skill1Dir, "SKILL.md"), flowTemplate("skill-one"));
      writeFileSync(join(skill2Dir, "SKILL.md"), flowTemplate("skill-two"));

      const result = await loadSkillWorkflows(TEST_DIR);

      expect(result.workflows.size).toBe(2);
      expect(result.workflows.has("skill-one")).toBe(true);
      expect(result.workflows.has("skill-two")).toBe(true);
    });

    it("handles missing skill directories", async () => {
      // Remove the skill directories
      rmSync(join(TEST_DIR, ".agent"), { recursive: true });
      rmSync(join(TEST_DIR, "skills"), { recursive: true });

      const result = await loadSkillWorkflows(TEST_DIR);

      expect(result.workflows.size).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it("skips directories without SKILL.md", async () => {
      // Create a directory without SKILL.md
      const emptyDir = join(TEST_DIR, ".agent", "skills", "empty-dir");
      mkdirSync(emptyDir, { recursive: true });

      const result = await loadSkillWorkflows(TEST_DIR);

      expect(result.workflows.size).toBe(0);
      expect(result.errors.length).toBe(0);
    });
  });

  describe("getSkillWorkflow", () => {
    it("retrieves a loaded workflow by folder name", async () => {
      const skillDir = join(TEST_DIR, ".agent", "skills", "lookup-test");
      mkdirSync(skillDir, { recursive: true });

      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: lookup-test
type: flow
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> END([END])
\`\`\`
`,
      );

      const result = await loadSkillWorkflows(TEST_DIR);
      const workflow = getSkillWorkflow(result.workflows, "lookup-test");

      expect(workflow).toBeDefined();
      expect(workflow?.id).toBe("skill-lookup-test");
    });

    it("returns undefined for non-existent workflow", async () => {
      const result = await loadSkillWorkflows(TEST_DIR);
      const workflow = getSkillWorkflow(result.workflows, "non-existent");

      expect(workflow).toBeUndefined();
    });
  });

  describe("toWorkflowsRecord", () => {
    it("converts map to record for Mastra registration", async () => {
      const skill1Dir = join(TEST_DIR, ".agent", "skills", "record-test-1");
      const skill2Dir = join(TEST_DIR, ".agent", "skills", "record-test-2");

      mkdirSync(skill1Dir, { recursive: true });
      mkdirSync(skill2Dir, { recursive: true });

      const flowTemplate = (name: string) => `---
name: ${name}
type: flow
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> END([END])
\`\`\`
`;

      writeFileSync(join(skill1Dir, "SKILL.md"), flowTemplate("record-test-1"));
      writeFileSync(join(skill2Dir, "SKILL.md"), flowTemplate("record-test-2"));

      const result = await loadSkillWorkflows(TEST_DIR);
      const record = toWorkflowsRecord(result.workflows);

      expect(typeof record).toBe("object");
      expect(record["skill-record-test-1"]).toBeDefined();
      expect(record["skill-record-test-2"]).toBeDefined();
    });

    it("returns empty record for empty map", () => {
      const record = toWorkflowsRecord(new Map());

      expect(typeof record).toBe("object");
      expect(Object.keys(record).length).toBe(0);
    });
  });
});

describe("Flow Skill Detection", () => {
  beforeEach(() => {
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
    } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, ".agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {}
  });

  it("detects flow skill by type: flow in frontmatter", async () => {
    const skillDir = join(TEST_DIR, ".agent", "skills", "explicit-type");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: explicit-type
type: flow
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> END([END])
\`\`\`
`,
    );

    const result = await loadSkillWorkflows(TEST_DIR);
    expect(result.workflows.has("explicit-type")).toBe(true);
  });

  it("detects flow skill by flowchart presence", async () => {
    const skillDir = join(TEST_DIR, ".agent", "skills", "implicit-flow");
    mkdirSync(skillDir, { recursive: true });

    // No explicit type, but has flowchart
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: implicit-flow
---

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> END([END])
\`\`\`
`,
    );

    const result = await loadSkillWorkflows(TEST_DIR);
    expect(result.workflows.has("implicit-flow")).toBe(true);
  });
});
