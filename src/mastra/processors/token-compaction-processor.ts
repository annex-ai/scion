// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Token Compaction Processor
 *
 * Monitors token count and triggers compaction when threshold exceeded.
 * Uses js-tiktoken (o200k_base encoding) for accurate token counting,
 * matching Mastra's built-in TokenLimiterProcessor.
 *
 * Extends TokenLimiterProcessor's simple truncation with LLM-powered
 * summarization of older messages, preserving key context.
 *
 * Usage: Import and use in buildContextProcessors() for strategies
 * that need summarization rather than simple truncation.
 */

import type { MastraDBMessage } from "@mastra/core/agent";
import { TripWire } from "@mastra/core/agent";
import type { ProcessInputArgs, ProcessInputResult, Processor } from "@mastra/core/processors";
import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
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
// Token Counting (matches Mastra's TokenLimiterProcessor)
// ============================================================================

/** Per-message overhead matching Mastra's constant */
const TOKENS_PER_MESSAGE = 3.8;
/** JSON serialization overhead reduction for tool args/results */
const JSON_OVERHEAD_REDUCTION = 12;

export class TokenEstimator {
  private encoder: Tiktoken;

  constructor() {
    this.encoder = new Tiktoken(o200k_base);
  }

  estimate(messages: MastraDBMessage[]): number {
    let total = 0;

    for (const message of messages) {
      total += this.countMessageTokens(message);
    }

    return Math.ceil(total);
  }

  private countMessageTokens(message: MastraDBMessage): number {
    let tokenString = message.role;
    let overhead = TOKENS_PER_MESSAGE;

    if (typeof message.content === "string") {
      tokenString += message.content;
    } else if (message.content && typeof message.content === "object") {
      const content = message.content as any;
      const parts = content.parts ?? (Array.isArray(content) ? content : []);
      let toolResultCount = 0;

      for (const part of parts) {
        if (part.type === "text" || part.type === "thinking") {
          tokenString += part.text ?? part.content ?? "";
        } else if (part.type === "tool-invocation") {
          const invocation = part.toolInvocation ?? part;
          tokenString += invocation.toolName ?? invocation.name ?? "";
          if (invocation.args) {
            tokenString += JSON.stringify(invocation.args);
            overhead -= JSON_OVERHEAD_REDUCTION;
          }
        } else if (part.type === "tool-result") {
          toolResultCount++;
          const invocation = part.toolInvocation ?? part;
          if (invocation.result) {
            tokenString += JSON.stringify(invocation.result);
            overhead -= JSON_OVERHEAD_REDUCTION;
          }
        }
      }

      if (toolResultCount > 0) {
        overhead += toolResultCount * TOKENS_PER_MESSAGE;
      }
    }

    // Legacy tool_calls field
    if ((message as any).tool_calls) {
      const toolCalls = (message as any).tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const name = tc.function?.name || tc.name || "";
          const args = tc.function?.arguments || tc.arguments || "";
          tokenString += name + JSON.stringify(args);
          overhead -= JSON_OVERHEAD_REDUCTION;
        }
      }
    }

    return this.encoder.encode(tokenString).length + overhead;
  }
}

// ============================================================================
// Configuration
// ============================================================================

export interface TokenCompactionConfig {
  /** Token threshold to trigger compaction */
  tokenThreshold: number;
  /** Number of recent messages to preserve verbatim */
  preserveRecentMessages: number;
  /**
   * Compaction strategy: "summarize" uses LLM to create a summary,
   * "truncate" simply removes old messages without summarizing.
   */
  strategy: "summarize" | "truncate";
  /** Model for summarization (only used when strategy="summarize") */
  compactionModel: string;
  /** Max summary length (only used when strategy="summarize") */
  maxSummaryLength: number;
  /** What to preserve in summaries (only used when strategy="summarize") */
  preserveDecisions: boolean;
  preserveErrors: boolean;
  /** Emergency hard limit (absolute max tokens) */
  hardTokenLimit: number;
}

export async function loadTokenCompactionConfig(): Promise<TokenCompactionConfig> {
  try {
    const agentConfig = await loadAgentConfig();
    const config = agentConfig.compaction;

    // Use defaults if compaction is not configured
    if (!config) {
      return getDefaultTokenCompactionConfig();
    }

    return {
      // TOKEN BUDGET: Threshold to trigger compaction
      tokenThreshold: config.trigger_threshold ?? 10000,
      // How many recent messages to preserve
      preserveRecentMessages: config.preserve_recent_messages ?? 6,
      // Compaction strategy: "summarize" or "truncate"
      strategy: config.strategy ?? "summarize",
      // Hard limit (emergency truncation)
      hardTokenLimit: config.max_context_tokens ?? 12000,
      // Model and summary options
      compactionModel: config.model ?? "openrouter/openai/gpt-4o-mini",
      maxSummaryLength: config.max_summary_length ?? 400,
      preserveDecisions: config.preserve_decisions ?? true,
      preserveErrors: config.preserve_errors ?? true,
    };
  } catch (error) {
    console.warn("[TokenCompaction] Failed to load config, using defaults:", error);
    return getDefaultTokenCompactionConfig();
  }
}

