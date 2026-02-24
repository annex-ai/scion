// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Task Archive Utilities
 *
 * Shared functions for archiving and clearing working memory.
 * Used by the TaskArchive tool and potentially by heartbeat alerts.
 */

import { mkdir, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { parseAllTasks } from "../tools/task-helpers";
import { resolveConfigPath } from "./config";

const LOG_PREFIX = "[TaskArchive]";

// ============================================================================
// Types
// ============================================================================

export interface ArchiveOptions {
  forced?: boolean;
  reason?: string;
}

export interface ClearOptions {
  preserveNotes?: boolean;
  forced?: boolean;
  reason?: string;
}

// ============================================================================
// Detection
// ============================================================================

/**
 * Determines if all tasks in working memory are completed.
 *
 * Returns true only if at least one task exists AND every task is completed.
 */
export function isAllTasksComplete(markdown: string): boolean {
  const tasks = parseAllTasks(markdown);
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.status === "completed");
}

// ============================================================================
// Hashing (TOCTOU protection)
// ============================================================================

/**
 * Extracts the task-bearing portion of working memory.
 *
 * Isolates content between "### Pending Tasks:" and "## Progress Log:" (exclusive).
 * This avoids false TOCTOU mismatches from progress log timestamp changes.
 */
export function extractTaskSection(markdown: string): string {
  const startMarker = "### Pending Tasks:";
  const endMarker = "## Progress Log:";

  const startIdx = markdown.indexOf(startMarker);
  if (startIdx === -1) return "";

  const endIdx = markdown.indexOf(endMarker, startIdx);
  if (endIdx === -1) {
    // No progress log section — take everything from pending tasks onward
    return markdown.slice(startIdx);
  }

  return markdown.slice(startIdx, endIdx);
}

/**
 * Generates a fast, non-cryptographic hash of the task section.
 *
 * Uses Bun.hash for speed — we're detecting accidental changes, not attacks.
 */
export function hashTaskSection(markdown: string): string {
  const taskSection = extractTaskSection(markdown);
  return Bun.hash(taskSection).toString(16);
}

// ============================================================================
// Archive
// ============================================================================

/**
 * Extracts the goal line from working memory.
 */
function extractGoal(markdown: string): string {
  const match = markdown.match(/## Goal:\n(.+)/);
  return match?.[1]?.trim() ?? "[Unknown]";
}

/**
 * Extracts the Notes & Context section content from working memory.
 */
function extractNotes(markdown: string): string {
  const marker = "## Notes & Context:";
  const idx = markdown.indexOf(marker);
  if (idx === -1) return "";

  const content = markdown.slice(idx + marker.length);
  return content.trim();
}

/**
 * Extracts all completed task lines from working memory.
 */
function extractCompletedTaskLines(markdown: string): string[] {
  const lines = markdown.split("\n");
  return lines.filter((line) => /^- \[x\]\s*\[#\d+\]/.test(line));
}

/**
 * Appends a timestamped archive section to TASK-ARCHIVE.md.
 *
 * @returns The path to the archive file
 */
export async function archiveWorkingMemory(markdown: string, opts?: ArchiveOptions): Promise<string> {
  const archivePath = resolveConfigPath("TASK-ARCHIVE.md");
  const timestamp = new Date().toISOString();
  const goal = extractGoal(markdown);
  const tasks = parseAllTasks(markdown);
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const completedLines = extractCompletedTaskLines(markdown);
  const notes = extractNotes(markdown);

  const completionType = opts?.forced ? `Forced — "${opts.reason ?? "No reason provided"}"` : "Natural completion";

  const sections: string[] = [
    "---",
    "",
    `## Archive — ${timestamp}`,
    "",
    `**Goal:** ${goal}`,
    `**Tasks:** ${completedCount} completed`,
    `**Type:** ${completionType}`,
    "",
    "### Completed Tasks",
    ...completedLines,
    "",
  ];

  if (notes) {
    sections.push("### Notes & Context", notes, "");
  }

  const archiveSection = sections.join("\n");

  // Read existing content
  let existing = "";
  try {
    const file = Bun.file(archivePath);
    if (await file.exists()) {
      existing = await file.text();
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Append
  const newContent = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + archiveSection;
  await Bun.write(archivePath, newContent);

  console.log(
    JSON.stringify({
      event: "working-memory.archive-written",
      archivePath,
      taskCount: completedCount,
      completionType: opts?.forced ? "forced" : "natural",
      timestamp,
    }),
  );

  return archivePath;
}

// ============================================================================
// Clear
// ============================================================================

/**
 * Generates fresh working memory content after archival.
 */
export function buildClearedWorkingMemory(markdown: string, archivePath: string, opts?: ClearOptions): string {
  const preserveNotes = opts?.preserveNotes ?? true;
  const timestamp = new Date().toISOString();
  const tasks = parseAllTasks(markdown);
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const notes = preserveNotes ? extractNotes(markdown) : "";

  // Determine log entry text
  const relativePath = archivePath.includes(".agent/") ? `.agent/${archivePath.split(".agent/").pop()}` : archivePath;

  const completionSuffix = opts?.forced ? `(forced: "${opts.reason ?? "no reason"}")` : "(natural completion)";

  const logEntry = `[${timestamp}] Archived ${completedCount} tasks to ${relativePath} ${completionSuffix}`;

  const sections = [
    "## Goal:",
    "[Unset]",
    "",
    "### Pending Tasks:",
    "",
    "### Completed Tasks:",
    "",
    "## Progress Log:",
    `- ${logEntry}`,
    "",
    "## Notes & Context:",
    notes || "",
  ];

  return `${sections.join("\n")}\n`;
}

// ============================================================================
// Backup
// ============================================================================

/**
 * Creates a rolling backup before clearing working memory.
 *
 * Keeps last 5 backups, deletes older ones.
 * @returns The backup file path
 */
export async function backupWorkingMemory(markdown: string): Promise<string> {
  const backupDir = resolveConfigPath(".backups");

  // Ensure directory exists
  try {
    await mkdir(backupDir, { recursive: true });
  } catch {
    // Already exists
  }

  // Generate timestamped filename (replace colons for filesystem safety)
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const filename = `working-memory-${timestamp}.md`;
  const backupPath = resolve(backupDir, filename);

  // Write backup
  await Bun.write(backupPath, markdown);
  console.log(`${LOG_PREFIX} Backup written to ${backupPath}`);

  // Cleanup old backups (keep last 5)
  try {
    const files = await readdir(backupDir);
    const backups = files
      .filter((f) => f.startsWith("working-memory-"))
      .sort()
      .reverse();

    for (const old of backups.slice(5)) {
      try {
        await unlink(resolve(backupDir, old));
        console.log(`${LOG_PREFIX} Deleted old backup: ${old}`);
      } catch (e) {
        console.warn(`${LOG_PREFIX} Failed to delete old backup ${old}:`, e);
      }
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} Failed to cleanup old backups:`, e);
  }

  return backupPath;
}
