// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findFlowInWorkspace } from "../native-flow-execution-workflow";

const TEST_DIR = "/tmp/find-flow-tests";

const MINIMAL_SKILL = `---
name: test-skill
type: flow
---

# Test Skill

\`\`\`mermaid
flowchart TD
    BEGIN([BEGIN]) --> TASK[Do Task]
    TASK --> END([END])
\`\`\`
`;

describe("findFlowInWorkspace", () => {
  beforeEach(() => {
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true });
      }
    } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true });
    } catch {}
  });

  describe("explicit path", () => {
    it("finds skill when given a direct SKILL.md path", async () => {
      const skillDir = join(TEST_DIR, "my-skill");
      mkdirSync(skillDir, { recursive: true });
      const skillFile = join(skillDir, "SKILL.md");
      writeFileSync(skillFile, MINIMAL_SKILL);

      const result = await findFlowInWorkspace("ignored", skillFile);

      expect(result.skillFile).toBe(skillFile);
      expect(result.workspaceRoot).toBe(TEST_DIR);
    });

    it("finds skill when given a directory containing SKILL.md", async () => {
      const skillDir = join(TEST_DIR, "my-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), MINIMAL_SKILL);

      const result = await findFlowInWorkspace("ignored", skillDir);

      expect(result.skillFile).toBe(join(skillDir, "SKILL.md"));
      expect(result.workspaceRoot).toBe(TEST_DIR);
    });

    it("throws when explicit path does not exist", async () => {
      await expect(findFlowInWorkspace("x", join(TEST_DIR, "nonexistent", "SKILL.md"))).rejects.toThrow(
        "Skill file not found at explicit path",
      );
    });
  });

  describe("workspace discovery with workingDir", () => {
    it("finds skill in skills/ directory", async () => {
      const skillDir = join(TEST_DIR, "skills", "healthcheck");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), MINIMAL_SKILL);

      const result = await findFlowInWorkspace("healthcheck", undefined, TEST_DIR);

      expect(result.skillFile).toBe(join(skillDir, "SKILL.md"));
      expect(result.workspaceRoot).toBe(TEST_DIR);
    });

    it("finds skill in .agent/skills/ directory", async () => {
      const skillDir = join(TEST_DIR, ".agent", "skills", "healthcheck");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), MINIMAL_SKILL);

      const result = await findFlowInWorkspace("healthcheck", undefined, TEST_DIR);

      expect(result.skillFile).toBe(join(skillDir, "SKILL.md"));
      expect(result.workspaceRoot).toBe(TEST_DIR);
    });

    it("prefers skills/ over .agent/skills/", async () => {
      // Create skill in both locations
      const primaryDir = join(TEST_DIR, "skills", "healthcheck");
      const legacyDir = join(TEST_DIR, ".agent", "skills", "healthcheck");
      mkdirSync(primaryDir, { recursive: true });
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(primaryDir, "SKILL.md"), MINIMAL_SKILL);
      writeFileSync(join(legacyDir, "SKILL.md"), MINIMAL_SKILL);

      const result = await findFlowInWorkspace("healthcheck", undefined, TEST_DIR);

      expect(result.skillFile).toBe(join(primaryDir, "SKILL.md"));
    });

    it("finds skill with case-insensitive name match", async () => {
      const skillDir = join(TEST_DIR, "skills", "healthcheck");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), MINIMAL_SKILL);

      // Search with uppercase name — should match via toLowerCase() fallback
      const result = await findFlowInWorkspace("Healthcheck", undefined, TEST_DIR);

      expect(result.skillFile).toBe(join(skillDir, "SKILL.md"));
    });

    it("throws with descriptive error when skill not found", async () => {
      try {
        await findFlowInWorkspace("nonexistent", undefined, TEST_DIR);
        expect(true).toBe(false); // should not reach
      } catch (err: any) {
        expect(err.message).toContain('Flow skill "nonexistent" not found');
        expect(err.message).toContain(`Workspace root: ${TEST_DIR}`);
        expect(err.message).toContain("Searched paths:");
      }
    });
  });

  describe("default workspace root (getProjectRoot fallback)", () => {
    it("uses getProjectRoot when no workingDir is provided", async () => {
      // This test verifies findFlowInWorkspace does NOT use process.cwd()
      // by calling it without workingDir. It should use getProjectRoot()
      // which resolves to the parent of .agent/ directory.
      //
      // We can't easily mock getProjectRoot, but we can verify the error
      // message contains the project root path (not process.cwd()).
      try {
        await findFlowInWorkspace("definitely-nonexistent-skill-xyz");
        expect(true).toBe(false); // should not reach
      } catch (err: any) {
        // The workspace root should be the project root (parent of .agent/)
        // not something like src/mastra/public
        expect(err.message).toContain("Workspace root:");
        // It should NOT contain "public" (the Mastra Studio assets dir)
        expect(err.message).not.toContain("/public");
        // It should contain the actual project root
        expect(err.message).toContain("/home/sacha/dev/scion");
      }
    });
  });
});
