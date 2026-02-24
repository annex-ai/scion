// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Time Compaction Processor
 *
 * Keeps N most recent conversation turns, summarizes older messages.
 */

import type { MastraDBMessage } from "@mastra/core/agent";
import { TripWire } from "@mastra/core/agent";
import type { ProcessInputArgs, ProcessInputResult, Processor } from "@mastra/core/processors";
import { loadAgentConfig } from "../lib/config/agent-config";
import {
  type CompactionSummary,
  buildSummarizationMessages,
  compactionAgent,
  compactionOutputSchema,
  createFallbackSummary,
  formatSummary,
} from "./lib/compaction-summary";

// ============================================================================
// Configuration
// ============================================================================

export interface TimeCompactionConfig {
  /**
   * Time-based constraint: Keep messages from last N minutes verbatim.
   * Messages older than this duration are processed based on strategy.
   */
  preserveDurationMinutes: number;
  /**
   * Compaction strategy: "summarize" uses LLM to create a summary,
   * "truncate" simply removes old messages without summarizing.
   */
  strategy: "summarize" | "truncate";
  /** Model to use for summarization (only used when strategy="summarize") */
  compactionModel: string;
  /** What to preserve in summaries (only used when strategy="summarize") */
  preserveDecisions: boolean;
  preserveErrors: boolean;
  preserveUserPreferences: boolean;
  /** Max summary length in tokens (only used when strategy="summarize") */
  maxSummaryLength: number;
}

export async function loadTimeCompactionConfig(): Promise<TimeCompactionConfig> {
  try {
    const agentConfig = await loadAgentConfig();
    const ctx = agentConfig.compaction;

    // Use defaults if compaction is not configured
    if (!ctx) {
      return getDefaultTimeCompactionConfig();
    }

    return {
      // TIME CONSTRAINT: Keep messages from last N minutes verbatim
      preserveDurationMinutes: ctx.preserve_duration_minutes ?? 60,
      // Compaction strategy: "summarize" or "truncate"
      strategy: ctx.strategy ?? "summarize",
      // Model and summary options
      compactionModel: ctx.model ?? "openrouter/openai/gpt-4o-mini",
      preserveDecisions: ctx.preserve_decisions ?? true,
      preserveErrors: ctx.preserve_errors ?? true,
      preserveUserPreferences: ctx.preserve_user_preferences ?? true,
      maxSummaryLength: ctx.max_summary_length ?? 400,
    };
  } catch (error) {
    console.warn("[TimeCompaction] Failed to load config, using defaults:", error);
    return getDefaultTimeCompactionConfig();
  }
}

function getDefaultTimeCompactionConfig(): TimeCompactionConfig {
  return {
    preserveDurationMinutes: 60,
    strategy: "summarize",
    compactionModel: "openrouter/openai/gpt-4o-mini",
    preserveDecisions: true,
    preserveErrors: true,
    preserveUserPreferences: true,
    maxSummaryLength: 400,
  };
}

// ============================================================================
// Processor
// ============================================================================

export class TimeCompactionProcessor implements Processor<"time-compaction"> {
  readonly id = "time-compaction" as const;
  readonly name = "Time Compaction";
  readonly description = "Keeps N recent turns, summarizes older messages";

  private config?: TimeCompactionConfig;
  private configPromise?: Promise<TimeCompactionConfig>;

  constructor(config?: Partial<TimeCompactionConfig>) {
    // Load config asynchronously in processInput
    this.config = config as TimeCompactionConfig;
  }

  /**
   * Load config with promise deduplication to prevent race conditions
   */
  private async loadConfig(): Promise<TimeCompactionConfig> {
    if (this.config) {
      return this.config;
    }
    if (!this.configPromise) {
      this.configPromise = loadTimeCompactionConfig();
    }
    this.config = await this.configPromise;
    return this.config;
  }

  async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
    const { messageList, systemMessages, tracingContext } = args;

