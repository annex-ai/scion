// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Delegate-to-Agent Tool
 *
 * Creates an ephemeral specialist agent and runs a one-shot generation.
 * Used by the agent-swarm pattern for fire-and-forget delegation.
 */

import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getLoopConfig, loadAgentConfig } from "../lib/config";
import { coreTools } from "./core-tools";
import { sequentialThinkingTool } from "./sequential-thinking";

const inputSchema = z.object({
  role: z.string().describe('Specialist role, e.g. "security_reviewer", "researcher"'),
  instructions: z.string().describe("System prompt defining the specialist expertise and constraints"),
  task: z.string().describe("The specific sub-task to complete"),
  tools: z
    .array(z.string())
    .optional()
    .describe('Tool IDs to make available (e.g. ["read-file", "grep-search", "web-search"]). No tools if omitted.'),
  model: z.string().optional().describe("Model override (defaults to agent.toml default)"),
});

const outputSchema = z.object({
  success: z.boolean(),
  role: z.string(),
  result: z.string(),
  error: z.string().optional(),
});

export const delegateToAgentTool = createTool({
  id: "delegate-to-agent",
  inputSchema,
  outputSchema,
  description:
    "Delegate a sub-task to an ephemeral specialist agent. The specialist is created on the fly with the given role, instructions, and tools, executes the task, and returns the result. Used by the agent-swarm pattern for fire-and-forget delegation.",

  execute: async (input) => {
    try {
      const agentConfig = await loadAgentConfig();
      const loop = await getLoopConfig();
      const model = input.model ?? agentConfig.models?.default ?? "openrouter/openai/gpt-4o-mini";

      const allTools = [...coreTools, sequentialThinkingTool];
      const availableTools = input.tools ? allTools.filter((t) => input.tools!.includes(t.id)) : [];
      const toolsMap = Object.fromEntries(availableTools.map((t) => [t.id, t]));

      const specialist = new Agent({
        id: `delegate-${input.role.replace(/\s+/g, "-").toLowerCase()}`,
        name: input.role,
        model,
        instructions: input.instructions,
        tools: toolsMap,
      });

      const maxSteps = loop.max_steps_per_turn ?? 50;
      const response = await specialist.generate(input.task, {
        maxSteps,
        prepareStep: async ({ stepNumber }) => {
          // Force text output on the final step to avoid empty responses
          if (stepNumber === maxSteps - 1) {
            return { toolChoice: "none" as const };
          }
        },
      });

      if (response.error) {
        return {
          success: false,
          role: input.role,
          result: response.text || "",
          error: response.error.message,
        };
      }

      return {
        success: true,
        role: input.role,
        result: response.text,
      };
    } catch (err: unknown) {
      return {
        success: false,
        role: input.role,
        result: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
