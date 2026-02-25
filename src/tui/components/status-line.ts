// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Status Line Component
 *
 * Displays mode, model, thread, OM status, and processing state.
 */

import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { statusColors } from "../theme";
import type { TUIState, OMStatus } from "../state";

export class StatusLine implements Component {
  private state: TUIState | null = null;

  setState(state: TUIState): void {
    this.state = state;
  }

  invalidate(): void {
    // No-op - invalidation handled by parent compositor
  }

  render(width: number): string[] {
    if (!this.state) {
      return [truncateToWidth(" Initializing...", width)];
    }

    const parts: string[] = [];

    // Mode indicator
    const modeColor =
      this.state.currentModeId === "fast" ? statusColors.mode.fast : statusColors.mode.default;
    parts.push(modeColor(` ${this.state.currentModeId.toUpperCase()} `));

    // Model
    if (this.state.currentModelId) {
      const shortModel = this.state.currentModelId.split("/").pop() || this.state.currentModelId;
      parts.push(statusColors.model(` ${shortModel} `));
    }

    // Thread
    if (this.state.currentThreadId) {
      const shortThread = this.state.currentThreadId.slice(0, 12);
      parts.push(statusColors.thread(` ${shortThread}... `));
    }

    // OM Status
    const omStatus = this.formatOMStatus(this.state.omStatus);
    if (omStatus) {
      parts.push(omStatus);
    }

    // Processing indicator
    if (this.state.isProcessing) {
      parts.push(statusColors.running(" Processing... "));
    }

    // Error indicator
    if (this.state.error) {
      parts.push(statusColors.mode.fast(` Error `));
    }

    // Join parts and truncate to width
    const line = parts.join(" | ");
    const visible = visibleWidth(line);

    if (visible > width) {
      return [truncateToWidth(line, width)];
    }

    // Pad to full width for consistent appearance
    return [line + " ".repeat(width - visible)];
  }

  private formatOMStatus(omStatus: OMStatus): string {
    switch (omStatus.state) {
      case "observing":
        return statusColors.om.observing(" OM:observing ");
      case "reflecting":
        return statusColors.om.reflecting(" OM:reflecting ");
      default:
        return "";
    }
  }
}
