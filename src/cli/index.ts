#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Agent CLI - Entry Point
 */

import { createRequire } from "node:module";
import { Command } from "commander";
import { registerAgentCommands } from "./commands/agent.js";
import { registerAgentsCommands } from "./commands/agents.js";
import { registerBrowserCommands } from "./commands/browser.js";
import { registerChannelsCommands } from "./commands/channels.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerCronCommands } from "./commands/cron.js";
import { registerDoctorCommands } from "./commands/doctor.js";
import { registerGatewayCommands } from "./commands/gateway.js";
import { registerLogsCommands } from "./commands/logs.js";
import { registerMemoryCommands } from "./commands/memory.js";
import { registerMessageCommands } from "./commands/message.js";
import { registerSessionsCommands } from "./commands/sessions.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerSkillsCommands } from "./commands/skills.js";
import { registerStatusCommands } from "./commands/status.js";
import { registerTUICommands } from "./commands/tui.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");

async function main() {
  const program = new Command();

  program.name("agent").description("AI Agent CLI - Multi-channel AI gateway").version(packageJson.version);

  // Register all command modules
  registerAgentCommands(program); // agent (run turn)
  registerAgentsCommands(program); // agents list/add/delete
  registerGatewayCommands(program); // gateway start/stop
  registerChannelsCommands(program); // channels list/connect
  registerMessageCommands(program); // message send
  registerSessionsCommands(program); // sessions list
  registerMemoryCommands(program); // memory status
  registerConfigCommands(program); // config get/set
  registerStatusCommands(program); // status
  registerDoctorCommands(program); // doctor
  registerBrowserCommands(program); // browser open/snapshot
  registerSkillsCommands(program); // skills list/install
  registerLogsCommands(program); // logs
  registerSetupCommand(program); // setup/onboard
  registerCronCommands(program); // cron jobs
  registerTUICommands(program); // interactive TUI

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error("[agent] Fatal error:", error.message);
  process.exit(1);
});
