// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TUI Command
 *
 * Launch the interactive Terminal UI for the agent.
 */

import type { Command } from "commander";
import { formatError } from "../lib/output.js";

export function registerTUICommands(program: Command): void {
  program
    .command("tui")
    .description("Launch interactive Terminal UI")
    .option("--mode <mode>", "Initial mode (default, fast)", "default")
    .option("--thread <id>", "Resume a specific thread")
    .addHelpText(
      "after",
      `
Features:
  - Streaming responses with live updates
  - Tool approval dialogs
  - Mode and model switching
  - Thread management
  - Markdown rendering

Commands (in TUI):
  /mode [name]    Switch agent mode
  /model [id]     Switch model
  /new [title]    Create new thread
  /threads        List threads
  /clear          Clear messages
  /help           Show help
  /quit           Exit

Keyboard:
  Enter           Send message
  Shift+Enter     New line
  Tab             Autocomplete
  Ctrl+C          Exit
    `
    )
    .action(async (opts) => {
      try {
        // Dynamic import to avoid loading TUI dependencies for other commands
        const { AgentTUI } = await import("../../tui/app.js");
        const { getHarness } = await import("../../mastra/harness-manager.js");

        console.log("Starting TUI...");
        console.log("Initializing harness...");

        // Get the harness singleton
        const harness = await getHarness();

        // Switch to specified mode if provided
        if (opts.mode && opts.mode !== harness.getCurrentModeId()) {
          await harness.switchMode({ modeId: opts.mode });
        }

        // Switch to specified thread if provided
        if (opts.thread) {
          try {
            await harness.switchThread({ threadId: opts.thread });
          } catch {
            console.log(`Thread ${opts.thread} not found, creating new thread...`);
            await harness.createThread({ title: `CLI: ${opts.thread}` });
          }
        }

        // Create and start TUI
        const tui = new AgentTUI({ harness });
        await tui.start();
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });
}
