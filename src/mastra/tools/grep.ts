// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Truncation constants
const DEFAULT_LIMIT = 10000; // Significantly increased
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const GREP_MAX_LINE_LENGTH = 10000; // Increased line length limit

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
 * Expand ~ in path to home directory
 */
function expandPath(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }
  if (filePath.startsWith("~/")) {
    return os.homedir() + filePath.slice(1);
  }
  return filePath;
}

/**
 * Resolve path relative to cwd, handling ~ expansion and absolute paths
 */
function resolvePath(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(cwd, expanded);
}

/**
 * Truncate a single line to max length
 */
function truncateLine(line: string): { text: string; wasTruncated: boolean } {
  if (line.length <= GREP_MAX_LINE_LENGTH) {
    return { text: line, wasTruncated: false };
  }
  return {
    text: `${line.slice(0, GREP_MAX_LINE_LENGTH)}...`,
    wasTruncated: true,
  };
}

/**
 * Truncate output from the head (keep first N bytes)
 */
function truncateOutput(
  content: string,
  maxBytes: number,
): { content: string; truncated: boolean; outputBytes: number } {
  const totalBytes = Buffer.byteLength(content, "utf-8");

  if (totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      outputBytes: totalBytes,
    };
  }

  // Truncate by bytes, preserving complete lines
  const lines = content.split("\n");
  const outputLines: string[] = [];
  let outputBytes = 0;

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0); // +1 for newline

    if (outputBytes + lineBytes > maxBytes) {
      break;
    }

    outputLines.push(line);
    outputBytes += lineBytes;
  }

  return {
    content: outputLines.join("\n"),
    truncated: true,
    outputBytes: Buffer.byteLength(outputLines.join("\n"), "utf-8"),
  };
}

