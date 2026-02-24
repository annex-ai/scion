// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gateway to Mastra adapter
 *
 * Routes channel messages to the Interactive Agent.
 *
 * ## Thread Management
 *
 * Thread IDs are deterministic (based on channel info, not timestamp).
 * Users can reset threads with /new or /reset commands.
 *
 * ## Memory Architecture
 *
 * 1. Thread Memory: Per-conversation (handled by Mastra)
 * 2. Global Memory: All interactions (captured for cross-thread search)
 * 3. Curated Knowledge: INTERACTIONS.md (LLM-curated important facts)
 *
 * ## HTTP-based Agent Communication
 *
 * The adapter communicates with the Mastra agent via HTTP endpoints instead of
 * direct imports. This eliminates circular dependencies and enables cleaner
 * architecture where the gateway can run independently or integrated with Mastra.
 *
 * ## Resource Loading
 *
 * Personality, identity, skills, and flows are now loaded at AGENT initialization time.
 * The adapter only passes channel context for callbacks and memory configuration.
 */

import { RequestContext } from "@mastra/core/request-context";
import { getLoopConfig, getSecurityConfig } from "../lib/config";
import { formatMediaIntoMessage } from "./channels/media/format.js";
import { processMediaAttachments } from "./channels/media/understand.js";
import { createThreadKey, type InboundMessage, type OutboundAttachment } from "./channels/types";
import { logger } from "./logger";

/**
 * Result from processing a message through the gateway
 */
export interface ProcessMessageResult {
  /** Text response from the agent */
  text: string;
  /** Media attachments to send (e.g., audio from TTS) */
  attachments?: OutboundAttachment[];
}

/**
 * Options for processing a message
 */
export interface ProcessOptions {
  /** Additional context to prepend to the message */
  context?: string;
  /** Working directory for resource discovery */
  cwd?: string;
  /** Additional skill paths */
  skillPaths?: string[];
  /** Path to recipe file for workflow execution */
  recipePath?: string;
  /** Path to flows.config.json (overrides gateway config) */
  flowsConfigPath?: string;
}

/**
 * Configuration for GatewayToMastraAdapter
 */
export interface GatewayAdapterConfig {
  /** Working directory for resource discovery */
  cwd?: string;
  /** Mastra server URL for HTTP-based agent communication */
  mastraUrl?: string;
  /** Commands that trigger thread reset (default: ['/new', '/reset']) */
  resetCommands?: string[];
}

/**
 * Gateway adapter that routes messages to Mastra agents
 *
 * Features:
 * - Thread management via Mastra's native HTTP API
 * - Reset commands (/new, /reset)
 * - Global memory capture
 * - Interaction curation queue
 *
 * Note: MCP tools are loaded at Mastra startup, not per-request.
 */
export class GatewayToMastraAdapter {
  /** Default working directory */
  private defaultCwd: string;

  /** Mastra server URL for HTTP-based agent communication */
  private mastraUrl: string;

  /** Reset commands */
  private resetCommands: string[];

  constructor(config: GatewayAdapterConfig) {
    this.defaultCwd = config.cwd ?? process.cwd();
    this.mastraUrl = config.mastraUrl ?? "http://localhost:4111";
    this.resetCommands = config.resetCommands ?? ["/new", "/reset"];

    logger.info({}, "Gateway adapter initialized (personality/skills loaded at agent level)");
  }

  /**
   * Generate a deterministic thread ID from channel info
   *
   * Format: thread_{channelType}_{channelId}_{threadId}
   *
   * @param channelType - Channel type (slack, telegram, etc.)
   * @param channelId - Channel ID
   * @param threadId - Optional thread ID within the channel
   * @returns Deterministic thread ID
   */
  generateThreadId(channelType: string, channelId: string, threadId?: string): string {
    const parts = [channelType, channelId, threadId].filter(Boolean);
    const sanitized = parts.join("_").replace(/[^a-zA-Z0-9]/g, "_");
    return `thread_${sanitized}`;
  }

  /**
   * Check if a message is a reset command
   *
   * @param text - Message text to check
   * @returns true if the message is a reset command
   */
  isResetCommand(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    return this.resetCommands.includes(trimmed);
  }

