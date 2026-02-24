// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Sessions Commands (backed by Threads API)
 * Manage agent conversation threads
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { formatError, formatOutput, formatSuccess, formatTable, formatWarning } from "../lib/output.js";

interface ListOptions {
  json?: boolean;
  resourceId?: string;
  limit?: string;
}

interface ShowOptions {
  json?: boolean;
}

interface DeleteOptions {
  force?: boolean;
}

export function registerSessionsCommands(program: Command): void {
  const sessions = program.command("sessions").description("Manage agent conversation threads");

  // sessions list
  sessions
    .command("list")
    .description("List conversation threads")
    .option("--json", "Output as JSON", false)
    .option("--resource-id <id>", "Filter by resource ID")
    .option("--limit <count>", "Maximum threads to return", "50")
    .action(async (opts: ListOptions) => {
      try {
        const client = new MastraClient();
        const result = await client.listThreads({
          resourceId: opts.resourceId,
          perPage: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
        });

        if (opts.json) {
          formatOutput(result, { json: true });
          return;
        }

        if (result.threads.length === 0) {
          console.log("No threads found.");
          return;
        }

        console.log(`Threads (${result.total} total):\n`);
        formatTable(
          result.threads.map((t: any) => [
            t.id.length > 24 ? `${t.id.slice(0, 24)}...` : t.id,
            t.title || "-",
            new Date(t.createdAt).toLocaleString(),
            new Date(t.updatedAt).toLocaleString(),
          ]),
          ["ID", "Title", "Created", "Updated"],
        );

        if (result.hasMore) {
          console.log(`\n  ... and ${result.total - result.threads.length} more. Use --limit to see more.`);
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // sessions show
  sessions
    .command("show <id>")
    .description("Show thread details and messages")
    .option("--json", "Output as JSON", false)
    .action(async (id: string, opts: ShowOptions) => {
      try {
        const client = new MastraClient();
        const thread = await client.getThread(id);

        if (!thread) {
          console.error(formatError(`Thread "${id}" not found`));
          process.exit(1);
        }

        if (opts.json) {
          formatOutput(thread, { json: true });
          return;
        }

        console.log(`Thread: ${thread.id}\n`);
        console.log(`  Resource: ${thread.resourceId}`);
        if (thread.title) console.log(`  Title: ${thread.title}`);
        console.log(`  Created: ${new Date(thread.createdAt).toLocaleString()}`);
        console.log(`  Updated: ${new Date(thread.updatedAt).toLocaleString()}`);

        // Fetch recent messages
        const msgs = await client.getThreadMessages(id, { perPage: 10 });
        if (msgs.messages.length > 0) {
          console.log(`\n  Recent Messages (${msgs.messages.length}):\n`);
          for (const m of msgs.messages) {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            const preview = content.length > 80 ? `${content.slice(0, 80)}...` : content;
            console.log(`    [${m.role}] ${preview}`);
          }
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // sessions delete
  sessions
    .command("delete <id>")
    .description("Delete a thread")
    .option("--force", "Skip confirmation", false)
    .action(async (id: string, opts: DeleteOptions) => {
      try {
        const client = new MastraClient();
        const result = await client.deleteThread(id);
        if (result.result === "not_found") {
          formatWarning(`Thread "${id}" was already deleted or does not exist`);
        } else {
          formatSuccess(`Thread "${id}" deleted`);
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // Default: list
  sessions.action(async () => {
    await sessions.commands.find((c) => c.name() === "list")?.parseAsync([]);
  });
}
