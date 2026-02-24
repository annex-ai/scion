// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Task Decomposition Agent
 *
 * Receives a goal (overarching objective) and a task (specific work item).
 * Decomposes the task into subtasks aligned with the goal.
 * If the task is already atomic, returns it as a single item.
 *
 * Input format (from TaskCreate tool):
 *   "Goal: <overarching objective>\n\nTask to decompose: <specific work>"
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

const LOG_PREFIX = "[TaskDecomposition]";

// ============================================================================
// Schema (LLM structured output)
// ============================================================================

export const taskDecompositionSchema = z.object({
  tasks: z.array(
    z.object({
      description: z.string().describe("Clear, actionable description of what needs to be done"),
      dependencies: z.array(z.number()).describe("Array of task indices (0-based) that must complete before this task"),
    }),
  ),
});

export type TaskDecompositionResult = z.infer<typeof taskDecompositionSchema>;

// ============================================================================
// Agent
// ============================================================================

const DECOMPOSITION_INSTRUCTIONS = `You are a task decomposition expert. You receive a goal (the overarching objective) and a task (specific work to break down).

Your job:
- Decompose the task into clear, actionable subtasks that advance the goal
- If the task is already atomic and cannot be meaningfully decomposed, return it as a single task
- Create 1-8 subtasks (1 if already atomic, up to 8 for complex work)
- Order subtasks logically (exploration → planning → implementation → verification)
- Dependencies must be valid 0-based indices of earlier tasks in the array
- No circular dependencies
- Each subtask description should be specific enough that an agent can act on it without further clarification`;

export const taskDecompositionAgent = new Agent({
  id: "task-decomposition-agent",
  name: "Task Decomposition Agent",
  instructions: DECOMPOSITION_INSTRUCTIONS,
  model: "zai-coding-plan/glm-4.7",
});
