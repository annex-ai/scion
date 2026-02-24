// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { Agent } from "@mastra/core/agent";
import { loadAgentConfig } from "../lib/config";
import { compactionOutputSchema } from "../processors/lib/compaction-schema";

const agentConfig = await loadAgentConfig();
const compactionModel = agentConfig.compaction?.model ?? agentConfig.models?.fast ?? agentConfig.models?.default;

console.log(`[compaction-agent] Initialized with model: ${compactionModel}`);

export const compactionAgent = new Agent({
  id: "compaction-agent",
  name: "Context Compaction Agent",
  model: compactionModel as any,
  instructions: `You are a context compaction agent. You receive conversation messages and produce a structured summary that preserves meaning while reducing token usage.

Be extremely concise. Focus on:
1. What the user wants/asked (user intent)
2. Key decisions or conclusions made
3. Critical context needed for continuity
4. Blockers or errors encountered

Output must be brief enough to fit within token limits.`,
  defaultOptions: {
    structuredOutput: { schema: compactionOutputSchema },
  },
});
