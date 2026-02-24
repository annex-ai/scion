// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TaskCreate Tool
 *
 * Creates task(s) in agent's working memory.
 * Always decomposes the goal into subtasks via LLM.
 * If decomposition fails or the goal is already atomic, creates a single task.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { taskDecompositionAgent, taskDecompositionSchema } from "../agents/task-decomposition";
import {
  BOOTSTRAP_TEMPLATE,
  type ParsedTask,
  addTaskToMarkdown,
  appendToProgressLog,
  fetchWorkingMemory,
  generateNextId,
  getMemoryParams,
  saveWorkingMemory,
} from "./task-helpers";

const LOG_PREFIX = "[TaskCreate]";

// ============================================================================
// Tool Schema
// ============================================================================

const taskCreateInputSchema = z.object({
  goal: z
    .string()
    .describe('The overarching objective that provides context for decomposition, e.g. "Add user authentication".'),
  task: z
    .string()
    .describe('The specific work item to decompose into subtasks, e.g. "Implement JWT token validation".'),
});

const taskCreateOutputSchema = z.object({
  success: z.boolean().describe("Whether the creation succeeded"),
  taskIds: z.array(z.string()).describe("IDs of created tasks"),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        subject: z.string(),
        description: z.string(),
        status: z.string(),
        blockedBy: z.array(z.string()),
      }),
    )
    .describe("Created task details"),
  message: z.string().describe("Status message"),
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Set the ## Goal: section content in working memory
 */
function setGoalSection(markdown: string, goal: string): string {
  const goalHeaderRegex = /## Goal:\n[^\n]*/;
  if (goalHeaderRegex.test(markdown)) {
    return markdown.replace(goalHeaderRegex, `## Goal:\n${goal}`);
  }
  // Prepend if no Goal section exists
  return `## Goal:\n${goal}\n\n${markdown}`;
}

// ============================================================================
// Tool Definition
// ============================================================================

export const taskCreateTool = createTool({
  id: "TaskCreate",
  inputSchema: taskCreateInputSchema,
  outputSchema: taskCreateOutputSchema,
  description:
    "Create tasks in working memory. Provide a goal and it will be decomposed into actionable subtasks with dependencies. If the goal is already atomic, a single task is created.",
  execute: async (input, context) => {
    console.log(`${LOG_PREFIX} execute called`);

    try {
      const params = getMemoryParams(context);
      console.log(`${LOG_PREFIX} threadId:`, params.threadId, "resourceId:", params.resourceId);

      let workingMemory: string;
      try {
        workingMemory = await fetchWorkingMemory(params);
        console.log(`${LOG_PREFIX} Existing working memory found (${workingMemory.length} chars)`);
      } catch (e) {
        workingMemory = BOOTSTRAP_TEMPLATE;
        console.log(`${LOG_PREFIX} No existing working memory — bootstrapping`);
      }

      const { goal, task } = input;
      console.log(`${LOG_PREFIX} Goal: "${goal.slice(0, 80)}" | Task: "${task.slice(0, 80)}"`);

      // Attempt decomposition — fall back to a single task on failure
      const prompt = `Goal: ${goal}\n\nTask to decompose: ${task}`;
      let decomposed: { description: string; dependencies: number[] }[];
      try {
        const result = await taskDecompositionAgent.generate(prompt, {
          structuredOutput: { schema: taskDecompositionSchema },
        });
        const tasks = result.object?.tasks;
        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
          throw new Error("empty result");
        }
        decomposed = tasks;
      } catch (e) {
        console.log(`${LOG_PREFIX} Decomposition failed, creating single task:`, e);
        decomposed = [{ description: task, dependencies: [] }];
      }

      // Set Goal section
      workingMemory = setGoalSection(workingMemory, goal);

      // Create tasks sequentially, mapping indices → IDs for dependencies
      const createdIds: string[] = [];
      const createdTasks: {
        id: string;
        subject: string;
        description: string;
        status: string;
        blockedBy: string[];
      }[] = [];

      for (const item of decomposed) {
        const id = generateNextId(workingMemory);
        const blockedBy = item.dependencies.map((i) => createdIds[i]).filter(Boolean);

        const task: ParsedTask = {
          id,
          subject: item.description,
          description: blockedBy.length > 0 ? `(blocked by: ${blockedBy.map((b) => `[#${b}]`).join(", ")})` : "",
          status: "pending",
          blockedBy,
        };

        workingMemory = addTaskToMarkdown(workingMemory, task);

        // If blockedBy, also annotate the task line
        if (blockedBy.length > 0) {
          const blockedStr = blockedBy.map((b) => `[#${b}]`).join(", ");
          const taskLinePattern = `- [ ] [#${id}] ${item.description}`;
          workingMemory = workingMemory.replace(taskLinePattern, `${taskLinePattern} (blocked by: ${blockedStr})`);
        }

        createdIds.push(id);
        createdTasks.push({
          id,
          subject: item.description,
          description: task.description,
          status: "pending",
          blockedBy,
        });
      }

      // Log
      workingMemory = appendToProgressLog(
        workingMemory,
        `Decomposed "${task.slice(0, 60)}" into ${createdTasks.length} task(s)`,
      );

      await saveWorkingMemory(params, workingMemory);
      console.log(`${LOG_PREFIX} Saved ${createdTasks.length} tasks`);

      return {
        success: true,
        taskIds: createdIds,
        tasks: createdTasks,
        message: `Created ${createdTasks.length} task(s): ${createdIds.map((id) => `#${id}`).join(", ")}`,
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} ERROR:`, error);
      return {
        success: false,
        taskIds: [],
        tasks: [],
        message: `Failed to create task: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
