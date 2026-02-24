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

// Executor
export {
  clearChannels,
  createSyntheticMessage,
  executeSchedule,
  getChannel,
  registerChannel,
  unregisterChannel,
} from "./executor";
// Service
export {
  CronService,
  createCronService,
  destroyCronService,
  getCronService,
} from "./service";
// Types
export type {
  ActiveSchedule,
  CronConfig,
  CronMdResult,
  Schedule,
  ScheduleTarget,
} from "./types";
export { ScheduleSchema, SchedulesSchema, ScheduleTargetSchema } from "./types";
