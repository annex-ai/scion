// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Shared Memory Instance
 *
 * Exports a static Memory instance for backwards compatibility with tools
 * and agents that access memory outside of harness context.
 *
 * NOTE: Observational Memory is DISABLED here because OM requires dynamic
 * model resolution via requestContext (harness state). Use the harness's
 * dynamic memory factory for OM-enabled agent interactions.
 *
 * @see src/mastra/harness.ts for OM-enabled dynamic memory
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
console.log(`[shared-memory] OM disabled in static memory - use harness for OM-enabled interactions`);

/**
 * Shared Memory instance (OM disabled)
 *
 * Uses the same storage backend as the interactive agent.
 * All memory operations (getThreadById, semantic recall, etc.)
 * will access the same data regardless of which Memory instance is used.
 *
 * For OM-enabled memory, use the harness's dynamic memory factory.
 */
export const sharedMemory = new Memory({
  embedder: fastembed,
  storage,
  vector,
  options: {
    lastMessages: memoryConfig.last_messages,
    workingMemory: { enabled: false },
    semanticRecall: {
      topK: memoryConfig.semantic_recall_top_k,
      messageRange: memoryConfig.semantic_recall_message_range,
      scope: memoryConfig.semantic_recall_scope,
    },
    // OM disabled - requires requestContext for dynamic model resolution
    // See harness.ts createDynamicMemory() for OM-enabled memory
    observationalMemory: { enabled: false },
  },
});
