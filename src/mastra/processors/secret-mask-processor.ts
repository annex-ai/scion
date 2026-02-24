// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Secret Mask Processor (Input)
 *
 * Masks secrets in user input before the LLM sees them.
 * Uses §§secret(ALIAS) pattern - LLM never sees real secrets.
 *
 * This prevents secrets from leaking into:
 * - Message history
 * - Tool arguments
 * - Observability traces
 */

import type { ProcessInputArgs, ProcessInputResult, Processor } from "@mastra/core/processors";
import { maskSecrets, scanForSecrets } from "../lib/secrets/utils";

export interface SecretMaskProcessorOptions {
  /** Enable debug logging of masked secrets */
  debug?: boolean;
}

/**
 * Input processor that masks secrets before LLM sees them
 *
 * Pattern: Detects secrets in user messages → replaces with §§secret(ALIAS)
 * Result: LLM cannot pass real secrets to tools (never saw them)
 */
export class SecretMaskProcessor implements Processor {
  readonly id = "secret-mask";
  readonly name = "Secret Mask Processor";

  private options: SecretMaskProcessorOptions;

  constructor(options: SecretMaskProcessorOptions = {}) {
    this.options = { debug: false, ...options };
  }

  /**
   * Process input messages - mask secrets in all messages
   */
  async processInput({ messages }: ProcessInputArgs): Promise<ProcessInputResult> {
    let modified = false;

    const maskedMessages = messages.map((message) => {
      if (message.role !== "user") return message;

      const content = message.content;
      if (!content || typeof content !== "object" || !("parts" in content)) return message;

      let partsModified = false;
      const maskedParts = content.parts.map((part: any) => {
        if (part.type === "text" && part.text) {
          if (this.options.debug) {
            const found = scanForSecrets(part.text);
            if (found.length > 0) {
              console.log(`[secret-mask] Found secrets in user message: ${found.map((s) => s.alias).join(", ")}`);
            }
          }
          const maskedText = maskSecrets(part.text);
          if (maskedText !== part.text) {
            partsModified = true;
            return { ...part, text: maskedText };
          }
        }
        return part;
      });

      if (partsModified) {
        modified = true;
        return {
          ...message,
          content: { ...content, parts: maskedParts },
        };
      }

      return message;
    });

    if (modified && this.options.debug) {
      console.log("[secret-mask] Masked secrets in user message(s)");
    }

    return maskedMessages;
  }
}
