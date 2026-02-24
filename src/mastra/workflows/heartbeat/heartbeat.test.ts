// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Tests
 *
 * Tests for heartbeat configuration, state management, and pause functionality.
 * Note: The HeartbeatService (in-process implementation) is tested separately
 * in src/mastra/gateway/heartbeat/service.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { rm } from "node:fs/promises";

import { clearConfigCache } from "../../lib/config";
import { getDefaultConfig, loadHeartbeatConfig } from "./config";
import { getPauseStatus, isPaused, pauseHeartbeat, resumeHeartbeat } from "./pause";
import {
  cleanupExpiredSuppressions,
  generateAlertKey,
  getIncompleteTasks,
  isAlertSuppressed,
  loadState,
  recordRun,
  registerBackgroundTask,
  saveState,
  suppressAlert,
  updateBackgroundTask,
  updateDefaultChannel,
} from "./state";

const TEST_CONFIG_DIR = "/tmp/heartbeat-test-config";
const TEST_STATE_PATH = "/tmp/heartbeat-test-config/heartbeat-state.json";

describe("Heartbeat Config", () => {
  beforeEach(async () => {
    clearConfigCache();
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  afterEach(async () => {
    try {
      await rm(TEST_CONFIG_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("loads config from agent.toml", async () => {
    // Uses the project's agent.toml which has heartbeat config
    const config = await loadHeartbeatConfig();
    expect(config.enabled).toBe(true);
    expect(config.alertThreshold).toBe(1);
    expect(config.activeHoursStart).toBe(0);
    expect(config.activeHoursEnd).toBe(23);
    expect(config.timezone).toBe("Asia/Bangkok");
  });

  test("returns default config structure", async () => {
    const config = await loadHeartbeatConfig();

    // Check all expected fields exist
    expect(typeof config.enabled).toBe("boolean");
    expect(typeof config.quietMode).toBe("boolean");
    expect(typeof config.alertThreshold).toBe("number");
    expect(typeof config.activeHoursStart).toBe("number");
    expect(typeof config.activeHoursEnd).toBe("number");
    expect(typeof config.timezone).toBe("string");
    expect(typeof config.checks).toBe("object");
    expect(Array.isArray(config.notificationTargets)).toBe(true);
    expect(typeof config.intervalMinutes).toBe("number");
  });

  test("getDefaultConfig returns expected defaults", () => {
    const defaults = getDefaultConfig();
    expect(defaults.enabled).toBe(true);
    expect(defaults.quietMode).toBe(false);
    expect(defaults.alertThreshold).toBe(1);
    expect(defaults.activeHoursStart).toBe(9);
    expect(defaults.activeHoursEnd).toBe(21);
    expect(defaults.timezone).toBe("UTC");
    expect(defaults.intervalMinutes).toBe(30);
  });

  test("checks configuration is loaded correctly", async () => {
    const config = await loadHeartbeatConfig();

    expect(config.checks.taskState).toBe(true);
    expect(config.checks.reminders).toBe(true);
    expect(config.checks.contextContinuity).toBe(true);
    expect(config.checks.backgroundTasks).toBe(true);
  });
});

describe("Heartbeat State", () => {
  beforeEach(async () => {
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
    // Clean up any existing state
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }
  });

  afterEach(async () => {
    try {
      await rm(TEST_CONFIG_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("loads default state when no file exists", async () => {
    const state = await loadState(TEST_STATE_PATH);
    expect(state.suppressedAlerts).toEqual([]);
    expect(state.pause.paused).toBe(false);
    expect(state.backgroundTasks).toEqual([]);
  });

  test("saves and loads state", async () => {
    let state = await loadState(TEST_STATE_PATH);
    state = updateDefaultChannel(state, "slack", "C123", "T456");
    await saveState(state, TEST_STATE_PATH);

    const loaded = await loadState(TEST_STATE_PATH);
    expect(loaded.defaultChannel?.channelType).toBe("slack");
    expect(loaded.defaultChannel?.channelId).toBe("C123");
    expect(loaded.defaultChannel?.threadId).toBe("T456");
  });

  test("generates consistent alert keys", () => {
    const key1 = generateAlertKey("task", "Complete the report by Friday");
    const key2 = generateAlertKey("task", "Complete the report by Friday");
    expect(key1).toBe(key2);

    // Numbers should be normalized
    const key3 = generateAlertKey("task", "Complete 5 reports");
    const key4 = generateAlertKey("task", "Complete 10 reports");
    expect(key3).toBe(key4);
  });

  test("suppression works with 24h window", async () => {
    const loaded = await loadState(TEST_STATE_PATH);
    let state = { ...loaded };
    const key = "test:alert";

    // Not suppressed initially
    expect(isAlertSuppressed(state, key, "medium")).toBe(false);

    // Suppress it
    state = suppressAlert(state, key, "medium");
    expect(isAlertSuppressed(state, key, "medium")).toBe(true);

    // High priority bypasses suppression
    expect(isAlertSuppressed(state, key, "high")).toBe(false);
  });

  test("cleans up expired suppressions", async () => {
    let state = await loadState(TEST_STATE_PATH);

    // Add an already-expired suppression
    state.suppressedAlerts.push({
      key: "expired:alert",
      suppressedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      priority: "medium",
    });

    // Add a valid suppression
    state = suppressAlert(state, "valid:alert", "medium");

    // Clean up
    state = cleanupExpiredSuppressions(state);

    expect(state.suppressedAlerts.length).toBe(1);
    expect(state.suppressedAlerts[0].key).toBe("valid:alert");
  });

  test("background task management", async () => {
    let state = await loadState(TEST_STATE_PATH);

    // Register tasks
    state = registerBackgroundTask(state, "task-1", "Test Task 1");
    state = registerBackgroundTask(state, "task-2", "Test Task 2");

    expect(getIncompleteTasks(state).length).toBe(2);

    // Update status
    state = updateBackgroundTask(state, "task-1", { status: "running" });
    state = updateBackgroundTask(state, "task-2", { status: "completed" });

    const incomplete = getIncompleteTasks(state);
    expect(incomplete.length).toBe(1);
    expect(incomplete[0].id).toBe("task-1");
  });

  test("records run status", async () => {
    let state = await loadState(TEST_STATE_PATH);

    state = recordRun(state, "ok");
    expect(state.lastRunStatus).toBe("ok");
    expect(state.lastRun).toBeDefined();

    state = recordRun(state, "alert");
    expect(state.lastRunStatus).toBe("alert");
  });
});

describe("Heartbeat Pause", () => {
  beforeEach(async () => {
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
    // Clean up any existing state
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }
  });

  afterEach(async () => {
    try {
      await rm(TEST_CONFIG_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // Note: These tests use the default state path (.agent/heartbeat-state.json)
  // In production, tests would mock this

  test("pause and resume flow", async () => {
    // This test would need to mock the state path
    // For now, just verify the functions exist and have correct signatures
    expect(typeof pauseHeartbeat).toBe("function");
    expect(typeof resumeHeartbeat).toBe("function");
    expect(typeof getPauseStatus).toBe("function");
    expect(typeof isPaused).toBe("function");
  });
});
