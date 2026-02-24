// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Schedule Executor
 *
 * Creates synthetic InboundMessages when schedules trigger and
 * processes them through GatewayToMastraAdapter.
 *
 * Supports two execution modes:
 * - Message-based: Sends message to agent via gateway adapter
 * - Workflow-based: Executes Mastra workflow via HTTP API
 */

import type { GatewayToMastraAdapter } from "../adapter";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "../channels/types";
import { generateScheduleChannelId } from "./thread-utils";
import type { Schedule } from "./types";

/**
 * Channel registry for sending scheduled message results
 */
const channelRegistry: Map<string, ChannelAdapter> = new Map();

/**
 * Mastra server URL for workflow execution
 */
let mastraUrl = "http://localhost:4111";

/**
 * Set Mastra server URL
 */
export function setMastraUrl(url: string): void {
  mastraUrl = url;
  console.log(`[cron] Mastra URL set to: ${url}`);
}

/**
 * Get Mastra server URL
 */
export function getMastraUrl(): string {
  return mastraUrl;
}

/**
 * Register a channel adapter for sending scheduled results
 */
export function registerChannel(channelType: string, adapter: ChannelAdapter): void {
  channelRegistry.set(channelType, adapter);
  console.log(`[cron] Registered channel: ${channelType}`);
}

/**
 * Unregister a channel adapter
 */
export function unregisterChannel(channelType: string): void {
  channelRegistry.delete(channelType);
}

/**
 * Clear all registered channels
 */
export function clearChannels(): void {
  channelRegistry.clear();
}

/**
 * Get registered channel adapter
 */
export function getChannel(channelType: string): ChannelAdapter | undefined {
  return channelRegistry.get(channelType);
}

/**
 * Create a synthetic InboundMessage for a schedule
 *
 * Uses thread-aware channel ID:
 * - Shared threads: `schedule:Daily_Report` (same key each run)
 * - Isolated threads: `schedule:isolated:Daily_Report:uuid` (unique each run)
 */
export function createSyntheticMessage(schedule: Schedule): InboundMessage {
  const now = new Date();
  const channelId = generateScheduleChannelId(schedule);

  return {
    id: `schedule_${schedule.name.replace(/\s+/g, "_")}_${now.getTime()}`,
    text: schedule.message || `Execute workflow: ${schedule.workflow?.workflowId}`,
    channelType: "scheduler",
    channelId,
    threadId: undefined,
    sender: {
      id: "scheduler",
      name: `Schedule: ${schedule.name}`,
    },
    timestamp: now,
    isDM: false,
    isMention: true, // Treat as mention to ensure processing
    attachments: [],
    raw: {
      schedule,
      threadMode: schedule.threadMode ?? "shared",
    },
  };
}

/**
 * Execute a workflow via HTTP API
 *
 * @param schedule - Schedule with workflow configuration
 * @returns Workflow result as string
 */
async function executeWorkflow(schedule: Schedule): Promise<string> {
  if (!schedule.workflow) {
    throw new Error("No workflow configured");
  }

  const { workflowId, inputData } = schedule.workflow;
  const startTime = Date.now();

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "scheduler",
      event: "workflow_start",
      workflowId,
      scheduleName: schedule.name,
      targetChannel: `${schedule.target.channelType}:${schedule.target.channelId}`,
    }),
  );

  // Merge schedule context with provided input data
  const mergedInputData = {
    ...inputData,
    // Add target channel info for workflows that support it
    targetChannel: {
      type: schedule.target.channelType,
      id: schedule.target.channelId,
      threadId: schedule.target.threadId,
    },
  };

  const url = `${mastraUrl}/api/workflows/${workflowId}/start-async`;

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "scheduler",
      event: "workflow_http_request",
      workflowId,
      url,
      inputDataKeys: Object.keys(mergedInputData),
    }),
  );

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputData: mergedInputData,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        component: "scheduler",
        event: "workflow_http_error",
        workflowId,
        status: response.status,
        error: errorText.slice(0, 200),
        durationMs: Date.now() - startTime,
      }),
    );
    throw new Error(`Workflow HTTP call failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const durationMs = Date.now() - startTime;

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "scheduler",
      event: "workflow_complete",
      workflowId,
      scheduleName: schedule.name,
      status: result.status,
      durationMs,
      stepCount: Object.keys(result.results || {}).length,
    }),
  );

  // Extract a summary from the result
  if (result.status === "success") {
    // Try to get a meaningful response from the result
    const lastStepResult = Object.values(result.results || {}).pop() as
      | { output?: Record<string, unknown> }
      | undefined;
    const output = lastStepResult?.output;

    if (output?.summary) {
      return String(output.summary);
    }
    if (output?.message) {
      return String(output.message);
    }
    if (typeof output === "string") {
      return output;
    }

    return `Workflow "${workflowId}" completed successfully`;
  }

  if (result.status === "failed") {
    throw new Error(result.error || `Workflow "${workflowId}" failed`);
  }

  return `Workflow "${workflowId}" status: ${result.status}`;
}

/**
 * Execute a schedule - either via agent message or direct workflow
 *
 * @param schedule - Schedule to execute
 * @param adapter - Gateway adapter to process message (optional for workflow-only schedules)
 * @returns Response text
 */
export async function executeSchedule(schedule: Schedule, adapter?: GatewayToMastraAdapter): Promise<string> {
  console.log(`[cron] Executing schedule: ${schedule.name}`);

  try {
    let response: string;

    // Check if this is a workflow schedule
    if (schedule.workflow) {
      response = await executeWorkflow(schedule);
    } else if (schedule.message && adapter) {
      // Message-based schedule - process through agent
      const message = createSyntheticMessage(schedule);
      const result = await adapter.processMessage(message);
      response = result.text;
    } else {
      throw new Error("Schedule must have either message (with adapter) or workflow");
    }

    console.log(
      `[cron] Schedule "${schedule.name}" completed: ${response.slice(0, 100)}${response.length > 100 ? "..." : ""}`,
    );

    // Send result to target channel (for message-based schedules)
    // Workflow schedules handle their own delivery via the deliver-alert step
    if (schedule.message) {
      await sendToTarget(schedule, response);
    }

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[cron] Schedule "${schedule.name}" failed:`, error);

    // Send error notification to target channel
    await sendToTarget(schedule, `Scheduled task "${schedule.name}" failed: ${errorMessage}`);

    throw error;
  }
}

/**
 * Send result to the schedule's target channel
 */
async function sendToTarget(schedule: Schedule, response: string): Promise<void> {
  const { channelType, channelId, threadId } = schedule.target;

  // Agent channel = silent self-reminder, no external delivery
  if (channelType === "agent") {
    console.log(`[cron] Schedule "${schedule.name}" is agent-targeted (self-reminder), skipping external delivery`);
    return;
  }

  // Get the channel adapter
  const channel = channelRegistry.get(channelType);

  if (!channel) {
    console.warn(
      `[cron] No channel adapter registered for "${channelType}", ` +
        `cannot send result for schedule "${schedule.name}"`,
    );
    return;
  }

  if (!channel.isConnected) {
    console.warn(
      `[cron] Channel "${channelType}" is not connected, ` + `cannot send result for schedule "${schedule.name}"`,
    );
    return;
  }

  try {
    const outbound: OutboundMessage = {
      text: response,
      channelId,
      threadId,
    };

    await channel.sendMessage(outbound);

    console.log(`[cron] Sent result to ${channelType} ${channelId}${threadId ? ` (thread: ${threadId})` : ""}`);
  } catch (error) {
    console.error(`[cron] Failed to send result to ${channelType} ${channelId}:`, error);
  }
}