function getDefaultTokenCompactionConfig(): TokenCompactionConfig {
  return {
    tokenThreshold: 10000,
    preserveRecentMessages: 6,
    strategy: "summarize",
    hardTokenLimit: 12000,
    compactionModel: "openrouter/openai/gpt-4o-mini",
    maxSummaryLength: 400,
    preserveDecisions: true,
    preserveErrors: true,
  };
}

// ============================================================================
// Processor
// ============================================================================

export class TokenCompactionProcessor implements Processor<"token-compaction"> {
  readonly id = "token-compaction" as const;
  readonly name = "Token Compaction";
  readonly description = "Compacts context when token threshold exceeded";

  private config?: TokenCompactionConfig;
  private configPromise?: Promise<TokenCompactionConfig>;
  private tokenEstimator: TokenEstimator;

  constructor(config?: Partial<TokenCompactionConfig>) {
    this.config = config as TokenCompactionConfig;
    this.tokenEstimator = new TokenEstimator();
  }

  /**
   * Load config with promise deduplication to prevent race conditions
   */
  private async loadConfig(): Promise<TokenCompactionConfig> {
    if (this.config) {
      return this.config;
    }
    if (!this.configPromise) {
      this.configPromise = loadTokenCompactionConfig();
    }
    this.config = await this.configPromise;
    return this.config;
  }

  async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
    const { messageList, tracingContext } = args;

