// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * CRON.md Loader
 *
 * Parses the CRON.md markdown file to extract schedule definitions.
 * Uses mtime-based caching for hot reload without server restart.
 *
 * CRON.md Format:
 * ```markdown
 * # Scheduled Tasks
 *
 * ## Daily Standup
 * - **Schedule**: `0 9 * * 1-5` (9 AM weekdays)
 * - **Timezone**: America/New_York
 * - **Message**: Generate the daily standup report
 * - **Target**: slack #team-updates
 * - **Enabled**: true
 * ```
 */

import * as fs from "node:fs/promises";
import type { CronMdResult, Schedule, ThreadMode, WorkflowInput } from "../cron/types";

/**
 * Cache entry for parsed CRON.md
 */
interface CronMdCache {
  result: CronMdResult;
  mtime: number;
}

/** Single cache entry (only one CRON.md file) */
let cache: CronMdCache | null = null;
let cachedPath: string | null = null;

/**
 * Check if cache is fresh by comparing mtime
 */
async function isCacheFresh(filePath: string): Promise<boolean> {
  if (!cache || cachedPath !== filePath) return false;

  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs === cache.mtime;
  } catch {
    return false;
  }
}

/**
 * Parse target string like "slack #channel-name" or "telegram 123456789"
 */
function parseTarget(targetStr: string): { channelType: string; channelId: string } | null {
  const parts = targetStr.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const channelType = parts[0].toLowerCase();
  const channelId = parts.slice(1).join(" ");

  return { channelType, channelId };
}

/**
 * Extract value from a line like "- **Key**: value" or "- **Key**: `value` (comment)"
 */
function extractValue(line: string, key: string): string | null {
  // Match pattern: - **Key**: value or - **Key**: `value` (optional comment)
  const patterns = [
    new RegExp(`^\\s*-\\s*\\*\\*${key}\\*\\*:\\s*\`([^\`]+)\``, "i"),
    new RegExp(`^\\s*-\\s*\\*\\*${key}\\*\\*:\\s*(.+)$`, "i"),
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      // Remove trailing comments in parentheses for cron expressions
      let value = match[1].trim();
      if (key.toLowerCase() === "schedule") {
        value = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
      }
      return value;
    }
  }

  return null;
}

/**
 * Parse workflow field: `workflowId` or `workflowId` with `{"key": "value"}`
 */
