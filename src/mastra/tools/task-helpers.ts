// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Task Tools - Helper Module
 *
 * Shared types, memory access, and markdown parsing logic
 * for all task management tools.
 */

import { sharedMemory } from "../memory";

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed task from markdown
 */
export interface ParsedTask {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blockedBy: string[];
}

/**
 * Memory access parameters
 */
export interface MemoryParams {
  threadId: string;
  resourceId?: string;
}

// ============================================================================
// Memory Access Helpers
// ============================================================================

const MEMORY_LOG_PREFIX = "[TaskHelpers]";

/**
 * Get memory parameters from context
 *
 * Mastra provides threadId and resourceId via context.agent.
 * This function extracts them with sensible defaults.
 *
 * @param context - Tool execution context
 * @returns Memory parameters with threadId and resourceId
 * @throws Error if threadId is missing (required for memory operations)
 */
export function getMemoryParams(context: any): MemoryParams {
  console.log(`${MEMORY_LOG_PREFIX} getMemoryParams called`);
  console.log(`${MEMORY_LOG_PREFIX}   context.agent exists:`, !!context?.agent);
  console.log(`${MEMORY_LOG_PREFIX}   context.agent keys:`, context?.agent ? Object.keys(context.agent) : "N/A");
  console.log(`${MEMORY_LOG_PREFIX}   context.agent.threadId:`, context?.agent?.threadId);
  console.log(`${MEMORY_LOG_PREFIX}   context.agent.resourceId:`, context?.agent?.resourceId);

  const threadId = context?.agent?.threadId;
  const resourceId = context?.agent?.resourceId ?? "interactive-agent";

  if (!threadId) {
    console.error(`${MEMORY_LOG_PREFIX} ERROR: No threadId in context.agent`);
    console.error(`${MEMORY_LOG_PREFIX}   Full context keys:`, context ? Object.keys(context) : "null");
    throw new Error("No threadId available in context. " + "Task tools require thread context to access memory.");
  }

  console.log(`${MEMORY_LOG_PREFIX} getMemoryParams result: threadId=${threadId}, resourceId=${resourceId}`);
  return { threadId, resourceId };
}

/**
 * Fetch working memory as string
 *
 * @param params - Memory parameters
 * @returns Working memory markdown string
 * @throws Error if working memory is null
 */
export async function fetchWorkingMemory(params: MemoryParams): Promise<string> {
  console.log(`${MEMORY_LOG_PREFIX} fetchWorkingMemory called with:`, JSON.stringify(params));
  const result = await sharedMemory.getWorkingMemory(params);

  if (!result) {
    console.warn(`${MEMORY_LOG_PREFIX} fetchWorkingMemory: returned null (no working memory yet)`);
    throw new Error("No working memory found");
  }

  console.log(`${MEMORY_LOG_PREFIX} fetchWorkingMemory: got ${result.length} chars`);
  console.log(
    `${MEMORY_LOG_PREFIX} fetchWorkingMemory preview: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`,
  );
  return result;
}

/**
 * Save updated working memory
 *
 * @param params - Memory parameters
 * @param markdown - Updated markdown content
 */
export async function saveWorkingMemory(params: MemoryParams, markdown: string): Promise<void> {
  console.log(`${MEMORY_LOG_PREFIX} saveWorkingMemory called with ${markdown.length} chars`);
  console.log(`${MEMORY_LOG_PREFIX} saveWorkingMemory params:`, JSON.stringify(params));
  console.log(
    `${MEMORY_LOG_PREFIX} saveWorkingMemory preview: ${markdown.slice(0, 200)}${markdown.length > 200 ? "..." : ""}`,
  );
  await sharedMemory.updateWorkingMemory({
    ...params,
    workingMemory: markdown,
  });
  console.log(`${MEMORY_LOG_PREFIX} saveWorkingMemory: success (${markdown.length} chars saved)`);
}

// ============================================================================
// Parsing Helpers
// ============================================================================

