// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Status Command
 * Show system status
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { loadConfig } from "../lib/config.js";
import { formatError, formatOutput } from "../lib/output.js";

interface StatusOptions {
  json?: boolean;
  deep?: boolean;
  all?: boolean;
  usage?: boolean;
}

export function registerStatusCommands(program: Command): void {
  program
    .command("status")
    .description("Show system status")
    .option("--json", "Output as JSON", false)
    .option("--deep", "Deep status check", false)
    .option("--all", "Show all components", false)
    .option("--usage", "Show resource usage", false)
    .action(async (opts: StatusOptions) => {
      try {
        const config = loadConfig();
        const client = new MastraClient();

        const status = {
          gateway: await client.getGatewayStatus(),
          config: {
            host: config.gateway.host,
            port: config.gateway.port,
          },
          channels: Object.entries(config.channels || {})
            .filter(([_, cfg]: [string, any]) => cfg?.enabled)
            .map(([type]) => type),
          version: "0.1.0",
        };

        if (opts.json) {
          formatOutput(status, { json: true });
          return;
        }

        console.log("System Status\n");
        console.log(`  Gateway: ${status.gateway.status === "running" ? "✓ Running" : "✗ Stopped"}`);
        console.log(`Address: http://${status.config.host}:${status.config.port}`);
        console.log(`Version: ${status.version}`);
        console.log(`Channels: ${status.channels.length > 0 ? status.channels.join(", ") : "None"}`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });
}
