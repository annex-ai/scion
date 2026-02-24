// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Skills Commands
 * Manage agent skills
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { formatError, formatOutput, formatSuccess, formatTable } from "../lib/output.js";

interface ListOptions {
  json?: boolean;
}

interface InstallOptions {
  force?: boolean;
}

interface UninstallOptions {
  force?: boolean;
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command("skills").description("Manage agent skills");

  // skills list
  skills
    .command("list")
    .description("List available skills")
    .option("--json", "Output as JSON", false)
    .action(async (opts: ListOptions) => {
      try {
        const client = new MastraClient();
        const skillsList = await client.listSkills();

        if (opts.json) {
          formatOutput(skillsList, { json: true });
          return;
        }

        if (skillsList.length === 0) {
          console.log("No skills installed.");
          return;
        }

        console.log("Installed Skills:\n");
        formatTable(
          skillsList.map((s: any) => [s.id || s.folder, s.name || "-", s.skillPath || "-"]),
          ["ID", "Name", "Path"],
        );
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // skills info
  skills
    .command("info <name>")
    .description("Show skill information")
    .option("--json", "Output as JSON", false)
    .action(async (name: string, opts: { json?: boolean }) => {
      try {
        const client = new MastraClient();
        const skill = await client.getSkill(name);

        if (opts.json) {
          formatOutput(skill, { json: true });
          return;
        }

        console.log(`Skill: ${skill.name || skill.id}\n`);
        console.log(`  ID: ${skill.id}`);
        console.log(`  Folder: ${skill.folder}`);
        console.log(`  Path: ${skill.skillPath}`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // skills install (placeholder)
  skills
    .command("install <name>")
    .description("Install a skill")
    .option("--force", "Force reinstall", false)
    .action(async (name: string, opts: InstallOptions) => {
      try {
        console.log(`Skill installation is not yet implemented. Skill: ${name}`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // skills uninstall (placeholder)
  skills
    .command("uninstall <name>")
    .description("Uninstall a skill")
    .option("--force", "Force uninstall", false)
    .action(async (name: string, opts: UninstallOptions) => {
      try {
        console.log(`Skill uninstallation is not yet implemented. Skill: ${name}`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // Default: list
  skills.action(async () => {
    await skills.commands.find((c) => c.name() === "list")?.parseAsync([]);
  });
}
