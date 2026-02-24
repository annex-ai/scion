// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Agents Commands
 * Manage isolated agents (workspaces + auth + routing)
 */

import type { Command } from "commander";
import { type AgentConfig, loadConfig, saveConfig } from "../lib/config.js";
import { formatError, formatOutput, formatSuccess, formatTable } from "../lib/output.js";

interface ListOptions {
  json?: boolean;
  bindings?: boolean;
}

interface AddOptions {
  workspace?: string;
  model?: string;
  agentDir?: string;
  bind?: string[];
  nonInteractive?: boolean;
  json?: boolean;
}

interface DeleteOptions {
  force?: boolean;
  json?: boolean;
}

interface SetIdentityOptions {
  agent?: string;
  workspace?: string;
  identityFile?: string;
  fromIdentity?: boolean;
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  json?: boolean;
}

export function registerAgentsCommands(program: Command): void {
  const agents = program.command("agents").description("Manage isolated agents (workspaces + auth + routing)");

  // agents list
  agents
    .command("list")
    .description("List configured agents")
    .option("--json", "Output JSON instead of text", false)
    .option("--bindings", "Include routing bindings", false)
    .action(async (opts: ListOptions) => {
      try {
        const config = loadConfig();
        const agentsList: AgentConfig[] = config.agents?.items || [
          { id: "interactiveAgent", name: "Interactive Agent" },
          { id: "taskAgent", name: "Task Agent" },
          { id: "reflectorAgent", name: "Reflector Agent" },
          // REMOVED: compactionAgent - replaced by Observational Memory
        ];

        if (opts.json) {
          formatOutput(agentsList, { json: true });
          return;
        }

        if (agentsList.length === 0) {
          console.log("No agents configured.");
          return;
        }

        console.log("Configured Agents:\n");
        for (const agent of agentsList) {
          console.log(`  ${agent.id}${agent.name ? ` - ${agent.name}` : ""}`);
          if (opts.bindings && agent.bindings) {
            console.log(`    Bindings: ${agent.bindings.join(", ")}`);
          }
          if (agent.model) {
            console.log(`    Model: ${agent.model}`);
          }
          if (agent.workspace) {
            console.log(`    Workspace: ${agent.workspace}`);
          }
          console.log();
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // agents add
  agents
    .command("add [name]")
    .description("Add a new isolated agent")
    .option("--workspace <dir>", "Workspace directory for the new agent")
    .option("--model <id>", "Model id for this agent")
    .option("--agent-dir <dir>", "Agent state directory for this agent")
    .option("--bind <channel[:accountId]>", "Route channel binding (repeatable)", collect, [])
    .option("--non-interactive", "Disable prompts; requires --workspace", false)
    .option("--json", "Output JSON summary", false)
    .action(async (name: string | undefined, opts: AddOptions) => {
      try {
        const config = loadConfig();
        const agentId = name || `agent-${Date.now()}`;

        // Initialize agents array if not exists
        if (!config.agents) config.agents = {};
        if (!config.agents.items) config.agents.items = [];

        // Check if agent already exists
        if (config.agents.items.find((a) => a.id === agentId)) {
          console.error(formatError(`Agent "${agentId}" already exists`));
          process.exit(1);
        }

        const newAgent: AgentConfig = {
          id: agentId,
          name: agentId,
          model: opts.model,
          workspace: opts.workspace,
          bindings: opts.bind,
        };

        config.agents.items.push(newAgent);
        saveConfig(config);

        formatSuccess(`Created agent: ${agentId}`);

        if (opts.json) {
          formatOutput(newAgent, { json: true });
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // agents delete
  agents
    .command("delete <id>")
    .description("Delete an agent and prune workspace/state")
    .option("--force", "Skip confirmation", false)
    .option("--json", "Output JSON summary", false)
    .action(async (id: string, opts: DeleteOptions) => {
      try {
        const config = loadConfig();

        if (!config.agents?.items) {
          console.error(formatError("No agents configured"));
          process.exit(1);
        }

        const agentIndex = config.agents.items.findIndex((a) => a.id === id);
        if (agentIndex === -1) {
          console.error(formatError(`Agent "${id}" not found`));
          process.exit(1);
        }

        // TODO: Add confirmation prompt if not --force

        config.agents.items.splice(agentIndex, 1);
        saveConfig(config);

        formatSuccess(`Deleted agent: ${id}`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // agents set-identity
  agents
    .command("set-identity")
    .description("Update an agent identity (name/theme/emoji/avatar)")
    .option("--agent <id>", "Agent id to update")
    .option("--workspace <dir>", "Workspace directory used to locate the agent + IDENTITY.md")
    .option("--identity-file <path>", "Explicit IDENTITY.md path to read")
    .option("--from-identity", "Read values from IDENTITY.md", false)
    .option("--name <name>", "Identity name")
    .option("--theme <theme>", "Identity theme")
    .option("--emoji <emoji>", "Identity emoji")
    .option("--avatar <value>", "Identity avatar (workspace path, http(s) URL, or data URI)")
    .option("--json", "Output JSON summary", false)
    .addHelpText(
      "after",
      `
Examples:
  agents set-identity --agent main --name "MyAgent" --emoji "🤖"  Set name + emoji
  agents set-identity --workspace ~/.agent/workspace --from-identity  Load from IDENTITY.md
    `,
    )
    .action(async (opts: SetIdentityOptions) => {
      try {
        const config = loadConfig();
        const agentId = opts.agent;

        if (!agentId) {
          console.error(formatError("--agent is required"));
          process.exit(1);
        }

        if (!config.agents?.items) {
          console.error(formatError("No agents configured"));
          process.exit(1);
        }

        const agent = config.agents.items.find((a) => a.id === agentId);
        if (!agent) {
          console.error(formatError(`Agent "${agentId}" not found`));
          process.exit(1);
        }

        // Update identity fields
        if (opts.name) agent.name = opts.name;
        // TODO: Handle theme, emoji, avatar storage

        saveConfig(config);
        formatSuccess(`Updated identity for agent: ${agentId}`);
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });

  // Default action (list)
  agents.action(async () => {
    await agents.commands.find((c) => c.name() === "list")?.parseAsync(["--json=false"]);
  });
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
