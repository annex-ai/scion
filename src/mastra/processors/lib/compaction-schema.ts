// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Compaction Output Schema
 *
 * Shared Zod schema for compaction agent structured output.
 * Extracted to its own file to avoid circular imports between
 * the compaction agent and compaction-summary utilities.
 */

import { z } from "zod";

/**
 * Unified schema for compaction summaries.
 * Used by both TimeCompactionProcessor and TokenCompactionProcessor.
 */
export const compactionOutputSchema = z.object({
  /** High-level summary of the conversation (2-3 sentences) */
  summary: z.string().describe("High-level summary of the conversation"),
  /** Key decisions made during the conversation */
  keyDecisions: z.array(z.string()).describe("Specific decisions or conclusions made"),
  /** Critical context needed for continuity */
  preservedContext: z.string().describe("Important context that must be preserved for continuity"),
  /** What the user wants/asked (optional enhancement) */
  userIntent: z.string().optional().describe("The user's intent or goal from the conversation"),
});

export type CompactionSummary = z.infer<typeof compactionOutputSchema>;
