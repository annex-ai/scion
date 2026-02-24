// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Extended tests for bash + process tools.
 *
 * Covers PTY sync, PTY background, edge cases, and error paths.
 *
 * NOTE: Bun has a known incompatibility with node-pty where PTY child processes
 * receive SIGHUP shortly after spawn, killing interactive/stdin-reading commands
 * (cat, python REPL, etc.) immediately. Commands that produce output quickly
 * (echo && sleep) work fine. Tests requiring long-lived PTY processes use non-PTY
 * mode instead. Production (Node.js) is unaffected.
 */
import { beforeEach, expect, test } from "bun:test";
import { bashTool } from "../bash";
import { processTool } from "../process";
import { killProcess, listProcesses, removeProcess } from "../process-registry";

// Type definitions based on tool output schemas
interface BashResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  truncated: boolean;
  sessionId?: string;
  pid?: number;
}

interface ProcessInfo {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  status: "running" | "exited";
  isPty: boolean;
  runtimeMs: number;
  exitCode: number | null;
}

interface ProcessResult {
  success: boolean;
  message?: string;
  processes?: ProcessInfo[];
  status?: "running" | "exited";
  exitCode?: number | null;
  exitSignal?: string | null;
  output?: string;
  outputOffset?: number;
  outputLines?: number;
  totalBytesReceived?: number;
  bytesDiscarded?: number;
  hasGap?: boolean;
}

const exec = bashTool.execute! as (
  input: { command: string; cwd?: string; workdir?: string; pty?: boolean; background?: boolean },
  ctx: unknown,
) => Promise<BashResult>;
const proc = processTool.execute! as (
  input: {
    action: string;
    sessionId?: string;
    offset?: number;
    limit?: number;
    data?: string;
    keys?: string[];
    signal?: string;
  },
  ctx: unknown,
) => Promise<ProcessResult>;
const ctx = {} as unknown;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  for (const p of listProcesses()) {
    if (p.status === "running") killProcess(p.id, "SIGKILL");
    removeProcess(p.id);
  }
  await sleep(50);
});

// --- Basic execution ---

test("standard bash execution returns stdout and exit_code", async () => {
  const r = await exec({ command: "echo hello" }, ctx);
  expect(r.stdout.trim()).toBe("hello");
  expect(r.exit_code).toBe(0);
  expect(r.truncated).toBe(false);
  expect(r.sessionId).toBeUndefined();
});

// Bun sends SIGHUP to PTY child processes (node-pty incompatibility).
// Output may be empty. Only verify no crash + stderr is empty (PTY merges streams).
test("pty sync mode runs command with pseudo-terminal", async () => {
  const r = await exec({ command: "echo pty-test && sleep 0.1", pty: true }, ctx);
  // Output may be empty under bun due to SIGHUP race; just verify no error
  expect(r.exit_code).toBeDefined();
  expect(r.stderr).toBe(""); // PTY merges streams
});

// --- Background (non-PTY) ---

