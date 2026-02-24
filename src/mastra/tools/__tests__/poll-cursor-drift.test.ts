// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Regression test: pollOutput cursor must stay valid after buffer trimming.
 *
 * Scenario:
 * 1. Fill buffer with lines, poll to advance cursor
 * 2. Append enough data to trigger buffer trim (removes lines from head)
 * 3. Append NEW data after the trim
 * 4. Poll again — should see the new data, not empty
 */
import { beforeEach, expect, test } from "bun:test";
import {
  type ProcessEntry,
  appendOutput,
  createProcess,
  generateProcessId,
  getProcess,
  listProcesses,
  pollOutput,
  removeProcess,
} from "../process-registry";

function makeEntry(overrides: Partial<ProcessEntry> = {}): ProcessEntry {
  return {
    id: generateProcessId(),
    command: "test",
    cwd: "/tmp",
    pid: 99999,
    status: "running",
    isPty: false,
    startTime: Date.now(),
    exitTime: null,
    exitCode: null,
    exitSignal: null,
    output: "",
    totalBytesReceived: 0,
    bytesDiscarded: 0,
    lastPollOffset: 0,
    ...overrides,
  };
}

beforeEach(() => {
  for (const p of listProcesses()) {
    removeProcess(p.id);
  }
});

test("pollOutput returns new data after buffer trim", () => {
  const entry = makeEntry();
  createProcess(entry);

  // Step 1: Write 500K of short lines (many lines)
  const lineData = "line-data-padding\n".repeat(30_000); // ~540K, ~30K lines
  appendOutput(entry.id, lineData);

  // Step 2: Poll to advance cursor to end
  const poll1 = pollOutput(entry.id);
  expect(poll1).not.toBeNull();
  expect(poll1!.output.length).toBeGreaterThan(0);

  const cursorAfterPoll1 = getProcess(entry.id)!.lastPollOffset;
  expect(cursorAfterPoll1).toBeGreaterThan(0);

  // Step 3: Append enough data to trigger buffer trim
  // Buffer limit is 1MB chars. We have ~540K, add ~600K more to exceed and trim.
  const bigChunk = `${"x".repeat(600_000)}\n`;
  appendOutput(entry.id, bigChunk);

  // Buffer should have been trimmed (output.length <= 1MB)
  const e = getProcess(entry.id)!;
  expect(e.output.length).toBeLessThanOrEqual(1_048_576);
  expect(e.bytesDiscarded).toBeGreaterThan(0);

  // Step 4: Add clearly new data AFTER the trim
  appendOutput(entry.id, "CANARY_NEW_LINE_1\n");
  appendOutput(entry.id, "CANARY_NEW_LINE_2\n");

  // Step 5: Poll — should include the canary lines
  const poll2 = pollOutput(entry.id);
  expect(poll2).not.toBeNull();
  expect(poll2!.output).toContain("CANARY_NEW_LINE_1");
  expect(poll2!.output).toContain("CANARY_NEW_LINE_2");
});

test("pollOutput never returns empty when new data exists", () => {
  const entry = makeEntry();
  createProcess(entry);

  // Small initial data, poll it
  appendOutput(entry.id, "initial\n");
  pollOutput(entry.id);

  // Massive data that replaces entire buffer
  appendOutput(entry.id, `${"a".repeat(1_100_000)}\n`); // > 1MB, trims everything old

  // New line after trim
  appendOutput(entry.id, "VISIBLE\n");

  const poll = pollOutput(entry.id);
  expect(poll).not.toBeNull();
  // Must not be empty — there IS new data
  expect(poll!.output.length).toBeGreaterThan(0);
});
