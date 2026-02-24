// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Cron Service
 *
 * Manages croner instances for CRON.md schedule execution.
 * Features:
 * - Hot reload via mtime-based polling (30s interval)
 * - protect: true to skip execution if previous still running
 * - Graceful start/stop lifecycle
 * - Only handles agent-defined schedules from CRON.md
 */

import { Cron } from "croner";
import {
  type CronSection,
  clearConfigCache,
  getCronConfig,
  getServicesConfig,
  resolveConfigPath,
} from "../../lib/config";
import type { GatewayToMastraAdapter } from "../adapter";
import type { ChannelAdapter } from "../channels/types";
import { clearCronMdCache, loadCronMd } from "../loaders/cron-md-loader";
import { clearChannels, executeSchedule, registerChannel, setMastraUrl, unregisterChannel } from "./executor";
import { startCleanupTimer, stopCleanupTimer } from "./thread-cleanup";
import { isScheduleThread } from "./thread-utils";
import type { ActiveSchedule, Schedule } from "./types";

/**
 * Cron Service
 *
 * Singleton service that manages agent-defined CRON schedules.
 * Loads schedules from CRON.md and creates croner jobs.
 *
 * Configuration is loaded from agent.toml [cron] section:
 * - enabled: Whether service is active (default: true)
 * - cron_md_path: Path to CRON.md (relative to agent.toml location)
 * - poll_interval_seconds: Hot-reload interval (default: 30)
 */
export class CronService {
  private config: CronSection | null = null;

  /** Path to CRON.md (loaded from agent.toml [cron] section in start()) */
  private cronMdPath = "";

  /** Polling interval for hot reload (in milliseconds) */
  private pollInterval = 30000;

  /** Thread TTL in days (loaded from config on start) */
  private threadTtlDays = 7;

  /** Resource ID for thread scoping */
  private resourceId = "default";

  /** Active schedules with croner jobs */
  private activeSchedules: Map<string, ActiveSchedule> = new Map();

  /** Gateway adapter for processing messages and thread operations */
  private adapter: GatewayToMastraAdapter | null = null;

  /** Polling timer handle */
  private pollTimer: NodeJS.Timeout | null = null;

  /** Whether service is running */
  private running = false;

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
   * Set the Mastra server URL for workflow execution
   */
  setMastraUrl(url: string): void {
    setMastraUrl(url);
  }

  /**
   * Register a channel adapter for sending results
   */
  registerChannel(channelType: string, adapter: ChannelAdapter): void {
    registerChannel(channelType, adapter);
  }

  /**
   * Unregister a channel adapter
   */
  unregisterChannel(channelType: string): void {
    unregisterChannel(channelType);
  }

  /**
   * Start the cron service
   */
  async start(): Promise<void> {
    console.log(`[cron] start() called, this.running=${this.running}`);
    if (this.running) {
      console.log("[cron] Already running");
      return;
    }

    // Clear config cache to ensure fresh load of agent.toml
    console.log("[cron] About to clear config cache...");
    clearConfigCache();
    console.log("[cron] Config cache cleared, now loading fresh config...");

    // Check if cron service is enabled in [services] section
    const servicesConfig = await getServicesConfig();
    if (!servicesConfig.cron) {
      console.log("[cron] Disabled in agent.toml [services] section");
      return;
    }

    // Load cron config from agent.toml [cron] section
    this.config = await getCronConfig();

    // Apply configuration
    this.cronMdPath = resolveConfigPath(this.config.cron_md_path);
    this.pollInterval = this.config.poll_interval_seconds * 1000; // Convert to milliseconds
    this.threadTtlDays = this.config.thread_ttl_days;

    console.log("[cron] Starting cron service...");
    console.log(`[cron] CRON.md path: ${this.cronMdPath}`);
    console.log(
      `[cron] Config from agent.toml: poll_interval=${this.pollInterval}ms, thread_ttl=${this.threadTtlDays} days`,
    );

    this.running = true;

    // Initial load
    await this.reload();

    // Start polling for changes
    this.startPolling();

    // Start thread cleanup timer for isolated threads
    if (this.adapter) {
      await startCleanupTimer(this.adapter, this.resourceId, this.threadTtlDays, this.config.cleanup_interval_ms);
    }

    console.log("[cron] Cron service started");
  }

