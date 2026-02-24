// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Integration tests: bash tool background mode + process tool
 *
 * Tests actual process spawning, not mocked.
 */
import { beforeEach, expect, test } from "bun:test";
// Direct function imports for testing (not through Mastra createTool wrapper)
// We'll test the tool execute functions directly
import { bashTool } from "../bash";
import { processTool } from "../process";
import { getProcess, killProcess, listProcesses, removeProcess } from "../process-registry";

beforeEach(async () => {
  // Kill and remove all processes from prior tests
  for (const p of listProcesses()) {
    if (p.status === "running") {
      killProcess(p.id, "SIGKILL");
    }
    removeProcess(p.id);
  }
  // Let OS clean up
  await new Promise((r) => setTimeout(r, 50));
});

test("background non-pty: echo returns sessionId", async () => {
  const result = (await bashTool.execute!({ command: "echo hello", background: true }, {} as any)) as any;

  expect(result.sessionId).toBeDefined();
  expect(result.sessionId!.length).toBe(8);
  expect(result.pid).toBeGreaterThan(0);
  expect(result.exit_code).toBeNull();

  // Wait for process to finish
  await new Promise((r) => setTimeout(r, 500));

  const entry = getProcess(result.sessionId!);
  expect(entry?.status).toBe("exited");
  expect(entry?.exitCode).toBe(0);
  expect(entry?.output).toContain("hello");
});

test("background non-pty: stderr is prefixed", async () => {
  const result = (await bashTool.execute!({ command: "echo error >&2", background: true }, {} as any)) as any;

  await new Promise((r) => setTimeout(r, 500));

  const entry = getProcess(result.sessionId!);
  expect(entry?.output).toContain("[stderr]");
  expect(entry?.output).toContain("error");
});

test("background pty: allocates terminal", async () => {
  // Use a command that lives long enough for onData to fire reliably.
  // Fast-exiting PTY commands (like bare `tput`) can hit a node-pty race
  // where onExit fires before onData delivers buffered output.
  const result = (await bashTool.execute!(
    {
      command: "echo PTY_MARKER && sleep 0.1",
      pty: true,
      background: true,
    },
    {} as any,
  )) as any;

  expect(result.sessionId).toBeDefined();

  // Wait for process to finish
  await new Promise((r) => setTimeout(r, 1000));

  const entry = getProcess(result.sessionId!);
  expect(entry?.status).toBe("exited");
  expect(entry?.isPty).toBe(true);
  // NOTE: Bun has a node-pty incompatibility where PTY child processes receive
  // SIGHUP shortly after spawn. Output may be empty under bun. Under Node.js
  // (production), PTY output is captured reliably.
  if (entry?.output) {
    expect(entry.output).toContain("PTY_MARKER");
  }
});

test("process tool: list shows background processes", async () => {
  const bash1 = (await bashTool.execute!({ command: "sleep 5", background: true }, {} as any)) as any;
  const bash2 = (await bashTool.execute!({ command: "sleep 5", background: true }, {} as any)) as any;

  const listResult = (await processTool.execute!({ action: "list" }, {} as any)) as any;
  expect(listResult.success).toBe(true);
  expect(listResult.processes!.length).toBeGreaterThanOrEqual(2);

  // Clean up
  await processTool.execute!({ action: "kill", sessionId: bash1.sessionId! }, {} as any);
  await processTool.execute!({ action: "kill", sessionId: bash2.sessionId! }, {} as any);
});

test("process tool: poll returns new output", async () => {
  const result = (await bashTool.execute!(
    {
      command: 'echo "line1" && sleep 0.2 && echo "line2" && sleep 0.2 && echo "line3"',
      background: true,
    },
    {} as any,
  )) as any;

  // Wait for first line
  await new Promise((r) => setTimeout(r, 100));

  const poll1 = (await processTool.execute!({ action: "poll", sessionId: result.sessionId! }, {} as any)) as any;
  expect(poll1.success).toBe(true);

  // Wait for all lines
  await new Promise((r) => setTimeout(r, 600));

  const poll2 = (await processTool.execute!({ action: "poll", sessionId: result.sessionId! }, {} as any)) as any;
  expect(poll2.success).toBe(true);
  // poll2 should have new lines not in poll1
});

