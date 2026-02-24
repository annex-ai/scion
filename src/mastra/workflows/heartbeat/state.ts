// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat State Management
 *
 * File-based persistence for heartbeat state including:
 * - Alert suppression history (24h deduplication)
 * - Default notification channel
 * - Pause/resume state
 * - Background task tracking
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { AGENT_DIR } from "../../lib/config";
import { heartbeatLogger } from "./logger";

// ============================================================================
// Schemas
// ============================================================================

const suppressedAlertSchema = z.object({
  key: z.string(), // Unique alert identifier
  suppressedAt: z.string(), // ISO timestamp
  expiresAt: z.string(), // ISO timestamp (24h from suppressed)
  priority: z.enum(["low", "medium", "high"]),
});

const defaultChannelSchema = z.object({
  channelType: z.string(),
  channelId: z.string(),
  threadId: z.string().optional(),
  lastUpdated: z.string(),
});

const pauseStateSchema = z.object({
  paused: z.boolean(),
  pausedAt: z.string().optional(),
  resumeAt: z.string().optional(), // ISO timestamp or undefined for indefinite
  reason: z.string().optional(),
});

const backgroundTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  registeredAt: z.string(),
  completedAt: z.string().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
});

const heartbeatStateSchema = z.object({
  // Suppression history for deduplication
  suppressedAlerts: z.array(suppressedAlertSchema).default([]),

  // Default channel for notifications
  defaultChannel: defaultChannelSchema.optional(),

  // Pause state
  pause: pauseStateSchema.default({ paused: false }),

  // Background tasks
  backgroundTasks: z.array(backgroundTaskSchema).default([]),

  // Last heartbeat run
  lastRun: z.string().optional(),
  lastRunStatus: z.enum(["ok", "alert", "error", "skipped"]).optional(),
});

export type HeartbeatState = z.infer<typeof heartbeatStateSchema>;
export type SuppressedAlert = z.infer<typeof suppressedAlertSchema>;
export type DefaultChannel = z.infer<typeof defaultChannelSchema>;
export type PauseState = z.infer<typeof pauseStateSchema>;
export type BackgroundTask = z.infer<typeof backgroundTaskSchema>;

// ============================================================================
// Constants
// ============================================================================

const STATE_PATH = join(AGENT_DIR, "heartbeat-state.json");
const SUPPRESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULT_STATE: HeartbeatState = {
  suppressedAlerts: [],
  defaultChannel: undefined,
  pause: { paused: false },
  backgroundTasks: [],
  lastRun: undefined,
  lastRunStatus: undefined,
};

// ============================================================================
// Core State Operations
// ============================================================================

/**
 * Load heartbeat state from file
 */
export async function loadState(statePath = STATE_PATH): Promise<HeartbeatState> {
  if (!existsSync(statePath)) {
    heartbeatLogger.debug({ statePath }, "State file not found, using defaults");
    return { ...DEFAULT_STATE };
  }

  try {
    const content = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(content);
    const state = heartbeatStateSchema.parse(parsed);
    heartbeatLogger.debug(
      {
        statePath,
        suppressedAlerts: state.suppressedAlerts.length,
        backgroundTasks: state.backgroundTasks.length,
        lastRun: state.lastRun,
      },
      "State loaded from file",
    );
    return state;
  } catch (error) {
    heartbeatLogger.error(
      { statePath, error: error instanceof Error ? error.message : String(error) },
      "Failed to load state, using defaults",
    );
    return { ...DEFAULT_STATE };
  }
}

/**
 * Save heartbeat state to file
 */
export async function saveState(state: HeartbeatState, statePath = STATE_PATH): Promise<void> {
  try {
    // Ensure directory exists
    const dir = dirname(statePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      heartbeatLogger.debug({ dir }, "Created state directory");
    }

    await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
    heartbeatLogger.debug(
      {
        statePath,
        suppressedAlerts: state.suppressedAlerts.length,
        backgroundTasks: state.backgroundTasks.length,
      },
      "State saved to file",
    );
  } catch (error) {
    heartbeatLogger.error(
      { statePath, error: error instanceof Error ? error.message : String(error) },
      "Failed to save state",
    );
  }
}

// ============================================================================
// Suppression Operations
// ============================================================================

