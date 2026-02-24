// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * HeartbeatService Tests — Live Data
 *
 * These tests require a running Mastra server (localhost:4111).
 * They write working memory into mastra_resources via storage,
 * then run the heartbeat which reads it back through the HTTP API.
 *
 * Run: bun test src/mastra/gateway/heartbeat/service.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AGENT_DIR, clearConfigCache } from "../../lib/config";
import { storage } from "../../storage";
import { resumeHeartbeat } from "../../workflows/heartbeat/pause";
import { loadState } from "../../workflows/heartbeat/state";
import { GatewayToMastraAdapter } from "../adapter";
import { HeartbeatService, parseTasksFromMemory } from "./service";

const TEST_STATE_PATH = join(AGENT_DIR, "heartbeat-state.json");
const MASTRA_URL = process.env.MASTRA_URL ?? "http://localhost:4111";
const TEST_RESOURCE_ID = `heartbeat-test-${Date.now()}`;

/**
 * Write working memory directly into mastra_resources table.
 */
async function writeWorkingMemory(resourceId: string, workingMemory: string) {
  const store = await storage.getStore("memory");
  if (!store) throw new Error("Memory store not available");
  await store.updateResource({ resourceId, workingMemory });
}

/**
 * Check if Mastra server is reachable.
 */
async function isMastraRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${MASTRA_URL}/api`);
    return res.ok || res.status === 404; // any response means it's up
  } catch {
    return false;
  }
}

// ============================================================================
// Parser unit tests — pure function, no server needed
// ============================================================================

describe("parseTasksFromMemory", () => {
  test("parses task-tool format with [#N] IDs", () => {
    const content = `## Tasks
- [ ] [#1] Buy groceries
- [-] [#2] Write report
- [x] [#3] Send email`;

    const tasks = parseTasksFromMemory(content);

    expect(tasks).toHaveLength(3);

    expect(tasks[0].text).toBe("Buy groceries");
    expect(tasks[0].isComplete).toBe(false);
    expect(tasks[0].isInProgress).toBe(false);

    expect(tasks[1].text).toBe("Write report");
    expect(tasks[1].isInProgress).toBe(true);
    expect(tasks[1].isComplete).toBe(false);

    expect(tasks[2].text).toBe("Send email");
    expect(tasks[2].isComplete).toBe(true);
    expect(tasks[2].isInProgress).toBe(false);
  });

  test("parses legacy format with [!] and [~] markers", () => {
    const content = `## Tasks
- [!] Critical urgent task
- [~] Blocked on external dependency
- [ ] Normal pending task`;

    const tasks = parseTasksFromMemory(content);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].isHighPriority).toBe(true);
    expect(tasks[0].text).toBe("Critical urgent task");
    expect(tasks[1].isBlocked).toBe(true);
    expect(tasks[1].text).toBe("Blocked on external dependency");
    expect(tasks[2].isComplete).toBe(false);
    expect(tasks[2].isInProgress).toBe(false);
    expect(tasks[2].isHighPriority).toBe(false);
    expect(tasks[2].isBlocked).toBe(false);
  });

  test("handles mixed format (legacy + task-tool)", () => {
    const content = `## Tasks
- [!] Urgent legacy task
- [ ] [#1] Task-tool pending
- [-] [#2] Task-tool in-progress
- [~] Blocked legacy task`;

    const tasks = parseTasksFromMemory(content);

    expect(tasks).toHaveLength(4);
    expect(tasks[0].isHighPriority).toBe(true);
    expect(tasks[0].text).toBe("Urgent legacy task");
    expect(tasks[1].text).toBe("Task-tool pending");
    expect(tasks[2].text).toBe("Task-tool in-progress");
    expect(tasks[2].isInProgress).toBe(true);
    expect(tasks[3].isBlocked).toBe(true);
  });

  test("strips [#N] IDs from task text", () => {
    const content = `- [!] [#42] Urgent task with ID
- [ ] [#100] Normal task with large ID`;

    const tasks = parseTasksFromMemory(content);

    expect(tasks[0].text).toBe("Urgent task with ID");
    expect(tasks[0].text).not.toContain("#42");
    expect(tasks[1].text).toBe("Normal task with large ID");
    expect(tasks[1].text).not.toContain("#100");
  });

  test("correctly classifies pending vs in-progress for count logic", () => {
    const content = `- [ ] [#1] Pending one
- [ ] [#2] Pending two
- [-] [#3] In progress
- [ ] [#4] Pending three
- [ ] [#5] Pending four
- [ ] [#6] Pending five`;

    const tasks = parseTasksFromMemory(content);
    const pending = tasks.filter((t) => !t.isComplete && !t.isInProgress && !t.isHighPriority && !t.isBlocked);
    const inProgress = tasks.filter((t) => t.isInProgress);

    expect(pending).toHaveLength(5);
    expect(inProgress).toHaveLength(1);
  });
});