const TASK_LINE_REGEX = /\[([ x-])\]\s*\[#(\d+)\]\s+(.*)/;
const HEADING_REGEX = /###\s+(Pending\s+Tasks|Completed\s+Tasks):/;

/**
 * Extract all task IDs from markdown content
 * Looks for patterns like [#1], [#2], etc.
 *
 * @param markdown - Markdown content
 * @returns Array of task IDs as numbers
 */
export function parseTaskIds(markdown: string): number[] {
  const ids: number[] = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    const match = line.match(/\[#(\d+)\]/);
    if (match) {
      ids.push(Number.parseInt(match[1], 10));
    }
  }

  return ids;
}

/**
 * Generate next available task ID
 *
 * @param markdown - Current markdown content
 * @returns Next task ID as string
 */
export function generateNextId(markdown: string): string {
  const ids = parseTaskIds(markdown);
  if (ids.length === 0) return "1";
  return String(Math.max(...ids) + 1);
}

/**
 * Determine task status from checkbox character
 * [ ] = pending, [x] = completed, [-] = in_progress
 */
export function checkboxToStatus(checkbox: string): "pending" | "in_progress" | "completed" {
  if (checkbox === " ") return "pending";
  if (checkbox === "x") return "completed";
  if (checkbox === "-") return "in_progress";
  return "pending"; // Default fallback
}

/**
 * Parse a single task by ID from markdown
 *
 * @param markdown - Markdown content
 * @param taskId - Task ID to find
 * @returns Parsed task or null if not found
 */
export function parseTask(markdown: string, taskId: string): ParsedTask | null {
  console.log(`${MEMORY_LOG_PREFIX} parseTask called for taskId=${taskId}`);
  const lines = markdown.split("\n");
  const taskLine = lines.find((line) => line.includes(`[#${taskId}]`));

  if (!taskLine) {
    console.log(`${MEMORY_LOG_PREFIX} parseTask: no line found containing [#${taskId}]`);
    return null;
  }

  console.log(`${MEMORY_LOG_PREFIX} parseTask: found line: "${taskLine}"`);
  const match = taskLine.match(TASK_LINE_REGEX);
  if (!match) {
    console.warn(`${MEMORY_LOG_PREFIX} parseTask: line found but doesn't match TASK_LINE_REGEX: "${taskLine}"`);
    return null;
  }

  const [, checkbox, id, subject] = match;
  console.log(`${MEMORY_LOG_PREFIX} parseTask: checkbox="${checkbox}" id="${id}" subject="${subject}"`);
  const status = checkboxToStatus(checkbox.trim());
  console.log(`${MEMORY_LOG_PREFIX} parseTask: checkbox="${checkbox}" → status="${status}"`);

  // Extract description (lines after task until next task or heading)
  const taskLineIndex = lines.indexOf(taskLine);
  const descriptionLines: string[] = [];

  for (let i = taskLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop at next task or heading
    if (HEADING_REGEX.test(line) || /\[#(\d+)\]/.test(line)) {
      break;
    }

    // Extract description content (indented)
    if (line.startsWith("  ") || line.startsWith("\t")) {
      descriptionLines.push(line.trim());
    }
  }

  const result: ParsedTask = {
    id,
    subject: subject.trim(),
    description: descriptionLines.join("\n"),
    status,
    blockedBy: [],
  };
  console.log(`${MEMORY_LOG_PREFIX} parseTask result:`, JSON.stringify(result));
  return result;
}

/**
 * Parse all tasks from markdown
 *
 * @param markdown - Markdown content
 * @returns Array of all parsed tasks
 */
export function parseAllTasks(markdown: string): ParsedTask[] {
  console.log(`${MEMORY_LOG_PREFIX} parseAllTasks called (${markdown.length} chars)`);
  const tasks: ParsedTask[] = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    const match = line.match(TASK_LINE_REGEX);

    if (match) {
      const [, checkbox, id, subject] = match;
      const status = checkboxToStatus(checkbox.trim());

      // Extract description
      const taskLineIndex = lines.indexOf(line);
      const descriptionLines: string[] = [];

      for (let i = taskLineIndex + 1; i < lines.length; i++) {
        const nextLine = lines[i];

        // Stop at next task or heading
        if (HEADING_REGEX.test(nextLine) || /\[#(\d+)\]/.test(nextLine)) {
          break;
        }

        if (nextLine.startsWith("  ") || nextLine.startsWith("\t")) {
          descriptionLines.push(nextLine.trim());
        }
      }

      tasks.push({
        id,
        subject: subject.trim(),
        description: descriptionLines.join("\n"),
        status,
        blockedBy: [],
      });
    }
  }

  console.log(
    `${MEMORY_LOG_PREFIX} parseAllTasks found ${tasks.length} tasks:`,
    tasks.map((t) => `#${t.id}[${t.status}] ${t.subject}`),
  );
  return tasks;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Bootstrap template for initializing working memory
 */
export const BOOTSTRAP_TEMPLATE =
  "## Goal:\n[Unset]\n\n### Pending Tasks:\n\n### Completed Tasks:\n\n## Progress Log:\n\n## Notes & Context:\n";

// ============================================================================
// Progress Log
// ============================================================================

/**
 * Append a line to the ## Progress Log: section
 */
export function appendToProgressLog(markdown: string, line: string): string {
  const logHeader = "## Progress Log:";
  const idx = markdown.indexOf(logHeader);
  if (idx === -1) {
    return `${markdown}\n${logHeader}\n- ${line}\n`;
  }
  const insertPoint = idx + logHeader.length;
  return `${markdown.slice(0, insertPoint)}\n- ${line}${markdown.slice(insertPoint)}`;
}

// ============================================================================
// Mutation Helpers
// ============================================================================

/**
 * Add a task to markdown in Pending Tasks section
 *
 * @param markdown - Current markdown
 * @param task - Task to add
 * @returns Updated markdown
 */
export function addTaskToMarkdown(
  markdown: string,
  task: { id: string; subject: string; description: string },
): string {
  console.log(
    `${MEMORY_LOG_PREFIX} addTaskToMarkdown: id=#${task.id} subject="${task.subject}" desc="${task.description?.slice(0, 80)}"`,
  );
  const taskLine = `- [ ] [#${task.id}] ${task.subject}`;

  const descriptionLines = task.description ? `\n  ${task.description.split("\n").join("\n  ")}` : "";

  const fullTask = taskLine + descriptionLines;

  // Find "### Pending Tasks:" section and add after it
  const pendingMatch = markdown.match(/### Pending Tasks:[ \t]*\n/);
  if (pendingMatch && pendingMatch.index !== undefined) {
    const insertPoint = pendingMatch.index + pendingMatch[0].length;
    return `${markdown.slice(0, insertPoint) + fullTask}\n${markdown.slice(insertPoint)}`;
  }

  // If no Pending Tasks section exists, try to add it before Completed Tasks
  const completedMatch = markdown.match(/### Completed Tasks:/);
  if (completedMatch && completedMatch.index !== undefined) {
    return `${markdown.slice(0, completedMatch.index)}### Pending Tasks:\n${fullTask}\n\n${markdown.slice(completedMatch.index)}`;
  }

  // If no Task Queue structure, append task
  console.log(`${MEMORY_LOG_PREFIX} addTaskToMarkdown: no section found, appending to end`);
  return `${markdown}\n${fullTask}`;
}

/**
 * Update a task in markdown in-place
 *
 * @param markdown - Current markdown
 * @param taskId - Task ID to update
 * @param updates - Fields to update (status, subject, description, blockedBy)
 * @returns Updated markdown
 */
export function updateTaskInMarkdown(markdown: string, taskId: string, updates: Partial<ParsedTask>): string {
  console.log(`${MEMORY_LOG_PREFIX} updateTaskInMarkdown: taskId=#${taskId} updates=`, JSON.stringify(updates));
  const lines = markdown.split("\n");
  const taskIndex = lines.findIndex((line) => line.includes(`[#${taskId}]`));

  if (taskIndex === -1) {
    console.error(`${MEMORY_LOG_PREFIX} updateTaskInMarkdown: task #${taskId} not found in markdown`);
    throw new Error(`Task #${taskId} not found`);
  }
  console.log(`${MEMORY_LOG_PREFIX} updateTaskInMarkdown: found at line ${taskIndex}: "${lines[taskIndex]}"`);

  const taskLine = lines[taskIndex];
  const match = taskLine.match(TASK_LINE_REGEX);

  if (!match) {
    throw new Error(`Task #${taskId} has invalid format`);
  }

  const [, checkbox, , subject] = match;

  // Build new task line
  const newSubject = updates.subject !== undefined ? updates.subject : subject;

  // Update checkbox based on status
  let newCheckbox = checkbox;
  if (updates.status) {
    switch (updates.status) {
      case "pending":
        newCheckbox = " ";
        break;
      case "in_progress":
        newCheckbox = "-";
        break;
      case "completed":
        newCheckbox = "x";
        break;
    }
  }

  const newTaskLine = `- [${newCheckbox}] [#${taskId}] ${newSubject}`;
  console.log(`${MEMORY_LOG_PREFIX} updateTaskInMarkdown: new line: "${newTaskLine}"`);

  lines[taskIndex] = newTaskLine;

  // Handle description updates
  if (updates.description !== undefined || updates.blockedBy !== undefined) {
    // Remove old description and add new
    const descriptionLines: string[] = [];
    for (let i = taskIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (HEADING_REGEX.test(line) || /\[#(\d+)\]/.test(line)) {
        break;
      }
      if (line.startsWith("  ") || line.startsWith("\t")) {
        descriptionLines.push(line);
      } else if (descriptionLines.length > 0) {
        break;
      }
    }

    // Remove old description lines
    const firstDescLine = taskIndex + 1;
    const lastDescLine = taskIndex + descriptionLines.length;
    lines.splice(firstDescLine, lastDescLine - firstDescLine);

    // Insert updated description
    const insertPoint = taskIndex + 1;
    const newDescription = updates.description !== undefined ? updates.description : descriptionLines.join("\n");

    if (newDescription) {
      const descLines = newDescription
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");
      lines.splice(insertPoint, 0, ...descLines);
    }

    // Update blockedBy if needed (in subject line)
    if (updates.blockedBy && updates.blockedBy.length > 0) {
      // Append blocked tasks to subject
      const blockedStr = updates.blockedBy.map((id) => `[#${id}]`).join(", ");
      lines[taskIndex] = `${newTaskLine} (blocked by: ${blockedStr})`;
    }
  }

  // Move task between sections if status changes
  if (updates.status) {
    const isPendingSection = (line: string) => /### Pending Tasks:[ \t]*\n/.test(line);
    const isCompletedSection = (line: string) => /### Completed Tasks:/.test(line);

    // Check if we need to move from Pending to Completed
    if (updates.status === "completed" && !isPendingSection(lines[taskIndex - 1]) && lines.some(isCompletedSection)) {
      // Find Completed section
      const completedIndex = lines.findIndex(isCompletedSection);
      const completedHeaderIndex = completedIndex + 1;

      // Extract task block (task line + description)
      const taskBlock = [lines[taskIndex]];
      for (let i = taskIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (HEADING_REGEX.test(line) || /\[#(\d+)\]/.test(line)) {
          break;
        }
        taskBlock.push(line);
      }

      // Remove from old position
      const blockLength = taskBlock.length;
      lines.splice(taskIndex, blockLength);

      // Insert into Completed section
      lines.splice(completedHeaderIndex, 0, ...taskBlock);
    }

    // Check if we need to move from Completed to Pending
    if (updates.status === "pending" && !isCompletedSection(lines[taskIndex - 1]) && lines.some(isPendingSection)) {
      // Find Pending section
      const pendingIndex = lines.findIndex(isPendingSection);
      const pendingHeaderIndex = pendingIndex + 1;

      // Extract task block
      const taskBlock = [lines[taskIndex]];
      for (let i = taskIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (HEADING_REGEX.test(line) || /\[#(\d+)\]/.test(line)) {
          break;
        }
        taskBlock.push(line);
      }

      // Remove from old position
      const blockLength = taskBlock.length;
      lines.splice(taskIndex, blockLength);

      // Insert into Pending section
      lines.splice(pendingHeaderIndex, 0, ...taskBlock);
    }
  }

  return lines.join("\n");
}

/**
 * Remove a task from markdown
 *
 * @param markdown - Current markdown
 * @param taskId - Task ID to remove
 * @returns Updated markdown without the task
 */
export function removeTaskFromMarkdown(markdown: string, taskId: string): string {
  console.log(`${MEMORY_LOG_PREFIX} removeTaskFromMarkdown: taskId=#${taskId}`);
  const lines = markdown.split("\n");
  const taskIndex = lines.findIndex((line) => line.includes(`[#${taskId}]`));

  if (taskIndex === -1) {
    console.error(`${MEMORY_LOG_PREFIX} removeTaskFromMarkdown: task #${taskId} not found`);
    throw new Error(`Task #${taskId} not found`);
  }
  console.log(`${MEMORY_LOG_PREFIX} removeTaskFromMarkdown: found at line ${taskIndex}: "${lines[taskIndex]}"`);

  // Remove task line and description
  let end = taskIndex + 1;
  for (let i = taskIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (HEADING_REGEX.test(line) || /\[#(\d+)\]/.test(line)) {
      break;
    }
    end = i + 1;
  }

  console.log(
    `${MEMORY_LOG_PREFIX} removeTaskFromMarkdown: removing lines ${taskIndex}..${end - 1} (${end - taskIndex} lines)`,
  );
  lines.splice(taskIndex, end - taskIndex);
  return lines.join("\n");
}
