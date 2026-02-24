// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { type ProcessEntry, appendOutput, createProcess, generateProcessId, loadNodePty } from "./process-registry";

// Truncation constants
const DEFAULT_MAX_LINES = 100000; // Effectively no truncation for most use cases
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Format bytes as human-readable size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Get shell configuration based on platform
 */
function getShellConfig(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    // Try Git Bash in known locations
    const paths: string[] = [];
    const programFiles = process.env.ProgramFiles;
    if (programFiles) {
      paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
    }
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    if (programFilesX86) {
      paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
    }

    for (const path of paths) {
      if (existsSync(path)) {
        return { shell: path, args: ["-c"] };
      }
    }

    throw new Error("No bash shell found. Install Git for Windows: https://git-scm.com/download/win");
  }

  // Unix: prefer bash over sh
  if (existsSync("/bin/bash")) {
    return { shell: "/bin/bash", args: ["-c"] };
  }

  return { shell: "sh", args: ["-c"] };
}

/**
 * Kill a process and all its children (cross-platform)
 */
function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
      });
    } catch {
      // Ignore errors
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already dead
      }
    }
  }
}

/**
 * Truncate content from the tail (keep last N lines/bytes)
 */
function truncateTail(content: string) {
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  // No truncation needed
  if (totalLines <= DEFAULT_MAX_LINES && totalBytes <= DEFAULT_MAX_BYTES) {
    return {
      content,
      truncated: false,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
    };
  }

  // Work backwards from the end
  const outputLinesArr: string[] = [];
  let outputBytesCount = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let i = lines.length - 1; i >= 0 && outputLinesArr.length < DEFAULT_MAX_LINES; i--) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLinesArr.length > 0 ? 1 : 0);

    if (outputBytesCount + lineBytes > DEFAULT_MAX_BYTES) {
      truncatedBy = "bytes";
      break;
    }

    outputLinesArr.unshift(line);
    outputBytesCount += lineBytes;
  }

  // If we exited due to line limit
  if (outputLinesArr.length >= DEFAULT_MAX_LINES && outputBytesCount <= DEFAULT_MAX_BYTES) {
    truncatedBy = "lines";
  }

  const outputContent = outputLinesArr.join("\n");
  const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");

  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: finalOutputBytes,
  };
}

// ---------------------------------------------------------------------------
// Background execution handler
// ---------------------------------------------------------------------------

