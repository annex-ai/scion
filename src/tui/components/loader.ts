// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Simple Loader Component
 *
 * Shows an animated spinner with a message.
 */

import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { colors } from "../theme";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class SimpleLoader implements Component {
  private message: string;
  private frame: number = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onRender: (() => void) | null = null;

  constructor(message: string = "Loading...") {
    this.message = message;
  }

  setMessage(message: string): void {
    this.message = message;
  }

  setOnRender(callback: () => void): void {
    this.onRender = callback;
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      this.onRender?.();
    }, 80);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  render(width: number): string[] {
    const spinner = colors.primary(SPINNER_FRAMES[this.frame]);
    const text = colors.secondary(this.message);
    return [truncateToWidth(`  ${spinner} ${text}`, width)];
  }
}
