// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Channels Commands
 * Manage messaging channel connections
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { type ChannelConfig, loadConfig, saveConfig } from "../lib/config.js";
import { formatError, formatInfo, formatOutput, formatSuccess, formatTable } from "../lib/output.js";

interface ListOptions {
  json?: boolean;
}

interface StatusOptions {
  json?: boolean;
}

interface ConnectOptions {
  json?: boolean;
}

interface DisconnectOptions {
  force?: boolean;
  json?: boolean;
}

const CHANNEL_TYPES = ["whatsapp", "telegram", "slack", "discord", "googlechat", "signal", "imessage"];

export function registerChannelsCommands(program: Command): void {
  const channels = program.command("channels").description("Manage messaging channel connections");

  // channels list — fetch live status from gateway
  channels
    .command("list")
    .description("List channels with live connection status")
    .option("--json", "Output as JSON", false)
    .action(async (opts: ListOptions) => {
      try {
        const client = new MastraClient();
        const channelsList = await client.listChannels();

        if (opts.json) {
          formatOutput(channelsList, { json: true });
          return;
        }

        if (channelsList.length === 0) {
          console.log("No channels connected.");
          console.log("Configure channels via environment variables and restart the gateway.");
          return;
        }

        console.log("Connected Channels:\n");
        formatTable(
          channelsList.map((ch) => [ch.type, ch.name, ch.connected ? "✓ connected" : "✗ disconnected"]),
          ["Type", "Name", "Status"],
        );
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // channels status
  channels
    .command("status [type]")
    .description("Show channel connection status")
    .option("--json", "Output as JSON", false)
    .action(async (type: string | undefined, opts: StatusOptions) => {
      try {
        const client = new MastraClient();

        if (type) {
          const status = await client.getChannelStatus(type);
          if (opts.json) {
            formatOutput(status, { json: true });
            return;
          }
          console.log(`Channel: ${status.type}`);
          console.log(`  Name: ${status.name}`);
          console.log(`  Connected: ${status.connected ? "✓" : "✗"}`);
          return;
        }

        // All channels
        const channelsList = await client.listChannels();

        if (opts.json) {
          formatOutput(channelsList, { json: true });
          return;
        }

        console.log("Channel Status:\n");
        formatTable(
          channelsList.map((s) => [s.type, s.name, s.connected ? "✓ connected" : "✗ disconnected"]),
          ["Type", "Name", "Status"],
        );
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // channels connect
  channels
    .command("connect <type>")
    .description("Connect a messaging channel (whatsapp|telegram|slack|discord|googlechat|signal|imessage)")
    .option("--json", "Output as JSON", false)
    .action(async (type: string, opts: ConnectOptions) => {
      try {
        if (!CHANNEL_TYPES.includes(type)) {
          console.error(formatError(`Unknown channel type: ${type}`));
          console.log(`Supported types: ${CHANNEL_TYPES.join(", ")}`);
          process.exit(1);
        }

        const config = loadConfig();
        if (!config.channels) config.channels = {};

        config.channels[type as keyof typeof config.channels] = {
          enabled: true,
        } as ChannelConfig;

        saveConfig(config);

        formatSuccess(`Channel "${type}" configured`);
        formatInfo(`To complete setup, set the required environment variables for ${type}`);
        showChannelSetupInstructions(type);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // channels disconnect
  channels
    .command("disconnect <type>")
    .description("Disconnect a channel")
    .option("--force", "Force disconnect", false)
    .option("--json", "Output as JSON", false)
    .action(async (type: string, opts: DisconnectOptions) => {
      try {
        const config = loadConfig();

        if (!config.channels?.[type as keyof typeof config.channels]) {
          console.error(formatError(`Channel "${type}" is not configured`));
          process.exit(1);
        }

        (config.channels[type as keyof typeof config.channels] as ChannelConfig).enabled = false;
        saveConfig(config);

        formatSuccess(`Channel "${type}" disconnected`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // Default: show list
  channels.action(async () => {
    await channels.commands.find((c) => c.name() === "list")?.parseAsync([]);
  });
}

function showChannelSetupInstructions(type: string): void {
  const instructions: Record<string, string[]> = {
    whatsapp: ["Set WHATSAPP_SESSION_PATH for session storage", "Scan QR code on first run"],
    telegram: ["Set TELEGRAM_BOT_TOKEN from @BotFather"],
    slack: ["Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN"],
    discord: ["Set DISCORD_BOT_TOKEN"],
    googlechat: ["Set GOOGLE_CHAT_CREDENTIALS_PATH"],
    signal: ["Install signal-cli and configure phone number"],
    imessage: ["macOS only: Configure BlueBubbles or legacy imsg"],
  };

  const steps = instructions[type];
  if (steps) {
    console.log("\nSetup instructions:");
    steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  }
}
