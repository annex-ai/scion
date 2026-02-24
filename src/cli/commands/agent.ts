// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Agent Command
 * Run an agent turn via the Gateway
 */

import type { Command } from "commander";
import { MastraClient } from "../lib/client.js";
import { loadConfig } from "../lib/config.js";
import { formatAgentResponse, formatError, formatOutput } from "../lib/output.js";

interface AgentOptions {
  message: string;
  to?: string;
  sessionId?: string;
  agent?: string;
  thinking?: string;
  verbose?: string;
  channel?: string;
  replyTo?: string;
  replyChannel?: string;
  local?: boolean;
  deliver?: boolean;
  json?: boolean;
  timeout?: string;
  stream?: boolean;
}

export function registerAgentCommands(program: Command): void {
  program
    .command("agent")
    .description("Run an agent turn via the Gateway (use --local for embedded)")
    .requiredOption("-m, --message <text>", "Message body for the agent")
    .option("-t, --to <number>", "Recipient number in E.164 used to derive the session key")
    .option("--session-id <id>", "Use an explicit session id")
    .option("--agent <id>", "Agent id (overrides routing bindings)", "interactiveAgent")
    .option("--thinking <level>", "Thinking level: off | minimal | low | medium | high")
    .option("--verbose <on|off|full>", "Persist agent verbose level for the session")
    .option("--channel <channel>", "Delivery channel: whatsapp | telegram | slack | discord")
    .option("--reply-to <target>", "Delivery target override (separate from session routing)")
    .option("--reply-channel <channel>", "Delivery channel override (separate from routing)")
    .option("--local", "Run the embedded agent locally (requires model provider API keys in your shell)", false)
    .option("--deliver", "Send the agent's reply back to the selected channel", false)
    .option("--json", "Output result as JSON", false)
    .option("--stream", "Stream the response", false)
    .option("--timeout <seconds>", "Override agent command timeout (seconds, default 600)")
    .addHelpText(
      "after",
      `
Examples:
  agent --message "status update"                    Start a new session
  agent --agent taskAgent --message "Summarize logs" Use a specific agent
  agent --session-id 1234 --message "Summarize inbox" --thinking medium
                                                     Target a session with explicit thinking level
  agent --message "Trace logs" --verbose on --json   Enable verbose logging and JSON output
  agent --to +15555550123 --message "Hello" --deliver  Deliver reply back to channel
    `,
    )
    .action(async (opts: AgentOptions) => {
      try {
        const config = loadConfig();
        const client = new MastraClient();

        // Validate thinking level
        const validThinking = ["off", "minimal", "low", "medium", "high"];
        if (opts.thinking && !validThinking.includes(opts.thinking)) {
          console.error(formatError(`Invalid thinking level. Use one of: ${validThinking.join(", ")}`));
          process.exit(1);
        }

        // Build options
        const generateOpts = {
          thinking: opts.thinking as any,
          verbose: opts.verbose as any,
          timeout: opts.timeout ? Number.parseInt(opts.timeout, 10) * 1000 : undefined,
        };

        const agentId = opts.agent || config.agents?.defaults?.model || "interactiveAgent";

        if (opts.stream) {
          // Stream mode
          const stream = await client.streamGenerate(agentId, opts.message, generateOpts);
          const reader = stream.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            process.stdout.write(new TextDecoder().decode(value));
          }
          console.log(); // newline
        } else {
          // Regular mode
          const response = await client.generate(agentId, opts.message, generateOpts);

          if (opts.json) {
            formatOutput(response, { json: true });
          } else {
            console.log(formatAgentResponse(response));
          }
        }
      } catch (error) {
        console.error(formatError(error as Error));
        process.exit(1);
      }
    });
}
