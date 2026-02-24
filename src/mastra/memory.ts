// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Shared Memory Instance
 *
 * Exports a Memory instance that can be used by both agents and tools.
 * This ensures tools can access working memory even when called outside
 * an agent context (e.g., from Mastra Studio).
 */

import { fastembed } from "@mastra/fastembed";
import { Memory } from "@mastra/memory";
import { getMemoryConfig } from "./lib/config";
import { storage, vector } from "./storage";

// Load memory configuration from agent.toml
const memoryConfig = await getMemoryConfig();

console.log(
  `[shared-memory] Initializing with config: lastMessages=${memoryConfig.last_messages}, topK=${memoryConfig.semantic_recall_top_k}`,
);

/**
 * Shared Memory instance
 *
 * Uses the same storage backend as the interactive agent.
 * All memory operations (getThreadById, updateWorkingMemory, etc.)
 * will access the same data regardless of which Memory instance is used.
 */
export const sharedMemory = new Memory({
  embedder: fastembed,
  storage,
  vector,
  options: {
    lastMessages: memoryConfig.last_messages,
    // DISABLED: Working memory replaced by Observational Memory
    workingMemory: {
      enabled: false,
    },
    semanticRecall: {
      topK: memoryConfig.semantic_recall_top_k,
      messageRange: memoryConfig.semantic_recall_message_range,
      scope: memoryConfig.semantic_recall_scope,
    },
    // Observational Memory replaces compaction AND working memory
    observationalMemory: {
      model: memoryConfig.om_model ?? "google/gemini-2.5-flash",
      scope: "resource", // cross-thread memory
      observation: {
        messageTokens: memoryConfig.om_observation_threshold ?? 50_000,
      },
      reflection: {
        observationTokens: memoryConfig.om_reflection_threshold ?? 60_000,
      },
    },
  },
});
