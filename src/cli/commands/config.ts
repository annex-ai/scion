// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Config Commands
 * Manage configuration
 */

import type { Command } from "commander";
import { configExists, getConfigPath, loadConfig, saveConfig } from "../lib/config.js";
import { formatError, formatInfo, formatOutput, formatSuccess } from "../lib/output.js";

interface GetOptions {
  json?: boolean;
}

interface SetOptions {
  json?: boolean;
}

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage configuration");

  // config get
  config
    .command("get [key]")
    .description("Get configuration value(s)")
    .option("--json", "Output as JSON", false)
    .action(async (key: string | undefined, opts: GetOptions) => {
      try {
        const cfg = loadConfig();

        if (key) {
          // Get specific key
          const value = key.split(".").reduce((obj: any, k) => obj?.[k], cfg);
          if (value === undefined) {
            console.error(formatError(`Key "${key}" not found`));
            process.exit(1);
          }
          formatOutput(value, { json: opts.json });
        } else {
          // Get all config
          formatOutput(cfg, { json: opts.json });
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // config set
  config
    .command("set <key> <value>")
    .description("Set configuration value")
    .option("--json", "Output as JSON", false)
    .action(async (key: string, value: string, opts: SetOptions) => {
      try {
        const cfg = loadConfig();

        // Parse value
        let parsedValue: any = value;
        if (value === "true") parsedValue = true;
        else if (value === "false") parsedValue = false;
        else if (!Number.isNaN(Number(value))) parsedValue = Number(value);

        // Set nested key
        const keys = key.split(".");
        let target: any = cfg;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]]) target[keys[i]] = {};
          target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = parsedValue;

        saveConfig(cfg);
        formatSuccess(`Set ${key} = ${parsedValue}`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // config path
  config
    .command("path")
    .description("Show configuration file path")
    .action(async () => {
      console.log(getConfigPath());
    });

  // config init
  config
    .command("init")
    .description("Initialize configuration file")
    .action(async () => {
      try {
        if (configExists()) {
          formatInfo("Configuration already exists at:");
          console.log(getConfigPath());
          return;
        }

        const cfg = loadConfig();
        saveConfig(cfg);

        formatSuccess("Configuration initialized at:");
        console.log(getConfigPath());
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // Default: get all
  config.action(async () => {
    await config.commands.find((c) => c.name() === "get")?.parseAsync([]);
  });
}
