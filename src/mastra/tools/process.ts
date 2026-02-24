// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Process Tool
 *
 * Manages background processes spawned by the bash tool.
 * Provides actions to list, poll, read logs, write stdin,
 * send key sequences, and kill processes.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  getOutput,
  getProcess,
  killProcess,
  listProcesses,
  pollOutput,
  pruneExpired,
  removeProcess,
  sendSignal,
  validateSignal,
  writeToProcess,
} from "./process-registry";

// ---------------------------------------------------------------------------
// Key token → escape sequence map
// ---------------------------------------------------------------------------

const KEY_MAP: Record<string, string> = {
  "C-c": "\x03",
  "C-d": "\x04",
  "C-z": "\x1a",
  "C-l": "\x0c",
  "C-a": "\x01",
  "C-e": "\x05",
  "C-k": "\x0b",
  "C-u": "\x15",
  "C-w": "\x17",
  "C-r": "\x12",
  "C-\\": "\x1c",
  Enter: "\r",
  Tab: "\t",
  Escape: "\x1b",
  Backspace: "\x7f",
  Up: "\x1b[A",
  Down: "\x1b[B",
  Right: "\x1b[C",
  Left: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Delete: "\x1b[3~",
  Insert: "\x1b[2~",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

// Signal keys for non-PTY processes (send OS signals instead of bytes)
const SIGNAL_KEYS: Record<string, NodeJS.Signals> = {
  "C-c": "SIGINT",
  "C-z": "SIGTSTP",
  "C-\\": "SIGQUIT",
};

export const processTool = createTool({
  id: "process",
  inputSchema: z.object({
    action: z
      .enum(["list", "poll", "log", "write", "paste", "submit", "send-keys", "kill"])
      .describe("Action to perform on background processes"),
    sessionId: z.string().optional().describe("Session ID (required for all actions except list)"),
    offset: z.number().optional().describe("Line offset for log action"),
    limit: z.number().optional().describe("Max lines to return for log action"),
    data: z.string().optional().describe("Data to write (for write, paste, and submit actions)"),
    keys: z
      .array(z.string())
      .optional()
      .describe(
        "Key tokens to send (for send-keys action). Tokens: C-c, C-d, C-z, Enter, Tab, Escape, Up, Down, Left, Right, etc.",
      ),
    signal: z
      .string()
      .optional()
      .describe(
        "Signal to send for kill action (default: SIGTERM). Valid: SIGTERM, SIGKILL, SIGINT, SIGHUP, SIGQUIT, SIGTSTP, SIGCONT",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string().optional(),
    processes: z
      .array(
        z.object({
          id: z.string(),
          command: z.string(),
          cwd: z.string(),
          pid: z.number(),
          status: z.enum(["running", "exited"]),
          isPty: z.boolean(),
          runtimeMs: z.number(),
          exitCode: z.number().nullable(),
        }),
      )
      .optional(),
    status: z.enum(["running", "exited"]).optional(),
    exitCode: z.number().nullable().optional(),
    exitSignal: z.string().nullable().optional(),
    output: z.string().optional(),
    outputOffset: z.number().optional(),
    outputLines: z.number().optional(),
    totalBytesReceived: z.number().optional(),
    bytesDiscarded: z.number().optional(),
    hasGap: z.boolean().optional(),
  }),
  description:
    "Manage background processes spawned by the bash tool. Actions: list (show all), poll (check status + new output since last poll), log (read output with offset/limit), write (raw stdin), paste (alias for write), submit (stdin + line ending), send-keys (key tokens like C-c, Enter, Up), kill (send signal).",
  execute: async ({ action, sessionId, offset, limit, data, keys, signal }) => {
    // --- LIST ---
    if (action === "list") {
      pruneExpired();
      const all = listProcesses();
      const now = Date.now();
      return {
        success: true,
        message: `${all.length} process(es)`,
        processes: all.map((p) => ({
          id: p.id,
          command: p.command.length > 80 ? `${p.command.slice(0, 77)}...` : p.command,
          cwd: p.cwd,
          pid: p.pid,
          status: p.status,
          isPty: p.isPty,
          runtimeMs: (p.exitTime ?? now) - p.startTime,
          exitCode: p.exitCode,
        })),
      };
    }

    // All other actions require sessionId
    if (!sessionId) {
      return { success: false, message: "sessionId is required for this action" };
    }

    const entry = getProcess(sessionId);
    if (!entry) {
      return { success: false, message: `No process found with id: ${sessionId}` };
    }

    // --- POLL ---
    if (action === "poll") {
      const slice = pollOutput(sessionId);
      return {
        success: true,
        status: entry.status,
        exitCode: entry.exitCode,
        exitSignal: entry.exitSignal,
        output: slice?.output ?? "",
        outputOffset: slice?.offset,
        outputLines: slice?.length,
        totalBytesReceived: entry.totalBytesReceived,
        bytesDiscarded: entry.bytesDiscarded,
      };
    }

    // --- LOG ---
    if (action === "log") {
      const slice = getOutput(sessionId, offset, limit);
      if (!slice) {
        return { success: false, message: "Failed to read output" };
      }
      return {
        success: true,
        output: slice.output,
        outputOffset: slice.offset,
        outputLines: slice.length,
        totalBytesReceived: slice.totalBytesReceived,
        bytesDiscarded: slice.bytesDiscarded,
        hasGap: slice.hasGap,
      };
    }

    // --- WRITE ---
    if (action === "write") {
      if (data === undefined) {
        return { success: false, message: "data is required for write action" };
      }
      const ok = writeToProcess(sessionId, data);
      return {
        success: ok,
        message: ok ? `Wrote ${data.length} chars` : "Failed to write (process may have exited)",
      };
    }

    // --- PASTE (with bracketed paste mode for PTY) ---
    if (action === "paste") {
      if (data === undefined) {
        return { success: false, message: "data is required for paste action" };
      }
      // PTY processes get bracketed paste sequences so TUI apps (vim, codex, etc.)
      // can distinguish pasted text from typed input
      const payload = entry.isPty ? `\x1b[200~${data}\x1b[201~` : data;
      const ok = writeToProcess(sessionId, payload);
      return {
        success: ok,
        message: ok
          ? `Pasted ${data.length} chars${entry.isPty ? " (bracketed)" : ""}`
          : "Failed to paste (process may have exited)",
      };
    }

    // --- SUBMIT ---
    if (action === "submit") {
      if (data === undefined) {
        return { success: false, message: "data is required for submit action" };
      }
      const lineEnding = entry.isPty ? "\r" : "\n";
      const ok = writeToProcess(sessionId, data + lineEnding);
      return {
        success: ok,
        message: ok ? `Submitted: ${data}` : "Failed to submit (process may have exited)",
      };
    }

    // --- SEND-KEYS ---
    if (action === "send-keys") {
      if (!keys || keys.length === 0) {
        return { success: false, message: "keys array is required for send-keys action" };
      }

      const results: string[] = [];
      let allOk = true;

      for (const key of keys) {
        // For non-PTY processes, signal keys send OS signals
        if (!entry.isPty && SIGNAL_KEYS[key]) {
          const ok = sendSignal(sessionId, SIGNAL_KEYS[key]);
          results.push(`${key} → ${SIGNAL_KEYS[key]} (${ok ? "sent" : "failed"})`);
          if (!ok) allOk = false;
          continue;
        }

        const seq = KEY_MAP[key];
        if (!seq) {
          results.push(`${key} → unknown key token`);
          allOk = false;
          continue;
        }

        const ok = writeToProcess(sessionId, seq);
        results.push(`${key} (${ok ? "sent" : "failed"})`);
        if (!ok) allOk = false;
      }

      return {
        success: allOk,
        message: results.join(", "),
      };
    }

    // --- KILL ---
    if (action === "kill") {
      let sig: NodeJS.Signals = "SIGTERM";
      if (signal) {
        try {
          sig = validateSignal(signal);
        } catch (e: any) {
          return { success: false, message: e.message };
        }
      }
      if (entry.status === "exited") {
        removeProcess(sessionId);
        return {
          success: true,
          message: `Process ${sessionId} already exited (code: ${entry.exitCode}), removed from registry`,
        };
      }
      const ok = killProcess(sessionId, sig);
      return {
        success: ok,
        message: ok
          ? `Sent ${sig} to process ${sessionId} (pid: ${entry.pid})`
          : `Failed to send ${sig} to process ${sessionId}`,
      };
    }

    return { success: false, message: `Unknown action: ${action}` };
  },
});
