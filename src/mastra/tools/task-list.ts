// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TaskList Tool
 *
 * Lists all task items with summary information from working memory.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { type ParsedTask, fetchWorkingMemory, getMemoryParams, parseAllTasks } from "./task-helpers";

const LOG_PREFIX = "[TaskList]";

// ============================================================================
// Tool Schema
// ============================================================================

/**
 * Input schema for TaskList tool
 */
const taskListInputSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed"]).optional().describe("Filter by task status (optional)"),
});

/**
 * Output schema for TaskList tool
 */
const taskListOutputSchema = z.object({
  success: z.boolean().describe("Whether list operation succeeded"),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        subject: z.string(),
        status: z.string(),
        blockedBy: z.array(z.string()),
      }),
    )
    .optional()
    .describe("Summary of all tasks"),
  message: z.string().describe("Status message"),
});

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * TaskList Tool
 *
 * Lists all task items with summary information.
 * Only shows open (non-completed) blockers in blockedBy.
 */
export const taskListTool = createTool({
  id: "TaskList",
  inputSchema: taskListInputSchema,
  outputSchema: taskListOutputSchema,
  description:
    "List all tasks with summary info (id, subject, status, blockedBy). Use this to see available tasks and find what to work on next. blockedBy only shows open tasks.",
  execute: async (input, context) => {
    const { status } = input;

    console.log(`${LOG_PREFIX} execute called`);
    console.log(`${LOG_PREFIX} status filter:`, status || "all");

    try {
      const params = getMemoryParams(context);
      const { threadId, resourceId } = params;

      console.log(`${LOG_PREFIX} threadId:`, threadId, "resourceId:", resourceId);

      let workingMemory: string;
      try {
        workingMemory = await fetchWorkingMemory(params);
        console.log(`${LOG_PREFIX} Working memory fetched (${workingMemory.length} chars)`);
      } catch (e) {
        console.log(`${LOG_PREFIX} No working memory found — returning empty task list`);
        return {
          success: true,
          tasks: [],
          message: "No tasks found (working memory not initialized)",
        };
      }

      const tasks = parseAllTasks(workingMemory);
      console.log(`${LOG_PREFIX} Parsed ${tasks.length} total tasks`);
      for (const t of tasks) {
        console.log(`${LOG_PREFIX}   #${t.id} [${t.status}] ${t.subject}`);
      }

      // Filter by status if provided
      const filteredTasks = status ? tasks.filter((task) => task.status === status) : tasks;
      console.log(`${LOG_PREFIX} After status filter: ${filteredTasks.length} tasks`);

      // Filter blockedBy to only show open tasks
      const resultTasks = filteredTasks.map((task) => ({
        ...task,
        blockedBy: task.blockedBy.filter((id) => {
          const blocker = tasks.find((t) => t.id === id);
          return blocker ? blocker.status !== "completed" : false;
        }),
      }));

      console.log(`${LOG_PREFIX} Returning ${resultTasks.length} tasks`);

      return {
        success: true,
        tasks: resultTasks,
        message: `Found ${resultTasks.length} tasks`,
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} ERROR:`, error);
      return {
        success: false,
        message: `Failed to list tasks: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
