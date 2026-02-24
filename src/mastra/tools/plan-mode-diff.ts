// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Plan Mode Diff Utilities
 *
 * Utilities for generating and formatting diffs for plan mode changes.
 * Uses the 'diff' package to generate unified diffs.
 */

import { createTwoFilesPatch, structuredPatch } from "diff";
import type { PlanChange, PlanSession } from "./plan-mode-manager";

/**
 * Generate a unified diff for a file change
 *
 * @param filePath - Path to the file
 * @param before - Original content (undefined for new files)
 * @param after - New content (undefined for deletions)
 * @param changeType - Type of change (write/edit/delete)
 * @returns Unified diff string
 */
export function generateDiff(
  filePath: string,
  before: string | undefined,
  after: string | undefined,
  changeType: "write" | "edit" | "delete",
): string {
  if (changeType === "write") {
    // New file - show diff from empty to new content
    return createTwoFilesPatch("/dev/null", filePath, "", after || "", "before", "after");
  }
  if (changeType === "delete") {
    // Deleted file - show diff from content to empty
    return createTwoFilesPatch(filePath, "/dev/null", before || "", "", "before", "after");
  }
  // Edit - show diff between old and new
  return createTwoFilesPatch(filePath, filePath, before || "", after || "", "before", "after");
}

/**
 * Generate a compact diff summary (just added/removed line counts)
 *
 * @param diff - Unified diff string
 * @returns Summary object with line counts
 */
export function getDiffSummary(diff: string): { added: number; removed: number; total: number } {
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
    }
  }

  return {
    added,
    removed,
    total: added + removed,
  };
}

/**
 * Format a file tree of changes
 *
 * Groups changes by directory and shows a tree view.
 *
 * @param changes - Array of plan changes
 * @returns Formatted file tree string
 */
export function formatFileTree(changes: PlanChange[]): string {
  if (changes.length === 0) {
    return "No changes";
  }

  // Group by directory
  const byDir = new Map<string, PlanChange[]>();

  for (const change of changes) {
    const parts = change.filePath.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";

    if (!byDir.has(dir)) {
      byDir.set(dir, []);
    }
    byDir.get(dir)!.push(change);
  }

  // Build tree
  const lines: string[] = [];
  const dirs = Array.from(byDir.keys()).sort();

  for (const dir of dirs) {
    lines.push(`\n${dir}/`);
    const dirChanges = byDir.get(dir)!;

    for (const change of dirChanges) {
      const fileName = change.filePath.split("/").pop() || change.filePath;
      const icon = change.type === "write" ? "+" : change.type === "delete" ? "-" : "~";
      const status = change.status === "approved" ? "✓" : change.status === "rejected" ? "✗" : "○";

      lines.push(`  ${status} ${icon} ${fileName}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a detailed plan summary with stats and diffs
 *
 * @param session - Plan session
 * @returns Markdown-formatted summary
 */
export function formatPlanSummary(session: PlanSession): string {
  const { id, changes, status, metadata, startedAt } = session;

  // Calculate stats
  const pending = changes.filter((c) => c.status === "pending").length;
  const approved = changes.filter((c) => c.status === "approved").length;
  const rejected = changes.filter((c) => c.status === "rejected").length;
  const executed = changes.filter((c) => c.status === "executed").length;

  const writes = changes.filter((c) => c.type === "write").length;
  const edits = changes.filter((c) => c.type === "edit").length;
  const deletes = changes.filter((c) => c.type === "delete").length;

  // Build summary
  let summary = `# Plan Summary: ${id}\n\n`;
  summary += `**Status:** ${status}\n`;
  summary += `**Started:** ${startedAt.toISOString()}\n`;

  if (metadata.initiator) {
    summary += `**Initiated by:** ${metadata.initiator}\n`;
  }

  if (metadata.reason) {
    summary += `**Reason:** ${metadata.reason}\n`;
  }

  summary += "\n## Statistics\n\n";
  summary += `- Total changes: ${changes.length}\n`;
  summary += `- Pending: ${pending}\n`;
  summary += `- Approved: ${approved}\n`;
  summary += `- Rejected: ${rejected}\n`;
  summary += `- Executed: ${executed}\n\n`;

  summary += "**Change types:**\n";
  summary += `- New files: ${writes}\n`;
  summary += `- Edits: ${edits}\n`;
  summary += `- Deletions: ${deletes}\n\n`;

  summary += "## File Tree\n";
  summary += formatFileTree(changes);
  summary += "\n\n";

  summary += "## Changes\n\n";

  for (const change of changes) {
    summary += `### ${change.id}\n\n`;
    summary += `**File:** ${change.filePath}\n`;
    summary += `**Type:** ${change.type}\n`;
    summary += `**Status:** ${change.status}\n`;
    summary += `**Tool:** ${change.metadata.tool}\n`;
    summary += `**Timestamp:** ${change.metadata.timestamp.toISOString()}\n`;

    if (change.metadata.reason) {
      summary += `**Reason:** ${change.metadata.reason}\n`;
    }

    if (change.diff) {
      const diffSummary = getDiffSummary(change.diff);
      summary += `\n**Diff summary:** +${diffSummary.added} -${diffSummary.removed} (${diffSummary.total} lines changed)\n\n`;
      summary += "```diff\n";
      summary += change.diff;
      summary += "\n```\n\n";
    }

    summary += "---\n\n";
  }

  return summary;
}

/**
 * Format a single change for display
 *
 * @param change - Plan change
 * @returns Formatted change string
 */
export function formatChange(change: PlanChange): string {
  let output = `**Change ID:** ${change.id}\n`;
  output += `**File:** ${change.filePath}\n`;
  output += `**Type:** ${change.type}\n`;
  output += `**Status:** ${change.status}\n`;
  output += `**Tool:** ${change.metadata.tool}\n`;
  output += `**Timestamp:** ${change.metadata.timestamp.toISOString()}\n`;

  if (change.metadata.reason) {
    output += `**Reason:** ${change.metadata.reason}\n`;
  }

  if (change.diff) {
    const diffSummary = getDiffSummary(change.diff);
    output += `\n**Diff summary:** +${diffSummary.added} -${diffSummary.removed} (${diffSummary.total} lines changed)\n\n`;
    output += "```diff\n";
    output += change.diff;
    output += "\n```\n";
  }

  return output;
}

/**
 * Get a compact one-line summary of a change
 *
 * @param change - Plan change
 * @returns One-line summary
 */
export function getChangeOneLine(change: PlanChange): string {
  const icon = change.type === "write" ? "+" : change.type === "delete" ? "-" : "~";
  const status = change.status === "approved" ? "✓" : change.status === "rejected" ? "✗" : "○";
  const fileName = change.filePath.split("/").pop() || change.filePath;

  let line = `${status} ${icon} ${fileName}`;

  if (change.diff) {
    const diffSummary = getDiffSummary(change.diff);
    line += ` (+${diffSummary.added}/-${diffSummary.removed})`;
  }

  return line;
}
