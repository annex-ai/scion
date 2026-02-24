// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Logs Command
 * View agent logs via Mastra storage or real-time gateway stream
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { formatError, formatOutput } from "../lib/output.js";

interface LogsOptions {
  follow?: boolean;
  lines?: string;
  level?: string;
  since?: string;
  until?: string;
  json?: boolean;
}

export function registerLogsCommands(program: Command): void {
  program
    .command("logs")
    .description("View agent logs")
    .option("-f, --follow", "Follow log output (SSE stream from gateway)", false)
    .option("-n, --lines <count>", "Number of lines to show", "100")
    .option("--level <level>", "Filter by level (debug|info|warn|error)")
    .option("--since <time>", "Show logs since timestamp (ISO 8601)")
    .option("--until <time>", "Show logs until timestamp (ISO 8601)")
    .option("--json", "Output as JSON", false)
    .action(async (opts: LogsOptions) => {
      try {
        const client = new MastraClient();

        if (opts.follow) {
          // SSE streaming mode (real-time gateway events)
          const res = await client.streamLogs();
          const reader = res.body?.getReader();
          if (!reader) {
            console.error(formatError("No stream body"));
            process.exit(1);
          }
          const decoder = new TextDecoder();
          process.on("SIGINT", () => {
            reader.cancel();
            process.exit(0);
          });
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                try {
                  const entry = JSON.parse(data);
                  if (opts.json) {
                    console.log(JSON.stringify(entry));
                  } else {
                    const ts = entry.timestamp?.slice(11, 19) || "";
                    const lvl = (entry.level || "").toUpperCase().padEnd(5);
                    console.log(`${ts} [${lvl}] ${entry.component || "-"}: ${entry.message}`);
                  }
                } catch {
                  // skip non-JSON lines (comments, keepalives)
                }
              }
            }
          }
          return;
        }

        // Batch query mode (agent run logs from Mastra storage)
        const result = await client.getLogs({
          limit: Number.parseInt(opts.lines || "100", 10),
          level: opts.level,
          since: opts.since,
          until: opts.until,
        });

        if (opts.json) {
          formatOutput(result, { json: true });
          return;
        }

        if (result.logs.length === 0) {
          console.log("No log entries found.");
          return;
        }

        for (const entry of result.logs) {
          const ts = entry.timestamp?.slice(11, 19) || entry.createdAt?.slice(11, 19) || "";
          const lvl = (entry.level || entry.logLevel || "").toUpperCase().padEnd(5);
          console.log(`${ts} [${lvl}] ${entry.component || entry.message || JSON.stringify(entry)}`);
        }

        if (result.hasMore) {
          console.log(`\n  ... ${result.total} total entries. Showing first ${result.logs.length}.`);
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });
}
