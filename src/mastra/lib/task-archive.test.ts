// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Task Archive Utilities — Unit Tests
 *
 * Tests for working memory archival and clearing functions.
 * Run: bun test src/mastra/lib/task-archive.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  archiveWorkingMemory,
  backupWorkingMemory,
  buildClearedWorkingMemory,
  extractTaskSection,
  hashTaskSection,
  isAllTasksComplete,
} from "./task-archive";

// ============================================================================
// Test Fixtures
// ============================================================================

const SAMPLE_WM_ALL_COMPLETE = `## Goal:
Implement user authentication system

### Pending Tasks:

### Completed Tasks:
- [x] [#1] Set up OAuth provider
- [x] [#2] Create login endpoint
- [x] [#3] Add session management

## Progress Log:
- [2026-02-15T10:00:00Z] Created task #1
- [2026-02-15T10:30:00Z] Completed task #1

## Notes & Context:
Using Auth0 for OAuth integration.
`;

const SAMPLE_WM_MIXED = `## Goal:
Build dashboard

### Pending Tasks:
- [ ] [#3] Add charts

### Completed Tasks:
- [x] [#1] Set up layout
- [x] [#2] Create sidebar

## Progress Log:
- [2026-02-15T10:00:00Z] Created tasks

## Notes & Context:
React with Tailwind CSS.
`;

const SAMPLE_WM_IN_PROGRESS = `## Goal:
Deploy app

### Pending Tasks:
- [-] [#1] Configure CI/CD

### Completed Tasks:
- [x] [#2] Write Dockerfile

## Progress Log:

## Notes & Context:
`;

const SAMPLE_WM_EMPTY_TASKS = `## Goal:
[Unset]

### Pending Tasks:

### Completed Tasks:

## Progress Log:

## Notes & Context:
`;

const SAMPLE_WM_NO_NOTES = `## Goal:
Quick fix

### Pending Tasks:

### Completed Tasks:
- [x] [#1] Fix typo

## Progress Log:
- [2026-02-15T10:00:00Z] Created task #1
`;

// ============================================================================
// isAllTasksComplete
// ============================================================================

describe("isAllTasksComplete", () => {
  test("returns true when all tasks are completed", () => {
    expect(isAllTasksComplete(SAMPLE_WM_ALL_COMPLETE)).toBe(true);
  });

  test("returns false when tasks are mixed (pending + completed)", () => {
    expect(isAllTasksComplete(SAMPLE_WM_MIXED)).toBe(false);
  });

  test("returns false when tasks are in progress", () => {
    expect(isAllTasksComplete(SAMPLE_WM_IN_PROGRESS)).toBe(false);
  });

  test("returns false when no tasks exist", () => {
    expect(isAllTasksComplete(SAMPLE_WM_EMPTY_TASKS)).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isAllTasksComplete("")).toBe(false);
  });

  test("returns true for single completed task", () => {
    const md = "### Pending Tasks:\n\n### Completed Tasks:\n- [x] [#1] Only task\n\n## Progress Log:\n";
    expect(isAllTasksComplete(md)).toBe(true);
  });

  test("returns false after clearing (no tasks in cleared WM)", () => {
    const cleared = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md");
    expect(isAllTasksComplete(cleared)).toBe(false);
  });
});

// ============================================================================
// extractTaskSection
// ============================================================================