function parseWorkflow(value: string): WorkflowInput | null {
  // Check for workflow with input data: `heartbeat` with `{"resourceId": "user-123"}`
  const withInputMatch = value.match(/^`?(\w+)`?\s+with\s+`([^`]+)`/i);
  if (withInputMatch) {
    try {
      const inputData = JSON.parse(withInputMatch[2]);
      return {
        workflowId: withInputMatch[1],
        inputData,
      };
    } catch {
      // Invalid JSON, just use the workflow ID
      return { workflowId: withInputMatch[1] };
    }
  }

  // Simple workflow ID: `heartbeat` or heartbeat
  const simpleMatch = value.match(/^`?(\w+)`?$/);
  if (simpleMatch) {
    return { workflowId: simpleMatch[1] };
  }

  return null;
}

/**
 * Parse a single schedule section
 */
function parseScheduleSection(name: string, lines: string[]): { schedule: Schedule | null; error: string | null } {
  let cron: string | null = null;
  let message: string | null = null;
  let workflow: WorkflowInput | null = null;
  let targetStr: string | null = null;
  let timezone: string | undefined;
  let enabled = true;
  let sessionMode: ThreadMode | undefined;

  for (const line of lines) {
    const scheduleVal = extractValue(line, "Schedule");
    if (scheduleVal) cron = scheduleVal;

    const messageVal = extractValue(line, "Message");
    if (messageVal) message = messageVal;

    const workflowVal = extractValue(line, "Workflow");
    if (workflowVal) {
      workflow = parseWorkflow(workflowVal);
    }

    const targetVal = extractValue(line, "Target");
    if (targetVal) targetStr = targetVal;

    const timezoneVal = extractValue(line, "Timezone");
    if (timezoneVal) timezone = timezoneVal;

    const enabledVal = extractValue(line, "Enabled");
    if (enabledVal !== null) {
      enabled = enabledVal.toLowerCase() !== "false";
    }

    const sessionModeVal = extractValue(line, "SessionMode");
    if (sessionModeVal !== null) {
      const normalized = sessionModeVal.toLowerCase().trim();
      if (normalized === "isolated") {
        sessionMode = "isolated";
      }
      // 'shared' or anything else defaults to undefined (shared)
    }
  }

  // Validate required fields
  if (!cron) {
    return { schedule: null, error: `Schedule "${name}": missing **Schedule** field` };
  }
  if (!message && !workflow) {
    return { schedule: null, error: `Schedule "${name}": missing **Message** or **Workflow** field` };
  }
  // Default to agent notification when Target is omitted
  let target: { channelType: string; channelId: string };
  if (!targetStr) {
    target = { channelType: "agent", channelId: "self" };
  } else {
    const parsed = parseTarget(targetStr);
    if (!parsed) {
      return {
        schedule: null,
        error: `Schedule "${name}": invalid **Target** format (expected "channelType #channelId")`,
      };
    }
    target = parsed;
  }

  return {
    schedule: {
      name,
      cron,
      enabled,
      message: message || undefined,
      workflow: workflow || undefined,
      target,
      timezone,
      threadMode: sessionMode,
    },
    error: null,
  };
}

/**
 * Strip HTML comments from content
 * Handles both single-line and multi-line comments
 */
function stripHtmlComments(content: string): string {
  // Remove HTML comments (<!-- ... -->), including multi-line
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Parse CRON.md content into schedules
 */
function parseCronMd(content: string): CronMdResult {
  const schedules: Schedule[] = [];
  const errors: string[] = [];

  // Strip HTML comments before parsing
  const cleanContent = stripHtmlComments(content);

  const lines = cleanContent.split("\n");
  let currentName: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    // Check for ## heading (schedule name)
    const headingMatch = line.match(/^##\s+(.+)$/);

    if (headingMatch) {
      // Process previous section if exists
      if (currentName && currentLines.length > 0) {
        const { schedule, error } = parseScheduleSection(currentName, currentLines);
        if (schedule) {
          schedules.push(schedule);
        }
        if (error) {
          errors.push(error);
        }
      }

      // Start new section
      currentName = headingMatch[1].trim();
      currentLines = [];
    } else if (currentName) {
      // Add line to current section
      currentLines.push(line);
    }
  }

  // Process final section
  if (currentName && currentLines.length > 0) {
    const { schedule, error } = parseScheduleSection(currentName, currentLines);
    if (schedule) {
      schedules.push(schedule);
    }
    if (error) {
      errors.push(error);
    }
  }

  return { schedules, errors };
}

/**
 * Load and parse CRON.md file
 *
 * Features:
 * - Parses human-readable markdown format
 * - Caches by file mtime for hot reload
 * - Returns empty array if file doesn't exist (no error)
 * - Reports parse errors but continues with valid schedules
 *
 * @param cronMdPath - Path to CRON.md file
 * @returns Parsed schedules and any parse errors
 */
export async function loadCronMd(cronMdPath: string): Promise<CronMdResult> {
  // Check cache freshness
  if (await isCacheFresh(cronMdPath)) {
    // console.log('[cron-md-loader] Using cached schedules');
    return cache!.result;
  }

  // Check if file exists
  let stat: Awaited<ReturnType<typeof fs.stat>> | undefined;
  try {
    stat = await fs.stat(cronMdPath);
  } catch {
    console.log(
      `[cron-md-loader] CRON.md not found at path: ${cronMdPath}, cwd: ${process.cwd()}, returning empty schedules`,
    );
    const result: CronMdResult = { schedules: [], errors: [] };
    cache = { result, mtime: 0 };
    cachedPath = cronMdPath;
    return result;
  }

  // Read and parse file
  try {
    const content = await fs.readFile(cronMdPath, "utf-8");
    const result = parseCronMd(content);

    // Log results
    console.log(`[cron-md-loader] Loaded ${result.schedules.length} schedule(s)`);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.warn(`[cron-md-loader] ${error}`);
      }
    }

    // Update cache
    cache = { result, mtime: stat.mtimeMs };
    cachedPath = cronMdPath;

    return result;
  } catch (error) {
    console.error("[cron-md-loader] Failed to read CRON.md:", error);
    return { schedules: [], errors: [`Failed to read file: ${error}`] };
  }
}

/**
 * Clear the cache (for testing)
 */
export function clearCronMdCache(): void {
  cache = null;
  cachedPath = null;
}

/**
 * Generate CRON.md content from schedules
 *
 * Used by cron-manage tool to write back to CRON.md
 */
export function generateCronMd(schedules: Schedule[]): string {
  const lines = ["# Scheduled Tasks", ""];

  for (const schedule of schedules) {
    lines.push(`## ${schedule.name}`);
    lines.push(`- **Schedule**: \`${schedule.cron}\``);
    if (schedule.timezone) {
      lines.push(`- **Timezone**: ${schedule.timezone}`);
    }
    lines.push(`- **Message**: ${schedule.message}`);
    // Omit Target line for agent notification (it's the default)
    if (!(schedule.target.channelType === "agent" && schedule.target.channelId === "self")) {
      lines.push(`- **Target**: ${schedule.target.channelType} ${schedule.target.channelId}`);
    }
    // Output ThreadMode if explicitly set to isolated
    if (schedule.threadMode === "isolated") {
      lines.push("- **SessionMode**: isolated");
    }
    if (!schedule.enabled) {
      lines.push("- **Enabled**: false");
    }
    lines.push("");
  }

  return lines.join("\n");
}
