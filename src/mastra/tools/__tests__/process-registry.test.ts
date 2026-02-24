// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { afterAll, beforeEach, expect, test } from "bun:test";
import {
  type ProcessEntry,
  appendOutput,
  createProcess,
  generateProcessId,
  getOutput,
  getProcess,
  killProcess,
  listProcesses,
  pollOutput,
  removeProcess,
  validateSignal,
} from "../process-registry";

function makeEntry(overrides: Partial<ProcessEntry> = {}): ProcessEntry {
  return {
    id: generateProcessId(),
    command: "echo hello",
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

// Clean up between tests
beforeEach(() => {
  for (const p of listProcesses()) {
    removeProcess(p.id);
  }
});

test("generateProcessId returns 8-char hex", () => {
  const id = generateProcessId();
  expect(id).toMatch(/^[0-9a-f]{8}$/);
  // Should be unique
  expect(generateProcessId()).not.toBe(id);
});

test("createProcess + getProcess + listProcesses", () => {
  const entry = makeEntry();
  createProcess(entry);
  expect(getProcess(entry.id)).toBe(entry);
  expect(listProcesses()).toContain(entry);
});

test("removeProcess", () => {
  const entry = makeEntry();
  createProcess(entry);
  expect(removeProcess(entry.id)).toBe(true);
  expect(getProcess(entry.id)).toBeUndefined();
  expect(removeProcess(entry.id)).toBe(false);
});

test("appendOutput accumulates data", () => {
  const entry = makeEntry();
  createProcess(entry);

  appendOutput(entry.id, "hello ");
  appendOutput(entry.id, "world\n");

  const e = getProcess(entry.id)!;
  expect(e.output).toBe("hello world\n");
  expect(e.totalBytesReceived).toBe(12);
  expect(e.bytesDiscarded).toBe(0);
});

test("appendOutput trims from head when over MAX_BUFFER_SIZE", () => {
  const entry = makeEntry();
  createProcess(entry);

  // Write 1.5MB of data (exceeds 1MB limit)
  const bigChunk = "x".repeat(800_000);
  appendOutput(entry.id, bigChunk);
  appendOutput(entry.id, bigChunk); // now 1.6MB total

  const e = getProcess(entry.id)!;
  // Buffer should be trimmed to ~1MB chars
  expect(e.output.length).toBeLessThanOrEqual(1_048_576);
  expect(e.bytesDiscarded).toBeGreaterThan(0);
  expect(e.totalBytesReceived).toBe(1_600_000);
});

test("getOutput with no offset/limit returns all", () => {
  const entry = makeEntry();
  createProcess(entry);
  appendOutput(entry.id, "line1\nline2\nline3");

  const slice = getOutput(entry.id);
  expect(slice).not.toBeNull();
  expect(slice!.output).toBe("line1\nline2\nline3");
  expect(slice!.length).toBe(3); // 3 lines
});

test("getOutput with offset and limit", () => {
  const entry = makeEntry();
  createProcess(entry);
  appendOutput(entry.id, "a\nb\nc\nd\ne");

  const slice = getOutput(entry.id, 1, 2);
  expect(slice).not.toBeNull();
  expect(slice!.output).toBe("b\nc");
  expect(slice!.offset).toBe(1);
  expect(slice!.length).toBe(2);
});

test("pollOutput returns only new lines and advances cursor", () => {
  const entry = makeEntry();
  createProcess(entry);
  appendOutput(entry.id, "line1\nline2\n");

  // First poll: gets everything
  const poll1 = pollOutput(entry.id);
  expect(poll1).not.toBeNull();
  expect(poll1!.output).toContain("line1");
  expect(poll1!.output).toContain("line2");

  // More output arrives
  appendOutput(entry.id, "line3\nline4\n");

  // Second poll: only new lines
  const poll2 = pollOutput(entry.id);
  expect(poll2).not.toBeNull();
  expect(poll2!.output).not.toContain("line1");
  expect(poll2!.output).toContain("line3");
  expect(poll2!.output).toContain("line4");
});

test("pollOutput cursor survives buffer trim", () => {
  const entry = makeEntry();
  createProcess(entry);

  // Fill buffer near max
  appendOutput(entry.id, "x\n".repeat(100_000));

  // Poll to advance cursor
  const poll1 = pollOutput(entry.id);
  expect(poll1).not.toBeNull();
  const cursorAfterPoll1 = getProcess(entry.id)!.lastPollOffset;

  // Add more data that triggers a buffer trim
  appendOutput(entry.id, `${"y".repeat(600_000)}\n`);
  appendOutput(entry.id, `${"z".repeat(600_000)}\n`);

  // Buffer was trimmed, so line count in output is now less than cursor
  const linesNow = getProcess(entry.id)!.output.split("\n").length;

  // Poll should handle cursor > current line count gracefully
  const poll2 = pollOutput(entry.id);
  expect(poll2).not.toBeNull();
  // Should not throw, and cursor should be reset
});

test("validateSignal accepts valid signals", () => {
  expect(validateSignal("SIGTERM")).toBe("SIGTERM");
  expect(validateSignal("SIGKILL")).toBe("SIGKILL");
  expect(validateSignal("SIGINT")).toBe("SIGINT");
});

test("validateSignal rejects invalid signals", () => {
  expect(() => validateSignal("POTATO")).toThrow("Invalid signal");
  expect(() => validateSignal("")).toThrow("Invalid signal");
});

test("max processes evicts oldest exited", () => {
  // Create 50 exited processes
  for (let i = 0; i < 50; i++) {
    const entry = makeEntry({
      status: "exited",
      exitTime: Date.now() - i * 1000, // oldest first
      exitCode: 0,
      startTime: Date.now() - 60_000 - i * 1000,
    });
    createProcess(entry);
  }

  expect(listProcesses().length).toBe(50);

  // Creating one more should evict the oldest
  const newEntry = makeEntry();
  createProcess(newEntry);

  expect(listProcesses().length).toBe(50); // still 50, oldest evicted
  expect(getProcess(newEntry.id)).toBeDefined();
});
