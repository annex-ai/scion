// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Cron Module
 *
 * Croner-based scheduling system with CRON.md as the schedule storage.
 * Schedules are managed by the interactive agent via cron-manage tool.
 *
 * Note: This module only handles agent-defined CRON schedules from CRON.md.
 * For system-level scheduled tasks, see HeartbeatService and ReflectionService.
 */

// Types
export type {
  Schedule,
  ScheduleTarget,
  CronConfig,
  ActiveSchedule,
  CronMdResult,
} from "./types";

export { ScheduleSchema, ScheduleTargetSchema, SchedulesSchema } from "./types";

// Service
export {
  CronService,
  getCronService,
  createCronService,
  destroyCronService,
} from "./service";

// Executor
export {
  executeSchedule,
  createSyntheticMessage,
  registerChannel,
  unregisterChannel,
  clearChannels,
  getChannel,
} from "./executor";
