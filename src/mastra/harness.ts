// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Harness Factory
 *
 * Creates and configures the Mastra Harness for orchestrating the agent.
 * The Harness provides:
 * - Mode-based model selection
 * - Tool permission management
 * - Event subscription for TUI
 * - Observational Memory configuration
 */

import { Harness, type ToolCategory } from "@mastra/core/harness";
import { z } from "zod";
import { interactiveAgent } from "./agents/interactive";
import { getSecurityConfig, loadAgentConfig } from "./lib/config";
import { getProviderApiKeyEnvVar, resolveModel } from "./lib/resolve-model";
import { sharedMemory } from "./memory";
import { storage } from "./storage";
import { workspace } from "./workspace";

export interface AgentHarnessConfig {
  resourceId?: string;
}

/**
 * State schema for type-safe runtime state
 */
const stateSchema = z.object({
  currentModelId: z.string().default(""),
  projectPath: z.string().optional(),
  channelType: z.string().optional(),
  yolo: z.boolean().default(false), // Auto-approve all tools
  permissionRules: z
    .object({
      categories: z.record(z.string(), z.enum(["allow", "ask", "deny"])).default({}),
      tools: z.record(z.string(), z.enum(["allow", "ask", "deny"])).default({}),
    })
    .default({ categories: {}, tools: {} }),
});

/**
 * Tool category resolver for permission system
 */
function toolCategoryResolver(toolName: string): ToolCategory | null {
  // Read operations
  if (["read-file", "glob-files", "grep-search", "ls", "cat", "head", "tail"].includes(toolName)) {
    return "read";
  }

  // Edit/write operations
  if (["write-file", "edit-file", "create-file", "delete-file", "mkdir", "rm"].includes(toolName)) {
    return "edit";
  }

  // Execute operations
  if (["bash", "execute", "shell", "run-command"].includes(toolName)) {
    return "execute";
  }

  // Network operations - map to "other" since "network" is not a valid ToolCategory
  if (["fetch", "http-request", "web-search", "browse"].includes(toolName)) {
    return "other";
  }

  // Default to MCP for unknown tools
  return "mcp";
}

/**
 * Create and configure the agent harness
 *
 * @param config - Optional configuration overrides
 * @returns Configured Harness instance
 */
export async function createAgentHarness(config?: AgentHarnessConfig) {
  const agentConfig = await loadAgentConfig();
  const securityConfig = await getSecurityConfig();

  // Model configuration
  const defaultModel = agentConfig.models?.default ?? "zai-coding-plan/glm-5";
  const fastModel = agentConfig.models?.fast ?? defaultModel;
  const omObserverModel = agentConfig.memory?.om_model ?? "google/gemini-2.5-flash";
  const omReflectorModel = agentConfig.memory?.om_model ?? "google/gemini-2.5-flash";

  // Modes — same agent, different default models
  const modes = [
    {
      id: "default",
      name: "Default",
      default: true,
      defaultModelId: defaultModel,
      agent: interactiveAgent,
    },
    {
      id: "fast",
      name: "Fast",
      defaultModelId: fastModel,
      agent: interactiveAgent,
    },
  ];

  console.log(`[harness] Creating harness with default model: ${defaultModel}, fast model: ${fastModel}`);
  console.log(`[harness] OM observer: ${omObserverModel}, reflector: ${omReflectorModel}`);

  // Instantiate Harness
  const harness = new Harness({
    id: "multi-channel-agent",
    resourceId: config?.resourceId || securityConfig.resource_id,
    storage,
    memory: sharedMemory,
    workspace,
    stateSchema,
    modes,
    resolveModel,
    omConfig: {
      defaultObserverModelId: omObserverModel,
      defaultReflectorModelId: omReflectorModel,
      defaultObservationThreshold: agentConfig.memory?.om_observation_threshold ?? 50000,
      defaultReflectionThreshold: agentConfig.memory?.om_reflection_threshold ?? 60000,
    },
    toolCategoryResolver,
    initialState: {
      currentModelId: defaultModel,
      yolo: false,
    },
  });

  return { harness };
}

/**
 * Get API key environment variable for the current model
 */
export { getProviderApiKeyEnvVar };
