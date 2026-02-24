// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Thread Cleanup for Scheduler
 *
 * Provides TTL-based cleanup for isolated scheduler threads.
 * Isolated threads are automatically deleted after a configurable
 * period of inactivity (configured in agent.toml).
 *
 * Shared threads are preserved indefinitely.
 */

import type { GatewayToMastraAdapter } from "../adapter";
import { extractScheduleNameFromThreadId, isIsolatedThreadId } from "./thread-utils";

let cleanupTimer: NodeJS.Timeout | null = null;
let cleanupIntervalMs = 3600000; // Default: 1 hour

/**
 * Clean up expired isolated scheduler threads
 *
 * Only isolated threads (with `:isolated:` in the ID) are cleaned up.
 * Shared threads are preserved indefinitely.
 *
 * @param adapter - GatewayToMastraAdapter for HTTP calls
 * @param resourceId - Resource ID to scope thread queries
 * @param ttlDays - TTL in days (from agent.toml scheduler.thread_ttl_days)
 * @returns Object with cleanup count and affected schedule names
 */
export async function cleanupExpiredThreads(
  adapter: GatewayToMastraAdapter,
  resourceId: string,
  ttlDays: number,
): Promise<{ cleaned: number; schedules: string[] }> {
  const now = new Date();
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;

  let cleaned = 0;
  const affectedSchedules = new Set<string>();

  // Query all threads for this resource from Mastra via HTTP
  const threads = await adapter.listThreads(resourceId);

  for (const thread of threads) {
    // Only clean up scheduler threads
    if (!thread.id.startsWith("thread_schedule_")) continue;

    // Only clean up isolated threads - shared threads are preserved
    if (!isIsolatedThreadId(thread.id)) continue;

    // Check last active time from metadata or updatedAt
    const lastActiveAt = thread.metadata?.lastActiveAt || thread.updatedAt;
    const lastActive = new Date(lastActiveAt as any);
    const age = now.getTime() - lastActive.getTime();

    if (age > ttlMs) {
      const scheduleName = extractScheduleNameFromThreadId(thread.id);

      // Delete the thread via Mastra HTTP API
      try {
        await adapter.deleteThread(thread.id);
        cleaned++;
        if (scheduleName) affectedSchedules.add(scheduleName);
      } catch (error) {
        console.error(`[scheduler-cleanup] Failed to delete thread ${thread.id}:`, error);
      }
    }
  }

  if (cleaned > 0) {
    console.log(`[scheduler-cleanup] Cleaned ${cleaned} expired isolated thread(s)`);
    if (affectedSchedules.size > 0) {
      console.log(`[scheduler-cleanup] Affected schedules: ${Array.from(affectedSchedules).join(", ")}`);
    }
  }

  return {
    cleaned,
    schedules: Array.from(affectedSchedules),
  };
}

/**
 * Start the periodic cleanup timer
 *
 * Runs cleanup immediately, then schedules periodic checks.
 * Only one timer can be active at a time.
 *
 * @param adapter - GatewayToMastraAdapter for HTTP calls
 * @param resourceId - Resource ID to scope thread queries
 * @param ttlDays - TTL in days (from agent.toml cron.thread_ttl_days)
 * @param cleanupInterval - Cleanup interval in ms (from agent.toml cron.cleanup_interval_ms)
 */
export async function startCleanupTimer(
  adapter: GatewayToMastraAdapter,
  resourceId: string,
  ttlDays: number,
  cleanupInterval: number,
): Promise<void> {
  if (cleanupTimer) {
    console.log("[scheduler-cleanup] Timer already running");
    return;
  }

  cleanupIntervalMs = cleanupInterval;

  const intervalHours = (cleanupIntervalMs / 3600000).toFixed(1);
  console.log(`[scheduler-cleanup] Starting cleanup timer (TTL: ${ttlDays} days, interval: ${intervalHours} hours)`);

  // Schedule periodic cleanup (skip startup run — Mastra server may not be ready yet)
  cleanupTimer = setInterval(() => {
    cleanupExpiredThreads(adapter, resourceId, ttlDays).catch((error) => {
      console.error("[scheduler-cleanup] Periodic cleanup failed:", error);
    });
  }, cleanupIntervalMs);

  // Don't keep the process alive just for cleanup
  cleanupTimer.unref();
}

/**
 * Stop the cleanup timer
 */
export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log("[scheduler-cleanup] Timer stopped");
  }
}

/**
 * Check if cleanup timer is running
 */
export function isCleanupTimerRunning(): boolean {
  return cleanupTimer !== null;
}
