// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Pause/Resume Functionality
 *
 * Allows pausing heartbeat notifications with optional duration.
 */

import { z } from "zod";
import { type HeartbeatState, loadState, type PauseState, saveState } from "./state";

// ============================================================================
// Schemas
// ============================================================================

const pauseOptionsSchema = z.object({
  /** Duration in minutes (undefined = indefinite) */
  durationMinutes: z.number().optional(),
  /** Reason for pausing */
  reason: z.string().optional(),
});

export type PauseOptions = z.infer<typeof pauseOptionsSchema>;

// ============================================================================
// Functions
// ============================================================================

/**
 * Pause heartbeat notifications
 *
 * @param options - Pause configuration
 * @returns Updated pause state
 */
export async function pauseHeartbeat(options: PauseOptions = {}): Promise<PauseState> {
  const state = await loadState();

  const now = new Date();
  const resumeAt = options.durationMinutes
    ? new Date(now.getTime() + options.durationMinutes * 60 * 1000).toISOString()
    : undefined;

  const newPauseState: PauseState = {
    paused: true,
    pausedAt: now.toISOString(),
    resumeAt,
    reason: options.reason,
  };

  const newState: HeartbeatState = {
    ...state,
    pause: newPauseState,
  };

  await saveState(newState);

  const durationStr = resumeAt
    ? `for ${options.durationMinutes} minutes (until ${new Date(resumeAt).toLocaleTimeString()})`
    : "indefinitely";
  console.log(`[Heartbeat] Paused ${durationStr}${options.reason ? `: ${options.reason}` : ""}`);

  return newPauseState;
}

/**
 * Resume heartbeat notifications
 *
 * @returns Updated pause state
 */
export async function resumeHeartbeat(): Promise<PauseState> {
  const state = await loadState();

  const newPauseState: PauseState = {
    paused: false,
    pausedAt: undefined,
    resumeAt: undefined,
    reason: undefined,
  };

  const newState: HeartbeatState = {
    ...state,
    pause: newPauseState,
  };

  await saveState(newState);
  console.log("[Heartbeat] Resumed");

  return newPauseState;
}

/**
 * Get current pause status
 */
export async function getPauseStatus(): Promise<{
  paused: boolean;
  remainingMinutes?: number;
  pausedAt?: string;
  resumeAt?: string;
  reason?: string;
}> {
  const state = await loadState();
  const { pause } = state;

  // Check if auto-resume time has passed
  if (pause.paused && pause.resumeAt) {
    const resumeTime = new Date(pause.resumeAt);
    if (new Date() >= resumeTime) {
      // Auto-resume
      await resumeHeartbeat();
      return { paused: false };
    }

    // Calculate remaining time
    const remainingMs = resumeTime.getTime() - Date.now();
    const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));

    return {
      paused: true,
      remainingMinutes,
      pausedAt: pause.pausedAt,
      resumeAt: pause.resumeAt,
      reason: pause.reason,
    };
  }

  return {
    paused: pause.paused,
    pausedAt: pause.pausedAt,
    reason: pause.reason,
  };
}

/**
 * Check if heartbeat is currently paused
 * (Also handles auto-resume if pause duration has expired)
 */
export async function isPaused(): Promise<boolean> {
  const status = await getPauseStatus();
  return status.paused;
}

/**
 * Format pause status as human-readable string
 */
export function formatPauseStatus(status: Awaited<ReturnType<typeof getPauseStatus>>): string {
  if (!status.paused) {
    return "Heartbeat is active";
  }

  let message = "Heartbeat is paused";

  if (status.remainingMinutes !== undefined) {
    message += ` (${status.remainingMinutes} minutes remaining)`;
  } else {
    message += " indefinitely";
  }

  if (status.reason) {
    message += ` - Reason: ${status.reason}`;
  }

  return message;
}
