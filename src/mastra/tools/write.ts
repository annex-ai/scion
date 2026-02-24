// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { addChangeToSession, isInPlanMode } from "./plan-mode-manager";

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
function resolveWritePath(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(cwd, expanded);
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export const writeTool = createTool({
  id: "write-file",
  inputSchema: z.object({
    file_path: z.string().describe("Path to the file to write (relative or absolute)"),
    content: z.string().describe("Content to write to the file"),
    overwrite: z.boolean().optional().default(true).describe("Whether to overwrite existing file (default: true)"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether the write operation succeeded"),
    message: z.string().describe("Success or error message"),
    bytes_written: z.number().optional().describe("Number of bytes written (on success)"),
  }),
  description:
    "Creates or overwrites a file with the specified content. Accepts a file path and content string. Returns success status and bytes written. Use this tool when you need to create new files, save generated content, or completely replace file contents. Creates parent directories automatically if needed. Set overwrite=false to prevent overwriting existing files.",
  execute: async ({ file_path, content, overwrite }) => {
    const cwd = process.cwd();
    const absolutePath = resolveWritePath(file_path, cwd);

    // Check if in plan mode
    if (isInPlanMode()) {
      try {
        // Check if file exists to determine change type
        const exists = await fileExists(absolutePath);
        let beforeContent: string | undefined;

        if (exists) {
          // Read current content for 'edit' type
          beforeContent = await readFile(absolutePath, "utf-8");
        }

        // Record change instead of executing
        const changeId = addChangeToSession({
          type: exists ? "edit" : "write",
          filePath: absolutePath,
          before: beforeContent,
          after: content,
          status: "pending",
          metadata: {
            tool: "write-file",
            timestamp: new Date(),
          },
        });

        const bytesWritten = Buffer.byteLength(content, "utf-8");

        return {
          success: true,
          message: `[PLAN MODE] Recorded ${exists ? "edit" : "write"} to ${file_path} (change ID: ${changeId})`,
          bytes_written: bytesWritten,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Error recording change in plan mode: ${error.message}`,
        };
      }
    }

    // Normal execution (not in plan mode)
    try {
      // Check if file exists when overwrite protection is enabled
      if (!overwrite) {
        const exists = await fileExists(absolutePath);
        if (exists) {
          return {
            success: false,
            message: `File already exists: ${file_path} (use overwrite=true to overwrite)`,
          };
        }
      }

      // Create parent directories if needed
      const dir = dirname(absolutePath);
      await mkdir(dir, { recursive: true });

      // Write the file
      await writeFile(absolutePath, content, "utf-8");

      const bytesWritten = Buffer.byteLength(content, "utf-8");

      return {
        success: true,
        message: `Successfully wrote ${bytesWritten} bytes to ${file_path}`,
        bytes_written: bytesWritten,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Error writing file: ${error.message}`,
      };
    }
  },
});
