// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TaskGet Tool
 *
 * Retrieves a single task by ID with full details.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchWorkingMemory, getMemoryParams, type ParsedTask, parseAllTasks, parseTask } from "./task-helpers";

const LOG_PREFIX = "[TaskGet]";

// ============================================================================
// Tool Schema
// ============================================================================

const taskGetInputSchema = z.object({
  taskId: z.string().describe('Task ID to retrieve (e.g., "1")'),
});

const taskGetOutputSchema = z.object({
  success: z.boolean().describe("Whether retrieval succeeded"),
  task: z
    .object({
      id: z.string(),
      subject: z.string(),
      description: z.string(),
      status: z.string(),
      blockedBy: z.array(z.string()),
    })
    .optional()
    .describe("Retrieved task details"),
  message: z.string().describe("Status message"),
});

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * TaskGet Tool
 *
 * Retrieves a single task by ID with full details including description.
 * Filters blockedBy to only show open (non-completed) blockers.
 */
export const taskGetTool = createTool({
  id: "TaskGet",
  inputSchema: taskGetInputSchema,
  outputSchema: taskGetOutputSchema,
  description: "Get a single task by ID with full details. Returns task subject, description, status, and blockers.",
  execute: async ({ taskId }, context) => {
    console.log(`${LOG_PREFIX} execute called`);
    console.log(`${LOG_PREFIX} taskId:`, taskId);

    try {
      const params = getMemoryParams(context);
      const { threadId, resourceId } = params;

      console.log(`${LOG_PREFIX} threadId:`, threadId, "resourceId:", resourceId);

      const workingMemory = await fetchWorkingMemory(params);
      console.log(`${LOG_PREFIX} Working memory fetched (${workingMemory.length} chars)`);

      const task = parseTask(workingMemory, taskId);
      console.log(`${LOG_PREFIX} parseTask result:`, task ? `found #${task.id} [${task.status}]` : "null");

      if (!task) {
        console.log(`${LOG_PREFIX} Task #${taskId} not found in working memory`);
        return {
          success: false,
          message: `Task #${taskId} not found`,
        };
      }

      // Need to parse all tasks to filter blockedBy
      const allTasks = parseAllTasks(workingMemory);
      console.log(`${LOG_PREFIX} All tasks: ${allTasks.length} total`);

      // Filter blockedBy to only show open blockers
      const filteredBlockedBy = task.blockedBy.filter((id) => {
        const blocker = allTasks.find((t) => t.id === id);
        return blocker ? blocker.status !== "completed" : false;
      });
      console.log(
        `${LOG_PREFIX} Filtered blockedBy: [${filteredBlockedBy.join(", ")}] (from [${task.blockedBy.join(", ")}])`,
      );

      const result = {
        success: true,
        task: {
          ...task,
          blockedBy: filteredBlockedBy,
        },
        message: `Retrieved task #${taskId}: ${task.subject}`,
      };
      console.log(`${LOG_PREFIX} Returning:`, JSON.stringify(result));
      return result;
    } catch (error) {
      console.error(`${LOG_PREFIX} ERROR:`, error);
      return {
        success: false,
        message: `Failed to get task: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
