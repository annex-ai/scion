// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Configuration
 *
 * Loads heartbeat behavior settings from agent.toml [heartbeat] section.
 * Schedule (frequency) comes from CRON.md, not from config.
 */

import { z } from "zod";
import { type HeartbeatSection, getHeartbeatConfig, getServicesConfig } from "../../lib/config";

// ============================================================================
// Schemas
// ============================================================================

const prioritySchema = z.enum(["low", "medium", "high"]);

const notificationTargetSchema = z.object({
  type: z.enum(["slack", "telegram", "discord"]),
  target: z.string(),
});

const heartbeatConfigSchema = z.object({
  // Whether heartbeat is enabled (from [services].heartbeat)
  enabled: z.boolean().default(true),

  // Core settings
  quietMode: z.boolean().default(false),
  alertThreshold: z.number().default(1),

  // Active hours
  activeHoursStart: z.number().min(0).max(23).default(9),
  activeHoursEnd: z.number().min(0).max(23).default(21),
  timezone: z.string().default("UTC"),
  intervalMinutes: z.number().min(1).default(30),

  // Checks enabled
  checks: z
    .object({
      taskState: z.boolean().default(true),
      reminders: z.boolean().default(true),
      contextContinuity: z.boolean().default(true),
      backgroundTasks: z.boolean().default(true),
      messageHistory: z.boolean().default(true),
    })
    .default({
      taskState: true,
      reminders: true,
      contextContinuity: true,
      backgroundTasks: true,
      messageHistory: true,
    }),

  // Notification targets
  notificationTargets: z.array(notificationTargetSchema).default([]),
});

export type HeartbeatConfig = z.infer<typeof heartbeatConfigSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: HeartbeatConfig = {
  enabled: true,
  quietMode: false,
  alertThreshold: 1,
  activeHoursStart: 9,
  activeHoursEnd: 21,
  timezone: "UTC",
  intervalMinutes: 30,
  checks: {
    taskState: true,
    reminders: true,
    contextContinuity: true,
    backgroundTasks: true,
    messageHistory: true,
  },
  notificationTargets: [],
};

// ============================================================================
// Transformer
// ============================================================================

/**
 * Transform agent.toml heartbeat section to HeartbeatConfig format
 */
async function transformHeartbeatSection(section: HeartbeatSection): Promise<HeartbeatConfig> {
  // Resolve enabled from [services].heartbeat
  let enabled = true;
  try {
    const services = await getServicesConfig();
    enabled = services.heartbeat ?? true;
  } catch {
    // Default to true if services config not available
  }

  return {
    enabled,
    quietMode: section.quiet_mode,
    alertThreshold: section.alert_threshold,
    activeHoursStart: section.hours.start,
    activeHoursEnd: section.hours.end,
    timezone: section.hours.timezone,
    intervalMinutes: section.hours.interval_minutes,
    checks: {
      taskState: section.checks.task_state,
      reminders: section.checks.reminders,
      contextContinuity: section.checks.context_continuity,
      backgroundTasks: section.checks.background_tasks,
      messageHistory: section.checks.message_history ?? true,
    },
    notificationTargets: section.targets,
  };
}

// ============================================================================
// Main Loader
// ============================================================================

/**
 * Load heartbeat configuration from agent.toml
 *
 * Config structure in agent.toml:
 * ```toml
 * [heartbeat]
 * enabled = true
 * quiet_mode = false
 * alert_threshold = 1
 *
 * [heartbeat.hours]
 * start = 9
 * end = 21
 * timezone = "Asia/Bangkok"
 *
 * [heartbeat.checks]
 * task_state = true
 * reminders = true
 * context_continuity = true
 * background_tasks = true
 *
 * [[heartbeat.targets]]
 * type = "slack"
 * target = "#general"
 * ```
 */
export async function loadHeartbeatConfig(): Promise<HeartbeatConfig> {
  try {
    const section = await getHeartbeatConfig();
    const config = await transformHeartbeatSection(section);

    // Validate with Zod
    const validated = heartbeatConfigSchema.parse(config);

    console.log("[Heartbeat] Loaded config from agent.toml:", {
      activeHours: `${validated.activeHoursStart}:00-${validated.activeHoursEnd}:00`,
      timezone: validated.timezone,
      targets: validated.notificationTargets.length,
    });

    return validated;
  } catch (error) {
    console.error("[Heartbeat] Failed to load config from agent.toml:", error);
    console.log("[Heartbeat] Using defaults");
    return DEFAULT_CONFIG;
  }
}

/**
 * Get the default config (for testing or fallback)
 */
export function getDefaultConfig(): HeartbeatConfig {
  return { ...DEFAULT_CONFIG };
}
