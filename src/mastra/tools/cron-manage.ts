// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Cron Manage Tool
 *
 * Tool for the interactive agent to manage scheduled tasks in CRON.md.
 * Supports add, update, remove, enable, and disable operations.
 */

import * as fs from "node:fs/promises";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Schedule } from "../gateway/cron/types";
import { clearCronMdCache, generateCronMd, loadCronMd } from "../gateway/loaders/cron-md-loader";
import { getCronConfig, resolveConfigPath } from "../lib/config/agent-config";

/**
 * Get the CRON.md path from config, resolving relative to agent.toml directory
 */
async function getCronMdPath(): Promise<string> {
  const config = await getCronConfig();
  return resolveConfigPath(config.cron_md_path);
}

/**
 * Validate cron expression (basic validation)
 */
function isValidCron(cron: string): boolean {
  // Basic validation: check for 5-6 space-separated parts
  const parts = cron.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

export const cronManageTool = createTool({
  id: "cron-manage",
  inputSchema: z.object({
    operation: z
      .enum(["add", "update", "remove", "enable", "disable", "reset-session"])
      .describe("Operation to perform"),
    name: z.string().min(1).describe("Schedule name (unique identifier)"),
    cron: z
      .string()
      .optional()
      .describe(
        'Cron expression (required for add/update). Examples: "0 9 * * 1-5" (9 AM weekdays), "*/30 * * * *" (every 30 min)',
      ),
    message: z.string().optional().describe("Task/message for the agent to execute when triggered (required for add)"),
    targetChannelType: z.string().optional().describe("Target channel type: slack, telegram, etc."),
    targetChannelId: z
      .string()
      .optional()
      .describe("Target channel ID: #channel-name or channel ID"),
    targetThreadId: z.string().optional().describe("Target thread ID for threaded conversations (optional)"),
    timezone: z.string().optional().describe('IANA timezone, e.g., "America/New_York" (optional, defaults to UTC)'),
    sessionMode: z
      .enum(["shared", "isolated"])
      .optional()
      .describe(
        "Session mode: shared (default, maintains context across runs) or isolated (fresh conversation each run)",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether the operation succeeded"),
    message: z.string().describe("Result message"),
    schedule: z
      .object({
        name: z.string(),
        cron: z.string(),
        enabled: z.boolean(),
        message: z.string().optional(),
        target: z.object({
          channelType: z.string(),
          channelId: z.string(),
          threadId: z.string().optional(),
        }),
        timezone: z.string().optional(),
        threadMode: z.enum(["shared", "isolated"]).optional(),
      })
      .optional()
      .describe("The schedule that was created/updated"),
    scheduleCount: z.number().describe("Total number of schedules after operation"),
    sessionsDeleted: z.number().optional().describe("Number of sessions deleted (for remove/reset-session operations)"),
  }),
  description: `Manage scheduled tasks in CRON.md. Operations:
- add: Create a new schedule (requires name, cron, message)
- update: Modify an existing schedule (only provide fields to change)
- remove: Delete a schedule by name (also cleans up associated sessions)
- enable: Enable a disabled schedule
- disable: Disable a schedule without removing it
- reset-session: Clear conversation history for a schedule (next run starts fresh)

Target channel:
- Omit target → defaults to agent notification (agent processes and acts on the message)
- Explicit target (e.g., slack #channel) → delivers result to that channel after agent processes

Session modes:
- shared (default): All runs share the same conversation history
- isolated: Each run gets a fresh conversation (no memory pollution)

Cron expression examples:
- "0 9 * * 1-5" - 9 AM on weekdays
- "0 17 * * 5" - 5 PM on Friday
- "*/30 * * * *" - Every 30 minutes
- "0 0 * * *" - Midnight daily`,

  execute: async (inputData, context) => {
    let { operation, name, cron, message, targetChannelType, targetChannelId, targetThreadId, timezone, sessionMode } =
      inputData;
    const cronMdPath = await getCronMdPath();

    // Load existing schedules
    const { schedules, errors } = await loadCronMd(cronMdPath);

    // Find existing schedule
    const existingIndex = schedules.findIndex((s) => s.name === name);
    const existing = existingIndex >= 0 ? schedules[existingIndex] : null;

    let result: {
      success: boolean;
      message: string;
      schedule?: any;
      scheduleCount: number;
      sessionsDeleted?: number;
    };

    switch (operation) {
      case "add": {
        if (existing) {
          return {
            success: false,
            message: `Schedule "${name}" already exists. Use 'update' to modify it.`,
            scheduleCount: schedules.length,
          };
        }

        // Validate required fields
        if (!cron) {
          return {
            success: false,
            message: "Missing required field: cron",
            scheduleCount: schedules.length,
          };
        }
        if (!message) {
          return {
            success: false,
            message: "Missing required field: message",
            scheduleCount: schedules.length,
          };
        }
        // Auto-detect target channel when both are omitted
        if (!targetChannelType && !targetChannelId) {
          const rc = context?.requestContext;
          const detectedType = rc?.get("channelType") as string | undefined;
          const detectedId = rc?.get("channelId") as string | undefined;

          if (detectedType && detectedId && detectedType !== "scheduler") {
            targetChannelType = detectedType;
            targetChannelId = detectedId;
            // Also capture threadId for threaded conversations
            targetThreadId = targetThreadId || (rc?.get("threadId") as string | undefined);
          } else {
            // Default to agent notification
            targetChannelType = "agent";
            targetChannelId = "self";
          }
        } else if (!targetChannelType || !targetChannelId) {
          // One provided without the other is an error
          return {
            success: false,
            message:
              "Both targetChannelType and targetChannelId must be provided together, or omit both for auto-detection",
            scheduleCount: schedules.length,
          };
        }

        // Validate cron expression
        if (!isValidCron(cron)) {
          return {
            success: false,
            message: `Invalid cron expression: "${cron}". Expected 5-6 space-separated fields.`,
            scheduleCount: schedules.length,
          };
        }

        const newSchedule: Schedule = {
          name,
          cron,
          enabled: true,
          message,
          target: {
            channelType: targetChannelType,
            channelId: targetChannelId,
            threadId: targetThreadId,
          },
          timezone,
          threadMode: sessionMode === "isolated" ? "isolated" : undefined,
        };

        schedules.push(newSchedule);
        result = {
          success: true,
          message: `Schedule "${name}" created successfully`,
          schedule: newSchedule,
          scheduleCount: schedules.length,
        };
        break;
      }

      case "update": {
        if (!existing) {
          return {
            success: false,
            message: `Schedule "${name}" not found. Use 'add' to create it.`,
            scheduleCount: schedules.length,
          };
        }

        // Validate cron if provided
        if (cron && !isValidCron(cron)) {
          return {
            success: false,
            message: `Invalid cron expression: "${cron}". Expected 5-6 space-separated fields.`,
            scheduleCount: schedules.length,
          };
        }

        // Update fields that are provided
        const updated: Schedule = {
          ...existing,
          cron: cron ?? existing.cron,
          message: message ?? existing.message,
          target: {
            channelType: targetChannelType ?? existing.target.channelType,
            channelId: targetChannelId ?? existing.target.channelId,
            threadId: targetThreadId ?? existing.target.threadId,
          },
          timezone: timezone ?? existing.timezone,
          threadMode:
            sessionMode !== undefined ? (sessionMode === "isolated" ? "isolated" : undefined) : existing.threadMode,
        };

        schedules[existingIndex] = updated;
        result = {
          success: true,
          message: `Schedule "${name}" updated successfully`,
          schedule: updated,
          scheduleCount: schedules.length,
        };
        break;
      }

      case "remove": {
        if (!existing) {
          return {
            success: false,
            message: `Schedule "${name}" not found`,
            scheduleCount: schedules.length,
          };
        }

        // Clean up sessions before removing schedule
        const { getCronService } = await import("../gateway/cron/service");
        const cronService = getCronService();
        let sessionsDeleted = 0;

        if (cronService) {
          sessionsDeleted = await cronService.cleanupScheduleThreads(name);
        }

        schedules.splice(existingIndex, 1);
        result = {
          success: true,
          message: `Schedule "${name}" removed successfully${sessionsDeleted > 0 ? ` and cleaned up ${sessionsDeleted} session(s)` : ""}`,
          scheduleCount: schedules.length,
          sessionsDeleted: sessionsDeleted > 0 ? sessionsDeleted : undefined,
        };
        break;
      }

      case "reset-session": {
        const { getCronService } = await import("../gateway/cron/service");
        const cronService = getCronService();

        if (!cronService) {
          return {
            success: false,
            message: "Cron service not running. Cannot reset session.",
            scheduleCount: schedules.length,
          };
        }

        const resetResult = await cronService.resetScheduleThreads(name);
        return {
          success: resetResult.success,
          message: resetResult.message,
          scheduleCount: schedules.length,
          sessionsDeleted: resetResult.threadsDeleted,
        };
      }

      case "enable": {
        if (!existing) {
          return {
            success: false,
            message: `Schedule "${name}" not found`,
            scheduleCount: schedules.length,
          };
        }

        if (existing.enabled) {
          return {
            success: true,
            message: `Schedule "${name}" is already enabled`,
            schedule: existing,
            scheduleCount: schedules.length,
          };
        }

        existing.enabled = true;
        schedules[existingIndex] = existing;
        result = {
          success: true,
          message: `Schedule "${name}" enabled successfully`,
          schedule: existing,
          scheduleCount: schedules.length,
        };
        break;
      }

      case "disable": {
        if (!existing) {
          return {
            success: false,
            message: `Schedule "${name}" not found`,
            scheduleCount: schedules.length,
          };
        }

        if (!existing.enabled) {
          return {
            success: true,
            message: `Schedule "${name}" is already disabled`,
            schedule: existing,
            scheduleCount: schedules.length,
          };
        }

        existing.enabled = false;
        schedules[existingIndex] = existing;
        result = {
          success: true,
          message: `Schedule "${name}" disabled successfully`,
          schedule: existing,
          scheduleCount: schedules.length,
        };
        break;
      }

      default:
        return {
          success: false,
          message: `Unknown operation: ${operation}`,
          scheduleCount: schedules.length,
        };
    }

    // Write updated CRON.md
    try {
      const content = generateCronMd(schedules);
      await fs.writeFile(cronMdPath, content, "utf-8");

      // Clear cache so scheduler picks up changes on next poll
      clearCronMdCache();

      return result;
    } catch (error) {
      return {
        success: false,
        message: `Failed to write CRON.md: ${error instanceof Error ? error.message : String(error)}`,
        scheduleCount: schedules.length,
      };
    }
  },
});