export const grepTool = createTool({
  id: "grep-search",
  inputSchema: z.object({
    pattern: z.string().describe("Search pattern (regex or literal string)"),
    path: z.string().optional().describe("Directory or file to search (default: current directory)"),
    glob: z.string().optional().describe("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"),
    case_insensitive: z.boolean().optional().default(false).describe("Case-insensitive search (default: false)"),
    context_before: z.number().optional().default(0).describe("Number of lines to show before each match (default: 0)"),
    context_after: z.number().optional().default(0).describe("Number of lines to show after each match (default: 0)"),
    limit: z
      .number()
      .optional()
      .default(DEFAULT_LIMIT)
      .describe(`Maximum number of matches to return (default: ${DEFAULT_LIMIT})`),
  }),
  outputSchema: z.object({
    matches: z.array(z.string()).describe("Array of matching lines with file paths and line numbers"),
    truncated: z.boolean().describe("Whether results were truncated"),
  }),
  description: `Searches file contents for a pattern using ripgrep. Accepts a regex or literal pattern, optional directory/file path, and glob filter. Returns matching lines with file paths and line numbers. Use this tool when you need to find code patterns, search for function definitions, locate string occurrences, or find files containing specific text. Respects .gitignore. Supports context lines before/after matches. Output is truncated to ${DEFAULT_LIMIT} matches or ${formatSize(DEFAULT_MAX_BYTES)}.`,
  execute: async (
    {
      pattern,
      path: searchDir,
      glob,
      case_insensitive = false,
      context_before = 0,
      context_after = 0,
      limit = DEFAULT_LIMIT,
    },
    context,
  ) => {
    const cwd = process.cwd();
    const searchPath = searchDir ? resolvePath(searchDir, cwd) : cwd;

    return new Promise((resolve, reject) => {
      const abortSignal = context?.abortSignal;

      if (abortSignal?.aborted) {
        reject(new Error("Operation aborted"));
        return;
      }

      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      // Check if rg is available
      const rgPath = "rg"; // Assume rg is in PATH

      // Check if search path exists and is a directory
      let isDirectory: boolean;
      try {
        isDirectory = statSync(searchPath).isDirectory();
      } catch (err: any) {
        settle(() => reject(new Error(`Path not found: ${searchPath}`)));
        return;
      }

      const effectiveLimit = Math.max(1, limit);
      const contextValue = Math.max(0, Math.max(context_before || 0, context_after || 0));

      // Format path for output
      const formatPath = (filePath: string): string => {
        if (isDirectory) {
          const rel = relative(searchPath, filePath);
          if (rel && !rel.startsWith("..")) {
            return rel.replace(/\\/g, "/");
          }
        }
        return basename(filePath);
      };

      // File cache for context lines
      const fileCache = new Map<string, string[]>();
      const getFileLines = (filePath: string): string[] => {
        let lines = fileCache.get(filePath);
        if (!lines) {
          try {
            const content = readFileSync(filePath, "utf-8");
            lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
          } catch {
            lines = [];
          }
          fileCache.set(filePath, lines);
        }
        return lines;
      };

      // Build ripgrep arguments
      const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"];

      if (case_insensitive) {
        args.push("--ignore-case");
      }

      if (glob) {
        args.push("--glob", glob);
      }

      // Add context flags
      if (context_before > 0) {
        args.push("-B", context_before.toString());
      }
      if (context_after > 0) {
        args.push("-A", context_after.toString());
      }

      args.push(pattern, searchPath);

      // Spawn ripgrep process
      const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      const rl = createInterface({ input: child.stdout });
      let stderr = "";
      let matchCount = 0;
      let matchLimitReached = false;
      let linesTruncated = false;
      let aborted = false;
      let killedDueToLimit = false;

      const matches: Array<{ filePath: string; lineNumber: number }> = [];

      const cleanup = () => {
        rl.close();
        abortSignal?.removeEventListener("abort", onAbort);
      };

      const stopChild = (dueToLimit = false) => {
        if (!child.killed) {
          killedDueToLimit = dueToLimit;
          child.kill();
        }
      };

      const onAbort = () => {
        aborted = true;
        stopChild();
      };

      abortSignal?.addEventListener("abort", onAbort, { once: true });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      // Format match block with context
      const formatBlock = (filePath: string, lineNumber: number): string[] => {
        const relativePath = formatPath(filePath);
        const lines = getFileLines(filePath);
        if (!lines.length) {
          return [`${relativePath}:${lineNumber}: (unable to read file)`];
        }

        const block: string[] = [];
        const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
        const end = contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;

        for (let current = start; current <= end; current++) {
          const lineText = lines[current - 1] ?? "";
          const sanitized = lineText.replace(/\r/g, "");
          const isMatchLine = current === lineNumber;

          // Truncate long lines
          const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
          if (wasTruncated) {
            linesTruncated = true;
          }

          if (isMatchLine) {
            block.push(`${relativePath}:${current}: ${truncatedText}`);
          } else {
            block.push(`${relativePath}-${current}- ${truncatedText}`);
          }
        }

        return block;
      };

      // Process JSON output from ripgrep
      rl.on("line", (line) => {
        if (!line.trim() || matchCount >= effectiveLimit) {
          return;
        }

        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type === "match") {
          matchCount++;
          const filePath = event.data?.path?.text;
          const lineNumber = event.data?.line_number;

          if (filePath && typeof lineNumber === "number") {
            matches.push({ filePath, lineNumber });
          }

          if (matchCount >= effectiveLimit) {
            matchLimitReached = true;
            stopChild(true);
          }
        }
      });

      child.on("error", (error) => {
        cleanup();
        settle(() => reject(new Error(`Failed to run ripgrep: ${error.message}`)));
      });

      child.on("close", (code) => {
        cleanup();

        if (aborted) {
          settle(() => reject(new Error("Operation aborted")));
          return;
        }

        if (!killedDueToLimit && code !== 0 && code !== 1) {
          const errorMsg = stderr.trim() || `ripgrep exited with code ${code}`;
          settle(() => reject(new Error(errorMsg)));
          return;
        }

        if (matchCount === 0) {
          settle(() =>
            resolve({
              matches: ["No matches found"],
              truncated: false,
            }),
          );
          return;
        }

        // Format matches with context
        const outputLines: string[] = [];
        for (const match of matches) {
          const block = formatBlock(match.filePath, match.lineNumber);
          outputLines.push(...block);
        }

        // Apply byte truncation
        const rawOutput = outputLines.join("\n");
        const truncation = truncateOutput(rawOutput, DEFAULT_MAX_BYTES);

        let output = truncation.content;
        const notices: string[] = [];

        if (matchLimitReached) {
          notices.push(
            `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
          );
        }

        if (truncation.truncated) {
          notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
        }

        if (linesTruncated) {
          notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
        }

        if (notices.length > 0) {
          output += `\n\n[${notices.join(". ")}]`;
        }

        settle(() =>
          resolve({
            matches: output.split("\n"),
            truncated: truncation.truncated || matchLimitReached,
          }),
        );
      });
    });
  },
});
