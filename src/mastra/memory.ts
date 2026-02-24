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
    workingMemory: {
      enabled: memoryConfig.working_memory_enabled,
      scope: memoryConfig.working_memory_scope,
    },
    semanticRecall: {
      topK: memoryConfig.semantic_recall_top_k,
      messageRange: memoryConfig.semantic_recall_message_range,
      scope: memoryConfig.semantic_recall_scope,
    },
  },
});
