// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Module
 *
 * Note: The heartbeat workflow has been replaced by HeartbeatService in the gateway.
 * This file now only exports shared utilities (config, state, pause).
 *
 * For the service implementation, see:
 *   src/mastra/gateway/heartbeat/service.ts
 */

// Re-export shared utilities (used by both old and new implementations)
export {
  loadHeartbeatConfig,
  getDefaultConfig,
  type HeartbeatConfig,
} from "./heartbeat/config";

export {
  loadState,
  saveState,
  generateAlertKey,
  isAlertSuppressed,
  suppressAlert,
  cleanupExpiredSuppressions,
  updateDefaultChannel,
  getDefaultChannel,
  registerBackgroundTask,
  updateBackgroundTask,
  getIncompleteTasks,
  cleanupOldTasks,
  recordRun,
  type HeartbeatState,
  type SuppressedAlert,
  type DefaultChannel,
  type PauseState,
  type BackgroundTask,
} from "./heartbeat/state";

export {
  pauseHeartbeat,
  resumeHeartbeat,
  getPauseStatus,
  isPaused,
  formatPauseStatus,
} from "./heartbeat/pause";

// Note: heartbeatWorkflow export removed - use HeartbeatService via gateway