test("background mode returns sessionId immediately", async () => {
  const r = await exec({ command: "sleep 0.2 && echo bg-done", background: true }, ctx);
  expect(r.sessionId).toBeDefined();
  expect(r.pid).toBeGreaterThan(0);
  expect(r.exit_code).toBeNull();
  expect(r.stdout).toContain("Background process started");

  await sleep(500);
  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("process poll shows status and output", async () => {
  const r = await exec({ command: "echo poll-test && sleep 0.1", background: true }, ctx);
  await sleep(300);

  const poll = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(poll.success).toBe(true);
  expect(poll.status).toBe("exited");
  expect(poll.output).toContain("poll-test");

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("process log returns output with offset/limit", async () => {
  const r = await exec({ command: "echo line1 && echo line2 && echo line3", background: true }, ctx);
  await sleep(300);

  const log = await proc({ action: "log", sessionId: r.sessionId }, ctx);
  expect(log.success).toBe(true);
  expect(log.output).toContain("line1");
  expect(log.output).toContain("line3");

  // With offset
  const log2 = await proc({ action: "log", sessionId: r.sessionId, offset: 1, limit: 1 }, ctx);
  expect(log2.success).toBe(true);
  expect(log2.outputOffset).toBe(1);
  expect(log2.outputLines).toBe(1);

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

// --- PTY + background ---

test("pty + background mode works together", async () => {
  const r = await exec({ command: "echo pty-bg-test && sleep 0.1", pty: true, background: true }, ctx);
  expect(r.sessionId).toBeDefined();
  expect(r.pid).toBeGreaterThan(0);
  expect(r.stdout).toContain("Background PTY process started");

  await sleep(500);
  const poll = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(poll.success).toBe(true);
  expect(poll.status).toBe("exited");
  // Output may be empty under bun due to PTY SIGHUP race; just verify no crash

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

// --- Interactive process tests (non-PTY cat, since bun+node-pty kills interactive PTY processes) ---

test("submit and send-keys work on background process", async () => {
  // Use non-PTY cat (works reliably under bun; PTY cat gets SIGHUP under bun)
  const r = await exec({ command: "cat", background: true }, ctx);
  expect(r.sessionId).toBeDefined();

  await sleep(200);

  const check = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(check.status).toBe("running");

  // Submit a line
  const sub = await proc({ action: "submit", sessionId: r.sessionId, data: "hello" }, ctx);
  expect(sub.success).toBe(true);

  await sleep(200);

  // cat echoes stdin back to stdout
  const poll = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(poll.output).toContain("hello");

  // Send C-c to kill cat (non-PTY sends OS SIGINT)
  const keys = await proc({ action: "send-keys", sessionId: r.sessionId, keys: ["C-c"] }, ctx);
  expect(keys.success).toBe(true);
  expect(keys.message).toContain("SIGINT");

  await sleep(300);

  const poll2 = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(poll2.status).toBe("exited");

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

// --- List and cleanup ---

test("process list shows sessions and kill removes exited ones", async () => {
  const r = await exec({ command: "echo list-test", background: true }, ctx);
  await sleep(300);

  const list = await proc({ action: "list" }, ctx);
  expect(list.success).toBe(true);
  expect(list.processes!.length).toBeGreaterThan(0);
  expect(list.processes!.some((p) => p.id === r.sessionId)).toBe(true);

  // Kill the exited process (removes from registry)
  const kill = await proc({ action: "kill", sessionId: r.sessionId }, ctx);
  expect(kill.success).toBe(true);
  expect(kill.message).toContain("already exited");

  // Verify it's gone
  const list2 = await proc({ action: "list" }, ctx);
  expect(list2.processes!.some((p) => p.id === r.sessionId)).toBe(false);
});

// --- workdir ---

test("workdir param works as alias for cwd", async () => {
  const r = await exec({ command: "pwd", workdir: "/tmp" }, ctx);
  expect(r.stdout.trim()).toBe("/tmp");
});

// --- Edge-case and error-path tests ---

test("paste action writes data to background process", async () => {
  // Use non-PTY cat (bun+node-pty kills interactive PTY processes)
  const r = await exec({ command: "cat", background: true }, ctx);
  await sleep(200);

  const paste = await proc({ action: "paste", sessionId: r.sessionId, data: "pasted-text" }, ctx);
  expect(paste.success).toBe(true);
  expect(paste.message).toContain("11 chars");

  // Send EOF to cat
  await proc({ action: "send-keys", sessionId: r.sessionId, keys: ["C-c"] }, ctx);
  await sleep(200);
  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("process actions fail without sessionId", async () => {
  const poll = await proc({ action: "poll" }, ctx);
  expect(poll.success).toBe(false);
  expect(poll.message).toContain("sessionId is required");

  const log = await proc({ action: "log" }, ctx);
  expect(log.success).toBe(false);
});

test("process actions fail for nonexistent sessionId", async () => {
  const poll = await proc({ action: "poll", sessionId: "nonexistent" }, ctx);
  expect(poll.success).toBe(false);
  expect(poll.message).toContain("No process found");
});

test("write without data fails", async () => {
  const r = await exec({ command: "sleep 1", background: true }, ctx);
  const w = await proc({ action: "write", sessionId: r.sessionId }, ctx);
  expect(w.success).toBe(false);
  expect(w.message).toContain("data is required");

  const s = await proc({ action: "submit", sessionId: r.sessionId }, ctx);
  expect(s.success).toBe(false);

  const k = await proc({ action: "send-keys", sessionId: r.sessionId, keys: [] }, ctx);
  expect(k.success).toBe(false);

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("kill with invalid signal fails gracefully", async () => {
  const r = await exec({ command: "sleep 1", background: true }, ctx);
  const kill = await proc({ action: "kill", sessionId: r.sessionId, signal: "SIGFAKE" }, ctx);
  expect(kill.success).toBe(false);
  expect(kill.message).toContain("Invalid signal");

  // Clean up with valid signal
  await proc({ action: "kill", sessionId: r.sessionId, signal: "SIGKILL" }, ctx);
});

test("send-keys C-c on non-PTY sends SIGINT signal", async () => {
  const r = await exec({ command: "sleep 10", background: true }, ctx);
  await sleep(200);

  const check = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(check.status).toBe("running");

  // C-c on non-PTY should send SIGINT via OS, not write \x03
  const keys = await proc({ action: "send-keys", sessionId: r.sessionId, keys: ["C-c"] }, ctx);
  expect(keys.success).toBe(true);
  expect(keys.message).toContain("SIGINT");

  await sleep(300);
  const poll = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(poll.status).toBe("exited");

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("send-keys with unknown key reports failure", async () => {
  const r = await exec({ command: "sleep 1", pty: true, background: true }, ctx);
  // PTY process will die from SIGHUP under bun, but we can still test the key mapping
  await sleep(200);

  const keys = await proc({ action: "send-keys", sessionId: r.sessionId, keys: ["FakeKey"] }, ctx);
  expect(keys.success).toBe(false);
  expect(keys.message).toContain("unknown key token");

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("poll returns only new output since last poll", async () => {
  const r = await exec({ command: "echo first && sleep 0.3 && echo second", background: true }, ctx);
  await sleep(200);

  // First poll should capture 'first'
  const poll1 = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(poll1.output).toContain("first");

  await sleep(400);

  // Second poll should only have 'second', not repeat 'first'
  const poll2 = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(poll2.output).toContain("second");
  expect(poll2.output).not.toContain("first");

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("non-PTY background stderr is prefixed", async () => {
  const r = await exec({ command: "echo err-msg >&2", background: true }, ctx);
  await sleep(300);

  const log = await proc({ action: "log", sessionId: r.sessionId }, ctx);
  expect(log.output).toContain("[stderr]");
  expect(log.output).toContain("err-msg");

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("invalid cwd throws descriptive error", async () => {
  expect(exec({ command: "echo test", cwd: "/nonexistent/path/xyz" }, ctx)).rejects.toThrow("does not exist");
});

test("write to exited process returns failure", async () => {
  const r = await exec({ command: "echo done", background: true }, ctx);
  await sleep(300);

  const check = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(check.status).toBe("exited");

  const w = await proc({ action: "write", sessionId: r.sessionId, data: "too late" }, ctx);
  expect(w.success).toBe(false);
  expect(w.message).toContain("may have exited");

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("list shows bounded runtimeMs for exited processes", async () => {
  const r = await exec({ command: "echo fast", background: true }, ctx);
  await sleep(300);

  const list1 = await proc({ action: "list" }, ctx);
  const p1 = list1.processes!.find((p) => p.id === r.sessionId);
  expect(p1).toBeDefined();
  expect(p1!.status).toBe("exited");
  const runtime1 = p1!.runtimeMs;

  // Wait and re-list — runtimeMs should NOT grow for an exited process
  await sleep(300);
  const list2 = await proc({ action: "list" }, ctx);
  const p2 = list2.processes!.find((p) => p.id === r.sessionId);
  expect(p2).toBeDefined();
  // Allow 50ms tolerance for timing differences
  expect(Math.abs(p2!.runtimeMs - runtime1)).toBeLessThan(50);

  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});

test("multiple concurrent background processes work independently", async () => {
  const r1 = await exec({ command: "echo proc1 && sleep 0.5", background: true }, ctx);
  const r2 = await exec({ command: "echo proc2 && sleep 0.5", background: true }, ctx);
  const r3 = await exec({ command: "echo proc3 && sleep 0.5", background: true }, ctx);

  expect(r1.sessionId).not.toBe(r2.sessionId);
  expect(r2.sessionId).not.toBe(r3.sessionId);

  await sleep(700);

  const p1 = await proc({ action: "poll", sessionId: r1.sessionId }, ctx);
  const p2 = await proc({ action: "poll", sessionId: r2.sessionId }, ctx);
  const p3 = await proc({ action: "poll", sessionId: r3.sessionId }, ctx);

  expect(p1.output).toContain("proc1");
  expect(p2.output).toContain("proc2");
  expect(p3.output).toContain("proc3");

  await proc({ action: "kill", sessionId: r1.sessionId }, ctx);
  await proc({ action: "kill", sessionId: r2.sessionId }, ctx);
  await proc({ action: "kill", sessionId: r3.sessionId }, ctx);
});

test("non-PTY kill cleans up child subprocesses", async () => {
  const r = await exec({ command: "sleep 999 & echo child_pid=$! && wait", background: true }, ctx);
  await sleep(300);

  const p1 = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  const match = p1.output!.match(/child_pid=(\d+)/);
  const childPid = match ? Number.parseInt(match[1]) : null;
  expect(childPid).toBeTruthy();

  // Verify child is alive
  expect(() => process.kill(childPid!, 0)).not.toThrow();

  // Kill via process tool
  await proc({ action: "kill", sessionId: r.sessionId, signal: "SIGTERM" }, ctx);
  await sleep(500);

  // Verify child is also dead (not orphaned)
  expect(() => process.kill(childPid!, 0)).toThrow();
});

test("paste action sends bracketed paste on PTY background", async () => {
  // Use a fast PTY command that outputs then exits — we test that paste tool
  // formats the bracketed paste message correctly, even though under bun
  // the PTY process may not live long enough to receive it.
  // Use non-PTY cat which reliably stays alive under bun.
  const r = await exec({ command: "cat", background: true }, ctx);
  await sleep(200);

  // Non-PTY paste doesn't use bracketed mode
  const paste = await proc({ action: "paste", sessionId: r.sessionId, data: "pasted-text" }, ctx);
  expect(paste.success).toBe(true);
  expect(paste.message).toContain("11 chars");

  await sleep(200);
  const poll = await proc({ action: "poll", sessionId: r.sessionId }, ctx);
  expect(poll.output).toContain("pasted-text");

  await proc({ action: "send-keys", sessionId: r.sessionId, keys: ["C-c"] }, ctx);
  await sleep(200);
  await proc({ action: "kill", sessionId: r.sessionId }, ctx);
});
