// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Tool Approval Component
 *
 * Interactive dialog for approving/declining tool calls.
 */

import type { Component } from "@mariozechner/pi-tui";
import { matchesKey, Key, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { toolApprovalColors, colors } from "../theme";
import type { PendingToolApproval } from "../state";

export interface ToolApprovalHandlers {
  onApprove: () => void;
  onDecline: () => void;
  onAlwaysAllow: () => void;
}

export class ToolApprovalDialog implements Component {
  private approval: PendingToolApproval | null = null;
  private handlers: ToolApprovalHandlers | null = null;
  private selectedOption: number = 0;

  invalidate(): void {
    // No-op - invalidation handled by parent compositor
  }

  setApproval(approval: PendingToolApproval | null, handlers: ToolApprovalHandlers | null): void {
    this.approval = approval;
    this.handlers = handlers;
    this.selectedOption = 0;
  }

  handleInput(data: string): void {
    if (!this.approval || !this.handlers) return;

    if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
      this.selectedOption = Math.max(0, this.selectedOption - 1);
    } else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
      this.selectedOption = Math.min(2, this.selectedOption + 1);
    } else if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      this.executeSelected();
    } else if (matchesKey(data, "y")) {
      this.handlers.onApprove();
    } else if (matchesKey(data, "n")) {
      this.handlers.onDecline();
    } else if (matchesKey(data, "a")) {
      this.handlers.onAlwaysAllow();
    } else if (matchesKey(data, Key.escape)) {
      this.handlers.onDecline();
    }
  }

  private executeSelected(): void {
    if (!this.handlers) return;
    switch (this.selectedOption) {
      case 0:
        this.handlers.onApprove();
        break;
      case 1:
        this.handlers.onDecline();
        break;
      case 2:
        this.handlers.onAlwaysAllow();
        break;
    }
  }

  render(width: number): string[] {
    if (!this.approval) {
      return [];
    }

    const lines: string[] = [];
    const boxWidth = Math.min(width - 4, 60);
    const border = colors.border;

    // Top border
    lines.push(border("  " + "─".repeat(boxWidth)));

    // Title
    lines.push(border("  │ ") + toolApprovalColors.toolName("Tool Approval Required") + border(" │"));
    lines.push(border("  " + "─".repeat(boxWidth)));

    // Tool info
    const toolLine = `  Tool: ${this.approval.toolName}`;
    lines.push(border("  │") + truncateToWidth(toolApprovalColors.toolName(toolLine), boxWidth - 2) + border("│"));

    const categoryLine = `  Category: ${this.approval.category}`;
    lines.push(border("  │") + truncateToWidth(toolApprovalColors.category(categoryLine), boxWidth - 2) + border("│"));

    // Args (truncated)
    const argsStr = JSON.stringify(this.approval.args);
    const argsLine = `  Args: ${argsStr.slice(0, 40)}${argsStr.length > 40 ? "..." : ""}`;
    lines.push(border("  │") + truncateToWidth(toolApprovalColors.args(argsLine), boxWidth - 2) + border("│"));

    // Separator
    lines.push(border("  " + "─".repeat(boxWidth)));

    // Options
    const options = [
      { key: "y", label: "Approve", color: toolApprovalColors.approve },
      { key: "n", label: "Decline", color: toolApprovalColors.decline },
      { key: "a", label: "Always Allow (category)", color: toolApprovalColors.alwaysAllow },
    ];

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const prefix = i === this.selectedOption ? "> " : "  ";
      const optLine = `${prefix}[${opt.key}] ${opt.label}`;
      const styled = i === this.selectedOption ? colors.highlight(optLine) : opt.color(optLine);
      const paddedLine = truncateToWidth(styled, boxWidth - 4);
      const padRight = " ".repeat(Math.max(0, boxWidth - 4 - visibleWidth(paddedLine)));
      lines.push(border("  │ ") + paddedLine + padRight + border(" │"));
    }

    // Bottom border
    lines.push(border("  " + "─".repeat(boxWidth)));

    return lines;
  }
}
