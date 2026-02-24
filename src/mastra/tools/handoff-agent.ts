// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Handoff-to-Agent Tool
 *
 * Creates an ephemeral team-member agent with shared team context.
 * Used by the agent-team pattern for coordinated team work.
 *
 * Unlike delegate-to-agent (fire-and-forget), handoff includes shared context
 * so team members have awareness of the broader project and other members' roles.
 */

import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getLoopConfig, loadAgentConfig } from "../lib/config";
import { coreTools } from "./core-tools";
import { sequentialThinkingTool } from "./sequential-thinking";

const inputSchema = z.object({
  role: z.string().describe('Team member role, e.g. "frontend_developer", "api_designer"'),
  instructions: z.string().describe("Role-specific expertise and constraints"),
  task: z.string().describe("The specific assignment"),
  context: z.string().describe("Shared team context: overall goal, other members roles, dependencies"),
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

export const handoffToAgentTool = createTool({
  id: "handoff-to-agent",
  inputSchema,
  outputSchema,
  description:
    "Hand off a task to an ephemeral team-member agent with shared team context. The team member receives both role-specific instructions and broader project context, enabling coordinated output. Used by the agent-team pattern.",

  execute: async (input) => {
    try {
      const agentConfig = await loadAgentConfig();
      const loop = await getLoopConfig();
      const model = input.model ?? agentConfig.models?.default ?? "openrouter/openai/gpt-4o-mini";

      const composedInstructions = `## Team Context\n${input.context}\n\n## Your Role: ${input.role}\n${input.instructions}`;

      const allTools = [...coreTools, sequentialThinkingTool];
      const availableTools = input.tools ? allTools.filter((t) => input.tools!.includes(t.id)) : [];
      const toolsMap = Object.fromEntries(availableTools.map((t) => [t.id, t]));

      const member = new Agent({
        id: `team-${input.role.replace(/\s+/g, "-").toLowerCase()}`,
        name: input.role,
        model,
        instructions: composedInstructions,
        tools: toolsMap,
      });

      const maxSteps = loop.max_steps_per_turn ?? 50;
      const response = await member.generate(input.task, {
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
