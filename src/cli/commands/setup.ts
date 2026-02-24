// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Setup Command
 * Interactive setup wizard
 */

import type { Command } from "commander";
import { configExists, loadConfig, saveConfig } from "../lib/config.js";
import { formatError, formatInfo, formatSuccess } from "../lib/output.js";

interface SetupOptions {
  nonInteractive?: boolean;
  installDaemon?: boolean;
  channel?: string;
  quick?: boolean;
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive setup wizard (alias: onboard)")
    .alias("onboard")
    .option("--non-interactive", "Non-interactive mode", false)
    .option("--install-daemon", "Install as system service", false)
    .option("--channel <type>", "Pre-configure channel type")
    .option("--quick", "Quick setup with defaults", false)
    .action(async (opts: SetupOptions) => {
      try {
        formatInfo("Agent Setup Wizard");
        formatInfo("==================\n");

        if (configExists()) {
          formatInfo("Configuration already exists.");
          formatInfo('Run "agent config get" to view current config.');
          formatInfo('Run "agent config init --force" to reinitialize.');
          return;
        }

        const config = loadConfig();

        if (opts.quick) {
          // Quick setup with defaults
          saveConfig(config);
          formatSuccess("Quick setup complete!");
        } else {
          // Interactive setup
          formatInfo("Initializing configuration...");
          saveConfig(config);
          formatSuccess("Configuration initialized!");
        }

        formatInfo("\nNext steps:");
        console.log("  1. Set your API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY)");
        console.log('  2. Run "agent gateway start" to start the gateway');
        console.log('  3. Run "agent channels connect <type>" to add a channel');
        console.log('  4. Run "agent --message \\"Hello\\"" to test');
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });
}
