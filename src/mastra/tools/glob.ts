// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import os from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import fg from "fast-glob";
import { z } from "zod";

// Truncation constants
const DEFAULT_MAX_RESULTS = 1000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

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
function resolveGlobPath(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(cwd, expanded);
}

/**
 * Truncate output from the head (keep first N lines/bytes)
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

export const globTool = createTool({
  id: "glob-files",
  inputSchema: z.object({
    pattern: z.string().describe("Glob pattern to match files (e.g., '*.ts', '**/*.json', 'src/**/*.spec.ts')"),
    path: z.string().optional().describe("Directory to search in (default: current directory)"),
  }),
  outputSchema: z.object({
    files: z.array(z.string()).describe("Array of matching file paths (relative to search directory)"),
    truncated: z.boolean().describe("Whether the result was truncated"),
    resultLimitReached: z.boolean().optional().describe("Whether the result limit was reached"),
    totalFiles: z.number().describe("Total number of files found"),
  }),
  description: `Finds files matching a glob pattern. Accepts a pattern like "*.ts", "**/*.json", or "src/**/*.spec.ts" and optional directory path. Returns an array of matching file paths relative to the search directory. Use this tool when you need to find files by name pattern, locate all files of a certain type, or explore directory structure. Respects .gitignore and excludes node_modules. Truncated to ${DEFAULT_MAX_RESULTS} results or ${formatSize(DEFAULT_MAX_BYTES)}.`,
  execute: async ({ pattern, path: searchDir }) => {
    const cwd = process.cwd();
    const searchPath = searchDir ? resolveGlobPath(searchDir, cwd) : cwd;

    try {
      // Search for files using fast-glob
      const results = await fg(pattern, {
        cwd: searchPath,
        dot: true, // Include dotfiles
        ignore: ["**/node_modules/**", "**/.git/**"], // Respect common ignore patterns
        onlyFiles: true, // Only return files, not directories
        absolute: true, // Get absolute paths first
        stats: false,
      });

      // Sort results for consistent output
      results.sort();

      // Check if result limit was reached
      const resultLimitReached = results.length >= DEFAULT_MAX_RESULTS;

      // Limit results
      const limitedResults = results.slice(0, DEFAULT_MAX_RESULTS);

      // Convert to relative paths
      const relativePaths = limitedResults.map((absolutePath) => {
        return relative(searchPath, absolutePath);
      });

      // No files found
      if (relativePaths.length === 0) {
        return {
          files: [],
          truncated: false,
          totalFiles: 0,
        };
      }

      // Join paths with newlines for truncation check
      const outputText = relativePaths.join("\n");
      const truncation = truncateOutput(outputText, DEFAULT_MAX_BYTES);

      // If truncated by bytes, reconstruct file list from truncated content
      const finalFiles = truncation.truncated
        ? truncation.content.split("\n").filter((line) => line.trim() !== "")
        : relativePaths;

      return {
        files: finalFiles,
        truncated: truncation.truncated,
        resultLimitReached: resultLimitReached || undefined,
        totalFiles: limitedResults.length,
      };
    } catch (error: any) {
      // Return error as empty result with error in first file entry
      return {
        files: [`Error: ${error.message}`],
        truncated: false,
        totalFiles: 0,
      };
    }
  },
});
