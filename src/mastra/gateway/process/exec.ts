// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { spawn } from "node:child_process";

/**
 * Run a shell command with arguments and return stdout/stderr.
 */
export async function runExec(
  command: string,
  args: string[],
  options?: { timeoutMs?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024;
  const timeoutMs = options?.timeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let totalBytes = 0;

    proc.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes <= maxBuffer) chunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");
      if (code !== 0) {
        const err = new Error(`Command failed (exit ${code}): ${command} ${args.join(" ")}\n${stderr}`);
        Object.assign(err, { stdout, stderr, exitCode: code });
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
