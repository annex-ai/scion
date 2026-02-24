// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Cron Commands
 * Manage scheduled jobs via the CronService API
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { formatError, formatInfo, formatOutput, formatSuccess, formatTable } from "../lib/output.js";

interface ListOptions {
  json?: boolean;
}

export function registerCronCommands(program: Command): void {
  const cron = program.command("cron").description("Manage scheduled jobs");

  // cron list
  cron
    .command("list")
    .description("List active scheduled jobs")
    .option("--json", "Output as JSON", false)
    .action(async (opts: ListOptions) => {
      try {
        const client = new MastraClient();
        const data = await client.listCronJobs();

        if (opts.json) {
          formatOutput(data.items, { json: true });
          return;
        }

        if (data.items.length === 0) {
          console.log("No scheduled jobs.");
          formatInfo('Add schedules to .agent/CRON.md, then run "agent cron reload".');
          return;
        }

        console.log("Scheduled Jobs:\n");
        formatTable(
          data.items.map((j: any) => {
            const desc = j.message || (j.workflow ? `workflow:${j.workflow.workflowId}` : "-");
            return [
              j.name,
              j.cron,
              j.enabled ? "✓" : "✗",
              j.target?.channelType || "-",
              j.nextRun ? new Date(j.nextRun).toLocaleString() : "never",
              desc.length > 40 ? `${desc.slice(0, 40)}...` : desc,
            ];
          }),
          ["Name", "Schedule", "On", "Channel", "Next Run", "Task"],
        );
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // cron trigger
  cron
    .command("trigger <name>")
    .description("Trigger a scheduled job immediately")
    .action(async (name: string) => {
      try {
        const client = new MastraClient();
        const result = await client.triggerCronJob(name);
        formatSuccess(`Triggered "${name}": ${result.status}`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // cron reset
  cron
    .command("reset <name>")
    .description("Reset threads for a scheduled job")
    .action(async (name: string) => {
      try {
        const client = new MastraClient();
        const result = await client.resetCronJob(name);
        if (result.success) {
          formatSuccess(result.message);
        } else {
          console.error(formatError(result.message));
          process.exit(1);
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // cron reload
  cron
    .command("reload")
    .description("Force reload CRON.md schedules")
    .action(async () => {
      try {
        const client = new MastraClient();
        const result = await client.reloadCron();
        formatSuccess(`Reloaded: ${result.scheduleCount} schedule(s) active`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // Default: list
  cron.action(async () => {
    await cron.commands.find((c) => c.name() === "list")?.parseAsync([]);
  });
}
