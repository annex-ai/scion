// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Secret Sanitizer Processor (Output)
 *
 * Final safety pass before persistence.
 * Masks any secrets that might have leaked into tool results or LLM output.
 *
 * Catches:
 * - API echoing keys back in responses
 * - Edge cases missed by input processor
 * - Secrets in tool result content
 */

import type { ProcessOutputResultArgs, Processor, ProcessorMessageResult } from "@mastra/core/processors";
import { maskSecrets } from "../lib/secrets/utils";

export interface SecretSanitizerProcessorOptions {
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Output processor that sanitizes secrets before persistence
 *
 * Runs on tool results and LLM output before storage.
 * Catches secrets that may have leaked through edge cases.
 */
export class SecretSanitizerProcessor implements Processor {
  readonly id = "secret-sanitizer";
  readonly name = "Secret Sanitizer Processor";

  private options: SecretSanitizerProcessorOptions;

  constructor(options: SecretSanitizerProcessorOptions = {}) {
    this.options = { debug: false, ...options };
  }

  /**
   * Process output messages - mask secrets before persistence
   */
  processOutputResult({ messages }: ProcessOutputResultArgs): ProcessorMessageResult {
    let modifiedCount = 0;

    const sanitizedMessages = messages.map((message) => {
      const content = message.content;
      if (!content || typeof content !== "object" || !("parts" in content)) return message;

      let partsModified = false;
      const sanitizedParts = content.parts.map((part: any) => {
        // Mask secrets in text parts
        if (part.type === "text" && part.text) {
          const maskedText = maskSecrets(part.text);
          if (maskedText !== part.text) {
            partsModified = true;
            modifiedCount++;
            return { ...part, text: maskedText };
          }
        }

        // Mask secrets in tool results
        if (part.type === "tool-invocation" && part.result) {
          const resultStr = JSON.stringify(part.result);
          const maskedResult = maskSecrets(resultStr);
          if (maskedResult !== resultStr) {
            partsModified = true;
            modifiedCount++;
            try {
              return { ...part, result: JSON.parse(maskedResult) };
            } catch {
              return { ...part, result: maskedResult };
            }
          }
        }

        return part;
      });

      if (partsModified) {
        return {
          ...message,
          content: { ...content, parts: sanitizedParts },
        };
      }

      return message;
    });

    if (this.options.debug && modifiedCount > 0) {
      console.log(`[secret-sanitizer] Masked secrets in ${modifiedCount} part(s)`);
    }

    return sanitizedMessages;
  }
}
