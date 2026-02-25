// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Harness Factory
 *
 * Creates and configures the Mastra Harness for orchestrating the agent.
 * The Harness provides:
 * - Mode-based model selection
 * - Tool permission management
 * - Event subscription for TUI/Gateway
 * - Observational Memory (static or dynamic based on om_mode config)
 */

import type { HarnessRequestContext } from "@mastra/core/harness";
import { Harness, type ToolCategory } from "@mastra/core/harness";
import type { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { interactiveAgent } from "./agents/interactive";
import { getMemoryConfig, getSecurityConfig, loadAgentConfig } from "./lib/config";
import { interactiveMemory } from "./memory";
import { storage, vector } from "./storage";
import { workspace } from "./workspace";

export interface AgentHarnessConfig {
  resourceId?: string;
}

/**
 * State schema for type-safe runtime state
 * Includes OM model/threshold fields for dynamic configuration
 */
export const stateSchema = z.object({
  currentModelId: z.string().default(""),
  projectPath: z.string().optional(),
  channelType: z.string().optional(),
  channelId: z.string().optional(),
  // YOLO mode — auto-approve all tool calls
  yolo: z.boolean().default(false),
  // Permission rules — per-category and per-tool approval policies
  permissionRules: z
    .object({
      categories: z.record(z.string(), z.enum(["allow", "ask", "deny"])).default({}),
      tools: z.record(z.string(), z.enum(["allow", "ask", "deny"])).default({}),
    })
    .default({ categories: {}, tools: {} }),
  // Observational Memory model settings (read by dynamic memory factory)
  observerModelId: z.string().optional(),
  reflectorModelId: z.string().optional(),
  // Observational Memory threshold settings
  observationThreshold: z.number().optional(),
  reflectionThreshold: z.number().optional(),
});

export type HarnessState = z.infer<typeof stateSchema>;

/**
 * Read harness state from requestContext.
 * Used by the dynamic memory factory and OM model functions.
 */
function getHarnessState(requestContext: RequestContext): HarnessState | undefined {
  return (requestContext.get("harness") as HarnessRequestContext<typeof stateSchema> | undefined)?.getState?.();
}

/**
 * Observer model function — reads the current observer model ID from
 * harness state via requestContext, returning a plain string for Mastra's
 * built-in model router to resolve.
 */
function getObserverModel({ requestContext }: { requestContext: RequestContext }, defaults: { omModel: string }) {
  const state = getHarnessState(requestContext);
  return state?.observerModelId ?? defaults.omModel;
}

/**
 * Reflector model function — reads the current reflector model ID from
 * harness state via requestContext, returning a plain string for Mastra's
 * built-in model router to resolve.
 */
function getReflectorModel({ requestContext }: { requestContext: RequestContext }, defaults: { omModel: string }) {
  const state = getHarnessState(requestContext);
  return state?.reflectorModelId ?? defaults.omModel;
}

/**
 * Create dynamic memory factory that reads OM config from harness state.
 * This allows runtime switching of OM models and thresholds.
 * Only used when om_mode === "dynamic".
 */
function createDynamicMemory(defaults: {
  omModel: string;
  obsThreshold: number;
  refThreshold: number;
  lastMessages: number;
  topK: number;
  messageRange: number;
  scope: "thread" | "resource";
}) {
  let cachedMemory: Memory | null = null;
  let cachedKey: string | null = null;

  return ({ requestContext }: { requestContext: RequestContext }) => {
    const state = getHarnessState(requestContext);

    const obsThreshold = state?.observationThreshold ?? defaults.obsThreshold;
    const refThreshold = state?.reflectionThreshold ?? defaults.refThreshold;
    const cacheKey = `${obsThreshold}:${refThreshold}`;

    // Return cached memory if thresholds haven't changed
    if (cachedMemory && cachedKey === cacheKey) {
      return cachedMemory;
    }

    cachedMemory = new Memory({
      storage,
      vector,
      options: {
        lastMessages: defaults.lastMessages,
        workingMemory: { enabled: false },
        semanticRecall: {
          topK: defaults.topK,
          messageRange: defaults.messageRange,
          scope: defaults.scope,
        },
        observationalMemory: {
          enabled: true,
          scope: defaults.scope,
          observation: {
            model: (ctx) => getObserverModel(ctx, defaults),
            messageTokens: obsThreshold,
            modelSettings: { maxOutputTokens: 60000 },
          },
          reflection: {
            model: (ctx) => getReflectorModel(ctx, defaults),
            observationTokens: refThreshold,
            modelSettings: { maxOutputTokens: 60000 },
          },
        },
      },
    });
    cachedKey = cacheKey;

    return cachedMemory;
  };
}

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

  // Network operations
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
  const memoryConfig = await getMemoryConfig();
  const securityConfig = await getSecurityConfig();

  // Model configuration from agent.toml
  const defaultModel = agentConfig.models?.default ?? "zai-coding-plan/glm-5";
  const fastModel = agentConfig.models?.fast ?? defaultModel;

  // OM configuration from agent.toml [memory] section
  const omModel = memoryConfig.om_model;
  const obsThreshold = memoryConfig.om_observation_threshold;
  const refThreshold = memoryConfig.om_reflection_threshold;
  const omMode = memoryConfig.om_mode;

  // Memory: static mode uses the same interactiveMemory instance as the agent;
  // dynamic mode creates a factory that reads model IDs from harness state.
  const memory =
    omMode === "dynamic"
      ? (createDynamicMemory({
          omModel,
          obsThreshold,
          refThreshold,
          lastMessages: memoryConfig.last_messages,
          topK: memoryConfig.semantic_recall_top_k,
          messageRange: memoryConfig.semantic_recall_message_range,
          scope: memoryConfig.semantic_recall_scope,
        }) as any)
      : interactiveMemory;

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
  console.log(
    `[harness] OM mode: ${omMode}, model: ${omModel}, obs threshold: ${obsThreshold}, ref threshold: ${refThreshold}`,
  );

  const harness = new Harness({
    id: "multi-channel-agent",
    resourceId: config?.resourceId || securityConfig.resource_id,
    storage,
    memory,
    workspace,
    stateSchema,
    modes,
    toolCategoryResolver,
    initialState: {
      currentModelId: defaultModel,
      yolo: false,
      // OM defaults from agent.toml (can be overridden per-thread via state)
      observerModelId: omModel,
      reflectorModelId: omModel,
      observationThreshold: obsThreshold,
      reflectionThreshold: refThreshold,
    },
  });

  return { harness };
}
