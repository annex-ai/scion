// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Message Commands
 * Send outbound messages via gateway channels
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { formatError, formatOutput, formatSuccess } from "../lib/output.js";

interface SendOptions {
  to: string;
  message: string;
  channel?: string;
  thread?: string;
  json?: boolean;
}

export function registerMessageCommands(program: Command): void {
  const message = program.command("message").description("Send outbound messages");

  // message send
  message
    .command("send")
    .description("Send a message to a contact or channel")
    .requiredOption("--to <recipient>", "Recipient (phone number, user ID, or channel)")
    .requiredOption("-m, --message <text>", "Message text")
    .option("--channel <type>", "Channel type (whatsapp|telegram|slack|discord)")
    .option("--thread <id>", "Thread ID for threaded messages")
    .option("--json", "Output as JSON", false)
    .addHelpText(
      "after",
      `
Examples:
  message send --to +15555550123 --message "Hello" --channel whatsapp
  message send --to "@username" --message "Hi there" --channel telegram
  message send --to "#general" --message "Team update" --channel slack
    `,
    )
    .action(async (opts: SendOptions) => {
      try {
        if (!opts.channel) {
          console.error(formatError("--channel is required (e.g. telegram, slack, discord)"));
          process.exit(1);
        }

        const client = new MastraClient();
        const result = await client.sendMessage({
          channel: opts.channel,
          to: opts.to,
          message: opts.message,
          threadId: opts.thread,
        });

        if (opts.json) {
          formatOutput(result, { json: true });
          return;
        }

        if (result.status === "sent") {
          formatSuccess(`Message sent to ${opts.to} via ${opts.channel} (id: ${result.messageId})`);
        } else {
          console.error(formatError(`Message failed: ${result.error || "Unknown error"}`));
          process.exit(1);
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // Default: show help
  message.action(async () => {
    message.help();
  });
}
