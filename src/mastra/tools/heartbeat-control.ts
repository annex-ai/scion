// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Control Tool
 *
 * Allows the agent to control the heartbeat system:
 * - Run a heartbeat check manually
 * - Pause/resume heartbeat notifications
 * - Check heartbeat status
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGatewayInstance } from "../gateway/integration";
import { formatPauseStatus, getPauseStatus, loadState, pauseHeartbeat, resumeHeartbeat } from "../workflows/heartbeat";

export const heartbeatControlTool = createTool({
  id: "heartbeat-control",
  description: `Control the heartbeat notification system. Use this to:
- Run a manual heartbeat check (action: "run")
- Pause notifications for a duration or indefinitely (action: "pause")
- Resume paused notifications (action: "resume")
- Check current heartbeat status (action: "status")`,
  inputSchema: z.object({
    action: z.enum(["run", "pause", "resume", "status"]).describe("The action to perform"),
    durationMinutes: z.number().optional().describe("For pause: duration in minutes (omit for indefinite)"),
    reason: z.string().optional().describe("For pause: reason for pausing"),
    force: z.boolean().optional().describe("For run: bypass active hours and pause checks"),
    resourceId: z.string().optional().describe("For run: resource ID to check (defaults to current user)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.any().optional(),
  }),

  execute: async ({ action, durationMinutes, reason, force, resourceId }) => {
    try {
      switch (action) {
        case "run": {
          // Call heartbeat service directly (same process)
          const gateway = getGatewayInstance();
          if (!gateway) {
            return {
              success: false,
              message: "Gateway not initialized",
            };
          }

          const heartbeatService = gateway.getHeartbeatService();
          if (!heartbeatService) {
            return {
              success: false,
              message: "Heartbeat service not available",
            };
          }

          if (resourceId !== undefined && !resourceId) {
            return { success: false, message: "resourceId cannot be null or empty" };
          }

          const result = await heartbeatService.runCheck({
            ...(resourceId ? { resourceId } : {}),
            force: force ?? true, // Default to force for manual runs
          });

          return {
            success: result.status !== "HEARTBEAT_ERROR",
            message: `Heartbeat check completed: ${result.status} — ${result.summary}`,
            data: {
              status: result.status,
              items: result.items?.length || 0,
              delivered: result.delivered,
              summary: result.summary,
              checkedAt: result.checkedAt,
            },
          };
        }

        case "pause": {
          const pauseState = await pauseHeartbeat({
            durationMinutes,
            reason,
          });

          const durationStr = durationMinutes ? `for ${durationMinutes} minutes` : "indefinitely";

          return {
            success: true,
            message: `Heartbeat paused ${durationStr}${reason ? ` (${reason})` : ""}`,
            data: pauseState,
          };
        }

        case "resume": {
          const pauseState = await resumeHeartbeat();

          return {
            success: true,
            message: "Heartbeat resumed",
            data: pauseState,
          };
        }

        case "status": {
          const pauseStatus = await getPauseStatus();
          const state = await loadState();

          return {
            success: true,
            message: formatPauseStatus(pauseStatus),
            data: {
              paused: pauseStatus.paused,
              remainingMinutes: pauseStatus.remainingMinutes,
              reason: pauseStatus.reason,
              lastRun: state.lastRun,
              lastRunStatus: state.lastRunStatus,
              suppressedAlerts: state.suppressedAlerts.length,
              backgroundTasks: state.backgroundTasks.length,
              defaultChannel: state.defaultChannel
                ? `${state.defaultChannel.channelType}:${state.defaultChannel.channelId}`
                : "not set",
            },
          };
        }

        default:
          return {
            success: false,
            message: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Heartbeat control failed: ${errorMsg}`,
      };
    }
  },
});
