// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Adaptation Processor
 *
 * Lightweight input processor that injects adaptation context into conversations.
 * Reads patterns and coaching suggestions from JSON files, no LLM calls.
 *
 * Part of the Observe → Reflect → Coach adaptation pipeline.
 */

import type { ProcessInputArgs, Processor } from "@mastra/core/processors";
import { getAdaptationConfig } from "../lib/config";
import { loadActivePatterns, ensureAdaptationDirs } from "../lib/adaptation-storage";
import { claimMatchingSuggestion } from "../lib/adaptation-claim";
import type { AdaptationPattern, CoachingSuggestion } from "../lib/adaptation-types";

// Message type for processor
interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  source?: string;
}

/**
 * Configuration options for AdaptationProcessor
 */
export interface AdaptationProcessorOptions {
  /**
   * Maximum number of patterns to include in context
   * @default 15
   */
  maxPatterns?: number;

  /**
   * Whether to include coaching suggestions
   * @default true
   */
  enableCoaching?: boolean;

  /**
   * Whether to log processing details
   * @default false
   */
  verbose?: boolean;
}

/**
 * AdaptationProcessor loads learned patterns and coaching suggestions,
 * injecting them into the system context for each conversation turn.
 *
 * @example
 * ```typescript
 * import { AdaptationProcessor } from '../processors/adaptation-processor';
 *
 * const adaptationProcessor = new AdaptationProcessor();
 *
 * const agent = new Agent({
 *   inputProcessors: [
 *     soulLoader,
 *     prefsProcessor,
 *     adaptationProcessor,  // Add patterns and coaching
 *     ...
 *   ],
 * });
 * ```
 */
export class AdaptationProcessor implements Processor<"adaptation"> {
  readonly id = "adaptation" as const;
  readonly name = "Adaptation Processor";
  readonly description = "Injects learned patterns and coaching suggestions";

  private maxPatterns: number;
  private enableCoaching: boolean;
  private verbose: boolean;

  constructor(options: AdaptationProcessorOptions = {}) {
    this.maxPatterns = options.maxPatterns ?? 15;
    this.enableCoaching = options.enableCoaching ?? true;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Process input messages, injecting adaptation context
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async processInput(args: ProcessInputArgs): Promise<any[]> {
    const { messages } = args;

    try {
      // Check if adaptation is enabled
      const config = await getAdaptationConfig();
      if (!config.enabled) {
        return messages;
      }

      ensureAdaptationDirs();

      // 1. Load top N active patterns (sorted by confidence × occurrences)
      const patterns = await loadActivePatterns();
      const topPatterns = patterns
        .filter((p) => p.state === "active" || p.state === "validated")
        .sort((a, b) => b.confidence * b.occurrences - a.confidence * a.occurrences)
        .slice(0, this.maxPatterns);

      // 2. Check for matching coaching suggestions (if enabled)
      let coaching: CoachingSuggestion | null = null;
      if (this.enableCoaching && config.coaching_enabled) {
        const lastUserMessage = this.getLastUserMessage(messages);
        if (lastUserMessage) {
          coaching = await claimMatchingSuggestion(lastUserMessage);
        }
      }

      // 3. Build system message if we have context to inject
      if (topPatterns.length === 0 && !coaching) {
        return messages;
      }

      const contextMessage = this.buildContextMessage(topPatterns, coaching);

      if (this.verbose) {
        console.log(
          `[AdaptationProcessor] Injecting ${topPatterns.length} patterns` +
            (coaching ? `, coaching: ${coaching.type}` : ""),
        );
      }

      // Create adaptation message
      const adaptationMessage: Message = {
        id: `adaptation-${Date.now()}`,
        role: "system",
        content: contextMessage,
        createdAt: new Date(),
        source: "adaptation",
      };

      // Inject after other system messages but before user messages
      const lastSystemIndex = this.findLastSystemMessageIndex(messages);

      if (lastSystemIndex >= 0) {
        return [
          ...messages.slice(0, lastSystemIndex + 1),
          adaptationMessage,
          ...messages.slice(lastSystemIndex + 1),
        ];
      }

      // No system messages, prepend
      return [adaptationMessage, ...messages];
    } catch (error) {
      // Don't fail the request if adaptation processing fails
      if (this.verbose) {
        console.error("[AdaptationProcessor] Error:", error);
      }
      return messages;
    }
  }

  /**
   * Build the context message from patterns and coaching
   */
  private buildContextMessage(
    patterns: AdaptationPattern[],
    coaching: CoachingSuggestion | null,
  ): string {
    const sections: string[] = [];

    if (patterns.length > 0) {
      sections.push("## Learned Patterns");
      sections.push("");
      sections.push("These patterns were learned from prior conversations:");
      sections.push("");

      for (const p of patterns) {
        const stateLabel = p.state === "validated" ? "✓" : "○";
        sections.push(`- ${stateLabel} ${p.pattern}`);
        if (p.guidance && p.guidance !== p.pattern) {
          sections.push(`  → ${p.guidance}`);
        }
      }
    }

    if (coaching) {
      sections.push("");
      sections.push("## Coaching Opportunity");
      sections.push("");
      sections.push(`**Type**: ${coaching.type.replace(/_/g, " ")}`);
      sections.push(`**Suggestion**: ${coaching.suggestion}`);
      sections.push("");
      sections.push(
        "Consider naturally incorporating this into your response if relevant. " +
          "Be subtle and helpful, not preachy.",
      );
    }

    return sections.join("\n");
  }

  /**
   * Extract the last user message text from the messages array
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getLastUserMessage(messages: any[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          return msg.content;
        }
        if (msg.content?.content) {
          return msg.content.content;
        }
        if (Array.isArray(msg.content?.parts)) {
          const textParts = msg.content.parts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text);
          return textParts.join(" ");
        }
      }
    }
    return null;
  }

  /**
   * Find the index of the last system message
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private findLastSystemMessageIndex(messages: any[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "system") {
        return i;
      }
    }
    return -1;
  }
}

/**
 * Singleton instance for access by other components
 */
let processorInstance: AdaptationProcessor | null = null;

/**
 * Get or create the singleton processor instance
 */
export function getAdaptationProcessor(
  options?: AdaptationProcessorOptions,
): AdaptationProcessor {
  if (!processorInstance) {
    processorInstance = new AdaptationProcessor(options);
  }
  return processorInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetAdaptationProcessor(): void {
  processorInstance = null;
}
