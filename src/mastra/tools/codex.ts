// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Codex Tool
 *
 * Tool for running Codex CLI non-interactively with structured JSON output.
 * Allows agents to leverage Codex's AI capabilities for code analysis, generation,
 * and review tasks.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Spawn codex exec with JSON output
 * Supports streaming logs via optional writer callback
 */
function spawnCodex(
  args: string[],
  cwd: string,
  writer?: { write: (data: string) => Promise<void> },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let eventCount = 0;

    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        // Count JSONL events for progress tracking
        const lines = chunk.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            eventCount++;
            // Log event types for visibility
            if (writer && event.type) {
              writer.write(`[codex] Event: ${event.type}\n`).catch(() => {
                // Ignore write errors
              });
            }
            // Stream content in real-time as it arrives
            if (writer) {
              const content =
                event.content ??
                event.text ??
                event.message ??
                event.delta?.content ??
                event.delta?.text ??
                event.item?.text;
              if (typeof content === "string") {
                writer.write(content).catch(() => {
                  // Ignore write errors
                });
              }
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        // Stream stderr for visibility
        if (writer) {
          writer.write(`[codex stderr] ${chunk}`).catch(() => {
            // Ignore write errors
          });
        }
      });
    }

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (writer) {
        writer.write(`[codex] Completed with exit code ${code}, received ${eventCount} events\n`).catch(() => {
          // Ignore write errors
        });
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Parse JSONL output from codex exec --json
 * Each line is a JSON object representing an event
 */
function parseJsonlOutput(jsonl: string): Array<Record<string, unknown>> {
  const lines = jsonl.trim().split("\n");
  const events: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }

  return events;
}

/**
 * Extract the final message from codex events
 * The final message from the agent is in an item.completed event where item.type === "agent_message"
 */
function extractFinalMessage(events: Array<Record<string, unknown>>): string | null {
  if (events.length === 0) return null;

  // Find the last agent_message item
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (
      event.type === "item.completed" &&
      event.item &&
      typeof event.item === "object" &&
      (event.item as any).type === "agent_message" &&
      typeof (event.item as any).text === "string"
    ) {
      return (event.item as any).text;
    }
  }

  return null;
}

/**
 * Extract error message from events if present
 */
function extractError(events: Array<Record<string, unknown>>): string | null {
  for (const event of events) {
    if (event.type === "error" && typeof event.message === "string") {
      return event.message;
    }
  }
  return null;
}

export const codexTool = createTool({
  id: "codex",
  inputSchema: z.object({
    prompt: z.string().describe("Prompt to send to Codex (instructions for the agent)"),
    cwd: z.string().optional().describe("Working directory (defaults to process.cwd())"),
    model: z.string().optional().describe('Model to use (e.g., "o3", "gpt-4", etc.)'),
    sandbox: z
      .enum(["read-only", "workspace-write", "danger-full-access"])
      .optional()
      .describe("Sandbox mode for shell commands"),
    outputFile: z.string().optional().describe("File path where the last message should be written"),
    skipGitCheck: z.boolean().optional().describe("Skip git repository check (allow running outside git repos)"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether execution succeeded"),
    exitCode: z.number().nullable().describe("Process exit code"),
    finalMessage: z.string().nullable().describe("The last message from the Codex agent"),
    events: z.array(z.object({ type: z.string() }).passthrough()).describe("All JSONL events from the execution"),
    outputFile: z.string().optional().describe("Path to output file if outputFile was specified"),
    error: z.string().optional().describe("Error message if execution failed"),
  }),
  description: `Run Codex CLI non-interactively with structured JSON output. Use this tool to leverage Codex's AI capabilities for code analysis, generation, explanation, and review tasks.

Example prompts:
- "Explain how the authentication flow works in this codebase"
- "Review the recent changes for potential bugs"
- "Generate unit tests for the calculateTotal function"
- "Refactor this code to be more maintainable"

The tool returns parsed JSONL events including the final message from the agent.`,

  execute: async ({ prompt, cwd, model, sandbox, outputFile, skipGitCheck }, context) => {
    const workingDir = cwd || process.cwd();
    const writer = context?.writer;

    // Log start
    if (writer) {
      writer.write(`[codex] Starting: "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"\n`).catch(() => {
        // Ignore write errors
      });
    }

    // Validate working directory exists
    if (!existsSync(workingDir)) {
      return {
        success: false,
        exitCode: null,
        finalMessage: null,
        events: [],
        error: `Working directory does not exist: ${workingDir}`,
      };
    }

    // Build command args
    const args = ["exec", "--json"];

    if (model) {
      args.push("--model", model);
    }

    if (sandbox) {
      args.push("--sandbox", sandbox);
    }

    if (outputFile) {
      args.push("--output-last-message", outputFile);
    }

    if (skipGitCheck) {
      args.push("--skip-git-repo-check");
    }

    // Add prompt as argument
    args.push("--", prompt);

    // Handle abort signal
    const abortSignal = context?.abortSignal;
    if (abortSignal?.aborted) {
      if (writer) {
        writer.write("[codex] Aborted by user\n").catch(() => {
          // Ignore write errors
        });
      }
      return {
        success: false,
        exitCode: null,
        finalMessage: null,
        events: [],
        error: "Execution aborted by user",
      };
    }

    try {
      if (writer) {
        writer
          .write(`[codex] Running: codex ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`)
          .catch(() => {
            // Ignore write errors
          });
      }
      const result = await spawnCodex(args, workingDir, writer);

      if (abortSignal?.aborted) {
        if (writer) {
          writer.write("[codex] Aborted by user\n").catch(() => {
            // Ignore write errors
          });
        }
        return {
          success: false,
          exitCode: result.exitCode,
          finalMessage: null,
          events: [],
          error: "Execution aborted by user",
        };
      }

      // Parse JSONL output
      const events = parseJsonlOutput(result.stdout);

      // Extract final message
      const finalMessage = extractFinalMessage(events);

      // Check for errors in events
      const eventError = extractError(events);

      // Determine success based on exit code and errors
      const success = result.exitCode === 0 && !eventError;

      // Log summary
      if (writer) {
        const status = success ? "✓ Success" : "✗ Failed";
        const msgPreview = finalMessage
          ? finalMessage.slice(0, 200) + (finalMessage.length > 200 ? "..." : "")
          : "No message";
        writer.write(`[codex] ${status} - ${msgPreview}\n`).catch(() => {
          // Ignore write errors
        });
      }

      return {
        success,
        exitCode: result.exitCode,
        finalMessage,
        events,
        ...(outputFile && { outputFile }),
        ...(eventError && { error: eventError }),
        ...(!success &&
          !eventError &&
          result.stderr && {
            error: result.stderr || `Codex exited with code ${result.exitCode}`,
          }),
      };
    } catch (error) {
      return {
        success: false,
        exitCode: null,
        finalMessage: null,
        events: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
