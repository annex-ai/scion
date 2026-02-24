// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Module
 *
 * Direct in-process heartbeat implementation for the Gateway.
 *
 * Usage:
 * ```typescript
 * import { createHeartbeatService } from './heartbeat';
 *
 * const heartbeat = createHeartbeatService({
 *   memory: sharedMemory,
 *   resourceId: 'default'
 * });
 *
 * await heartbeat.start();  // Starts CRON schedule
 * await heartbeat.stop();   // Stops CRON schedule
 *
 * // Manual check
 * const result = await heartbeat.runCheck({ force: true });
 * ```
 */

export {
  HeartbeatService,
  createHeartbeatService,
  type HeartbeatServiceConfig,
  type HeartbeatResult,
  type AlertItem,
} from "./service";