/**
 * Generate unique key for an alert (for deduplication)
 */
export function generateAlertKey(type: string, description: string): string {
  // Create a stable key from type and simplified description
  const normalized = description
    .toLowerCase()
    .replace(/\d+/g, "N") // Normalize numbers
    .replace(/[^a-z0-9]/g, "_")
    .slice(0, 100);
  return `${type}:${normalized}`;
}

/**
 * Check if an alert is currently suppressed
 */
export function isAlertSuppressed(
  state: HeartbeatState,
  alertKey: string,
  priority: "low" | "medium" | "high",
): boolean {
  // High priority alerts bypass suppression
  if (priority === "high") {
    return false;
  }

  const now = new Date().toISOString();
  const suppressed = state.suppressedAlerts.find((s) => s.key === alertKey && s.expiresAt > now);

  return !!suppressed;
}

/**
 * Add alert to suppression list
 */
export function suppressAlert(
  state: HeartbeatState,
  alertKey: string,
  priority: "low" | "medium" | "high",
): HeartbeatState {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SUPPRESSION_DURATION_MS);

  // Remove existing entry for this key
  const filtered = state.suppressedAlerts.filter((s) => s.key !== alertKey);

  return {
    ...state,
    suppressedAlerts: [
      ...filtered,
      {
        key: alertKey,
        suppressedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        priority,
      },
    ],
  };
}

/**
 * Clean up expired suppressions
 */
export function cleanupExpiredSuppressions(state: HeartbeatState): HeartbeatState {
  const now = new Date().toISOString();
  return {
    ...state,
    suppressedAlerts: state.suppressedAlerts.filter((s) => s.expiresAt > now),
  };
}

// ============================================================================
// Default Channel Operations
// ============================================================================

/**
 * Update default notification channel
 */
export function updateDefaultChannel(
  state: HeartbeatState,
  channelType: string,
  channelId: string,
  threadId?: string,
): HeartbeatState {
  return {
    ...state,
    defaultChannel: {
      channelType,
      channelId,
      threadId,
      lastUpdated: new Date().toISOString(),
    },
  };
}

/**
 * Get default channel (returns undefined if not set)
 */
export function getDefaultChannel(state: HeartbeatState): DefaultChannel | undefined {
  return state.defaultChannel;
}

// ============================================================================
// Background Task Operations
// ============================================================================

/**
 * Register a background task for monitoring
 */
export function registerBackgroundTask(state: HeartbeatState, id: string, name: string): HeartbeatState {
  // Remove existing task with same ID
  const filtered = state.backgroundTasks.filter((t) => t.id !== id);

  return {
    ...state,
    backgroundTasks: [
      ...filtered,
      {
        id,
        name,
        status: "pending",
        registeredAt: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Update background task status
 */
export function updateBackgroundTask(
  state: HeartbeatState,
  id: string,
  update: Partial<Pick<BackgroundTask, "status" | "result" | "error">>,
): HeartbeatState {
  return {
    ...state,
    backgroundTasks: state.backgroundTasks.map((task) => {
      if (task.id !== id) return task;
      return {
        ...task,
        ...update,
        completedAt:
          update.status === "completed" || update.status === "failed" ? new Date().toISOString() : task.completedAt,
      };
    }),
  };
}

/**
 * Get incomplete background tasks
 */
export function getIncompleteTasks(state: HeartbeatState): BackgroundTask[] {
  return state.backgroundTasks.filter((t) => t.status === "pending" || t.status === "running");
}

/**
 * Clean up old completed tasks (keep last 10)
 */
export function cleanupOldTasks(state: HeartbeatState): HeartbeatState {
  const incomplete = state.backgroundTasks.filter((t) => t.status === "pending" || t.status === "running");
  const completed = state.backgroundTasks
    .filter((t) => t.status === "completed" || t.status === "failed")
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""))
    .slice(0, 10);

  return {
    ...state,
    backgroundTasks: [...incomplete, ...completed],
  };
}

// ============================================================================
// Last Run Operations
// ============================================================================

/**
 * Record heartbeat run
 */
export function recordRun(state: HeartbeatState, status: "ok" | "alert" | "error" | "skipped"): HeartbeatState {
  return {
    ...state,
    lastRun: new Date().toISOString(),
    lastRunStatus: status,
  };
}
