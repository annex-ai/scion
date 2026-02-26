// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Memory Instances
 *
 * Exports two Memory instances:
 *
 * - `sharedMemory` — OM disabled. Used by the task agent and tools.
 * - `interactiveMemory` — OM enabled with static model IDs from agent.toml.
 *   Set on the interactive agent so it has memory everywhere (Studio, API, workflows).
 *
 * Both share the same storage, vector, and embedder backends.
 */

import { fastembed } from "@mastra/fastembed";
import { Memory } from "@mastra/memory";
import { getMemoryConfig } from "./lib/config";
import { storage, vector } from "./storage";

// Load memory configuration from agent.toml
const memoryConfig = await getMemoryConfig();

console.log(
  `[memory] Initializing with config: lastMessages=${memoryConfig.last_messages}, topK=${memoryConfig.semantic_recall_top_k}`,
);

/**
 * Shared Memory instance (OM disabled)
 *
 * Used by the task agent and tools that need memory access
 * without Observational Memory overhead.
 */
export const sharedMemory = new Memory({
  embedder: fastembed,
  storage,
  vector,
  options: {
    lastMessages: memoryConfig.last_messages,
    workingMemory: {
      enabled: memoryConfig.working_memory_enabled,
      scope: memoryConfig.working_memory_scope,
    },
    semanticRecall: {
      topK: memoryConfig.semantic_recall_top_k,
      messageRange: memoryConfig.semantic_recall_message_range,
      scope: memoryConfig.semantic_recall_scope,
    },
    observationalMemory: { enabled: false },
  },
});

/**
 * Interactive Memory instance (OM enabled, static models)
 *
 * Uses plain string model IDs (e.g. "google/gemini-2.5-flash") which
 * Mastra's built-in model router resolves natively.
 */
const omModel = memoryConfig.om_model;

export const interactiveMemory = new Memory({
  embedder: fastembed,
  storage,
  vector,
  options: {
    lastMessages: memoryConfig.last_messages,
    workingMemory: {
      enabled: memoryConfig.working_memory_enabled,
      scope: memoryConfig.working_memory_scope,
    },
    semanticRecall: {
      topK: memoryConfig.semantic_recall_top_k,
      messageRange: memoryConfig.semantic_recall_message_range,
      scope: memoryConfig.semantic_recall_scope,
    },
    observationalMemory: {
      enabled: true,
      scope: memoryConfig.om_scope,
      observation: {
        model: omModel,
        messageTokens: memoryConfig.om_observation_threshold,
        maxTokensPerBatch: memoryConfig.om_max_tokens_per_batch,
        bufferTokens: memoryConfig.om_buffer_tokens,
        bufferActivation: memoryConfig.om_buffer_activation,
        blockAfter: memoryConfig.om_observation_block_after,
        modelSettings: { maxOutputTokens: 100_000 },
        instruction: memoryConfig.om_observation_instruction || undefined,
      },
      reflection: {
        model: omModel,
        observationTokens: memoryConfig.om_reflection_threshold,
        bufferActivation: memoryConfig.om_reflection_buffer_activation,
        blockAfter: memoryConfig.om_reflection_block_after,
        modelSettings: { maxOutputTokens: 100_000 },
        instruction: memoryConfig.om_reflection_instruction || undefined,
      },
    },
  },
});

console.log(
  `[memory] interactiveMemory: OM enabled, model=${omModel}, scope=${memoryConfig.om_scope}, bufferTokens=${memoryConfig.om_buffer_tokens}, batchSize=${memoryConfig.om_max_tokens_per_batch}`,
);
