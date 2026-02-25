// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Harness Manager
 *
 * Manages a singleton Harness instance for the Mastra server.
 * The gateway communicates with this harness via HTTP endpoints,
 * avoiding multiple Mastra instances and memory leaks from MCP tools.
 *
 * Architecture:
 * - Single Harness instance per server process
 * - HTTP endpoints for gateway communication
 * - SSE for streaming responses and events back to gateway
 * - Thread-per-channel isolation (same as before)
 */

import type { Harness } from "@mastra/core/harness";
import type { HarnessState, stateSchema } from "./harness";
import { createAgentHarness } from "./harness";

// Singleton harness instance
let harnessInstance: Harness<typeof stateSchema> | null = null;
let harnessInitPromise: Promise<Harness<typeof stateSchema>> | null = null;

/**
 * Get or create the singleton harness instance.
 * Thread-safe: multiple concurrent calls will get the same instance.
 */
export async function getHarness(): Promise<Harness<typeof stateSchema>> {
  if (harnessInstance) {
    return harnessInstance;
  }

  // If initialization is in progress, wait for it
  if (harnessInitPromise) {
    return harnessInitPromise;
  }

  // Start initialization
  harnessInitPromise = (async () => {
    console.log("[harness-manager] Initializing singleton harness...");
    const { harness } = await createAgentHarness();
    await harness.init();
    harnessInstance = harness;
    console.log("[harness-manager] Harness initialized successfully");
    return harness;
  })();

  try {
    const harness = await harnessInitPromise;
    return harness;
  } catch (error) {
    // Reset on failure so next call can retry
    harnessInitPromise = null;
    throw error;
  }
}

/**
 * Check if harness is initialized
 */
export function isHarnessInitialized(): boolean {
  return harnessInstance !== null;
}

/**
 * Get harness instance without initializing (returns null if not ready)
 */
export function getHarnessIfReady(): Harness<typeof stateSchema> | null {
  return harnessInstance;
}

/**
 * Thread context for harness operations
 * Maps channel-specific thread IDs to harness thread IDs
 */
export interface ThreadContext {
  channelType: string;
  channelId: string;
  threadId?: string;
  threadKey: string;
  harnessThreadId: string;
}

/**
 * Generate a deterministic harness thread ID from channel info.
 * Same format as GatewayToMastraAdapter.generateThreadId()
 */
export function generateHarnessThreadId(
  channelType: string,
  channelId: string,
  threadId?: string,
): string {
  const parts = [channelType, channelId, threadId].filter(Boolean);
  const sanitized = parts.join("_").replace(/[^a-zA-Z0-9]/g, "_");
  return `thread_${sanitized}`;
}

/**
 * Event emitter for harness events (tool approval, streaming, etc.)
 * Subscribers are registered per-thread for targeted delivery
 */
type HarnessEventCallback = (event: HarnessEvent) => void;

export interface HarnessEvent {
  type:
    | "message_start"
    | "message_chunk"
    | "message_complete"
    | "tool_approval_required"
    | "tool_execution_start"
    | "tool_execution_complete"
    | "error"
    | "state_changed";
  threadId: string;
  data: unknown;
}

const threadSubscribers = new Map<string, Set<HarnessEventCallback>>();

/**
 * Subscribe to events for a specific thread
 */
export function subscribeToThread(
  threadId: string,
  callback: HarnessEventCallback,
): () => void {
  if (!threadSubscribers.has(threadId)) {
    threadSubscribers.set(threadId, new Set());
  }
  const subscribers = threadSubscribers.get(threadId)!;
  subscribers.add(callback);

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      threadSubscribers.delete(threadId);
    }
  };
}

/**
 * Emit an event to all subscribers of a thread
 */
export function emitThreadEvent(event: HarnessEvent): void {
  const subscribers = threadSubscribers.get(event.threadId);
  if (subscribers) {
    for (const callback of subscribers) {
      try {
        callback(event);
      } catch (error) {
        console.error("[harness-manager] Error in event subscriber:", error);
      }
    }
  }
}

/**
 * Get all active thread subscriptions (for debugging)
 */
export function getActiveSubscriptions(): string[] {
  return Array.from(threadSubscribers.keys());
}
