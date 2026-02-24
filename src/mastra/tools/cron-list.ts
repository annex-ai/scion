// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Cron List Tool
 *
 * Tool for the interactive agent to list all scheduled tasks.
 * Shows schedule details and next run times.
 */

import { createTool } from "@mastra/core/tools";
import { Cron } from "croner";
import { z } from "zod";
import { loadCronMd } from "../gateway/loaders/cron-md-loader";
import { getCronConfig, resolveConfigPath } from "../lib/config/agent-config";

/**
 * Get the CRON.md path from config, resolving relative to agent.toml directory
 */
async function getCronMdPath(): Promise<string> {
  const config = await getCronConfig();
  return resolveConfigPath(config.cron_md_path);
}

/**
 * Calculate next run time for a cron expression
 */
function getNextRun(cron: string, timezone?: string): Date | null {
  try {
    const job = new Cron(cron, { timezone, paused: true });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch {
    return null;
  }
}

/**
 * Format a date for display
 */
function formatDate(date: Date | null): string {
  if (!date) return "never";

  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const diffMinutes = Math.round(diff / 60000);
  const diffHours = Math.round(diff / 3600000);
  const diffDays = Math.round(diff / 86400000);

  let relative: string;
  if (diffMinutes < 1) {
    relative = "now";
  } else if (diffMinutes < 60) {
    relative = `in ${diffMinutes} min`;
  } else if (diffHours < 24) {
    relative = `in ${diffHours} hour${diffHours > 1 ? "s" : ""}`;
  } else {
    relative = `in ${diffDays} day${diffDays > 1 ? "s" : ""}`;
  }

  return `${date.toISOString()} (${relative})`;
}

export const cronListTool = createTool({
  id: "cron-list",
  inputSchema: z.object({
    filter: z.enum(["all", "enabled", "disabled"]).optional().default("all").describe("Filter schedules by status"),
  }),
  outputSchema: z.object({
    schedules: z.array(
      z.object({
        name: z.string(),
        cron: z.string(),
        enabled: z.boolean(),
        message: z.string(),
        target: z.string(),
        timezone: z.string().nullable(),
        nextRun: z.string(),
        threadMode: z.enum(["shared", "isolated"]),
      }),
    ),
    total: z.number(),
    enabled: z.number(),
    disabled: z.number(),
    errors: z.array(z.string()),
  }),
  description: `List all scheduled tasks from CRON.md with their next run times.
Shows schedule name, cron expression, enabled status, message, target channel, timezone, session mode, and next scheduled run.
Use filter to show only enabled or disabled schedules.`,

  execute: async ({ filter }, _context: any) => {
    try {
      const cronMdPath = await getCronMdPath();

      // Load schedules
      const { schedules, errors } = await loadCronMd(cronMdPath);

      // Filter if requested
      let filtered = schedules;
      if (filter === "enabled") {
        filtered = schedules.filter((s) => s.enabled);
      } else if (filter === "disabled") {
        filtered = schedules.filter((s) => !s.enabled);
      }

      // Build result with next run times
      const result = filtered.map((schedule) => {
        const nextRun = schedule.enabled ? getNextRun(schedule.cron, schedule.timezone) : null;

        return {
          name: schedule.name,
          cron: schedule.cron,
          enabled: schedule.enabled,
          message: schedule.message,
          target: `${schedule.target.channelType} ${schedule.target.channelId}${schedule.target.threadId ? ` (thread: ${schedule.target.threadId})` : ""}`,
          timezone: schedule.timezone ?? null,
          nextRun: schedule.enabled ? formatDate(nextRun) : "disabled",
          threadMode: schedule.threadMode ?? "shared",
        };
      });

      return {
        schedules: result,
        total: schedules.length,
        enabled: schedules.filter((s) => s.enabled).length,
        disabled: schedules.filter((s) => !s.enabled).length,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        schedules: [],
        total: 0,
        enabled: 0,
        disabled: 0,
        errors: [message],
      };
    }
  },
});
