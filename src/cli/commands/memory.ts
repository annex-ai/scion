// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Memory Commands
 * Manage agent memory (threads, working memory)
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { formatError, formatInfo, formatOutput, formatSuccess } from "../lib/output.js";

interface StatusOptions {
  resourceId?: string;
  json?: boolean;
}

interface ResetOptions {
  resourceId?: string;
  force?: boolean;
}

export function registerMemoryCommands(program: Command): void {
  const memory = program.command("memory").description("Manage agent memory");

  // memory status
  memory
    .command("status")
    .description("Show memory status")
    .option("--resource-id <id>", "Resource ID (defaults to agent config)")
    .option("--json", "Output as JSON", false)
    .action(async (opts: StatusOptions) => {
      try {
        const client = new MastraClient();
        const status = await client.getMemoryStatus(opts.resourceId);

        if (opts.json) {
          formatOutput(status, { json: true });
          return;
        }

        console.log("Memory Status:\n");
        console.log(`  Resource ID: ${status.resourceId}`);
        console.log(`  Threads: ${status.threadCount}`);
        console.log(
          `  Working Memory: ${status.workingMemory.exists ? `${status.workingMemory.length} chars` : "none"}`,
        );
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // memory reset
  memory
    .command("reset")
    .description("Reset/clear all threads for a resource")
    .option("--resource-id <id>", "Resource ID (defaults to agent config)")
    .option("--force", "Skip confirmation", false)
    .action(async (opts: ResetOptions) => {
      try {
        const client = new MastraClient();
        formatInfo("Resetting memory...");
        const result = await client.resetMemory(opts.resourceId);
        formatSuccess(`Memory reset: ${result.deleted} thread(s) deleted for resource "${result.resourceId}"`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // memory compact (deferred — not yet implemented server-side)
  memory
    .command("compact")
    .description("Compact memory (not yet implemented)")
    .action(async () => {
      formatInfo("Memory compaction via API is not yet implemented.");
      formatInfo("Compaction happens automatically during agent processing.");
    });

  // Default: status
  memory.action(async () => {
    await memory.commands.find((c) => c.name() === "status")?.parseAsync([]);
  });
}