// ============================================================================
// all-tasks-complete alert logic — pure function tests
// ============================================================================

describe("all-tasks-complete alert detection", () => {
  test("all completed tasks trigger alert condition", () => {
    const content = `## Tasks
- [x] [#1] First task
- [x] [#2] Second task
- [x] [#3] Third task`;

    const tasks = parseTasksFromMemory(content);
    const pending = tasks.filter((t) => !t.isComplete && !t.isInProgress && !t.isHighPriority && !t.isBlocked);
    const inProgress = tasks.filter((t) => t.isInProgress);
    const completed = tasks.filter((t) => t.isComplete);
    const highPriority = tasks.filter((t) => t.isHighPriority);
    const blocked = tasks.filter((t) => t.isBlocked);

    // All conditions for all-tasks-complete alert
    expect(pending.length).toBe(0);
    expect(inProgress.length).toBe(0);
    expect(blocked.length).toBe(0);
    expect(highPriority.length).toBe(0);
    expect(completed.length).toBeGreaterThan(0);
  });

  test("mixed tasks do not trigger all-tasks-complete", () => {
    const content = `## Tasks
- [x] [#1] Done task
- [ ] [#2] Pending task`;

    const tasks = parseTasksFromMemory(content);
    const pending = tasks.filter((t) => !t.isComplete && !t.isInProgress && !t.isHighPriority && !t.isBlocked);
    const completed = tasks.filter((t) => t.isComplete);

    // Pending > 0, so all-tasks-complete should NOT fire
    expect(pending.length).toBeGreaterThan(0);
    expect(completed.length).toBeGreaterThan(0);
  });

  test("empty working memory does not trigger all-tasks-complete", () => {
    const content = "## Goal:\n[Unset]\n\n### Pending Tasks:\n\n### Completed Tasks:\n";

    const tasks = parseTasksFromMemory(content);
    const completed = tasks.filter((t) => t.isComplete);

    // completed.length === 0, so alert should NOT fire
    expect(completed.length).toBe(0);
  });

  test("in-progress tasks prevent all-tasks-complete", () => {
    const content = `## Tasks
- [x] [#1] Done task
- [-] [#2] Still working`;

    const tasks = parseTasksFromMemory(content);
    const inProgress = tasks.filter((t) => t.isInProgress);

    // inProgress > 0, so alert should NOT fire
    expect(inProgress.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Live data tests — require running Mastra server
// Skipped: these tests need a running Mastra server (localhost:4111) and
// database access (writes to mastra_resources via storage). They time out
// in a standard `bun test` run without those services available.
// ============================================================================

describe.skip("HeartbeatService (live data)", () => {
  let mastraUp = false;

  beforeEach(async () => {
    clearConfigCache();

    if (!existsSync(AGENT_DIR)) {
      mkdirSync(AGENT_DIR, { recursive: true });
    }
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }
    await resumeHeartbeat();

    mastraUp = await isMastraRunning();
    if (!mastraUp) {
      console.log("[test] Mastra server not running — skipping live data test");
    }
  });

  afterEach(async () => {
    try {
      if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
    } catch {
      /* ignore */
    }
  });

  test("detects task-tool format from real storage", async () => {
    if (!mastraUp) return;

    const wm = `## Tasks
- [ ] [#1] Buy groceries
- [-] [#2] Write report
- [x] [#3] Send email
- [ ] [#4] Call dentist
- [ ] [#5] Review PR
- [ ] [#6] Update docs
- [ ] [#7] Fix bug`;

    await writeWorkingMemory(TEST_RESOURCE_ID, wm);

    const adapter = new GatewayToMastraAdapter({ mastraUrl: MASTRA_URL });
    const service = new HeartbeatService({ resourceId: TEST_RESOURCE_ID });
    service.setAdapter(adapter);

    const result = await service.runCheck({ force: true });

    console.log("[test:task-tool] result:", JSON.stringify(result, null, 2));

    // Should detect individual pending tasks (exclude in-progress and complete)
    expect(["HEARTBEAT_OK", "HEARTBEAT_ALERT", "HEARTBEAT_ERROR"]).toContain(result.status);
    if (result.status === "HEARTBEAT_ALERT") {
      const pendingItems = result.items.filter((i) => i.type === "pending-task");
      expect(pendingItems.length).toBeGreaterThanOrEqual(1);
      // Each item should carry the actual task text
      for (const item of pendingItems) {
        expect(item.description).not.toContain("pending tasks in working memory");
      }
    }
  });

  test("detects legacy format ([!] and [~]) from real storage", async () => {
    if (!mastraUp) return;

    const wm = `## Tasks
- [!] Critical urgent task
- [~] Blocked on external dependency
- [ ] Normal pending task`;

    await writeWorkingMemory(TEST_RESOURCE_ID, wm);

    const adapter = new GatewayToMastraAdapter({ mastraUrl: MASTRA_URL });
    const service = new HeartbeatService({ resourceId: TEST_RESOURCE_ID });
    service.setAdapter(adapter);

    const result = await service.runCheck({ force: true });

    console.log("[test:legacy] result:", JSON.stringify(result, null, 2));

    expect(["HEARTBEAT_ALERT", "HEARTBEAT_ERROR"]).toContain(result.status);
    if (result.status === "HEARTBEAT_ALERT") {
      const highPriority = result.items.find((i) => i.type === "high-priority-task");
      const blocked = result.items.find((i) => i.type === "blocked-task");
      expect(highPriority).toBeDefined();
      expect(highPriority!.description).toBe("Critical urgent task");
      expect(blocked).toBeDefined();
      expect(blocked!.description).toBe("Blocked on external dependency");
    }
  });

  test("no resource exists returns HEARTBEAT_OK", async () => {
    if (!mastraUp) return;

    const adapter = new GatewayToMastraAdapter({ mastraUrl: MASTRA_URL });
    const service = new HeartbeatService({ resourceId: `nonexistent-${Date.now()}` });
    service.setAdapter(adapter);

    const result = await service.runCheck({ force: true });

    console.log("[test:no-resource] result:", JSON.stringify(result, null, 2));

    expect(result.status).toBe("HEARTBEAT_OK");
  });

  test("mixed formats in same working memory", async () => {
    if (!mastraUp) return;

    const wm = `## Tasks
- [!] Urgent legacy task
- [ ] [#1] Task-tool pending item
- [-] [#2] Task-tool in-progress item
- [~] Blocked legacy task
- [ ] [#3] Another pending
- [ ] [#4] Yet another pending
- [ ] [#5] Fifth pending
- [ ] [#6] Sixth pending`;

    await writeWorkingMemory(TEST_RESOURCE_ID, wm);

    const adapter = new GatewayToMastraAdapter({ mastraUrl: MASTRA_URL });
    const service = new HeartbeatService({ resourceId: TEST_RESOURCE_ID });
    service.setAdapter(adapter);

    const result = await service.runCheck({ force: true });

    console.log("[test:mixed] result:", JSON.stringify(result, null, 2));

    expect(["HEARTBEAT_ALERT", "HEARTBEAT_ERROR"]).toContain(result.status);
    if (result.status === "HEARTBEAT_ALERT") {
      const highPriority = result.items.find((i) => i.type === "high-priority-task");
      const blocked = result.items.find((i) => i.type === "blocked-task");
      expect(highPriority).toBeDefined();
      expect(highPriority!.description).toBe("Urgent legacy task");
      expect(blocked).toBeDefined();
    }
  });
});
