// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Slash Command Processor (Input)
 *
 * Intercepts messages starting with `/`, looks up the command in
 * pre-loaded custom commands, and expands the template — replacing
 * the user's message text with the fully expanded prompt.
 *
 * Works everywhere the agent is called (Studio, API, gateway) with
 * zero per-channel wiring.
 */

import type { ProcessInputArgs, ProcessInputResult, Processor } from "@mastra/core/processors";
import type { SlashCommandMetadata } from "../utils/slash-command-loader";
import { formatCommandForDisplay, processSlashCommand } from "../utils/slash-command-processor";

export interface SlashCommandProcessorOptions {
  /** Pre-loaded command map (name → metadata) */
  commands: Map<string, SlashCommandMetadata>;
  /** Project root for shell/file expansion in templates */
  projectRoot: string;
}

/**
 * Input processor that expands custom slash commands before the agent sees them.
 *
 * - `/commandName args...` → expand template and replace message text
 * - `/commands` → inject a listing of available commands as a system message
 * - Anything else → pass through unchanged
 */
export class SlashCommandProcessor implements Processor {
  readonly id = "slash-command";
  readonly name = "Slash Command Processor";

  private commands: Map<string, SlashCommandMetadata>;
  private projectRoot: string;

  constructor(options: SlashCommandProcessorOptions) {
    this.commands = options.commands;
    this.projectRoot = options.projectRoot;
  }

  async processInput({ messages, systemMessages }: ProcessInputArgs): Promise<ProcessInputResult> {
    // Find last user message
    const lastIdx = findLastIndex(messages, (m) => m.role === "user");
    if (lastIdx === -1) return { messages, systemMessages: systemMessages ?? [] };

    const userMessage = messages[lastIdx]!;
    const content = userMessage.content;
    if (!content || typeof content !== "object" || !("parts" in content)) {
      return { messages, systemMessages: systemMessages ?? [] };
    }

    // Find text part and check for /command
    const textPart = (content as any).parts.find((p: any) => p.type === "text");
    if (!textPart?.text?.trim().startsWith("/")) {
      return { messages, systemMessages: systemMessages ?? [] };
    }

    // Parse command name + args
    const tokens = textPart.text.trim().split(/\s+/);
    const commandName = tokens[0]!.slice(1); // strip leading /
    const args = tokens.slice(1);

    // /commands → list available commands as system message
    if (commandName === "commands") {
      const listing = formatCommandList(this.commands);
      return {
        messages,
        systemMessages: [...(systemMessages ?? []), { role: "system" as const, content: listing }],
      };
    }

    // Look up command (exact match or colon→slash variant)
    const command = this.commands.get(commandName) ?? this.commands.get(commandName.replace(/:/g, "/"));
    if (!command) return { messages, systemMessages: systemMessages ?? [] };

    // Expand template and replace text part
    const expanded = await processSlashCommand(command, args, this.projectRoot);
    const newParts = (content as any).parts.map((p: any) => (p === textPart ? { ...p, text: expanded } : p));
    const newMessages = [...messages];
    newMessages[lastIdx] = {
      ...userMessage,
      content: { ...(content as any), parts: newParts },
    };

    return { messages: newMessages, systemMessages: systemMessages ?? [] };
  }
}

/**
 * Format the command map into a human-readable listing.
 */
function formatCommandList(commands: Map<string, SlashCommandMetadata>): string {
  if (commands.size === 0) {
    return "No custom slash commands are loaded. Create `.md` files in `.agent/commands/` to add commands.";
  }

  const lines = ["Available slash commands:", ""];
  for (const cmd of commands.values()) {
    lines.push(`  /${formatCommandForDisplay(cmd)}`);
  }
  lines.push("", "Run a command: /commandName [args...]");
  return lines.join("\n");
}

/**
 * Array.findLastIndex polyfill (available in ES2023+ but not all targets).
 */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) return i;
  }
  return -1;
}
