// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Thread Utilities for Scheduler
 *
 * Provides utilities for managing scheduler thread IDs and channel IDs.
 * Supports both shared and isolated thread modes.
 *
 * Thread ID Patterns (derived from channelId):
 * - Shared:   thread_schedule_Daily_Report
 * - Isolated: thread_schedule_isolated_Daily_Report_uuid
 */

import { randomUUID } from "node:crypto";
import type { Schedule, ThreadMode } from "./types";

const ISOLATED_PREFIX = "isolated";

/**
 * Generate channel ID for schedule execution
 *
 * @param schedule - The schedule to generate a channel ID for
 * @returns Channel ID string
 *
 * @example
 * // Shared mode
 * generateScheduleChannelId({ name: 'Daily Report', threadMode: 'shared' })
 * // => 'schedule:Daily_Report'
 *
 * @example
 * // Isolated mode
 * generateScheduleChannelId({ name: 'Daily Report', threadMode: 'isolated' })
 * // => 'schedule:isolated:Daily_Report:550e8400-e29b-41d4-a716-446655440000'
 */
export function generateScheduleChannelId(schedule: Schedule): string {
  const baseName = schedule.name.replace(/\s+/g, "_");

  if (schedule.threadMode === "isolated") {
    return `schedule:${ISOLATED_PREFIX}:${baseName}:${randomUUID()}`;
  }
  return `schedule:${baseName}`;
}

/**
 * Generate the base thread ID for a schedule (used for shared threads)
 *
 * @param scheduleName - Name of the schedule
 * @returns Thread ID string
 */
export function getScheduleThreadId(scheduleName: string): string {
  const baseName = scheduleName.replace(/\s+/g, "_");
  return `thread_schedule_${baseName}`;
}

/**
 * Check if a thread ID belongs to a schedule (shared or isolated)
 *
 * @param threadId - The thread ID to check
 * @param scheduleName - Name of the schedule
 * @returns true if the thread belongs to the schedule
 */
export function isScheduleThread(threadId: string, scheduleName: string): boolean {
  const baseName = scheduleName.replace(/\s+/g, "_");
  const sharedPattern = `thread_schedule_${baseName}`;
  const isolatedPattern = `thread_schedule_${ISOLATED_PREFIX}_${baseName}_`;

  return threadId === sharedPattern || threadId.startsWith(isolatedPattern);
}

/**
 * Check if a thread ID is an isolated thread
 *
 * @param threadId - The thread ID to check
 * @returns true if the thread is isolated
 */
export function isIsolatedThreadId(threadId: string): boolean {
  return threadId.includes(`_${ISOLATED_PREFIX}_`);
}

/**
 * Extract schedule name from a thread ID (best effort)
 *
 * @param threadId - The thread ID to extract from
 * @returns Schedule name or null if not extractable
 *
 * @example
 * // Shared thread
 * extractScheduleNameFromThreadId('thread_schedule_Daily_Report')
 * // => 'Daily Report'
 *
 * @example
 * // Isolated thread
 * extractScheduleNameFromThreadId('thread_schedule_isolated_Daily_Report_uuid')
 * // => 'Daily Report'
 */
export function extractScheduleNameFromThreadId(threadId: string): string | null {
  // Patterns:
  // Shared:   thread_schedule_Daily_Report
  // Isolated: thread_schedule_isolated_Daily_Report_uuid

  if (!threadId.startsWith("thread_schedule_")) return null;

  // Remove prefix
  const withoutPrefix = threadId.slice("thread_schedule_".length);

  // Check if this is an isolated thread (has 'isolated' marker)
  if (withoutPrefix.startsWith(`${ISOLATED_PREFIX}_`)) {
    // Format: isolated_Schedule_Name_uuid
    const parts = withoutPrefix.slice(ISOLATED_PREFIX.length + 1).split("_");
    // Last part is UUID, rest is schedule name
    if (parts.length < 2) return null;
    return parts.slice(0, -1).join(" ").replace(/_/g, " ");
  }
  // Format: Schedule_Name
  return withoutPrefix.replace(/_/g, " ");
}

/**
 * Get the thread mode from a thread ID
 *
 * @param threadId - The thread ID to check
 * @returns 'isolated' or 'shared'
 */
export function getThreadModeFromId(threadId: string): ThreadMode {
  return isIsolatedThreadId(threadId) ? "isolated" : "shared";
}
