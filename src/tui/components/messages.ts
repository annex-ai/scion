// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Messages Component
 *
 * Displays conversation messages with markdown rendering.
 */

import type { Component } from "@mariozechner/pi-tui";
import { Markdown } from "@mariozechner/pi-tui";
import { markdownTheme, colors } from "../theme";
import type { Message } from "../state";

export class MessagesDisplay implements Component {
  private messages: Message[] = [];
  private cachedLines: string[] | null = null;
  private cachedWidth: number | null = null;

  setMessages(messages: Message[]): void {
    // Check if messages changed
    if (
      this.messages.length !== messages.length ||
      messages.some((m, i) => m.id !== this.messages[i]?.id || m.content !== this.messages[i]?.content)
    ) {
      this.messages = messages;
      this.invalidate();
    }
  }

  invalidate(): void {
    this.cachedLines = null;
    this.cachedWidth = null;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    if (this.messages.length === 0) {
      this.cachedLines = [colors.muted("  No messages yet. Type a message to begin.")];
      this.cachedWidth = width;
      return this.cachedLines;
    }

    const lines: string[] = [];

    for (const message of this.messages) {
      // Role header
      const roleColor = this.getRoleColor(message.role);
      const roleLabel = message.role === "tool" ? `Tool: ${message.toolName}` : message.role;
      lines.push(roleColor(`  ${roleLabel.toUpperCase()}`));

      // Message content
      if (message.role === "tool" && message.toolArgs) {
        // Format tool args
        const argsStr = JSON.stringify(message.toolArgs, null, 2);
        const argsLines = argsStr.split("\n").map((l) => colors.muted(`    ${l}`));
        lines.push(...argsLines);
      } else if (message.content) {
        // Use markdown for assistant messages
        if (message.role === "assistant") {
          const md = new Markdown(message.content, 2, 0, markdownTheme);
          const mdLines = md.render(width - 4);
          lines.push(...mdLines.map((l) => `  ${l}`));
        } else {
          // Simple text for user/system messages
          const contentLines = message.content.split("\n").map((l) => `    ${l}`);
          lines.push(...contentLines);
        }
      }

      // Streaming indicator
      if (message.isStreaming) {
        lines.push(colors.muted("  ..."));
      }

      // Spacer between messages
      lines.push("");
    }

    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }

  private getRoleColor(role: Message["role"]): (text: string) => string {
    switch (role) {
      case "user":
        return colors.user;
      case "assistant":
        return colors.assistant;
      case "system":
        return colors.system;
      case "tool":
        return colors.tool;
    }
  }
}
