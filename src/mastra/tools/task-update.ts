// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TaskUpdate Tool
 *
 * Updates a task: status, subject, description, blockers, or deletion.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  fetchWorkingMemory,
  getMemoryParams,
  type ParsedTask,
  parseTask,
  removeTaskFromMarkdown,
  saveWorkingMemory,
  updateTaskInMarkdown,
} from "./task-helpers";

const LOG_PREFIX = "[TaskUpdate]";

// ============================================================================
// Tool Schema
// ============================================================================

const taskUpdateInputSchema = z.object({
  taskId: z.string().describe("Task ID to update (required)"),
  status: z.enum(["pending", "in_progress", "completed", "deleted"]).optional().describe("New task status"),
  subject: z.string().optional().describe("Updated subject"),
  description: z.string().optional().describe("Updated description"),
  addBlockedBy: z.array(z.string()).optional().describe("Add task IDs that block this task"),
});

const taskUpdateOutputSchema = z.object({
  success: z.boolean().describe("Whether update succeeded"),
  task: z
    .object({
      id: z.string(),
      subject: z.string(),
      description: z.string(),
      status: z.string(),
      blockedBy: z.array(z.string()),
    })
    .optional()
    .describe("Updated task details"),
  message: z.string().describe("Status message"),
});

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * TaskUpdate Tool
 *
 * Updates a task: status changes, field updates, deletion.
 * Handles moving tasks between Pending/Completed sections when status changes.
 */
export const taskUpdateTool = createTool({
  id: "TaskUpdate",
  inputSchema: taskUpdateInputSchema,
  outputSchema: taskUpdateOutputSchema,
  description:
    "Update a task: change status (pending/in_progress/completed/deleted), update subject or description, or add/remove blocking tasks. Tasks move between sections based on status.",
  execute: async ({ taskId, status, subject, description, addBlockedBy }, context) => {
    console.log(`${LOG_PREFIX} execute called`);
    console.log(`${LOG_PREFIX} taskId:`, taskId);
    console.log(`${LOG_PREFIX} status:`, status);
    console.log(`${LOG_PREFIX} subject:`, subject);
    console.log(`${LOG_PREFIX} description:`, description);
    console.log(`${LOG_PREFIX} addBlockedBy:`, addBlockedBy);

    try {
      const params = getMemoryParams(context);
      const { threadId, resourceId } = params;

      console.log(`${LOG_PREFIX} threadId:`, threadId, "resourceId:", resourceId);

      const workingMemory = await fetchWorkingMemory(params);
      console.log(`${LOG_PREFIX} Working memory fetched (${workingMemory.length} chars)`);

      const task = parseTask(workingMemory, taskId);
      console.log(`${LOG_PREFIX} Existing task:`, task ? `#${task.id} [${task.status}] "${task.subject}"` : "null");

      if (!task) {
        console.log(`${LOG_PREFIX} Task #${taskId} not found in working memory`);
        return {
          success: false,
          message: `Task #${taskId} not found`,
        };
      }

      // Handle deletion
      if (status === "deleted") {
        console.log(`${LOG_PREFIX} Deleting task #${taskId}`);
        const updatedMarkdown = removeTaskFromMarkdown(workingMemory, taskId);
        console.log(`${LOG_PREFIX} Markdown after deletion (${updatedMarkdown.length} chars)`);
        await saveWorkingMemory(params, updatedMarkdown);
        console.log(`${LOG_PREFIX} Saved. Task #${taskId} deleted.`);
        return {
          success: true,
          message: `Deleted task #${taskId}`,
        };
      }

      // Build updates object
      const updates: Partial<ParsedTask> = {};
      if (status) updates.status = status;
      if (subject) updates.subject = subject;
      if (description) updates.description = description;
      if (addBlockedBy) {
        updates.blockedBy = [...task.blockedBy, ...addBlockedBy];
      }
      console.log(`${LOG_PREFIX} Applying updates:`, JSON.stringify(updates));

      // Apply updates
      const updatedMarkdown = updateTaskInMarkdown(workingMemory, taskId, updates);
      console.log(`${LOG_PREFIX} Markdown after update (${updatedMarkdown.length} chars)`);
      await saveWorkingMemory(params, updatedMarkdown);

      // Parse updated task for return
      const updatedTask = parseTask(updatedMarkdown, taskId);
      console.log(
        `${LOG_PREFIX} Updated task parsed:`,
        updatedTask ? `#${updatedTask.id} [${updatedTask.status}] "${updatedTask.subject}"` : "null (parse failed)",
      );

      const result = {
        success: true,
        task: updatedTask || ({ ...task, ...updates } as ParsedTask),
        message: `Updated task #${taskId}`,
      };
      console.log(`${LOG_PREFIX} Returning:`, JSON.stringify(result));
      return result;
    } catch (error) {
      console.error(`${LOG_PREFIX} ERROR:`, error);
      return {
        success: false,
        message: `Failed to update task: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
