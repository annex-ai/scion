// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gateway Commands
 * Control the Gateway daemon
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { loadConfig, saveConfig } from "../lib/config.js";
import { formatError, formatInfo, formatOutput, formatSuccess } from "../lib/output.js";

interface StartOptions {
  port?: string;
  verbose?: boolean;
  daemon?: boolean;
  bind?: string;
}

interface StopOptions {
  force?: boolean;
}

interface StatusOptions {
  json?: boolean;
  deep?: boolean;
}

export function registerGatewayCommands(program: Command): void {
  const gateway = program.command("gateway").description("Control the Gateway daemon");

  // gateway start
  gateway
    .command("start")
    .description("Start the Gateway")
    .option("-p, --port <port>", "Port to bind the Gateway on")
    .option("-v, --verbose", "Enable verbose logging", false)
    .option("--daemon", "Run as background daemon", false)
    .option("--bind <address>", "Bind address (loopback|all)", "loopback")
    .action(async (opts: StartOptions) => {
      try {
        const config = loadConfig();
        const port = opts.port ? Number.parseInt(opts.port, 10) : config.gateway.port;

        config.gateway.port = port;
        config.gateway.verbose = opts.verbose || config.gateway.verbose;
        saveConfig(config);

        formatInfo(`Starting Gateway on port ${port}...`);

        if (opts.daemon) {
          console.log("Daemon mode not yet implemented. Running in foreground...");
        }

        const client = new MastraClient();
        await client.startGateway();

        formatSuccess(`Gateway started on http://${config.gateway.host}:${port}`);
        formatInfo("Use Ctrl+C to stop");
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // gateway stop
  gateway
    .command("stop")
    .description("Stop the Gateway gracefully")
    .option("--force", "Force stop", false)
    .action(async (opts: StopOptions) => {
      try {
        const client = new MastraClient();
        formatInfo("Stopping Gateway...");
        const result = await client.stopGateway();
        formatSuccess(`Gateway ${result.status} (grace period: ${result.gracePeriodMs}ms)`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // gateway restart
  gateway
    .command("restart")
    .description("Restart the Gateway")
    .action(async () => {
      try {
        const client = new MastraClient();
        formatInfo("Restarting Gateway...");
        const result = await client.restartGateway();
        formatSuccess(`Gateway ${result.status} (grace period: ${result.gracePeriodMs}ms)`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // gateway status
  gateway
    .command("status")
    .description("Show Gateway status")
    .option("--json", "Output as JSON", false)
    .option("--deep", "Deep health check", false)
    .action(async (opts: StatusOptions) => {
      try {
        const config = loadConfig();
        const client = new MastraClient();

        const status = await client.getGatewayStatus();

        if (opts.json) {
          formatOutput(
            {
              ...status,
              config: {
                host: config.gateway.host,
                port: config.gateway.port,
              },
            },
            { json: true },
          );
          return;
        }

        console.log("Gateway Status:\n");
        console.log(`  Status: ${status.status === "running" ? "✓ Running" : "✗ Stopped"}`);
        console.log(`  Host: ${config.gateway.host}`);
        console.log(`  Port: ${config.gateway.port}`);
        console.log(`  URL: http://${config.gateway.host}:${config.gateway.port}`);

        if (status.channels && status.channels.length > 0) {
          console.log(`\n  Connected Channels: ${status.channels.length}`);
          for (const ch of status.channels) {
            console.log(`    - ${ch.type}: ${ch.status}`);
          }
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // Default: show status
  gateway.action(async () => {
    await gateway.commands.find((c) => c.name() === "status")?.parseAsync([]);
  });
}