  /**
   * Stop the cron service
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log("[cron] Stopping cron service...");

    this.running = false;

    // Stop thread cleanup timer
    stopCleanupTimer();

    // Stop polling
    this.stopPolling();

    // Stop all active jobs
    for (const [name, active] of this.activeSchedules) {
      (active.job as Cron).stop();
      console.log(`[cron] Stopped job: ${name}`);
    }

    this.activeSchedules.clear();
    clearChannels();

    console.log("[cron] Cron service stopped");
  }

  /**
   * Reload schedules from CRON.md
   */
  async reload(): Promise<void> {
    // Load agent-defined schedules from CRON.md
    const { schedules, errors } = await loadCronMd(this.cronMdPath);

    // Log errors
    for (const error of errors) {
      console.warn(`[cron] Parse error: ${error}`);
    }

    // All schedules are from CRON.md (agent-defined)
    const allSchedules = schedules;

    // Reconcile: stop removed/changed jobs, start new ones
    await this.reconcileSchedules(allSchedules);
  }

  /**
   * Force reload (ignores cache)
   */
  async forceReload(): Promise<void> {
    // Clear loader cache
    clearCronMdCache();

    // Reload
    await this.reload();
  }

  /**
   * Get all active schedules
   */
  getActiveSchedules(): Schedule[] {
    return Array.from(this.activeSchedules.values()).map((a) => a.schedule);
  }