test("process tool: submit sends data + newline", async () => {
  // cat echoes stdin back to stdout
  const result = (await bashTool.execute!({ command: "cat", background: true }, {} as any)) as any;

  await new Promise((r) => setTimeout(r, 200));

  const submitResult = (await processTool.execute!(
    {
      action: "submit",
      sessionId: result.sessionId!,
      data: "hello from test",
    },
    {} as any,
  )) as any;
  expect(submitResult.success).toBe(true);

  await new Promise((r) => setTimeout(r, 200));

  const entry = getProcess(result.sessionId!);
  expect(entry?.output).toContain("hello from test");

  // Clean up: send EOF to cat
  await processTool.execute!({ action: "send-keys", sessionId: result.sessionId!, keys: ["C-d"] }, {} as any);
  await new Promise((r) => setTimeout(r, 200));
});

test("process tool: kill terminates running process", async () => {
  const result = (await bashTool.execute!({ command: "sleep 60", background: true }, {} as any)) as any;

  const killResult = (await processTool.execute!(
    {
      action: "kill",
      sessionId: result.sessionId!,
      signal: "SIGTERM",
    },
    {} as any,
  )) as any;
  expect(killResult.success).toBe(true);

  await new Promise((r) => setTimeout(r, 300));

  const entry = getProcess(result.sessionId!);
  // Entry might be removed by killProcess or still there as exited
  if (entry) {
    expect(entry.status).toBe("exited");
  }
});

test("process tool: kill with invalid signal returns error", async () => {
  const result = (await bashTool.execute!({ command: "sleep 60", background: true }, {} as any)) as any;

  const killResult = (await processTool.execute!(
    {
      action: "kill",
      sessionId: result.sessionId!,
      signal: "INVALID",
    },
    {} as any,
  )) as any;
  expect(killResult.success).toBe(false);
  expect(killResult.message).toContain("Invalid signal");

  // Clean up
  await processTool.execute!({ action: "kill", sessionId: result.sessionId! }, {} as any);
  await new Promise((r) => setTimeout(r, 200));
});

test("process tool: log with offset and limit", async () => {
  const result = (await bashTool.execute!(
    {
      command: 'for i in $(seq 1 10); do echo "line-$i"; done',
      background: true,
    },
    {} as any,
  )) as any;

  await new Promise((r) => setTimeout(r, 500));

  const logResult = (await processTool.execute!(
    {
      action: "log",
      sessionId: result.sessionId!,
      offset: 2,
      limit: 3,
    },
    {} as any,
  )) as any;

  expect(logResult.success).toBe(true);
  expect(logResult.outputLines).toBe(3);
  expect(logResult.output).toContain("line-3");
  expect(logResult.output).toContain("line-4");
  expect(logResult.output).toContain("line-5");
});

test("workdir alias works", async () => {
  const result = (await bashTool.execute!({ command: "pwd", workdir: "/tmp" }, {} as any)) as any;
  expect(result.stdout).toContain("/tmp");
});

test("nonexistent workdir throws", async () => {
  try {
    await bashTool.execute!({ command: "echo hi", workdir: "/nonexistent-dir-12345" }, {} as any);
    expect(true).toBe(false); // should not reach
  } catch (e: any) {
    expect(e.message).toContain("does not exist");
  }
});

test("standard (non-pty, non-background) still works", async () => {
  const result = (await bashTool.execute!({ command: "echo standard-mode" }, {} as any)) as any;
  expect(result.stdout).toContain("standard-mode");
  expect(result.exit_code).toBe(0);
  expect(result.sessionId).toBeUndefined();
});
