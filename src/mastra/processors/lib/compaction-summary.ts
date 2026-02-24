// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Shared Compaction Summary Utilities
 *
 * Unified schema and formatting for time-based and token-based compaction processors.
 */

import type { MastraDBMessage } from "@mastra/core/agent";
import { compactionAgent } from "../../agents/compaction";
import { type CompactionSummary, compactionOutputSchema } from "./compaction-schema";

// Re-export schema and types for backward compatibility
export { compactionOutputSchema, type CompactionSummary };

// Re-export the agent for backward compatibility
export { compactionAgent };

// ============================================================================
// Shared Formatting
// ============================================================================

export interface FormatSummaryOptions {
  /** Include key decisions section if present */
  preserveDecisions?: boolean;
  /** Include preserved context section if present */
  preserveContext?: boolean;
  /** Include user intent section if present */
  includeUserIntent?: boolean;
  /** Title for the summary section */
  title?: string;
}

/**
 * Format a compaction summary into a consistent markdown structure.
 * Used by both TimeCompactionProcessor and TokenCompactionProcessor.
 */
export function formatSummary(summary: CompactionSummary, options: FormatSummaryOptions = {}): string {
  const {
    preserveDecisions = true,
    preserveContext = true,
    includeUserIntent = true,
    title = "Previous Conversation Summary",
  } = options;

  const parts: string[] = [];

  parts.push(`## ${title}`);
  parts.push(summary.summary);

  // User intent (if available and enabled)
  if (includeUserIntent && summary.userIntent) {
    parts.push("\n### User Intent");
    parts.push(summary.userIntent);
  }

  // Key decisions
  if (preserveDecisions && summary.keyDecisions.length > 0) {
    parts.push("\n### Key Decisions");
    summary.keyDecisions.forEach((d) => parts.push(`- ${d}`));
  }

  // Preserved context
  if (preserveContext && summary.preservedContext) {
    parts.push("\n### Important Context");
    parts.push(summary.preservedContext);
  }

  return parts.join("\n");
}

/**
 * Fallback summary when LLM call fails.
 */
export function createFallbackSummary(messageCount: number): CompactionSummary {
  return {
    summary: `Previous conversation (${messageCount} messages)`,
    keyDecisions: [],
    preservedContext: "See conversation history for details",
  };
}

// ============================================================================
// Shared Message Builder
// ============================================================================

export interface BuildMessagesOptions {
  /** The older messages to summarize */
  messages: MastraDBMessage[];
  /** Current user query for context */
  query?: string;
  /** Additional focus areas to include in prompt */
  focusAreas?: string[];
  /** Max length guidance for the summary */
  maxLength?: number;
}

/**
 * Build messages for the compaction agent.
 * Passes the actual MastraDBMessages as conversation history,
 * then appends a final user message with summarization instructions.
 */
export function buildSummarizationMessages(options: BuildMessagesOptions): MastraDBMessage[] {
  const { messages, query, focusAreas = [], maxLength = 400 } = options;

  const focusText = focusAreas.length > 0 ? `\nFocus on preserving: ${focusAreas.join(", ")}` : "";

  const instructionText = `Summarize the preceding conversation.${query ? `\n\nCurrent user query for context: "${query}"` : ""}${focusText}

Be concise. Max ${maxLength} tokens total.`;

  // Pass the actual messages, then append summarization instruction
  return [
    ...messages,
    {
      role: "user",
      content: {
        format: 2,
        parts: [{ type: "text", text: instructionText }],
      },
      id: `compaction-instruction-${Date.now()}`,
      createdAt: new Date(),
    },
  ];
}
