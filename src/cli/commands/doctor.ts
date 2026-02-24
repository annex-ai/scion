// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Doctor Command
 * Health check and diagnostics
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { configExists, loadConfig } from "../lib/config.js";
import { formatError, formatInfo, formatOutput, formatSuccess, formatWarning } from "../lib/output.js";

interface DoctorOptions {
  json?: boolean;
  fix?: boolean;
  yes?: boolean;
}

export function registerDoctorCommands(program: Command): void {
  program
    .command("doctor")
    .description("Health check and diagnostics")
    .option("--json", "Output as JSON", false)
    .option("--fix", "Attempt to fix issues", false)
    .option("--yes", "Answer yes to prompts", false)
    .action(async (opts: DoctorOptions) => {
      try {
        const checks: Array<{ name: string; status: "ok" | "warn" | "error"; message: string }> = [];

        // Check 1: Config exists
        if (configExists()) {
          checks.push({ name: "Config", status: "ok", message: "Configuration file exists" });
        } else {
          checks.push({ name: "Config", status: "warn", message: "Configuration not initialized" });
        }

        // Check 2: Gateway connectivity
        try {
          const client = new MastraClient();
          const status = await client.getGatewayStatus();
          if (status.status === "running") {
            checks.push({ name: "Gateway", status: "ok", message: "Gateway is running" });
          } else {
            checks.push({ name: "Gateway", status: "error", message: "Gateway is not running" });
          }
        } catch {
          checks.push({ name: "Gateway", status: "error", message: "Cannot connect to gateway" });
        }

        // Check 3: Environment variables
        const requiredEnvVars = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
        const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
        if (missingEnvVars.length === 0) {
          checks.push({ name: "Environment", status: "ok", message: "API keys configured" });
        } else {
          checks.push({ name: "Environment", status: "warn", message: `Missing: ${missingEnvVars.join(", ")}` });
        }

        if (opts.json) {
          formatOutput(checks, { json: true });
          return;
        }

        console.log("Health Check Results:\n");

        for (const check of checks) {
          const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
          console.log(`${icon} ${check.name}: ${check.message}`);
        }

        const errors = checks.filter((c) => c.status === "error").length;
        const warnings = checks.filter((c) => c.status === "warn").length;

        console.log();
        if (errors === 0 && warnings === 0) {
          formatSuccess("All checks passed!");
        } else if (errors === 0) {
          formatWarning(`${warnings} warning(s) found`);
        } else {
          formatError(`${errors} error(s), ${warnings} warning(s) found`);
          process.exit(1);
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });
}
