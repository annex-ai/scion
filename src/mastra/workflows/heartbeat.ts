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
  getDefaultConfig,
  type HeartbeatConfig,
  loadHeartbeatConfig,
} from "./heartbeat/config";
export {
  formatPauseStatus,
  getPauseStatus,
  isPaused,
  pauseHeartbeat,
  resumeHeartbeat,
} from "./heartbeat/pause";
export {
  type BackgroundTask,
  cleanupExpiredSuppressions,
  cleanupOldTasks,
  type DefaultChannel,
  generateAlertKey,
  getDefaultChannel,
  getIncompleteTasks,
  type HeartbeatState,
  isAlertSuppressed,
  loadState,
  type PauseState,
  recordRun,
  registerBackgroundTask,
  type SuppressedAlert,
  saveState,
  suppressAlert,
  updateBackgroundTask,
  updateDefaultChannel,
} from "./heartbeat/state";

// Note: heartbeatWorkflow export removed - use HeartbeatService via gateway