function handleBackground(
  command: string,
  cwd: string,
  usePty: boolean,
): { sessionId: string; pid: number; stdout: string; stderr: string; exit_code: null; truncated: false } {
  const id = generateProcessId();
  const { shell, args } = getShellConfig();

  if (usePty) {
    const pty = loadNodePty();
    const ptyProcess = pty.spawn(shell, [...args, command], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env: process.env as Record<string, string>,
    });

    // Buffer data that arrives before registry entry exists
    const earlyData: string[] = [];
    let registered = false;

    const entry: ProcessEntry = {
      id,
      command,
      cwd,
      pid: ptyProcess.pid,
      status: "running",
      isPty: true,
      startTime: Date.now(),
      exitTime: null,
      exitCode: null,
      exitSignal: null,
      output: "",
      totalBytesReceived: 0,
      bytesDiscarded: 0,
      lastPollOffset: 0,
      _pty: ptyProcess,
    };

    // Attach handlers BEFORE registering to avoid race with fast-exiting processes
    ptyProcess.onData((data: string) => {
      if (!registered) {
        earlyData.push(data);
      } else {
        appendOutput(id, data);
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      // Delay marking exited to let buffered onData events flush (node-pty quirk)
      setTimeout(() => {
        entry.status = "exited";
        entry.exitTime = Date.now();
        entry.exitCode = exitCode;
        entry.exitSignal = signal !== undefined ? String(signal) : null;
        entry._pty = undefined;
      }, 50);
    });

    createProcess(entry);

    // Flush any data that arrived before registration
    for (const chunk of earlyData) {
      appendOutput(id, chunk);
    }
    registered = true;

    return {
      sessionId: id,
      pid: ptyProcess.pid,
      stdout: `Background PTY process started [${id}] (pid: ${ptyProcess.pid})`,
      stderr: "",
      exit_code: null,
      truncated: false,
    };
  }
  const child = spawn(shell, [...args, command], {
    cwd,
    detached: true,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pid = child.pid ?? 0;
  if (!child.pid) {
    // Spawn failed synchronously (no PID assigned). The 'error' event will fire
    // but we need to handle it gracefully. Return an immediate failure.
    child.on("error", () => {}); // prevent unhandled error crash
    return {
      sessionId: id,
      pid: 0,
      stdout: "Failed to start background process: spawn may have failed",
      stderr: "",
      exit_code: null,
      truncated: false,
    };
  }

  // Detach so the parent event loop doesn't keep running for background processes.
  // Stdio pipes are net.Socket at runtime but typed as Readable/Writable, so cast.
  child.unref();
  (child.stdout as any)?.unref?.();
  (child.stderr as any)?.unref?.();
  (child.stdin as any)?.unref?.();

  const earlyChunks: string[] = [];
  let childRegistered = false;

  const entry: ProcessEntry = {
    id,
    command,
    cwd,
    pid,
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
    _child: child,
  };

  // Attach handlers before registering to avoid race
  child.stdout?.on("data", (data: Buffer) => {
    if (!childRegistered) {
      earlyChunks.push(data.toString());
    } else {
      appendOutput(id, data.toString());
    }
  });
  child.stderr?.on("data", (data: Buffer) => {
    const prefixed = `[stderr] ${data.toString()}`;
    if (!childRegistered) {
      earlyChunks.push(prefixed);
    } else {
      appendOutput(id, prefixed);
    }
  });

  child.on("error", (err) => {
    entry.status = "exited";
    entry.exitTime = Date.now();
    entry.exitCode = 1;
    entry.exitSignal = null;
    entry._child = undefined;
    appendOutput(id, `[error] ${err.message}\n`);
  });

  child.on("close", (code, signal) => {
    entry.status = "exited";
    entry.exitTime = Date.now();
    entry.exitCode = code;
    entry.exitSignal = signal;
    entry._child = undefined;
  });

  createProcess(entry);

  for (const chunk of earlyChunks) {
    appendOutput(id, chunk);
  }
  childRegistered = true;

  return {
    sessionId: id,
    pid,
    stdout: `Background process started [${id}] (pid: ${pid})`,
    stderr: "",
    exit_code: null,
    truncated: false,
  };
}

// ---------------------------------------------------------------------------
// Synchronous PTY execution handler
// ---------------------------------------------------------------------------

function handlePtySynchronous(
  command: string,
  cwd: string,
  timeout: number | undefined,
  context: any,
): Promise<{
  stdout: string;
  stderr: string;
  exit_code: number | null;
  truncated: boolean;
  full_output_file?: string;
}> {
  return new Promise((resolve, reject) => {
    const pty = loadNodePty();
    const { shell, args } = getShellConfig();

    const ptyProcess = pty.spawn(shell, [...args, command], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env: process.env as Record<string, string>,
    });

    let timedOut = false;
    const outputChunks: string[] = [];

    // Timeout
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeout !== undefined && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        ptyProcess.kill();
      }, timeout * 1000);
    }

    // Abort signal
    const abortSignal = context?.abortSignal;
    const onAbort = () => {
      ptyProcess.kill();
    };
    if (abortSignal) {
      if (abortSignal.aborted) {
        ptyProcess.kill();
        reject(Object.assign(new Error("Command aborted by user or timeout"), { code: "COMMAND_ABORTED" }));
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    ptyProcess.onData((data: string) => {
      outputChunks.push(data);
      if (context?.writer) {
        context.writer.write(data).catch(() => {});
      }
    });

    ptyProcess.onExit(async ({ exitCode }) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);

      if (abortSignal?.aborted) {
        reject(Object.assign(new Error("Command aborted by user or timeout"), { code: "COMMAND_ABORTED" }));
        return;
      }
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeout} seconds`));
        return;
      }

      // Allow final PTY data to drain before collecting output
      await new Promise((r) => setTimeout(r, 50));

      // PTY merges stdout/stderr into a single stream
      const fullOutput = outputChunks.join("");
      const truncation = truncateTail(fullOutput);
      let stdoutText = truncation.content || "";

      if (truncation.truncated) {
        const startLine = truncation.totalLines - truncation.outputLines + 1;
        const endLine = truncation.totalLines;
        if (truncation.truncatedBy === "lines") {
          stdoutText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}]`;
        } else {
          stdoutText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)]`;
        }
      }

      let fullOutputFile: string | undefined;
      if (truncation.truncated) {
        try {
          const tempDir = join(os.tmpdir(), "mastra-bash-output");
          if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          fullOutputFile = join(tempDir, `output-${timestamp}-${randomSuffix}.txt`);
          await writeFile(fullOutputFile, fullOutput, "utf-8");
          stdoutText += `\n[Full output saved to: ${fullOutputFile}]`;
        } catch {
          // Ignore temp file errors
        }
      }

      resolve({
        stdout: stdoutText,
        stderr: "", // PTY merges streams
        exit_code: exitCode,
        truncated: truncation.truncated,
        ...(fullOutputFile && { full_output_file: fullOutputFile }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Standard (non-PTY, non-background) execution — original behavior
// ---------------------------------------------------------------------------

function handleStandardExecution(
  command: string,
  cwd: string,
  timeout: number | undefined,
  context: any,
): Promise<{
  stdout: string;
  stderr: string;
  exit_code: number | null;
  truncated: boolean;
  full_output_file?: string;
}> {
  const { shell, args } = getShellConfig();

  return new Promise((resolve, reject) => {
    const child = spawn(shell, [...args, command], {
      cwd,
      detached: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timedOut = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    // Set timeout if provided
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeout !== undefined && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          killProcessTree(child.pid);
        }
      }, timeout * 1000);
    }

    // Handle abort signal
    const abortSignal = context?.abortSignal;
    const onAbort = () => {
      if (child.pid) {
        killProcessTree(child.pid);
      }
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort();
        const error = new Error("Command aborted by user or timeout");
        (error as any).code = "COMMAND_ABORTED";
        reject(error);
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // Collect stdout with streaming callback support
    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        stdoutChunks.push(data);
        // Stream output via writer if available
        if (context?.writer) {
          context.writer.write(data.toString()).catch(() => {
            // Ignore write errors during streaming
          });
        }
      });
    }

    // Collect stderr with streaming callback support
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        stderrChunks.push(data);
        // Stream output via writer if available
        if (context?.writer) {
          context.writer.write(data.toString()).catch(() => {
            // Ignore write errors during streaming
          });
        }
      });
    }

    // Handle spawn errors
    child.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
      reject(err);
    });

    // Handle process exit
    child.on("close", async (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);

      if (abortSignal?.aborted) {
        const error = new Error("Command aborted by user or timeout");
        (error as any).code = "COMMAND_ABORTED";
        reject(error);
        return;
      }

      if (timedOut) {
        reject(new Error(`Command timed out after ${timeout} seconds`));
        return;
      }

      // Process stdout
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stdoutFull = stdoutBuffer.toString("utf-8");
      const stdoutTruncation = truncateTail(stdoutFull);
      let stdoutText = stdoutTruncation.content || "";

      // Add truncation notice for stdout
      if (stdoutTruncation.truncated) {
        const startLine = stdoutTruncation.totalLines - stdoutTruncation.outputLines + 1;
        const endLine = stdoutTruncation.totalLines;

        if (stdoutTruncation.truncatedBy === "lines") {
          stdoutText += `\n\n[Showing lines ${startLine}-${endLine} of ${stdoutTruncation.totalLines}]`;
        } else {
          stdoutText += `\n\n[Showing lines ${startLine}-${endLine} of ${stdoutTruncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)]`;
        }
      }

      // Process stderr
      const stderrBuffer = Buffer.concat(stderrChunks);
      const stderrFull = stderrBuffer.toString("utf-8");
      const stderrTruncation = truncateTail(stderrFull);
      let stderrText = stderrTruncation.content || "";

      // Add truncation notice for stderr
      if (stderrTruncation.truncated) {
        const startLine = stderrTruncation.totalLines - stderrTruncation.outputLines + 1;
        const endLine = stderrTruncation.totalLines;

        if (stderrTruncation.truncatedBy === "lines") {
          stderrText += `\n\n[Showing lines ${startLine}-${endLine} of ${stderrTruncation.totalLines}]`;
        } else {
          stderrText += `\n\n[Showing lines ${startLine}-${endLine} of ${stderrTruncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)]`;
        }
      }

      const wasTruncated = stdoutTruncation.truncated || stderrTruncation.truncated;

      // Write full output to temp file if truncated
      let fullOutputFile: string | undefined;
      if (wasTruncated) {
        try {
          const tempDir = join(os.tmpdir(), "mastra-bash-output");
          if (!existsSync(tempDir)) {
            mkdirSync(tempDir, { recursive: true });
          }
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          fullOutputFile = join(tempDir, `output-${timestamp}-${randomSuffix}.txt`);

          const fullContent = ["=== STDOUT ===", stdoutFull, "", "=== STDERR ===", stderrFull].join("\n");

          await writeFile(fullOutputFile, fullContent, "utf-8");

          // Add notice about temp file to stdout
          stdoutText += `\n[Full output saved to: ${fullOutputFile}]`;
        } catch {
          // Ignore temp file errors, continue with truncated output
        }
      }

      resolve({
        stdout: stdoutText,
        stderr: stderrText,
        exit_code: code,
        truncated: wasTruncated,
        ...(fullOutputFile && { full_output_file: fullOutputFile }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const bashTool = createTool({
  id: "bash",
  inputSchema: z.object({
    command: z.string().describe("Bash command to execute"),
    timeout: z.number().optional().describe("Timeout in seconds (optional, no default timeout)"),
    cwd: z.string().optional().describe("Working directory (defaults to process.cwd())"),
    workdir: z.string().optional().describe("Alias for cwd"),
    pty: z.boolean().optional().describe("Allocate a pseudo-terminal (enables color, interactive programs)"),
    background: z.boolean().optional().describe("Run in background, return sessionId immediately"),
  }),
  outputSchema: z.object({
    stdout: z.string().describe("Standard output from command"),
    stderr: z.string().describe("Standard error from command"),
    exit_code: z.number().nullable().describe("Exit code (null if killed or background)"),
    truncated: z.boolean().describe("Whether output was truncated"),
    full_output_file: z
      .string()
      .optional()
      .describe("Path to temp file containing full output (only present when truncated)"),
    sessionId: z.string().optional().describe("Process registry ID (only for background processes)"),
    pid: z.number().optional().describe("OS process ID (only for background processes)"),
  }),
  description: `Executes a bash shell command on the system. Accepts a command string, optional timeout in seconds, and optional working directory. Returns stdout, stderr, and exit code. Supports pty mode for interactive/colored output and background mode for long-running processes. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Full output is saved to a temp file when truncated.`,
  execute: async ({ command, timeout, cwd, workdir, pty: usePty, background }, context) => {
    const workingDir = workdir || cwd || process.cwd();

    // Validate working directory exists
    if (!existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }

    // Background mode: spawn and return immediately
    if (background) {
      return handleBackground(command, workingDir, usePty ?? false);
    }

    // PTY synchronous mode: run to completion with pseudo-terminal
    if (usePty) {
      return handlePtySynchronous(command, workingDir, timeout, context);
    }

    // Standard mode: original behavior, unchanged
    return handleStandardExecution(command, workingDir, timeout, context);
  },
});
