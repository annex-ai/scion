// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TaskArchive Tool
 *
 * Archives completed working memory and resets for new goals.
 * Supports both natural completion (all tasks done) and forced archival.
 * Includes TOCTOU protection and rolling backups.
 */

import { unlink } from "node:fs/promises";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  archiveWorkingMemory,
  backupWorkingMemory,
  buildClearedWorkingMemory,
  hashTaskSection,
  isAllTasksComplete,
} from "../lib/task-archive";
import { fetchWorkingMemory, getMemoryParams, parseAllTasks, saveWorkingMemory } from "./task-helpers";

const LOG_PREFIX = "[TaskArchive]";

// ============================================================================
// Tool Schema
// ============================================================================

const taskArchiveInputSchema = z.object({
  force: z.boolean().optional().default(false).describe("Archive even if not all tasks are complete"),
  reason: z.string().optional().describe("Required context when force=true"),
  preserveNotes: z.boolean().optional().default(true).describe("Keep Notes & Context section (default: true)"),
});

const taskArchiveOutputSchema = z.object({
  success: z.boolean(),
  archived: z.boolean(),
  archivePath: z.string().optional(),
  taskCount: z.number().int().optional(),
  message: z.string(),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const taskArchiveTool = createTool({
  id: "TaskArchive",
  inputSchema: taskArchiveInputSchema,
  outputSchema: taskArchiveOutputSchema,
  description:
    "Archive completed working memory to history and reset for new goals. " +
    "Use after all tasks are complete, or with force=true to archive mid-work.",
  execute: async (input, context) => {
    const { force, reason, preserveNotes } = input;
    const startTime = Date.now();

    console.log(`${LOG_PREFIX} execute called — force=${force}, preserveNotes=${preserveNotes}`);

    try {
      // Validation: force requires reason
      if (force && (!reason || reason.trim().length === 0)) {
        console.log(`${LOG_PREFIX} Validation failed: force=true but no reason provided`);
        return {
          success: false,
          archived: false,
          message: "reason is required when force=true",
        };
      }

      const params = getMemoryParams(context);
      console.log(`${LOG_PREFIX} threadId=${params.threadId}, resourceId=${params.resourceId}`);

      // 1. Fetch working memory
      let markdown: string;
      try {
        markdown = await fetchWorkingMemory(params);
      } catch {
        return {
          success: false,
          archived: false,
          message: "No working memory found — nothing to archive",
        };
      }

      // 2. Validate: all tasks complete (unless forced)
      if (!force && !isAllTasksComplete(markdown)) {
        console.log(`${LOG_PREFIX} Not all tasks complete and force=false`);
        return {
          success: false,
          archived: false,
          message: "Not all tasks complete. Use force:true to override.",
        };
      }

      // 3. TOCTOU snapshot
      const hashBefore = hashTaskSection(markdown);
      console.log(`${LOG_PREFIX} TOCTOU hash before: ${hashBefore}`);

      // 4. Backup
      let backupPath: string;
      try {
        backupPath = await backupWorkingMemory(markdown);
        console.log(`${LOG_PREFIX} Backup created: ${backupPath}`);
      } catch (e) {
        console.error(`${LOG_PREFIX} Backup failed:`, e);
        return {
          success: false,
          archived: false,
          message: `Failed to create backup: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      // 5. TOCTOU verification — re-read and compare
      let currentMarkdown: string;
      try {
        currentMarkdown = await fetchWorkingMemory(params);
      } catch {
        // Working memory disappeared between reads
        try {
          await unlink(backupPath);
        } catch {}
        return {
          success: false,
          archived: false,
          message: "Working memory disappeared during archival, aborting",
        };
      }

      const hashAfter = hashTaskSection(currentMarkdown);
      console.log(`${LOG_PREFIX} TOCTOU hash after: ${hashAfter}`);

      if (hashBefore !== hashAfter) {
        console.warn(
          JSON.stringify({
            event: "working-memory.archive-aborted",
            level: "warn",
            reason: "toctou_mismatch",
            hashBefore,
            hashAfter,
            message: "Working memory changed during archival, aborting",
          }),
        );
        // Cleanup backup
        try {
          await unlink(backupPath);
        } catch {}
        return {
          success: false,
          archived: false,
          message: "Working memory changed during archival, aborting",
        };
      }

      // 6. Archive
      let archivePath: string;
      try {
        archivePath = await archiveWorkingMemory(currentMarkdown, {
          forced: force,
          reason,
        });
        console.log(`${LOG_PREFIX} Archived to: ${archivePath}`);
      } catch (e) {
        console.error(
          JSON.stringify({
            event: "working-memory.archive-failed",
            level: "error",
            stage: "archive_write",
            error: e instanceof Error ? e.message : String(e),
          }),
        );
        // Cleanup backup
        try {
          await unlink(backupPath);
        } catch {}
        return {
          success: false,
          archived: false,
          message: `Failed to write archive: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      // 7. Build cleared working memory
      const clearedContent = buildClearedWorkingMemory(currentMarkdown, archivePath, {
        preserveNotes,
        forced: force,
        reason,
      });

      // 8. Save cleared working memory
      try {
        await saveWorkingMemory(params, clearedContent);
        console.log(`${LOG_PREFIX} Working memory cleared and saved`);
      } catch (e) {
        console.error(`${LOG_PREFIX} Failed to save cleared working memory:`, e);
        return {
          success: false,
          archived: true, // Archive was written successfully
          archivePath,
          message: "Archive written but failed to clear working memory. Backup available for recovery.",
        };
      }

      // 9. Success
      const tasks = parseAllTasks(currentMarkdown);
      const taskCount = tasks.filter((t) => t.status === "completed").length;
      const durationMs = Date.now() - startTime;

      console.log(
        JSON.stringify({
          event: "working-memory.archived",
          archivePath,
          backupPath,
          taskCount,
          completionType: force ? "forced" : "natural",
          forcedReason: reason ?? null,
          durationMs,
          timestamp: new Date().toISOString(),
        }),
      );

      return {
        success: true,
        archived: true,
        archivePath,
        taskCount,
        message: `Archived ${taskCount} tasks. Working memory cleared for new goals.`,
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} ERROR:`, error);
      return {
        success: false,
        archived: false,
        message: `Failed to archive: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
