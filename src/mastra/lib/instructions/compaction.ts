// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Compaction Instructions
 *
 * Injected into the agent's system prompt to describe the active
 * context-management strategy so the agent understands how its
 * conversation history is being managed.
 */

import type { CompactionSection } from "../config/agent-config";

export function getCompactionInstructions(config: CompactionSection): string {
  const lines: string[] = ["## Context Management"];

  switch (config.mode) {
    case "token_limiter":
      lines.push(`- Token limiter: oldest messages dropped when context exceeds ${config.trigger_threshold} tokens`);
      break;
    case "token_compaction":
      lines.push(
        `- Token compaction: older messages summarized when context exceeds ${config.trigger_threshold} tokens`,
      );
      lines.push(`- Recent ${config.preserve_recent_messages} messages always preserved verbatim`);
      break;
    case "time_based":
      lines.push(
        `- Time-based compaction: messages older than ${config.preserve_duration_minutes} minutes are summarized`,
      );
      break;
  }

  lines.push(`- Max context tokens: ${config.max_context_tokens}`);

  return lines.join("\n");
}
