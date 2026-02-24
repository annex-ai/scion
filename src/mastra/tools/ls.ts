// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Format file size as human-readable
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}K`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/**
 * Format date as ls-style timestamp
 */
function formatDate(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  const day = date.getDate().toString().padStart(2, " ");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${month} ${day} ${hours}:${minutes}`;
}

export const lsTool = createTool({
  id: "ls",
  inputSchema: z.object({
    path: z.string().optional().describe("Directory path to list (defaults to current working directory)"),
    all: z.boolean().optional().describe("Include hidden files (starting with .)"),
    long: z.boolean().optional().describe("Use long listing format with details"),
  }),
  outputSchema: z.object({
    entries: z.array(
      z.object({
        name: z.string(),
        type: z.enum(["file", "directory", "symlink", "other"]),
        size: z.number().optional(),
        sizeFormatted: z.string().optional(),
        modified: z.string().optional(),
      }),
    ),
    path: z.string(),
    total: z.number(),
  }),
  description:
    "Lists contents of a directory. Accepts an optional path (defaults to current directory). Returns an array of entries with names and types (file/directory/symlink). Use this tool when you need to explore directory structure, see what files exist in a folder, or get an overview of project contents. Set all=true to include hidden files, long=true for sizes and modification times.",
  execute: async ({ path, all, long }) => {
    const targetPath = path || process.cwd();

    try {
      const entries = await readdir(targetPath, { withFileTypes: true });

      // Filter hidden files unless 'all' is specified
      const filteredEntries = all ? entries : entries.filter((entry) => !entry.name.startsWith("."));

      // Sort: directories first, then files, alphabetically within each group
      filteredEntries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      const results = await Promise.all(
        filteredEntries.map(async (entry) => {
          const fullPath = join(targetPath, entry.name);
          let type: "file" | "directory" | "symlink" | "other" = "other";
          let size: number | undefined;
          let modified: string | undefined;

          if (entry.isDirectory()) {
            type = "directory";
          } else if (entry.isFile()) {
            type = "file";
          } else if (entry.isSymbolicLink()) {
            type = "symlink";
          }

          // Get additional stats if long format requested
          if (long) {
            try {
              const stats = await stat(fullPath);
              size = stats.size;
              modified = formatDate(stats.mtime);
            } catch {
              // Ignore stat errors (e.g., broken symlinks)
            }
          }

          return {
            name: entry.name + (type === "directory" ? "/" : ""),
            type,
            ...(size !== undefined && { size, sizeFormatted: formatSize(size) }),
            ...(modified && { modified }),
          };
        }),
      );

      return {
        entries: results,
        path: targetPath,
        total: results.length,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to list directory '${targetPath}': ${error.message}`);
      }
      throw error;
    }
  },
});