describe("extractTaskSection", () => {
  test("extracts section between Pending Tasks and Progress Log", () => {
    const section = extractTaskSection(SAMPLE_WM_ALL_COMPLETE);
    expect(section).toContain("### Pending Tasks:");
    expect(section).toContain("- [x] [#1] Set up OAuth provider");
    expect(section).not.toContain("## Progress Log:");
    expect(section).not.toContain("Created task #1");
  });

  test("returns empty string when no Pending Tasks section", () => {
    expect(extractTaskSection("no tasks here")).toBe("");
  });

  test("returns rest of content if no Progress Log section", () => {
    const md = "### Pending Tasks:\n- [x] [#1] Done\n### Completed Tasks:\n- [x] [#1] Done";
    const section = extractTaskSection(md);
    expect(section).toContain("### Pending Tasks:");
    expect(section).toContain("- [x] [#1] Done");
  });

  test("includes Completed Tasks section in extraction", () => {
    const section = extractTaskSection(SAMPLE_WM_ALL_COMPLETE);
    expect(section).toContain("### Completed Tasks:");
    expect(section).toContain("- [x] [#3] Add session management");
  });

  test("excludes Notes & Context from extraction", () => {
    const section = extractTaskSection(SAMPLE_WM_ALL_COMPLETE);
    expect(section).not.toContain("Auth0");
    expect(section).not.toContain("Notes & Context");
  });

  test("handles cleared working memory correctly", () => {
    const cleared = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md");
    const section = extractTaskSection(cleared);
    expect(section).toContain("### Pending Tasks:");
    // No task items in cleared WM
    expect(section).not.toMatch(/\[#\d+\]/);
  });
});

// ============================================================================
// hashTaskSection
// ============================================================================

describe("hashTaskSection", () => {
  test("returns stable hash for same input", () => {
    const hash1 = hashTaskSection(SAMPLE_WM_ALL_COMPLETE);
    const hash2 = hashTaskSection(SAMPLE_WM_ALL_COMPLETE);
    expect(hash1).toBe(hash2);
  });

  test("returns different hash for different task content", () => {
    const hash1 = hashTaskSection(SAMPLE_WM_ALL_COMPLETE);
    const hash2 = hashTaskSection(SAMPLE_WM_MIXED);
    expect(hash1).not.toBe(hash2);
  });

  test("is not affected by progress log changes", () => {
    const md1 = "### Pending Tasks:\n- [x] [#1] Done\n\n## Progress Log:\n- Old entry";
    const md2 = "### Pending Tasks:\n- [x] [#1] Done\n\n## Progress Log:\n- New entry";
    expect(hashTaskSection(md1)).toBe(hashTaskSection(md2));
  });

  test("returns a hex string", () => {
    const hash = hashTaskSection(SAMPLE_WM_ALL_COMPLETE);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  test("empty task section produces consistent hash", () => {
    const hash1 = hashTaskSection("no pending tasks section here");
    const hash2 = hashTaskSection("something completely different");
    // Both have no task section, so both hash the empty string
    expect(hash1).toBe(hash2);
  });

  test("cleared WM produces stable hash", () => {
    const cleared = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md");
    const hash1 = hashTaskSection(cleared);
    const hash2 = hashTaskSection(cleared);
    expect(hash1).toBe(hash2);
  });

  test("is sensitive to task text changes", () => {
    const md1 = "### Pending Tasks:\n- [x] [#1] Original text\n\n## Progress Log:\n";
    const md2 = "### Pending Tasks:\n- [x] [#1] Modified text\n\n## Progress Log:\n";
    expect(hashTaskSection(md1)).not.toBe(hashTaskSection(md2));
  });

  test("is sensitive to task status changes", () => {
    const md1 = "### Pending Tasks:\n- [ ] [#1] Some task\n\n## Progress Log:\n";
    const md2 = "### Pending Tasks:\n- [x] [#1] Some task\n\n## Progress Log:\n";
    expect(hashTaskSection(md1)).not.toBe(hashTaskSection(md2));
  });
});

// ============================================================================
// archiveWorkingMemory (filesystem tests)
// ============================================================================

describe("archiveWorkingMemory", () => {
  // resolveConfigPath resolves relative to .agent/ which is already loaded.
  // We test the function's output by checking the actual file it writes.

  const archivePath = resolve(import.meta.dir, "..", "..", "..", ".agent", "TASK-ARCHIVE.md");
  let existedBefore = false;
  let originalContent = "";

  beforeEach(() => {
    existedBefore = existsSync(archivePath);
    if (existedBefore) {
      originalContent = readFileSync(archivePath, "utf-8");
    }
    // Start with a clean file for each test
    if (existsSync(archivePath)) {
      rmSync(archivePath);
    }
  });

  afterEach(() => {
    // Restore original state
    if (existedBefore) {
      writeFileSync(archivePath, originalContent);
    } else if (existsSync(archivePath)) {
      rmSync(archivePath);
    }
  });

  test("creates archive file with correct format", async () => {
    const result = await archiveWorkingMemory(SAMPLE_WM_ALL_COMPLETE);

    expect(result).toBe(archivePath);
    expect(existsSync(archivePath)).toBe(true);

    const content = readFileSync(archivePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("## Archive —");
    expect(content).toContain("**Goal:** Implement user authentication system");
    expect(content).toContain("**Tasks:** 3 completed");
    expect(content).toContain("**Type:** Natural completion");
    expect(content).toContain("### Completed Tasks");
    expect(content).toContain("- [x] [#1] Set up OAuth provider");
    expect(content).toContain("- [x] [#2] Create login endpoint");
    expect(content).toContain("- [x] [#3] Add session management");
  });

  test("appends second archive to same file", async () => {
    await archiveWorkingMemory(SAMPLE_WM_ALL_COMPLETE);
    await archiveWorkingMemory(SAMPLE_WM_ALL_COMPLETE);

    const content = readFileSync(archivePath, "utf-8");
    // Should have two "## Archive —" entries
    const archiveMatches = content.match(/## Archive —/g);
    expect(archiveMatches?.length).toBe(2);
  });

  test("writes forced archive with reason", async () => {
    await archiveWorkingMemory(SAMPLE_WM_ALL_COMPLETE, {
      forced: true,
      reason: "Emergency pivot to new priority",
    });

    const content = readFileSync(archivePath, "utf-8");
    expect(content).toContain('**Type:** Forced — "Emergency pivot to new priority"');
  });

  test("preserves Notes & Context in archive", async () => {
    await archiveWorkingMemory(SAMPLE_WM_ALL_COMPLETE);

    const content = readFileSync(archivePath, "utf-8");
    expect(content).toContain("### Notes & Context");
    expect(content).toContain("Using Auth0 for OAuth integration.");
  });

  test("omits Notes section when original has no notes", async () => {
    await archiveWorkingMemory(SAMPLE_WM_NO_NOTES);

    const content = readFileSync(archivePath, "utf-8");
    // No notes section in the archive (extractNotes returns '' for no notes)
    expect(content).not.toContain("### Notes & Context");
  });
});

// ============================================================================
// buildClearedWorkingMemory
// ============================================================================

describe("buildClearedWorkingMemory", () => {
  test("generates cleared template with progress log entry", () => {
    const result = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, "/project/.agent/TASK-ARCHIVE.md");

    expect(result).toContain("## Goal:\n[Unset]");
    expect(result).toContain("### Pending Tasks:");
    expect(result).toContain("### Completed Tasks:");
    expect(result).toContain("## Progress Log:");
    expect(result).toContain("Archived 3 tasks");
    expect(result).toContain("natural completion");
    expect(result).toContain(".agent/TASK-ARCHIVE.md");
  });

  test("preserves notes by default", () => {
    const result = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, "/project/.agent/TASK-ARCHIVE.md");

    expect(result).toContain("## Notes & Context:");
    expect(result).toContain("Using Auth0 for OAuth integration.");
  });

  test("clears notes when preserveNotes=false", () => {
    const result = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, "/project/.agent/TASK-ARCHIVE.md", {
      preserveNotes: false,
    });

    expect(result).toContain("## Notes & Context:");
    expect(result).not.toContain("Auth0");
  });

  test("handles missing Notes section gracefully", () => {
    const result = buildClearedWorkingMemory(SAMPLE_WM_NO_NOTES, "/project/.agent/TASK-ARCHIVE.md");

    expect(result).toContain("## Notes & Context:");
    expect(result).toContain("## Goal:\n[Unset]");
    // Should have archived 1 task
    expect(result).toContain("Archived 1 tasks");
  });

  test("includes correct task count from mixed WM", () => {
    const result = buildClearedWorkingMemory(SAMPLE_WM_MIXED, "/project/.agent/TASK-ARCHIVE.md");

    // Only 2 tasks are completed in mixed WM
    expect(result).toContain("Archived 2 tasks");
  });

  test("uses forced log entry when forced=true", () => {
    const result = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, "/project/.agent/TASK-ARCHIVE.md", {
      forced: true,
      reason: "Pivoting to new feature",
    });

    expect(result).toContain('(forced: "Pivoting to new feature")');
    expect(result).not.toContain("natural completion");
  });

  test("uses natural completion log entry by default", () => {
    const result = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, "/project/.agent/TASK-ARCHIVE.md");

    expect(result).toContain("(natural completion)");
    expect(result).not.toContain("forced");
  });
});

// ============================================================================
// backupWorkingMemory (filesystem tests)
// ============================================================================

describe("backupWorkingMemory", () => {
  const backupDir = resolve(import.meta.dir, "..", "..", "..", ".agent", ".backups");
  let existedBefore = false;
  let originalFiles: string[] = [];

  beforeEach(() => {
    existedBefore = existsSync(backupDir);
    if (existedBefore) {
      originalFiles = readdirSync(backupDir);
    }
  });

  afterEach(() => {
    // Clean up test backups (those created during the test)
    if (existsSync(backupDir)) {
      const currentFiles = readdirSync(backupDir);
      for (const f of currentFiles) {
        if (!originalFiles.includes(f)) {
          try {
            rmSync(join(backupDir, f));
          } catch {}
        }
      }
    }
    if (!existedBefore && existsSync(backupDir)) {
      try {
        rmSync(backupDir, { recursive: true });
      } catch {}
    }
  });

  test("creates backup file with correct content", async () => {
    const path = await backupWorkingMemory(SAMPLE_WM_ALL_COMPLETE);

    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toBe(SAMPLE_WM_ALL_COMPLETE);
  });

  test("backup filename contains timestamp", async () => {
    const path = await backupWorkingMemory(SAMPLE_WM_ALL_COMPLETE);

    expect(path).toContain("working-memory-");
    expect(path).toContain(".md");
    // Timestamp should be in the filename (colons replaced with dashes)
    expect(path).toMatch(/working-memory-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
  });

  test("creates .backups directory if missing", async () => {
    // Clean up first if it exists and was empty before
    if (!existedBefore && existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true });
    }

    const path = await backupWorkingMemory("test content");

    expect(existsSync(backupDir)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  test("keeps only last 5 backups (rolling cleanup)", async () => {
    // Create 7 backups
    const paths: string[] = [];
    for (let i = 0; i < 7; i++) {
      // Small delay to ensure unique timestamps
      const path = await backupWorkingMemory(`backup content ${i}`);
      paths.push(path);
      // Wait a tiny bit to get different timestamps
      await new Promise((r) => setTimeout(r, 10));
    }

    // Count test backups (exclude pre-existing ones)
    const currentFiles = readdirSync(backupDir)
      .filter((f) => f.startsWith("working-memory-"))
      .filter((f) => !originalFiles.includes(f));

    // Should have at most 5 test backups (cleanup removes oldest)
    expect(currentFiles.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// Integration: Full archive flow (pure function simulation)
// ============================================================================

describe("full archive flow (pure functions)", () => {
  test("complete flow: detect -> hash -> build cleared", () => {
    const markdown = SAMPLE_WM_ALL_COMPLETE;

    // 1. Detection
    expect(isAllTasksComplete(markdown)).toBe(true);

    // 2. Hash for TOCTOU
    const hash1 = hashTaskSection(markdown);
    const hash2 = hashTaskSection(markdown);
    expect(hash1).toBe(hash2); // No change = same hash

    // 3. Build cleared content
    const cleared = buildClearedWorkingMemory(markdown, ".agent/TASK-ARCHIVE.md");
    expect(cleared).toContain("[Unset]");
    expect(cleared).toContain("Archived 3 tasks");

    // 4. Cleared WM should have no completed tasks
    expect(isAllTasksComplete(cleared)).toBe(false);
  });

  test("TOCTOU detects changes between reads", () => {
    const markdown1 = SAMPLE_WM_ALL_COMPLETE;
    const markdown2 = SAMPLE_WM_MIXED;

    const hash1 = hashTaskSection(markdown1);
    const hash2 = hashTaskSection(markdown2);

    expect(hash1).not.toBe(hash2);
  });

  test("unicode characters in tasks are handled correctly", () => {
    const unicodeWm = `## Goal:
国際化テスト

### Pending Tasks:

### Completed Tasks:
- [x] [#1] 日本語タスク 🎉
- [x] [#2] العربية مهمة
- [x] [#3] Ñoño tarea

## Progress Log:

## Notes & Context:
Emoji test: 🚀✨💡
`;

    expect(isAllTasksComplete(unicodeWm)).toBe(true);

    const hash1 = hashTaskSection(unicodeWm);
    const hash2 = hashTaskSection(unicodeWm);
    expect(hash1).toBe(hash2);

    const cleared = buildClearedWorkingMemory(unicodeWm, ".agent/TASK-ARCHIVE.md");
    expect(cleared).toContain("Archived 3 tasks");
    // Notes should be preserved with unicode
    expect(cleared).toContain("🚀✨💡");
  });
});

// ============================================================================
// Round-trip verification: cleared WM is parseable by existing tools
// ============================================================================

describe("round-trip: cleared WM structure", () => {
  test("cleared WM has all required sections", () => {
    const cleared = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md");

    expect(cleared).toContain("## Goal:");
    expect(cleared).toContain("### Pending Tasks:");
    expect(cleared).toContain("### Completed Tasks:");
    expect(cleared).toContain("## Progress Log:");
    expect(cleared).toContain("## Notes & Context:");
  });

  test("cleared WM has no task items (empty task lists)", () => {
    const cleared = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md");

    // parseAllTasks should find zero tasks
    const { parseAllTasks } = require("../tools/task-helpers");
    const tasks = parseAllTasks(cleared);
    expect(tasks).toHaveLength(0);
  });

  test("cleared WM extractTaskSection returns a parseable section", () => {
    const cleared = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md");

    const section = extractTaskSection(cleared);
    // Should have the headers but no task items
    expect(section).toContain("### Pending Tasks:");
    expect(section).not.toMatch(/- \[[ x-]\] \[#\d+\]/);
  });

  test("cleared WM hash is different from original WM hash", () => {
    const cleared = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md");

    const originalHash = hashTaskSection(SAMPLE_WM_ALL_COMPLETE);
    const clearedHash = hashTaskSection(cleared);
    expect(originalHash).not.toBe(clearedHash);
  });

  test("cleared WM with preserveNotes=true retains notes content", () => {
    const cleared = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md", {
      preserveNotes: true,
    });

    // Notes content should survive the round-trip
    expect(cleared).toContain("Using Auth0 for OAuth integration.");
  });

  test("forced cleared WM log entry differs from natural", () => {
    const natural = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md");
    const forced = buildClearedWorkingMemory(SAMPLE_WM_ALL_COMPLETE, ".agent/TASK-ARCHIVE.md", {
      forced: true,
      reason: "test reason",
    });

    expect(natural).toContain("(natural completion)");
    expect(forced).toContain('(forced: "test reason")');
    expect(natural).not.toContain("forced");
    expect(forced).not.toContain("natural completion");
  });
});
