// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Service
 *
 * Direct in-process heartbeat implementation that runs within the GatewayServer.
 * Replaces the Mastra workflow-based approach for deterministic, synchronous execution.
 *
 * Features:
 * - CRON-based scheduling (from agent.toml config)
 * - Direct sharedMemory access (no HTTP overhead)
 * - Direct alert handler invocation (no workflow overhead)
 * - Simpler, more reliable architecture
 */

import { Cron } from "croner";
import { getServicesConfig } from "../../lib/config";
import { type HeartbeatConfig, loadHeartbeatConfig } from "../../workflows/heartbeat/config";
import { heartbeatLogger } from "../../workflows/heartbeat/logger";
import { isPaused } from "../../workflows/heartbeat/pause";
import {
  type HeartbeatState,
  cleanupExpiredSuppressions,
  generateAlertKey,
  getIncompleteTasks,
  isAlertSuppressed,
  loadState,
  recordRun,
  saveState,
  suppressAlert,
} from "../../workflows/heartbeat/state";
import type { GatewayToMastraAdapter } from "../adapter";
import { type HeartbeatAlertPayload, handleHeartbeatAlert } from "../handlers/alert-handler";

// ============================================================================
// Types
// ============================================================================

export interface AlertItem {
  type: string;
  description: string;
  priority: "low" | "medium" | "high";
  source: string;
}

export interface HeartbeatResult {
  status: "HEARTBEAT_OK" | "HEARTBEAT_ALERT" | "HEARTBEAT_SKIPPED" | "HEARTBEAT_ERROR";
  items: AlertItem[];
  summary: string;
  delivered: boolean;
  checkedAt: string;
}

export interface HeartbeatServiceConfig {
  // No longer needs memory - uses adapter HTTP methods
  resourceId?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getCurrentHourInTimezone(timezone: string): number {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone === "user" ? "UTC" : timezone,
      hour: "numeric",
      hour12: false,
    });
    const hourStr = formatter.format(now);
    return Number.parseInt(hourStr, 10);
  } catch {
    return new Date().getUTCHours();
  }
}

function isWithinActiveHours(currentHour: number, start: number, end: number): boolean {
  if (start <= end) {
    return currentHour >= start && currentHour < end;
  }
  return currentHour >= start || currentHour < end;
}

// ============================================================================
// Check Functions
// ============================================================================

export interface ParsedTask {
  text: string;
  isComplete: boolean;
  isInProgress: boolean;
  isHighPriority: boolean;
  isBlocked: boolean;
}

