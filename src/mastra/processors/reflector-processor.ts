// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { MastraDBMessage } from "@mastra/core/agent";
import type { ProcessOutputResultArgs, Processor } from "@mastra/core/processors";
import { reflectorAgent } from "../agents/reflector";
import { type ReflectorAnalysis, reflectorAnalysisSchema } from "../lib/reflection-utils";

// Re-export schema and type for backward compatibility
export { reflectorAnalysisSchema } from "../lib/reflection-utils";
export type { ReflectorAnalysis } from "../lib/reflection-utils";

/**
 * ReflectorProcessor — output processor that analyzes assistant responses
 * and attaches reflectorAnalysis metadata to assistant messages.
 *
 * The metadata is later consumed by:
 * 1. The ReflectionWorkflow (for aggregation into REFLECTIONS.md on a cron)
 *
 * Pipeline position: after PIIDetector, before BatchPartsProcessor
 */
export class ReflectorProcessor implements Processor<"reflector-processor"> {
  readonly id = "reflector-processor" as const;
  readonly name = "Reflector";
  readonly description =
    "Analyzes assistant responses to extract attention patterns for self-improving context curation";

  /**
   * Process output result — analyze assistant response and attach metadata
   */
  async processOutputResult(args: ProcessOutputResultArgs): Promise<MastraDBMessage[]> {
    const { messages, messageList, tracingContext } = args;

    // messages = newly generated response messages only
    // messageList provides the full conversation history via public API
    console.log(`[Reflector] processOutputResult called — output: ${messages.length} msgs`);

    try {
      // Find the last assistant message in the output
      const lastAssistantIdx = this.findLastAssistantIndex(messages);
      if (lastAssistantIdx === -1) {
        console.log("[Reflector] SKIP: no assistant message found in output");
        return messages;
      }

      const assistantMsg = messages[lastAssistantIdx];
      const assistantText = this.extractTextContent(assistantMsg);
      console.log(
        `[Reflector] Found assistant message at output index ${lastAssistantIdx}, text length: ${assistantText.length}`,
      );

      // Skip very short responses or tool-call-only messages
      if (assistantText.length < 50) {
        console.log(`[Reflector] SKIP: response too short (${assistantText.length} chars < 50)`);
        return messages;
      }

      // Skip if all content parts are tool-result type
      if (this.isToolCallOnly(assistantMsg)) {
        console.log("[Reflector] SKIP: tool-call-only message");
        return messages;
      }

      // Get last user query from the full conversation via MessageList public API,
      // since the output messages only contain the assistant response
      const userQuery = messageList?.getLatestUserContent() ?? null;
      if (!userQuery) {
        console.log("[Reflector] SKIP: no user query found in conversation history");
        return messages;
      }
      console.log(`[Reflector] User query: "${userQuery.slice(0, 80)}..."`);

      // Extract reasoning/thinking parts if available
      const reasoning = this.extractReasoningContent(assistantMsg);
      if (reasoning) {
        console.log(`[Reflector] Found reasoning content: ${reasoning.length} chars`);
      }

      // Build analysis prompt
      const prompt = `Analyze this assistant response:

User Query: "${userQuery}"

Assistant Response:
${assistantText.slice(0, 2000)}
${reasoning ? `\nReasoning/Thinking:\n${reasoning.slice(0, 1000)}` : ""}

Extract patterns about what information was useful, what decisions were made, and what could be filtered next time.`;

      console.log(`[Reflector] Calling reflector agent (model: ${reflectorAgent.model?.toString?.() ?? "unknown"})...`);
      const startTime = Date.now();

      const response = await reflectorAgent.generate(prompt, {
        structuredOutput: { schema: reflectorAnalysisSchema },
        modelSettings: { temperature: 0 },
        tracingContext,
      });

      const elapsed = Date.now() - startTime;
      console.log(
        `[Reflector] Agent responded in ${elapsed}ms, object type: ${typeof response.object}, text length: ${response.text?.length ?? 0}`,
      );

      const analysis = response.object as ReflectorAnalysis;

      if (!analysis || !analysis.patterns) {
        console.warn(
          "[Reflector] SKIP: no valid analysis returned from agent",
          JSON.stringify(response.object).slice(0, 200),
        );
        return messages;
      }

      console.log(
        `[Reflector] Analysis: ${analysis.patterns.length} patterns, insights: ${JSON.stringify(analysis.insights).slice(0, 150)}`,
      );

      // Attach analysis as metadata on the assistant message
      const modifiedMessages = [...messages];
      const modifiedMsg = { ...modifiedMessages[lastAssistantIdx] };

      // Attach metadata to content
      // MastraMessageContentV2 expects: { format: 2, parts: [...], metadata?: Record<string, unknown> }
      const existingContent = modifiedMsg.content;
      const reflectorMetadata = {
        reflectorAnalysis: analysis,
        reflectorTimestamp: new Date().toISOString(),
      };

      if (typeof existingContent === "object" && existingContent !== null) {
        const contentObj = existingContent as Record<string, any>;
        modifiedMsg.content = {
          ...contentObj,
          metadata: {
            ...(contentObj.metadata || {}),
            ...reflectorMetadata,
          },
        } as any;
        console.log(
          `[Reflector] Attached metadata to object content (existing metadata keys: ${Object.keys(contentObj.metadata || {}).join(", ") || "none"})`,
        );
      } else {
        // String content — convert to V2 format for memory persistence compatibility
        modifiedMsg.content = {
          format: 2,
          parts: [{ type: "text", text: String(existingContent) }],
          content: existingContent,
          metadata: reflectorMetadata,
        } as any;
        console.log("[Reflector] Converted string content to V2 format with metadata");
      }

      modifiedMessages[lastAssistantIdx] = modifiedMsg;

      const patternCount = analysis.patterns.length;
      console.info(
        `[Reflector] SUCCESS: Attached ${patternCount} patterns (${analysis.patterns.filter((p) => p.type === "attention_signal").length} attention, ${analysis.patterns.filter((p) => p.type === "decision_marker").length} decision, ${analysis.patterns.filter((p) => p.type === "noise_pattern").length} noise)`,
      );

      return modifiedMessages;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      console.error(`[Reflector] FAILED: ${errMsg}`);
      if (errStack) console.error(`[Reflector] Stack: ${errStack}`);
      // Non-blocking: return messages unchanged on failure
      return messages;
    }
  }

  /**
   * Find index of the last assistant message
   */
  private findLastAssistantIndex(messages: MastraDBMessage[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return i;
      }
    }
    return -1;
  }

  /**
   * Check if message is tool-call-only (no substantive text content)
   */
  private isToolCallOnly(message: MastraDBMessage): boolean {
    if (typeof message.content === "object" && message.content !== null) {
      const content = message.content as any;
      if (Array.isArray(content.parts)) {
        const hasTextParts = content.parts.some((p: any) => p.type === "text" && p.text?.trim().length > 0);
        const hasToolParts = content.parts.some((p: any) => p.type === "tool-invocation" || p.type === "tool-result");
        return !hasTextParts && hasToolParts;
      }
    }
    return false;
  }

  /**
   * Extract reasoning/thinking content from assistant message
   */
  private extractReasoningContent(message: MastraDBMessage): string {
    if (typeof message.content === "object" && message.content !== null) {
      const content = message.content as any;
      if (Array.isArray(content.parts)) {
        return content.parts
          .filter((p: any) => p.type === "thinking" || p.type === "reasoning")
          .map((p: any) => p.text || p.content || "")
          .join("\n");
      }
    }
    return "";
  }

  /**
   * Extract text content from a message
   */
  private extractTextContent(message: MastraDBMessage): string {
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