    try {
      // Get all messages from messageList (includes memory + input)
      const messages = messageList?.get.all.db() ?? args.messages;

      // Guard against empty messages (following Mastra's TokenLimiterProcessor pattern)
      if (!messages || messages.length === 0) {
        throw new TripWire(
          "TimeCompactionProcessor: No messages to process. Cannot send LLM a request with no messages.",
          {
            retry: false,
          },
        );
      }

      // Separate system messages from non-system messages
      // System messages should NEVER be compacted - they're handled separately via args.systemMessages
      const nonSystemMessages = messages.filter((m) => m.role !== "system");
      const systemMessagesInList = messages.filter((m) => m.role === "system");

      // Get query from the last user message if available
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
      const query = lastUserMessage ? this.extractTextContent(lastUserMessage) : "";

      // Load config if not provided (with race condition protection)
      const config = await this.loadConfig();

      console.log(
        `[TimeCompaction] Processing ${messages.length} messages (${nonSystemMessages.length} non-system, ${systemMessagesInList.length} system)`,
      );

      // Determine cutoff point based on NON-SYSTEM messages only
      const cutoffIndex = this.calculateCutoffIndex(nonSystemMessages);

      // If no compaction needed, return as-is
      if (cutoffIndex <= 0) {
        console.log("[TimeCompaction] No compaction needed");
        return messageList ?? messages;
      }

      // Guard: messageList is required for compaction
      if (!messageList) {
        console.log("[TimeCompaction] No messageList available, skipping compaction");
        return messages;
      }

      // Split NON-SYSTEM messages only
      const olderMessages = nonSystemMessages.slice(0, cutoffIndex);
      const recentMessages = nonSystemMessages.slice(cutoffIndex);

      console.log(
        `[TimeCompaction] Compacting ${olderMessages.length} messages, ` +
          `keeping ${recentMessages.length} recent + ${systemMessagesInList.length} system messages (strategy: ${config.strategy})`,
      );

      console.log(
        `[TimeCompaction] Compacting ${olderMessages.length} messages, ` +
          `keeping ${recentMessages.length} recent (strategy: ${config.strategy})`,
      );

      // Remove old messages from messageList (following Mastra's TokenLimiterProcessor pattern)
      const idsToRemove = olderMessages.map((m) => m.id).filter((id): id is string => !!id);
      if (idsToRemove.length > 0) {
        messageList.removeByIds(idsToRemove);
      }

      // Handle based on strategy
      if (config.strategy === "truncate") {
        // Truncate: Simply remove old messages without summarizing
        const truncateMessage: MastraDBMessage = {
          role: "system",
          content: {
            format: 2,
            parts: [{ type: "text", text: `[${olderMessages.length} older messages truncated due to time limit]` }],
          },
          id: `compaction-truncate-${Date.now()}`,
          createdAt: new Date(),
        };
        messageList.add(truncateMessage, "context");

        console.log(`[TimeCompaction] Truncated ${olderMessages.length} messages (no summary)`);
      } else {
        // Summarize: Generate summary using LLM
        const summary = await this.summarizeMessages(olderMessages, query, tracingContext);

        // Add summary as a system message using unified format
        const summaryText = formatSummary(summary, {
          preserveDecisions: this.config!.preserveDecisions,
          preserveContext: true,
          includeUserIntent: true,
          title: "Previous Conversation Summary",
        });

        const summaryMessage: MastraDBMessage = {
          role: "system",
          content: {
            format: 2,
            parts: [{ type: "text", text: summaryText }],
          },
          id: `compaction-${Date.now()}`,
          createdAt: new Date(),
        };
        messageList.add(summaryMessage, "context");

        console.log(`[TimeCompaction] Summarized ${olderMessages.length} messages into context summary`);
      }

      return messageList;
    } catch (error) {
      // If it's already a TripWire, re-throw it
      if (error instanceof TripWire) {
        throw error;
      }
      // Log the error and return original messages (fail-safe)
      console.error("[TimeCompaction] Error in processInput:", error);
      // Always return consistent type: prefer messageList if we modified it, otherwise messages
      return messageList ?? args.messages;
    }
  }

  private calculateCutoffIndex(messages: MastraDBMessage[]): number {
    const { preserveDurationMinutes } = this.config!;

    // Calculate the cutoff time (N minutes ago from now)
    const now = Date.now();
    const cutoffTime = now - preserveDurationMinutes * 60 * 1000;

    // Find the first message that is older than the cutoff time
    // Messages are sorted by createdAt (oldest first)
    for (let i = 0; i < messages.length; i++) {
      const messageTime = this.getMessageTimestamp(messages[i]);
      if (messageTime < cutoffTime) {
      } else {
        // This message is within the preservation window
        // Return the index where old messages end and recent begin
        return i;
      }
    }

    // All messages are within the preservation window
    return 0;
  }

  private getMessageTimestamp(message: MastraDBMessage): number {
    // Use createdAt if available
    if (message.createdAt) {
      return new Date(message.createdAt).getTime();
    }
    // Fallback to current time (message without timestamp won't be compacted)
    return Date.now();
  }

  private async summarizeMessages(
    messages: MastraDBMessage[],
    query: string,
    tracingContext?: ProcessInputArgs["tracingContext"],
  ): Promise<CompactionSummary> {
    // Pass actual messages to compaction agent (not serialized text)
    const compactionMessages = buildSummarizationMessages({
      messages,
      query,
      focusAreas: this.getFocusAreas(),
      maxLength: this.config!.maxSummaryLength,
    });

    try {
      const response = await compactionAgent.generate(compactionMessages, {
        structuredOutput: { schema: compactionOutputSchema },
        tracingContext,
      });
      return response.object as CompactionSummary;
    } catch (error) {
      console.error("[TimeCompaction] Summarization failed:", error);
      return createFallbackSummary(messages.length);
    }
  }

  private getFocusAreas(): string[] {
    const areas: string[] = [];
    if (this.config!.preserveDecisions) areas.push("decisions");
    if (this.config!.preserveErrors) areas.push("errors");
    if (this.config!.preserveUserPreferences) areas.push("user preferences");
    return areas;
  }

  private extractTextContent(message: MastraDBMessage): string {
    if (typeof message.content === "string") {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join(" ");
    }

    if (typeof message.content === "object" && message.content !== null) {
      const content = message.content as any;
      if (content.text) return content.text;
      if (content.content) return String(content.content);
    }

    return "";
  }
}