  /**
   * Get schedule by name
   */
  getSchedule(name: string): Schedule | undefined {
    return this.activeSchedules.get(name)?.schedule;
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start polling for CRON.md changes
   */
  private startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(async () => {
      try {
        await this.reload();
      } catch (error) {
        console.error("[cron] Error during poll reload:", error);
      }
    }, this.pollInterval);

    // Unref so it doesn't keep the process alive
    this.pollTimer.unref();
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Reconcile active schedules with loaded schedules
   */
  private async reconcileSchedules(schedules: Schedule[]): Promise<void> {
    const newScheduleMap = new Map(schedules.map((s) => [s.name, s]));

    // Stop jobs that are removed or changed
    for (const [name, active] of this.activeSchedules) {
      const newSchedule = newScheduleMap.get(name);

      if (!newSchedule || this.hasScheduleChanged(active.schedule, newSchedule)) {
        (active.job as Cron).stop();
        this.activeSchedules.delete(name);
        console.log(`[cron] Removed job: ${name}`);
      }
    }

    // Start new or changed jobs
    for (const schedule of schedules) {
      if (!this.activeSchedules.has(schedule.name)) {
        if (schedule.enabled) {
          this.createJob(schedule);
        } else {
          console.log(`[cron] Skipping disabled schedule: ${schedule.name}`);
        }
      }
    }
  }

  /**
   * Check if schedule has changed
   */
  private hasScheduleChanged(old: Schedule, newSched: Schedule): boolean {
    return (
      old.cron !== newSched.cron ||
      old.enabled !== newSched.enabled ||
      old.message !== newSched.message ||
      old.timezone !== newSched.timezone ||
      old.target.channelType !== newSched.target.channelType ||
      old.target.channelId !== newSched.target.channelId ||
      old.target.threadId !== newSched.target.threadId ||
      (old.threadMode ?? "shared") !== (newSched.threadMode ?? "shared")
    );
  }

  /**
   * Reset threads for a schedule
   *
   * Deletes all threads associated with the schedule.
   * The next run will start with a fresh conversation.
   *
   * @param scheduleName - Name of the schedule to reset
   * @returns Result with success status and thread count
   */
  async resetScheduleThreads(scheduleName: string): Promise<{
    success: boolean;
    message: string;
    threadsDeleted: number;
  }> {
    const schedule = this.getSchedule(scheduleName);
    if (!schedule) {
      return {
        success: false,
        message: `Schedule "${scheduleName}" not found`,
        threadsDeleted: 0,
      };
    }

    if (!this.adapter) {
      return {
        success: false,
        message: "Adapter not set",
        threadsDeleted: 0,
      };
    }

    // Query all threads for this resource
    const threads = await this.adapter.listThreads(this.resourceId);

    let deleted = 0;
    for (const thread of threads) {
      if (isScheduleThread(thread.id, scheduleName)) {
        try {
          await this.adapter.deleteThread(thread.id);
          deleted++;
        } catch (error) {
          console.error(`[cron] Failed to delete thread ${thread.id}:`, error);
        }
      }
    }

    if (deleted > 0) {
      console.log(`[cron] Reset ${deleted} thread(s) for "${scheduleName}"`);
    }

    return {
      success: true,
      message:
        deleted > 0
          ? `Reset ${deleted} thread(s) for "${scheduleName}". Next run will start fresh.`
          : `No active threads for "${scheduleName}"`,
      threadsDeleted: deleted,
    };
  }

  /**
   * Clean up all threads for a schedule (called on schedule removal)
   *
   * @param scheduleName - Name of the schedule being removed
   * @returns Number of threads deleted
   */
  async cleanupScheduleThreads(scheduleName: string): Promise<number> {
    if (!this.adapter) {
      console.error("[cron] Cannot cleanup threads: adapter not set");
      return 0;
    }

    // Query all threads for this resource
    const threads = await this.adapter.listThreads(this.resourceId);

    let deleted = 0;
    for (const thread of threads) {
      if (isScheduleThread(thread.id, scheduleName)) {
        try {
          await this.adapter.deleteThread(thread.id);
          deleted++;
        } catch (error) {
          console.error(`[cron] Failed to delete thread ${thread.id}:`, error);
        }
      }
    }

    if (deleted > 0) {
      console.log(`[cron] Cleaned up ${deleted} thread(s) for removed schedule "${scheduleName}"`);
    }

    return deleted;
  }

  /**
   * Create a croner job for a schedule
   */
  private createJob(schedule: Schedule): void {
    if (!this.adapter) {
      console.error(`[cron] Cannot create job "${schedule.name}": no adapter set`);
      return;
    }

    const adapter = this.adapter;

    try {
      const job = new Cron(
        schedule.cron,
        {
          timezone: schedule.timezone,
          protect: true, // Skip if previous run still executing
        },
        async () => {
          try {
            await executeSchedule(schedule, adapter);
          } catch (error) {
            console.error(`[cron] Job "${schedule.name}" execution failed:`, error);
          }
        },
      );

      this.activeSchedules.set(schedule.name, { schedule, job });

      const nextRun = job.nextRun();
      console.log(
        `[cron] Created job: ${schedule.name} (cron: ${schedule.cron}, ` +
          `next: ${nextRun?.toISOString() ?? "never"})`,
      );
    } catch (error) {
      console.error(`[cron] Failed to create job "${schedule.name}":`, error);
    }
  }

  /**
   * Get next run time for a schedule
   */
  getNextRun(name: string): Date | null {
    const active = this.activeSchedules.get(name);
    if (!active) return null;

    return (active.job as Cron).nextRun();
  }

  /**
   * Get all schedules with next run times
   */
  getSchedulesWithNextRun(): Array<{ schedule: Schedule; nextRun: Date | null }> {
    return Array.from(this.activeSchedules.values()).map(({ schedule, job }) => ({
      schedule,
      nextRun: (job as Cron).nextRun(),
    }));
  }

  /**
   * Trigger a schedule immediately (for testing)
   */
  async triggerNow(name: string): Promise<string> {
    const active = this.activeSchedules.get(name);
    if (!active) {
      throw new Error(`Schedule "${name}" not found`);
    }

    if (!this.adapter) {
      throw new Error("No adapter set");
    }

    return executeSchedule(active.schedule, this.adapter);
  }
}

/** Singleton instance */
let cronInstance: CronService | null = null;

/**
 * Get the cron service singleton
 */
export function getCronService(): CronService | null {
  return cronInstance;
}

/**
 * Create and set the cron service singleton
 */
export function createCronService(): CronService {
  if (cronInstance) {
    console.warn("[cron] Cron service already exists, stopping previous instance");
    cronInstance.stop();
  }

  cronInstance = new CronService();
  return cronInstance;
}

/**
 * Stop and clear the cron singleton
 */
export async function destroyCronService(): Promise<void> {
  if (cronInstance) {
    await cronInstance.stop();
    cronInstance = null;
  }
}