export function parseTasksFromMemory(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  // Match [ ], [x], [!], [~], [-] markers, and optionally skip [#N] task IDs
  const taskRegex = /^[-*]\s*\[([ x!~-])\]\s*(?:\[#\d+\]\s*)?(.+)$/gim;
  console.log(`[heartbeat:parser] Parsing working memory (${content.length} chars)`);

  for (let match = taskRegex.exec(content); match !== null; match = taskRegex.exec(content)) {
    const marker = match[1];
    const text = match[2].trim();
    const status =
      marker === "x"
        ? "complete"
        : marker === "-"
          ? "in_progress"
          : marker === "!"
            ? "high_priority"
            : marker === "~"
              ? "blocked"
              : "pending";
    console.log(`[heartbeat:parser]   [${marker}] "${text}" → ${status}`);
    tasks.push({
      text,
      isComplete: marker === "x",
      isInProgress: marker === "-",
      isHighPriority: marker === "!",
      isBlocked: marker === "~",
    });
  }

  console.log(
    `[heartbeat:parser] Found ${tasks.length} tasks: ${tasks.filter((t) => t.isComplete).length} complete, ${tasks.filter((t) => t.isInProgress).length} in-progress, ${tasks.filter((t) => t.isHighPriority).length} high-priority, ${tasks.filter((t) => t.isBlocked).length} blocked, ${tasks.filter((t) => !t.isComplete && !t.isInProgress && !t.isHighPriority && !t.isBlocked).length} pending`,
  );

  return tasks;
}

async function checkWorkingMemory(
  adapter: GatewayToMastraAdapter,
  resourceId: string,
  config: HeartbeatConfig,
): Promise<AlertItem[]> {
  console.log(`[heartbeat:checkWorkingMemory] Starting check for resourceId=${resourceId}`);
  console.log(
    `[heartbeat:checkWorkingMemory] Config checks: taskState=${config.checks.taskState}, contextContinuity=${config.checks.contextContinuity}`,
  );

  if (!config.checks.taskState && !config.checks.contextContinuity) {
    console.log("[heartbeat:checkWorkingMemory] Both taskState and contextContinuity disabled, skipping");
    return [];
  }

  const items: AlertItem[] = [];

  try {
    console.log(`[heartbeat:checkWorkingMemory] Calling adapter.getWorkingMemory(${resourceId})...`);
    const workingMemory = await adapter.getWorkingMemory(resourceId);

    if (!workingMemory) {
      console.log(
        `[heartbeat:checkWorkingMemory] No working memory returned for resourceId=${resourceId} (null/empty)`,
      );
      return [];
    }

    console.log(`[heartbeat:checkWorkingMemory] Got working memory: ${workingMemory.length} chars`);
    console.log(
      `[heartbeat:checkWorkingMemory] Working memory content (first 1000 chars):\n${workingMemory.slice(0, 1000)}`,
    );

    const tasks = parseTasksFromMemory(workingMemory);
    console.log(`[heartbeat:checkWorkingMemory] Parsed ${tasks.length} total tasks`);

    // High priority tasks
    const highPriorityTasks = tasks.filter((t) => t.isHighPriority);
    for (const task of highPriorityTasks) {
      console.log(`[heartbeat:checkWorkingMemory] ALERT: high-priority-task: "${task.text}"`);
      items.push({
        type: "high-priority-task",
        description: task.text,
        priority: "high",
        source: "working-memory",
      });
    }

    // Blocked tasks
    const blockedTasks = tasks.filter((t) => t.isBlocked);
    for (const task of blockedTasks) {
      console.log(`[heartbeat:checkWorkingMemory] ALERT: blocked-task: "${task.text}"`);
      items.push({
        type: "blocked-task",
        description: task.text,
        priority: "medium",
        source: "working-memory",
      });
    }

    // Pending tasks (alert if many) — exclude in-progress tasks from the count
    const pending = tasks.filter((t) => !t.isComplete && !t.isInProgress && !t.isHighPriority && !t.isBlocked);
    const inProgress = tasks.filter((t) => t.isInProgress);
    const completed = tasks.filter((t) => t.isComplete);
    console.log(
      `[heartbeat:checkWorkingMemory] Task breakdown: ${highPriorityTasks.length} high-priority, ${blockedTasks.length} blocked, ${inProgress.length} in-progress, ${pending.length} pending, ${completed.length} completed`,
    );

    for (const task of pending) {
      console.log(`[heartbeat:checkWorkingMemory] ALERT: pending-task: "${task.text}"`);
      items.push({
        type: "pending-task",
        description: task.text,
        priority: "low",
        source: "working-memory",
      });
    }

    // All tasks complete — suggest archival
    if (
      pending.length === 0 &&
      inProgress.length === 0 &&
      blockedTasks.length === 0 &&
      highPriorityTasks.length === 0 &&
      completed.length > 0
    ) {
      console.log(`[heartbeat:checkWorkingMemory] ALERT: all-tasks-complete (${completed.length} tasks)`);
      items.push({
        type: "all-tasks-complete",
        description: `All ${completed.length} tasks are complete. Consider archiving with TaskArchive.`,
        priority: "low",
        source: "heartbeat", // Uses normal suppression path (not 'working-memory' bypass)
      });
    }

    console.log(`[heartbeat:checkWorkingMemory] Generated ${items.length} alert items from working memory`);
  } catch (error) {
    console.log(`[heartbeat:checkWorkingMemory] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    heartbeatLogger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error checking working memory",
    );
  }

  return items;
}

const LONG_RUNNING_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function isLongRunning(registeredAt: string): boolean {
  const registered = new Date(registeredAt).getTime();
  return Date.now() - registered > LONG_RUNNING_THRESHOLD_MS;
}

async function checkBackgroundTasks(state: HeartbeatState, config: HeartbeatConfig): Promise<AlertItem[]> {
  if (!config.checks.backgroundTasks) {
    return [];
  }

  const items: AlertItem[] = [];
  const incompleteTasks = getIncompleteTasks(state);

  for (const task of incompleteTasks) {
    // Long-running tasks
    if (task.status === "running" && isLongRunning(task.registeredAt)) {
      const durationMinutes = Math.round((Date.now() - new Date(task.registeredAt).getTime()) / (60 * 1000));
      items.push({
        type: "long-running-task",
        description: `"${task.name}" has been running for ${durationMinutes} minutes`,
        priority: "medium",
        source: "background-tasks",
      });
    }

    // Pending tasks (alert if waiting a while)
    if (task.status === "pending") {
      const waitingMinutes = Math.round((Date.now() - new Date(task.registeredAt).getTime()) / (60 * 1000));
      if (waitingMinutes > 15) {
        items.push({
          type: "pending-background-task",
          description: `"${task.name}" has been pending for ${waitingMinutes} minutes`,
          priority: "low",
          source: "background-tasks",
        });
      }
    }
  }

  // Recently failed tasks (last 24h)
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentFailed = state.backgroundTasks.filter((t) => {
    if (t.status !== "failed") return false;
    if (!t.completedAt) return false;
    return new Date(t.completedAt).getTime() > dayAgo;
  });

  for (const task of recentFailed) {
    items.push({
      type: "failed-background-task",
      description: `"${task.name}" failed: ${task.error || "Unknown error"}`,
      priority: "high",
      source: "background-tasks",
    });
  }

  return items;
}

function deduplicateItems(items: AlertItem[], state: HeartbeatState): { items: AlertItem[]; state: HeartbeatState } {
  const filtered: AlertItem[] = [];
  let currentState = state;

  for (const item of items) {
    // Working-memory tasks bypass suppression — keep alerting until complete
    if (item.source === "working-memory") {
      filtered.push(item);
      continue;
    }

    const alertKey = generateAlertKey(item.type, item.description);

    if (isAlertSuppressed(currentState, alertKey, item.priority)) {
      heartbeatLogger.debug({ type: item.type, description: item.description.slice(0, 50) }, "Item suppressed");
      continue;
    }

    filtered.push(item);
    currentState = suppressAlert(currentState, alertKey, item.priority);
  }

  return { items: filtered, state: currentState };
}

function generateSummary(items: AlertItem[], suppressedCount: number): string {
  if (items.length === 0) {
    return suppressedCount > 0
      ? `All ${suppressedCount} items suppressed (already alerted recently)`
      : "No items need attention";
  }

  const highPriority = items.filter((i) => i.priority === "high").length;
  const medium = items.filter((i) => i.priority === "medium").length;
  const low = items.filter((i) => i.priority === "low").length;

  const parts: string[] = [];
  if (highPriority > 0) parts.push(`${highPriority} high-priority`);
  if (medium > 0) parts.push(`${medium} medium`);
  if (low > 0) parts.push(`${low} low`);

  let summary = `${items.length} items need attention`;
  if (parts.length > 0) {
    summary += ` (${parts.join(", ")})`;
  }
  if (suppressedCount > 0) {
    summary += ` [${suppressedCount} suppressed]`;
  }

  return summary;
}

function generateSuggestedActions(items: AlertItem[]): string[] {
  const actions: string[] = [];
  const seen = new Set<string>();

  const add = (action: string) => {
    if (!seen.has(action)) {
      seen.add(action);
      actions.push(action);
    }
  };

  for (const item of items) {
    switch (item.type) {
      case "high-priority-task":
        add("Address high-priority task immediately");
        break;
      case "blocked-task":
        add("Resolve blocker to unblock task");
        break;
      case "pending-task":
        add("Prioritize next steps on pending tasks");
        break;
      case "all-tasks-complete":
        add("Archive completed tasks with TaskArchive tool");
        break;
      case "long-running-task":
        add("Check on long-running task - may need intervention");
        break;
      case "failed-background-task":
        add("Investigate failed task and retry if needed");
        break;
      default:
        if (item.priority === "high") {
          add(`Address ${item.type} urgently`);
        }
    }
  }

  return actions.slice(0, 5);
}

// ============================================================================
// Heartbeat Service
// ============================================================================

export class HeartbeatService {
  private config: HeartbeatConfig | null = null;
  private cronJob?: Cron;
  private adapter: GatewayToMastraAdapter | null = null;
  private resourceId: string;
  private isRunning = false;

  constructor(config?: HeartbeatServiceConfig) {
    this.resourceId = config?.resourceId ?? "default";
  }

  /**
   * Set the gateway adapter (called by GatewayServer)
   */
  setAdapter(adapter: GatewayToMastraAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Set the resource ID for thread scoping (called by GatewayServer)
   */
  setResourceId(resourceId: string): void {
    this.resourceId = resourceId;
  }

  /**
   * Start the heartbeat service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      heartbeatLogger.warn({}, "Heartbeat service already running");
      return;
    }

    // Check if heartbeat service is enabled in [services] section
    const servicesConfig = await getServicesConfig();
    if (!servicesConfig.heartbeat) {
      heartbeatLogger.info({}, "Heartbeat disabled in agent.toml [services] section");
      return;
    }

    // Load config
    this.config = await loadHeartbeatConfig();

    // Build CRON expression from config
    const { activeHoursStart, activeHoursEnd, timezone, intervalMinutes } = this.config;
    const cronExpression = `*/${intervalMinutes} ${activeHoursStart}-${activeHoursEnd} * * *`;

    this.cronJob = new Cron(
      cronExpression,
      {
        timezone: timezone === "user" ? "UTC" : timezone,
        protect: true, // Skip if previous run still executing
      },
      async () => {
        try {
          await this.runCheck();
        } catch (error) {
          heartbeatLogger.error(
            { error: error instanceof Error ? error.message : String(error) },
            "Heartbeat check failed",
          );
        }
      },
    );

    this.isRunning = true;
    const nextRun = this.cronJob.nextRun();
    heartbeatLogger.info(
      {
        cron: cronExpression,
        timezone,
        nextRun: nextRun?.toISOString(),
      },
      "Heartbeat service started",
    );
  }

  /**
   * Stop the heartbeat service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = undefined;
    }

    this.isRunning = false;
    heartbeatLogger.info({}, "Heartbeat service stopped");
  }

  /**
   * Run a manual check (can bypass active hours and pause)
   */
  async runCheck(options?: { force?: boolean; resourceId?: string }): Promise<HeartbeatResult> {
    const config = this.config ?? (await loadHeartbeatConfig());
    const resourceId = options?.resourceId ?? this.resourceId;
    const force = options?.force ?? false;
    const checkedAt = new Date().toISOString();

    console.log("\n[heartbeat:runCheck] ========== HEARTBEAT CHECK START ==========");
    console.log(`[heartbeat:runCheck] resourceId=${resourceId}, force=${force}, checkedAt=${checkedAt}`);
    console.log(
      `[heartbeat:runCheck] config: timezone=${config.timezone}, activeHours=${config.activeHoursStart}-${config.activeHoursEnd}, alertThreshold=${config.alertThreshold}`,
    );
    console.log(
      `[heartbeat:runCheck] checks: taskState=${config.checks.taskState}, contextContinuity=${config.checks.contextContinuity}, backgroundTasks=${config.checks.backgroundTasks}`,
    );

    try {
      // Check active hours
      const currentHour = getCurrentHourInTimezone(config.timezone);
      const withinHours = isWithinActiveHours(currentHour, config.activeHoursStart, config.activeHoursEnd);
      console.log(
        `[heartbeat:runCheck] Active hours: current=${currentHour}:00, range=${config.activeHoursStart}:00-${config.activeHoursEnd}:00, withinHours=${withinHours}`,
      );

      if (!withinHours && !force) {
        console.log("[heartbeat:runCheck] SKIPPED — outside active hours");
        return {
          status: "HEARTBEAT_SKIPPED",
          items: [],
          summary: `Outside active hours (${currentHour}:00 not in ${config.activeHoursStart}:00-${config.activeHoursEnd}:00)`,
          delivered: false,
          checkedAt,
        };
      }

      // Check pause status
      const paused = await isPaused();
      console.log(`[heartbeat:runCheck] Pause status: paused=${paused}`);
      if (paused && !force) {
        console.log("[heartbeat:runCheck] SKIPPED — heartbeat is paused");
        return {
          status: "HEARTBEAT_SKIPPED",
          items: [],
          summary: "Heartbeat is paused",
          delivered: false,
          checkedAt,
        };
      }

      // Load and clean state
      let state = await loadState();
      state = cleanupExpiredSuppressions(state);
      console.log(
        `[heartbeat:runCheck] State loaded: suppressions=${(state.suppressedAlerts || []).length}, backgroundTasks=${state.backgroundTasks?.length ?? 0}`,
      );

      // Run checks
      const items: AlertItem[] = [];

      // Check working memory
      if (!this.adapter) {
        console.log("[heartbeat:runCheck] ERROR — adapter not set, cannot check working memory");
        return {
          status: "HEARTBEAT_ERROR",
          items: [],
          summary: "Adapter not set",
          delivered: false,
          checkedAt,
        };
      }
      console.log("[heartbeat:runCheck] Adapter is set, checking working memory...");
      const workingMemoryItems = await checkWorkingMemory(this.adapter, resourceId, config);
      console.log(`[heartbeat:runCheck] Working memory check returned ${workingMemoryItems.length} items`);
      for (const item of workingMemoryItems) {
        console.log(`[heartbeat:runCheck]   → [${item.priority}] ${item.type}: ${item.description}`);
      }
      items.push(...workingMemoryItems);

      // Check background tasks
      const backgroundTaskItems = await checkBackgroundTasks(state, config);
      console.log(`[heartbeat:runCheck] Background task check returned ${backgroundTaskItems.length} items`);
      for (const item of backgroundTaskItems) {
        console.log(`[heartbeat:runCheck]   → [${item.priority}] ${item.type}: ${item.description}`);
      }
      items.push(...backgroundTaskItems);

      console.log(`[heartbeat:runCheck] Total items before dedup: ${items.length}`);

      // Deduplicate
      const beforeDedupe = items.length;
      const dedupeResult = deduplicateItems(items, state);
      const suppressedCount = beforeDedupe - dedupeResult.items.length;
      state = dedupeResult.state;
      console.log(
        `[heartbeat:runCheck] After dedup: ${dedupeResult.items.length} items (${suppressedCount} suppressed)`,
      );

      // Save state with suppressions
      await saveState(state);

      // Generate summary
      const summary = generateSummary(dedupeResult.items, suppressedCount);
      console.log(`[heartbeat:runCheck] Summary: ${summary}`);

      // Check threshold
      const meetsThreshold = dedupeResult.items.length >= config.alertThreshold;
      const hasHighPriority = dedupeResult.items.some((i) => i.priority === "high");
      const shouldAlert = meetsThreshold || hasHighPriority;
      console.log(
        `[heartbeat:runCheck] Decision: meetsThreshold=${meetsThreshold} (${dedupeResult.items.length}>=${config.alertThreshold}), hasHighPriority=${hasHighPriority}, shouldAlert=${shouldAlert}`,
      );

      if (!shouldAlert) {
        // Record OK run
        state = recordRun(state, "ok");
        await saveState(state);

        console.log(`[heartbeat:runCheck] RESULT: HEARTBEAT_OK — ${summary}`);
        console.log("[heartbeat:runCheck] ========== HEARTBEAT CHECK END ==========\n");
        return {
          status: "HEARTBEAT_OK",
          items: [],
          summary,
          delivered: false,
          checkedAt,
        };
      }

      // Generate suggested actions
      const suggestedActions = generateSuggestedActions(dedupeResult.items);
      console.log(`[heartbeat:runCheck] Suggested actions: ${suggestedActions.join("; ")}`);

      // Record alert run
      state = recordRun(state, "alert");
      await saveState(state);

      // Send alert directly to handler
      const payload: HeartbeatAlertPayload = {
        resourceId,
        alertType: "heartbeat",
        items: dedupeResult.items,
        summary,
        suggestedActions,
      };
      console.log(`[heartbeat:runCheck] Sending alert payload: ${JSON.stringify(payload, null, 2)}`);

      const response = await handleHeartbeatAlert(payload);
      console.log(
        `[heartbeat:runCheck] Alert handler response: status=${response.status}, threadId=${response.threadId ?? "none"}`,
      );

      if (response.status === "error") {
        throw new Error(response.error || "Alert delivery failed");
      }

      console.log(`[heartbeat:runCheck] RESULT: HEARTBEAT_ALERT — ${dedupeResult.items.length} items delivered`);
      console.log("[heartbeat:runCheck] ========== HEARTBEAT CHECK END ==========\n");
      return {
        status: "HEARTBEAT_ALERT",
        items: dedupeResult.items,
        summary,
        delivered: true,
        checkedAt,
      };
    } catch (error) {
      console.log(
        `[heartbeat:runCheck] RESULT: HEARTBEAT_ERROR — ${error instanceof Error ? error.message : String(error)}`,
      );
      console.log("[heartbeat:runCheck] ========== HEARTBEAT CHECK END ==========\n");

      return {
        status: "HEARTBEAT_ERROR",
        items: [],
        summary: `Error: ${error instanceof Error ? error.message : String(error)}`,
        delivered: false,
        checkedAt,
      };
    }
  }

  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get next scheduled run time
   */
  getNextRun(): Date | null {
    return this.cronJob?.nextRun() ?? null;
  }
}

/**
 * Factory function to create a HeartbeatService
 */
export function createHeartbeatService(config: HeartbeatServiceConfig): HeartbeatService {
  return new HeartbeatService(config);
}