  /**
   * Call the Mastra agent via HTTP
   */
  private async callAgentViaHttp(
    message: string,
    memoryConfig: { resource: string; thread: string },
    channelContext: {
      channelType: string;
      channelId: string;
      threadId: string;
      threadKey: string;
    },
  ): Promise<{
    text?: string;
    steps?: Array<{
      toolResults?: Array<{
        payload: {
          toolName: string;
          result: unknown;
        };
      }>;
    }>;
    traceId?: string;
  }> {
    const url = `${this.mastraUrl}/api/agents/interactiveAgent/generate`;

    const loop = await getLoopConfig();

    logger.info(
      {
        url,
        messageLength: message.length,
        channelType: channelContext.channelType,
        maxSteps: loop.max_steps_per_turn ?? 50,
        maxRetries: loop.max_retries_per_step ?? 3,
      },
      "Calling agent via HTTP",
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.GATEWAY_API_KEY) {
      headers.Authorization = `Bearer ${process.env.GATEWAY_API_KEY}`;
    }

    // 2-minute timeout — agent responses can be slow when tool-calling
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          messages: [{ role: "user", content: message }],
          memory: memoryConfig,
          maxSteps: loop.max_steps_per_turn ?? 50,
          maxRetries: loop.max_retries_per_step ?? 3,
          requestContext: {
            channelType: channelContext.channelType,
            channelId: channelContext.channelId,
            threadId: channelContext.threadId,
            threadKey: channelContext.threadKey,
            memoryThreadId: memoryConfig.thread,
            memoryResource: memoryConfig.resource,
          },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Agent HTTP call failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  /**
   * Process an inbound message and return the agent's response
   */
  async processMessage(message: InboundMessage, options?: ProcessOptions): Promise<ProcessMessageResult> {
    const threadKey = createThreadKey(message.channelType, message.channelId, message.threadId);

    const securityConfig = await getSecurityConfig();
    const memoryThread = this.generateThreadId(message.channelType, message.channelId, message.threadId);
    const resourceId = securityConfig.resource_id;

    logger.info(
      {
        stage: "REQUEST_START",
        channelType: message.channelType,
        channelId: message.channelId,
        messageThreadId: message.threadId || "(none)",
        messageId: message.id,
        threadKey,
        memoryThread,
        messagePreview: message.text.slice(0, 50),
      },
      "📥 Incoming message",
    );

    // Check for reset commands - delete thread via HTTP
    if (this.isResetCommand(message.text)) {
      try {
        await this.deleteThread(memoryThread);
        return { text: "✓ Thread reset. Starting fresh conversation." };
      } catch {
        return { text: "✓ No active thread to reset. Starting fresh conversation." };
      }
    }

    const cwd = options?.cwd ?? this.defaultCwd;
    const requestContext = new RequestContext();
    requestContext.set("cwd", cwd);
    requestContext.set("channelType", message.channelType);
    requestContext.set("channelId", message.channelId);
    requestContext.set("threadId", message.threadId || message.id);
    requestContext.set("threadKey", threadKey);
    requestContext.set("memoryThreadId", memoryThread);
    requestContext.set("memoryResource", resourceId);

    let messageText = message.text;
    if (message.attachments?.length) {
      try {
        const processed = await processMediaAttachments(message.attachments);
        messageText = formatMediaIntoMessage(message.text, processed);
      } catch (error) {
        logger.error({ error: String(error), threadKey }, "Media processing failed");
      }
    }

    const senderContext = message.sender.name ? `[User: ${message.sender.name}]\n` : "";
    const fullMessage = options?.context
      ? `${options.context}\n\n${senderContext}${messageText}`
      : `${senderContext}${messageText}`;

    const memoryConfig = {
      resource: resourceId,
      thread: memoryThread,
    };

    try {
      logger.info(
        {
          stage: "PRE_GENERATE",
          threadKey,
          memoryResource: memoryConfig.resource,
          memoryThread: memoryConfig.thread,
          messageLength: fullMessage.length,
        },
        "🚀 About to call agent via HTTP",
      );

      const response = await this.callAgentViaHttp(fullMessage, memoryConfig, {
        channelType: message.channelType,
        channelId: message.channelId,
        threadId: message.threadId || message.id,
        threadKey,
      });

      logger.info(
        {
          stage: "POST_GENERATE",
          threadKey,
          responseLength: response.text?.length || 0,
        },
        "✅ Agent response received",
      );

      // Extract attachments from tool results
      const attachments: OutboundAttachment[] = [];
      if (response.steps) {
        for (const step of response.steps) {
          if (step.toolResults) {
            for (const toolResult of step.toolResults) {
              const { toolName, result } = toolResult.payload;
              if (toolName === "text-to-speech" && result) {
                const ttsResult = result as {
                  success: boolean;
                  filePath?: string;
                  voiceCompatible?: boolean;
                };
                if (ttsResult.success && ttsResult.filePath) {
                  const ext = ttsResult.filePath.split(".").pop();
                  attachments.push({
                    type: "audio",
                    path: ttsResult.filePath,
                    mimeType: ext === "opus" ? "audio/ogg" : "audio/mpeg",
                    asVoice: ttsResult.voiceCompatible,
                  });
                }
              }
            }
          }
        }
      }

      return {
        text: response.text || "",
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    } catch (error) {
      const errorObj = error as any;
      const errorMessage = errorObj?.message || String(error);
      const errorCode = errorObj?.code;

      logger.error(
        {
          error: errorMessage,
          errorCode,
          threadKey,
        },
        "❌ Error generating response",
      );

      if (errorCode === "COMMAND_ABORTED") {
        return { text: "⚠️ Command was aborted. The operation has been cancelled." };
      }

      if (errorMessage.includes("Client connection prematurely closed")) {
        return { text: "⚠️ Connection interrupted. Please try again or rephrase your request." };
      }

      throw new Error("⚠️ An error occurred while processing your request. Please try again.");
    }
  }

  // ============================================================================
  // Mastra Memory API (HTTP-based)
  // Services use these methods to interact with Mastra threads
  // ============================================================================

  /**
   * List threads for a resource via Mastra HTTP API
   */
  async listThreads(resourceId: string): Promise<
    Array<{
      id: string;
      resourceId: string;
      title?: string;
      createdAt: string;
      updatedAt: string;
      metadata?: Record<string, unknown>;
    }>
  > {
    const url = `${this.mastraUrl}/api/memory/threads?resourceId=${encodeURIComponent(resourceId)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.GATEWAY_API_KEY) {
      headers.Authorization = `Bearer ${process.env.GATEWAY_API_KEY}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to list threads: ${response.status}`);
    }

    const data = await response.json();
    return data.threads || [];
  }

  /**
   * Get a thread by ID via Mastra HTTP API
   */
  async getThreadById(threadId: string): Promise<{
    id: string;
    resourceId: string;
    title?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
  } | null> {
    const url = `${this.mastraUrl}/api/memory/threads/${encodeURIComponent(threadId)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.GATEWAY_API_KEY) {
      headers.Authorization = `Bearer ${process.env.GATEWAY_API_KEY}`;
    }

    const response = await fetch(url, { headers });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to get thread: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get resource-scoped working memory via Mastra HTTP API
   */
  async getWorkingMemory(resourceId: string): Promise<string | null> {
    const url = `${this.mastraUrl}/api/memory/working-memory?resourceId=${encodeURIComponent(resourceId)}`;
    console.log(`[adapter.getWorkingMemory] Fetching working memory for resourceId=${resourceId}, url=${url}`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.GATEWAY_API_KEY) {
      headers.Authorization = `Bearer ${process.env.GATEWAY_API_KEY}`;
    }

    const response = await fetch(url, { headers });
    console.log(`[adapter.getWorkingMemory] Response status=${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[adapter.getWorkingMemory] ERROR: ${response.status} — ${errorText}`);
      throw new Error(`Failed to get working memory: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { workingMemory: string | null };
    const wm = data.workingMemory ?? null;
    console.log(
      `[adapter.getWorkingMemory] resourceId=${resourceId}, workingMemory returned=${wm !== null}, length=${wm?.length ?? 0}`,
    );
    return wm;
  }

  /**
   * Delete a thread via Mastra HTTP API
   */
  async deleteThread(threadId: string): Promise<void> {
    const url = `${this.mastraUrl}/api/memory/threads/${encodeURIComponent(threadId)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.GATEWAY_API_KEY) {
      headers.Authorization = `Bearer ${process.env.GATEWAY_API_KEY}`;
    }

    const response = await fetch(url, { method: "DELETE", headers });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete thread: ${response.status}`);
    }
  }

  /**
   * Get messages for a thread via Mastra HTTP API
   */
  async getThreadMessages(threadId: string): Promise<
    Array<{
      id: string;
      role: string;
      content: unknown;
      createdAt: string;
    }>
  > {
    const url = `${this.mastraUrl}/api/memory/threads/${encodeURIComponent(threadId)}/messages`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.GATEWAY_API_KEY) {
      headers.Authorization = `Bearer ${process.env.GATEWAY_API_KEY}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to get messages: ${response.status}`);
    }

    const data = await response.json();
    return data.messages || [];
  }

  /**
   * Get all messages for a resource via Mastra HTTP API
   *
   * Note: Mastra doesn't have a direct /memory/messages?resourceId endpoint.
   * This method lists all threads for the resource, then fetches messages for each.
   */
  async getMessagesByResource(resourceId: string): Promise<
    Array<{
      id: string;
      role: string;
      content: unknown;
      createdAt: string;
      threadId: string;
    }>
  > {
    const threads = await this.listThreads(resourceId);

    const allMessages: Array<{
      id: string;
      role: string;
      content: unknown;
      createdAt: string;
      threadId: string;
    }> = [];

    for (const thread of threads) {
      try {
        const messages = await this.getThreadMessages(thread.id);
        for (const msg of messages) {
          allMessages.push({
            ...msg,
            threadId: thread.id,
          });
        }
      } catch (error) {
        console.error(`[adapter] Failed to get messages for thread ${thread.id}:`, error);
      }
    }

    allMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return allMessages;
  }
}
