// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Cron Types
 *
 * Types and Zod schemas for the croner-based CRON.md scheduling system.
 * Schedules are stored in CRON.md and managed by the interactive agent.
 */

import { z } from "zod";

/**
 * Thread mode for scheduled tasks
 * - 'shared': All runs share the same conversation history (default)
 * - 'isolated': Each run gets a fresh conversation
 */
export type ThreadMode = "shared" | "isolated";

/**
 * Target channel for scheduled message delivery
 */
export interface ScheduleTarget {
  /** Channel type (slack, telegram, etc.) */
  channelType: string;
  /** Channel ID (e.g., #channel-name or channel ID) */
  channelId: string;
  /** Optional thread ID for threaded conversations */
  threadId?: string;
}

/**
 * Workflow input for direct workflow execution
 */
export interface WorkflowInput {
  /** Workflow ID to execute */
  workflowId: string;
  /** Input data to pass to the workflow */
  inputData?: Record<string, unknown>;
}

/**
 * Schedule definition
 */
export interface Schedule {
  /** Unique identifier (from ## heading in CRON.md) */
  name: string;
  /** Croner cron expression */
  cron: string;
  /** Whether the schedule is enabled */
  enabled: boolean;
  /** Task/message for interactive agent (mutually exclusive with workflow) */
  message?: string;
  /** Workflow to execute directly (mutually exclusive with message) */
  workflow?: WorkflowInput;
  /** Target channel for delivery */
  target: ScheduleTarget;
  /** IANA timezone (default: UTC) */
  timezone?: string;
  /** Thread mode: 'shared' (default) or 'isolated' */
  threadMode?: ThreadMode;
}

/**
 * Zod schema for schedule target
 */
export const ScheduleTargetSchema = z.object({
  channelType: z.string().describe("Channel type (slack, telegram, etc.)"),
  channelId: z.string().describe("Channel ID (e.g., #channel-name)"),
  threadId: z.string().optional().describe("Thread ID for threaded conversations"),
});

/**
 * Zod schema for workflow input
 */
export const WorkflowInputSchema = z.object({
  workflowId: z.string().min(1).describe("Workflow ID to execute"),
  inputData: z.record(z.string(), z.unknown()).optional().describe("Input data for the workflow"),
});

/**
 * Zod schema for schedule
 */
export const ScheduleSchema = z.object({
  name: z.string().min(1).describe("Unique schedule name"),
  cron: z.string().min(1).describe("Croner cron expression"),
  enabled: z.boolean().default(true).describe("Whether schedule is enabled"),
  message: z.string().optional().describe("Task/message for interactive agent"),
  workflow: WorkflowInputSchema.optional().describe("Workflow to execute directly"),
  target: ScheduleTargetSchema,
  timezone: z.string().optional().describe("IANA timezone (default: UTC)"),
  threadMode: z.enum(["shared", "isolated"]).optional().describe("Thread mode: shared (default) or isolated"),
});

/**
 * Zod schema for array of schedules
 */
export const SchedulesSchema = z.array(ScheduleSchema);

/**
 * Parsed CRON.md result
 */
export interface CronMdResult {
  /** Parsed schedules */
  schedules: Schedule[];
  /** Parse errors (non-fatal) */
  errors: string[];
}

/**
 * Cron service configuration (legacy)
 *
 * @deprecated Use CronSection from agent.toml [cron] instead
 */
export interface CronConfig {
  /** Path to CRON.md file */
  cronMdPath: string;
  /** Hot reload polling interval in milliseconds (default: 30000) */
  pollInterval?: number;
  /** Whether to start cron service on initialization */
  autoStart?: boolean;
}

/**
 * Active schedule with croner job reference
 */
export interface ActiveSchedule {
  /** Schedule definition */
  schedule: Schedule;
  /** Croner job instance */
  job: unknown; // Croner type, kept as unknown to avoid import here
}
