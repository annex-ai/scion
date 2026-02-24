// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { MastraDBMessage } from "@mastra/core/agent";
import type { ProcessInputArgs, Processor } from "@mastra/core/processors";
import { logger } from "../gateway/logger";

/**
 * Configuration options for AdversarialPatternDetector
 */
export interface AdversarialPatternDetectorOptions {
  /**
   * Additional custom patterns to check
   */
  extraPatterns?: Array<{ pattern: RegExp; name: string; severity: "high" | "medium" }>;
}

/**
 * Fast pattern-based detector for common adversarial attacks.
 * Complements LLM-based PromptInjectionDetector with zero-latency,
 * zero-cost regex checks. No LLM calls — deterministic behavior.
 */
export class AdversarialPatternDetector implements Processor<"adversarial-detector"> {
  readonly id = "adversarial-detector" as const;
  readonly name = "Adversarial Pattern Detector";
  readonly description = "Zero-latency regex-based detection of common prompt injection patterns";

  private patterns: Array<{ pattern: RegExp; name: string; severity: "high" | "medium" }> = [
    // High severity — clear attack attempts
    { pattern: /ignore\s+(all\s+)?previous\s+(instructions|prompts)/gi, name: "ignore-previous", severity: "high" },
    { pattern: /ignore\s+above\s+(instructions|prompts)/gi, name: "ignore-above", severity: "high" },
    {
      pattern: /disregard\s+(all\s+)?previous\s+(instructions|prompts)/gi,
      name: "disregard-previous",
      severity: "high",
    },

    // Role manipulation
    { pattern: /you\s+are\s+now\s+a\b/gi, name: "role-override", severity: "high" },
    { pattern: /from\s+now\s+on\s+you\s+are/gi, name: "role-override-variant", severity: "high" },

    // Jailbreak patterns
    { pattern: /\bDAN\s+(mode|prompt|jailbreak)\b/gi, name: "dan-mode", severity: "high" },
    { pattern: /\bjailbreak\b/gi, name: "jailbreak-term", severity: "high" },

    // System prompt extraction
    {
      pattern: /(repeat|output|show|print|echo)\s+(back\s+|me\s+)?(your|above|previous|the)\s+(system\s+)?prompt/gi,
      name: "prompt-extraction",
      severity: "high",
    },
    {
      pattern: /what\s+(were|are|was)\s+your\s+(instructions|directions)/gi,
      name: "instruction-extraction",
      severity: "high",
    },

    // JSON/markdown injection attempts
    { pattern: /\{[\s\S]*"role"\s*:\s*"system"[\s\S]*\}/gi, name: "json-role-injection", severity: "high" },
    { pattern: /```\s*system[\s\S]*```/gi, name: "markdown-system-injection", severity: "high" },

    // Delimiter attacks
    { pattern: /<!-----\s*BEGIN\s*(SYSTEM|INSTRUCTIONS)/gi, name: "delimiter-attack", severity: "high" },
    { pattern: /\[SYSTEM\s*MESSAGE\]/gi, name: "fake-system-tag", severity: "high" },

    // Medium severity
    { pattern: /act\s+as\s+(if\s+you\s+(are|were)\s+)?a?\s*(an?\s+)?/gi, name: "act-as", severity: "medium" },
    { pattern: /\bdeveloper\s+mode\b/gi, name: "developer-mode", severity: "medium" },
  ];

  constructor(options?: AdversarialPatternDetectorOptions) {
    if (options?.extraPatterns) {
      this.patterns.push(...options.extraPatterns);
    }
  }

  async processInput(args: ProcessInputArgs): Promise<MastraDBMessage[]> {
    const { messages, abort } = args;
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      return messages;
    }

    // Extract text content from the message
    const text = this.extractText(lastMessage);
    if (!text) {
      return messages;
    }

    const detectedPatterns: Array<{ name: string; severity: string; match: string }> = [];

    for (const { pattern, name, severity } of this.patterns) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) {
        detectedPatterns.push({
          name,
          severity,
          match: matches[0].slice(0, 100),
        });
      }
    }

    if (detectedPatterns.length > 0) {
      const highSeverityCount = detectedPatterns.filter((p) => p.severity === "high").length;

      logger.warn(
        {
          patterns: detectedPatterns,
          messagePreview: text.slice(0, 200),
        },
        "Adversarial patterns detected in input",
      );

      // Block if any high-severity pattern detected
      if (highSeverityCount > 0) {
        abort(
          "Your message contains patterns that may be attempting to manipulate the AI system. Please rephrase your request.",
          { retry: false },
        );
      }
    }

    return messages;
  }

  /**
   * Extract text content from a MastraDBMessage
   */
  private extractText(message: MastraDBMessage): string {
    if (typeof message.content === "string") {
      return message.content;
    }

    if (message.content && typeof message.content === "object") {
      const content = message.content as any;

      if (typeof content.content === "string") {
        return content.content;
      }

      if (Array.isArray(content.parts)) {
        return content.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("\n");
      }
    }

    return "";
  }
}