    try {
      // Get all messages from messageList (includes memory + input)
      const messages = messageList?.get.all.db() ?? args.messages;

      // Guard against empty messages (following Mastra's TokenLimiterProcessor pattern)
      if (!messages || messages.length === 0) {
        throw new TripWire(
          "TokenCompactionProcessor: No messages to process. Cannot send LLM a request with no messages.",
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
      const query = lastUserMessage ? this.extractTextPreview(lastUserMessage) : "";

      // Load config if not provided (with race condition protection)
      const config = await this.loadConfig();

      // Check current token count of NON-SYSTEM messages only
      const tokenCount = this.tokenEstimator.estimate(nonSystemMessages);

      console.log(
        `[TokenCompaction] Current estimate: ${tokenCount} tokens (${nonSystemMessages.length} non-system, ${systemMessagesInList.length} system messages)`,
      );

      // If under threshold, no compaction needed
      if (tokenCount < config.tokenThreshold) {
        console.info(`[TokenCompaction] Skipping: ${tokenCount} tokens < threshold ${config.tokenThreshold}`);
        return messageList ?? messages;
      }

      console.log(`[TokenCompaction] Threshold exceeded (${tokenCount} > ${config.tokenThreshold})`);

      // Determine compaction strategy based on severity
      if (tokenCount > config.hardTokenLimit) {
        // Emergency: aggressive truncation (only non-system messages)
        return this.emergencyCompaction(messageList, nonSystemMessages, systemMessagesInList);
      }

      // Standard compaction (only non-system messages)
      return this.standardCompaction(messageList, nonSystemMessages, systemMessagesInList, query, tracingContext);
    } catch (error) {
      // If it's already a TripWire, re-throw it
      if (error instanceof TripWire) {
        throw error;
      }
      // Log the error and return original messages (fail-safe)
      console.error("[TokenCompaction] Error in processInput:", error);
      // Always return consistent type
      return messageList ?? args.messages;
    }
  }

  private async standardCompaction(
    messageList: ProcessInputArgs["messageList"],
    messages: MastraDBMessage[],
    systemMessages: MastraDBMessage[],
    query: string,
    tracingContext?: ProcessInputArgs["tracingContext"],
  ): Promise<ProcessInputResult> {
    const { preserveRecentMessages, strategy } = this.config!;

    // Calculate split point
    const cutoffIndex = Math.max(0, messages.length - preserveRecentMessages);

    const olderMessages = messages.slice(0, cutoffIndex);
    const recentMessages = messages.slice(cutoffIndex);

    console.log(
      `[TokenCompaction] Compacting ${olderMessages.length} messages, ` +
        `preserving ${recentMessages.length} + ${systemMessages.length} system (strategy: ${strategy})`,
    );

    // Handle based on strategy
    if (strategy === "truncate") {
      // Truncate: Simply remove old messages without summarizing
      if (messageList) {
        const idsToRemove = olderMessages.map((m) => m.id).filter((id): id is string => !!id);
        if (idsToRemove.length > 0) {
          messageList.removeByIds(idsToRemove);
        }

        const truncateMessage: MastraDBMessage = {
          role: "system",
          content: {
            format: 2,
            parts: [{ type: "text", text: `[${olderMessages.length} older messages truncated due to token limit]` }],
          },
          id: `token-compaction-truncate-${Date.now()}`,
          createdAt: new Date(),
        };
        messageList.add(truncateMessage, "context");

        console.log(`[TokenCompaction] Truncated ${olderMessages.length} messages (no summary)`);
        return messageList;
      }

      // Fallback: return new array if no messageList
      return [
        {
          role: "system",
          content: {
            format: 2,
            parts: [{ type: "text", text: `[${olderMessages.length} older messages truncated due to token limit]` }],
          },
          id: `token-compaction-truncate-${Date.now()}`,
          createdAt: new Date(),
        },
        ...systemMessages, // Preserve all original system messages
        ...recentMessages,
      ];
    }

    // Summarize: Generate summary using LLM (default behavior)
    const summary = await this.summarizeMessages(olderMessages, query, tracingContext);

    // Use unified format for the summary
    const summaryText = formatSummary(summary, {
      preserveDecisions: this.config!.preserveDecisions,
      preserveContext: true,
      includeUserIntent: true,
      title: "Previous Conversation Summary",
    });

    // If we have a messageList, modify it directly (following Mastra's pattern)
    if (messageList) {
      const idsToRemove = olderMessages.map((m) => m.id).filter((id): id is string => !!id);
      if (idsToRemove.length > 0) {
        messageList.removeByIds(idsToRemove);
      }

      const summaryMessage: MastraDBMessage = {
        role: "system",
        content: {
          format: 2,
          parts: [{ type: "text", text: summaryText }],
        },
        id: `token-compaction-${Date.now()}`,
        createdAt: new Date(),
      };
      messageList.add(summaryMessage, "context");

      console.log(`[TokenCompaction] Summarized ${olderMessages.length} messages into context summary`);
      return messageList;
    }

    // Fallback: return new array if no messageList
    const compacted: MastraDBMessage[] = [
      {
        role: "system",
        content: {
          format: 2,
          parts: [{ type: "text", text: summaryText }],
        },
        id: `token-compaction-${Date.now()}`,
        createdAt: new Date(),
      },
      ...systemMessages, // Preserve all original system messages
      ...recentMessages,
    ];

    const newTokenCount = this.tokenEstimator.estimate(compacted);
    console.log(`[TokenCompaction] Reduced to ${newTokenCount} tokens`);

    return compacted;
  }

  private emergencyCompaction(
    messageList: ProcessInputArgs["messageList"],
    messages: MastraDBMessage[],
    systemMessages: MastraDBMessage[] = [],
  ): ProcessInputResult {
    console.warn("[TokenCompaction] EMERGENCY: Hard limit exceeded, truncating");

    // Keep only last N messages (from non-system messages)
    const keepCount = Math.floor(this.config!.preserveRecentMessages / 2);
    const removeCount = messages.length - keepCount;
    const messagesToRemove = messages.slice(0, removeCount);
    const kept = messages.slice(-keepCount);

    // If we have a messageList, modify it directly
    if (messageList) {
      const idsToRemove = messagesToRemove.map((m) => m.id).filter((id): id is string => !!id);
      if (idsToRemove.length > 0) {
        messageList.removeByIds(idsToRemove);
      }

      const emergencySummary: MastraDBMessage = {
        role: "system",
        content: {
          format: 2,
          parts: [
            { type: "text", text: `[Earlier conversation truncated due to length. ${removeCount} messages removed.]` },
          ],
        },
        id: `emergency-compaction-${Date.now()}`,
        createdAt: new Date(),
      };
      messageList.add(emergencySummary, "context");

      return messageList;
    }

    // Fallback: return new array
    const emergencySummary: MastraDBMessage = {
      role: "system",
      content: {
        format: 2,
        parts: [
          { type: "text", text: `[Earlier conversation truncated due to length. ${removeCount} messages removed.]` },
        ],
      },
      id: `emergency-compaction-${Date.now()}`,
      createdAt: new Date(),
    };

    return [emergencySummary, ...systemMessages, ...kept];
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
      console.error("[TokenCompaction] Summarization failed:", error);
      return createFallbackSummary(messages.length);
    }
  }

  private getFocusAreas(): string[] {
    const areas: string[] = [];
    if (this.config!.preserveDecisions) areas.push("decisions");
    if (this.config!.preserveErrors) areas.push("errors");
    return areas;
  }

  private extractTextPreview(message: MastraDBMessage): string {
    if (typeof message.content === "string") {
      return (message.content as string).slice(0, 500);
    }
    if (message.content && typeof message.content === "object") {
      const content = message.content as any;
      const parts = content.parts ?? (Array.isArray(content) ? content : []);
      return parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text ?? "")
        .join(" ")
        .slice(0, 500);
    }
    return "";
  }
}
