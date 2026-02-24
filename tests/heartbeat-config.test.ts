// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Tests for agent configuration loading from agent.toml
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearConfigCache,
  getCronConfig,
  getHeartbeatConfig,
  getLoopConfig,
  getMemoryConfig,
  getServerConfig,
  loadAgentConfig,
} from "../src/mastra/lib/config";
import { getDefaultConfig, loadHeartbeatConfig } from "../src/mastra/workflows/heartbeat/config";

describe("Agent Config Loader", () => {
  beforeEach(() => {
    clearConfigCache();
  });

  test("loads agent.toml successfully", async () => {
    const config = await loadAgentConfig();

    expect(config).toBeDefined();
    expect(config.identity?.name).toBe("Scion");
    expect(config.identity?.role).toBe("AI Assistant");
  });

  test("loads heartbeat section from agent.toml", async () => {
    const config = await loadAgentConfig();

    expect(config.heartbeat).toBeDefined();
    expect(config.heartbeat?.quiet_mode).toBe(false);
    expect(config.heartbeat?.alert_threshold).toBe(1);
  });

  test("loads heartbeat hours correctly", async () => {
    const config = await loadAgentConfig();

    expect(config.heartbeat?.hours.start).toBe(0);
    expect(config.heartbeat?.hours.end).toBe(23);
    expect(config.heartbeat?.hours.timezone).toBe("Asia/Bangkok");
  });

  test("loads heartbeat checks correctly", async () => {
    const config = await loadAgentConfig();

    expect(config.heartbeat?.checks.task_state).toBe(true);
    expect(config.heartbeat?.checks.reminders).toBe(true);
    expect(config.heartbeat?.checks.context_continuity).toBe(true);
    expect(config.heartbeat?.checks.background_tasks).toBe(true);
  });
});

describe("Heartbeat Config Loader", () => {
  beforeEach(() => {
    clearConfigCache();
  });

  test("loads and transforms config correctly", async () => {
    const config = await loadHeartbeatConfig();

    expect(config.enabled).toBe(true);
    expect(config.quietMode).toBe(false);
    expect(config.alertThreshold).toBe(1);
    expect(config.activeHoursStart).toBe(0);
    expect(config.activeHoursEnd).toBe(23);
    expect(config.timezone).toBe("Asia/Bangkok");
  });

  test("transforms check names from snake_case to camelCase", async () => {
    const config = await loadHeartbeatConfig();

    expect(config.checks.taskState).toBe(true);
    expect(config.checks.reminders).toBe(true);
    expect(config.checks.contextContinuity).toBe(true);
    expect(config.checks.backgroundTasks).toBe(true);
  });

  test("returns notification targets from agent.toml", async () => {
    const config = await loadHeartbeatConfig();

    // agent.toml has one Slack target configured
    expect(config.notificationTargets.length).toBe(1);
    expect(config.notificationTargets[0]).toEqual({
      type: "slack",
      target: "general",
    });
  });

  test("getDefaultConfig returns expected defaults", () => {
    const defaults = getDefaultConfig();

    expect(defaults.enabled).toBe(true);
    expect(defaults.quietMode).toBe(false);
    expect(defaults.alertThreshold).toBe(1);
    expect(defaults.activeHoursStart).toBe(9);
    expect(defaults.activeHoursEnd).toBe(21);
    expect(defaults.timezone).toBe("UTC");
  });
});

describe("getHeartbeatConfig helper", () => {
  beforeEach(() => {
    clearConfigCache();
  });

  test("returns heartbeat section directly", async () => {
    const section = await getHeartbeatConfig();

    expect(section.quiet_mode).toBe(false);
    expect(section.hours.timezone).toBe("Asia/Bangkok");
  });
});

describe("Memory Config", () => {
  beforeEach(() => {
    clearConfigCache();
  });

  test("loads memory section from agent.toml", async () => {
    const config = await loadAgentConfig();

    expect(config.memory).toBeDefined();
    expect(config.memory?.last_messages).toBe(30);
    expect(config.memory?.semantic_recall_top_k).toBe(5);
    expect(config.memory?.semantic_recall_message_range).toBe(2);
  });

  test("getMemoryConfig returns memory settings", async () => {
    const memory = await getMemoryConfig();

    expect(memory.last_messages).toBe(30);
    expect(memory.semantic_recall_top_k).toBe(5);
    expect(memory.semantic_recall_message_range).toBe(2);
    expect(memory.semantic_recall_scope).toBe("resource");
    // Working memory disabled - replaced by Observational Memory
    expect(memory.working_memory_enabled).toBe(false);
    expect(memory.working_memory_scope).toBe("resource");
  });

  test("getMemoryConfig returns defaults when not configured", async () => {
    // Clear cache and test default values
    clearConfigCache();
    const memory = await getMemoryConfig();

    // These are the Zod defaults
    expect(memory.last_messages).toBeDefined();
    expect(memory.semantic_recall_top_k).toBeDefined();
  });
});

describe("Server Config", () => {
  beforeEach(() => {
    clearConfigCache();
  });

  test("loads server section from agent.toml", async () => {
    const config = await loadAgentConfig();

    expect(config.server).toBeDefined();
    expect(config.server?.timeout).toBe(600000);
    expect(config.server?.host).toBe("0.0.0.0");
    expect(config.server?.port).toBe(4111);
  });

  test("getServerConfig returns server settings", async () => {
    const server = await getServerConfig();

    expect(server.timeout).toBe(600000);
    expect(server.host).toBe("0.0.0.0");
    expect(server.port).toBe(4111);
  });
});

describe("Cron Config", () => {
  beforeEach(() => {
    clearConfigCache();
  });

  test("loads cron section from agent.toml", async () => {
    const config = await loadAgentConfig();

    expect(config.cron).toBeDefined();
    expect(config.cron?.poll_interval_seconds).toBe(30);
    expect(config.cron?.thread_ttl_days).toBe(7);
    expect(config.cron?.cleanup_interval_ms).toBe(3600000);
  });

  test("getCronConfig returns cron settings", async () => {
    const cron = await getCronConfig();

    expect(cron.poll_interval_seconds).toBe(30);
    expect(cron.thread_ttl_days).toBe(7);
    expect(cron.cleanup_interval_ms).toBe(3600000);
  });
});

describe("Loop Config", () => {
  beforeEach(() => {
    clearConfigCache();
  });

  test("loads loop section from agent.toml", async () => {
    const config = await loadAgentConfig();

    expect(config.loop).toBeDefined();
    expect(config.loop?.pattern).toBe("kimi-loop");
    expect(config.loop?.max_iterations).toBe(3);
    expect(config.loop?.max_steps_per_turn).toBe(50);
    expect(config.loop?.max_retries_per_step).toBe(3);
  });

  test("getLoopConfig returns loop settings", async () => {
    const loop = await getLoopConfig();

    expect(loop.pattern).toBe("kimi-loop");
    expect(loop.max_steps_per_turn).toBe(50);
    expect(loop.max_retries_per_step).toBe(3);
  });
});
