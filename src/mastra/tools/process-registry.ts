// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Process Registry
 *
 * In-memory registry of live OS processes spawned by the bash tool
 * in background/PTY mode. Holds runtime handles (ChildProcess, IPty),
 * output buffers, and status. This is NOT related to Mastra threads/resources —
 * it's purely ephemeral kernel-level process management.
 */

import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";

// Lazy-loaded node-pty types
type IPty = import("node-pty").IPty;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessEntry {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  status: "running" | "exited";
  isPty: boolean;
  startTime: number;
  exitTime: number | null;
  exitCode: number | null;
  exitSignal: string | null;
  output: string;
  totalBytesReceived: number;
  bytesDiscarded: number;
  lastPollOffset: number;
  /** @internal */ _pty?: IPty;
  /** @internal */ _child?: ChildProcess;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BUFFER_SIZE = 1 * 1024 * 1024; // 1 MB per process
const MAX_PROCESSES = 50;
const PROCESS_TTL_MS = 30 * 60 * 1000; // 30 min after exit

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

const registry = new Map<string, ProcessEntry>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateProcessId(): string {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Lazily load node-pty. Throws a clear error if not installed.
 */
let _nodePty: typeof import("node-pty") | null = null;
export function loadNodePty(): typeof import("node-pty") {
  if (_nodePty) return _nodePty;
  try {
    // Use createRequire for ESM compatibility (tsx, node --loader, etc.)
    const req = createRequire(import.meta.url);
    _nodePty = req("node-pty");
    return _nodePty!;
  } catch {
    throw new Error("node-pty is not installed. Run: bun install node-pty");
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createProcess(entry: ProcessEntry): void {
  pruneExpired();
  if (registry.size >= MAX_PROCESSES) {
    // Evict oldest exited process
    let oldestExited: ProcessEntry | null = null;
    for (const e of registry.values()) {
      if (e.status === "exited") {
        if (!oldestExited || (e.exitTime ?? e.startTime) < (oldestExited.exitTime ?? oldestExited.startTime)) {
          oldestExited = e;
        }
      }
    }
    if (oldestExited) {
      registry.delete(oldestExited.id);
    } else {
      throw new Error(`Process limit reached (${MAX_PROCESSES}). Kill some background processes first.`);
    }
  }
  registry.set(entry.id, entry);
}

export function getProcess(id: string): ProcessEntry | undefined {
  return registry.get(id);
}

export function listProcesses(): ProcessEntry[] {
  pruneExpired();
  return Array.from(registry.values());
}

export function removeProcess(id: string): boolean {
  return registry.delete(id);
}

// ---------------------------------------------------------------------------
// Output buffer
// ---------------------------------------------------------------------------

export function appendOutput(id: string, data: string): void {
  const entry = registry.get(id);
  if (!entry) return;

  const dataBytes = Buffer.byteLength(data, "utf-8");
  entry.totalBytesReceived += dataBytes;
  entry.output += data;

  // Trim from head if over byte limit.
  // Use byteLength for the check (correct for multi-byte UTF-8).
  // Estimate trim position via byte/char ratio to avoid scanning twice.
  const currentBytes = Buffer.byteLength(entry.output, "utf-8");
  if (currentBytes > MAX_BUFFER_SIZE) {
    const ratio = MAX_BUFFER_SIZE / currentBytes;
    const keepChars = Math.floor(entry.output.length * ratio);
    const trimChars = entry.output.length - keepChars;
    entry.bytesDiscarded += Buffer.byteLength(entry.output.slice(0, trimChars), "utf-8");
    entry.output = entry.output.slice(trimChars);
    // Adjust poll cursor so it doesn't point past the trimmed head
    entry.lastPollOffset = Math.max(0, entry.lastPollOffset - trimChars);
  }
}

export interface OutputSlice {
  output: string;
  offset: number;
  length: number;
  totalBytesReceived: number;
  bytesDiscarded: number;
  hasGap: boolean;
}

export function getOutput(id: string, offset?: number, limit?: number): OutputSlice | null {
  const entry = registry.get(id);
  if (!entry) return null;

  const lines = entry.output.split("\n");
  const startLine = offset ?? 0;
  const endLine = limit ? startLine + limit : lines.length;
  const sliceLines = lines.slice(startLine, endLine);

  return {
    output: sliceLines.join("\n"),
    offset: startLine,
    length: sliceLines.length,
    totalBytesReceived: entry.totalBytesReceived,
    bytesDiscarded: entry.bytesDiscarded,
    hasGap: entry.bytesDiscarded > 0 && startLine === 0,
  };
}

/**
 * Get output since last poll, updating the lastPollOffset cursor.
 * Uses character-based offset (not line-based) to avoid issues with
 * trailing newlines creating phantom empty lines in split().
 */
export function pollOutput(id: string, maxChars = 200 * 120): OutputSlice | null {
  const entry = registry.get(id);
  if (!entry) return null;

  const startChar = entry.lastPollOffset;
  let newData = entry.output.slice(startChar);

  // Cap to last N characters if there's too much new output
  const capped = newData.length > maxChars;
  if (capped) {
    newData = newData.slice(-maxChars);
  }

  const lines = newData.split("\n");

  // Advance cursor to end of current output
  entry.lastPollOffset = entry.output.length;

  return {
    output: newData,
    offset: capped ? entry.output.length - maxChars : startChar,
    length: lines.length,
    totalBytesReceived: entry.totalBytesReceived,
    bytesDiscarded: entry.bytesDiscarded,
    hasGap: entry.bytesDiscarded > 0 && startChar === 0,
  };
}

// ---------------------------------------------------------------------------
// Process I/O
// ---------------------------------------------------------------------------

export function writeToProcess(id: string, data: string): boolean {
  const entry = registry.get(id);
  if (!entry || entry.status === "exited") return false;

  if (entry.isPty && entry._pty) {
    entry._pty.write(data);
    return true;
  }
  if (entry._child?.stdin && !entry._child.stdin.destroyed) {
    entry._child.stdin.write(data);
    return true;
  }
  return false;
}

const VALID_SIGNALS = new Set<string>(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGQUIT", "SIGTSTP", "SIGCONT"]);

export function validateSignal(signal: string): NodeJS.Signals {
  if (!VALID_SIGNALS.has(signal)) {
    throw new Error(`Invalid signal: "${signal}". Valid signals: ${[...VALID_SIGNALS].join(", ")}`);
  }
  return signal as NodeJS.Signals;
}

export function sendSignal(id: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
  const entry = registry.get(id);
  if (!entry || entry.status === "exited") return false;

  if (entry.isPty && entry._pty) {
    try {
      process.kill(entry.pid, signal);
      return true;
    } catch {
      return false;
    }
  } else if (entry._child) {
    try {
      // Kill the entire process group (negative PID) since background processes
      // are spawned with detached:true making them process group leaders.
      // This prevents child subprocesses from being orphaned.
      process.kill(-entry.pid, signal);
      return true;
    } catch {
      // Fallback to killing just the child if process group kill fails
      try {
        entry._child.kill(signal);
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

export function killProcess(id: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
  const sent = sendSignal(id, signal);
  const entry = registry.get(id);
  // If already exited, remove from registry
  if (entry?.status === "exited") {
    registry.delete(id);
  }
  return sent || entry?.status === "exited" || false;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function pruneExpired(): void {
  const now = Date.now();
  for (const [id, entry] of registry) {
    if (entry.status === "exited" && entry.exitTime && now - entry.exitTime > PROCESS_TTL_MS) {
      registry.delete(id);
    }
  }
}

// Kill all running processes on server shutdown
function shutdownAll(): void {
  for (const entry of registry.values()) {
    if (entry.status === "running") {
      try {
        if (entry.isPty && entry._pty) {
          entry._pty.kill();
        } else if (entry._child) {
          // Kill entire process group to prevent orphans
          try {
            process.kill(-entry.pid, "SIGKILL");
          } catch {}
          try {
            entry._child.kill("SIGKILL");
          } catch {}
        }
      } catch {
        // best-effort
      }
    }
  }
  registry.clear();
}

process.on("exit", shutdownAll);
