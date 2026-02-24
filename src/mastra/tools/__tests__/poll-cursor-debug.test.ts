// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Debug test: trace exact cursor/line behavior through buffer trim
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
  for (const p of listProcesses()) removeProcess(p.id);
});

test("cursor drift after buffer trim — exact trace", () => {
  const entry = makeEntry();
  createProcess(entry);

  // Write exactly 30K lines
  const lineData = "line-data-padding\n".repeat(30_000);
  appendOutput(entry.id, lineData);

  const e1 = getProcess(entry.id)!;
  const lines1 = e1.output.split("\n").length;
  console.log(
    `After initial write: output.length=${e1.output.length}, lines=${lines1}, discarded=${e1.bytesDiscarded}`,
  );

  // Poll to advance cursor
  const poll1 = pollOutput(entry.id);
  const cursor1 = getProcess(entry.id)!.lastPollOffset;
  console.log(`After poll1: cursor=${cursor1}, poll1.lines=${poll1!.length}`);

  // Add big chunk to trigger trim
  appendOutput(entry.id, `${"x".repeat(600_000)}\n`);
  const e2 = getProcess(entry.id)!;
  const lines2 = e2.output.split("\n").length;
  console.log(
    `After big chunk: output.length=${e2.output.length}, lines=${lines2}, discarded=${e2.bytesDiscarded}, cursor=${e2.lastPollOffset}`,
  );

  // Add canary
  appendOutput(entry.id, "CANARY\n");
  const e3 = getProcess(entry.id)!;
  const lines3 = e3.output.split("\n").length;
  console.log(`After canary: output.length=${e3.output.length}, lines=${lines3}, cursor=${e3.lastPollOffset}`);

  // The critical check: cursor vs current line count
  console.log(
    `Cursor (${e3.lastPollOffset}) vs lines (${lines3}): cursor ${e3.lastPollOffset > lines3 ? ">" : "<="} lines`,
  );

  // Poll for canary
  const poll2 = pollOutput(entry.id);
  console.log(
    `Poll2 result: output.length=${poll2!.output.length}, lines=${poll2!.length}, contains CANARY=${poll2!.output.includes("CANARY")}`,
  );

  // This SHOULD have CANARY but might not if cursor drifted
  expect(poll2!.output).toContain("CANARY");
});
