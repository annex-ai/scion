// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Claude Tool
 *
 * Tool for running Claude CLI non-interactively with structured JSON output.
 * Allows agents to leverage Claude's AI capabilities for code analysis, generation,
 * and general AI assistance tasks.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Spawn claude with JSON output
 * Supports streaming logs via optional writer callback
 */
function spawnClaude(
  args: string[],
  cwd: string,
  writer?: { write: (data: string) => Promise<void> },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"], // ignore stdin to prevent hanging
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
              writer.write(`[claude] Event: ${event.type}\n`).catch(() => {
                // Ignore write errors
              });
            }
            // Stream content in real-time as it arrives
            if (writer && event.type === "assistant") {
              const content = event.message?.content?.[0]?.text;
              if (typeof content === "string") {
                writer.write(content).catch(() => {
                  // Ignore write errors
                });
              }
            }
          } catch {
            // Non-JSON output - might be an error message
            if (writer && line.trim()) {
              writer.write(`[claude] ${line}\n`).catch(() => {
                // Ignore write errors
              });
            }
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
          writer.write(`[claude stderr] ${chunk}`).catch(() => {
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
        writer.write(`[claude] Completed with exit code ${code}, received ${eventCount} events\n`).catch(() => {
          // Ignore write errors
        });
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Parse JSONL output from claude --output-format stream-json
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
 * Extract the final message from claude events
 * Looks for assistant message content in the event stream
 */
function extractFinalMessage(events: Array<Record<string, unknown>>): string | null {
  if (events.length === 0) return null;

  // Look for the result event first (contains final output)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "result" && typeof event.result === "string") {
      return event.result;
    }
  }

  // Fall back to last assistant message
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "assistant" && event.message) {
      const message = event.message as Record<string, unknown>;
      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (content && content.length > 0 && typeof content[0].text === "string") {
        return content[0].text;
      }
    }
  }

  return null;
}

/**
 * Extract error message from events or output if present
 */
function extractError(events: Array<Record<string, unknown>>, stderr: string): string | null {
  // Check events for errors
  for (const event of events) {
    if (event.type === "error" && typeof event.message === "string") {
      return event.message;
    }
    if (event.type === "error" && typeof event.error === "string") {
      return event.error;
    }
  }

  // Check stderr for common error patterns
  if (stderr.includes("Invalid API key")) {
    return 'Authentication failed. Run "claude login" to authenticate.';
  }

  return null;
}

export const claudeTool = createTool({
  id: "claude",
  inputSchema: z.object({
    prompt: z.string().describe("Prompt to send to Claude (instructions for the AI)"),
    cwd: z.string().optional().describe("Working directory (defaults to process.cwd())"),
    model: z.string().optional().describe('Model to use (e.g., "sonnet", "opus", "haiku")'),
    permissionMode: z
      .enum(["default", "acceptEdits", "bypassPermissions"])
      .optional()
      .describe("Permission mode for tool execution"),
    maxTurns: z.number().optional().describe("Maximum number of agentic turns"),
    systemPrompt: z.string().optional().describe("System prompt to prepend"),
    outputFile: z.string().optional().describe("File path where the response should be written"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether execution succeeded"),
    exitCode: z.number().nullable().describe("Process exit code"),
    finalMessage: z.string().nullable().describe("The final response from Claude"),
    events: z.array(z.object({ type: z.string() }).passthrough()).describe("All JSONL events from the execution"),
    outputFile: z.string().optional().describe("Path to output file if outputFile was specified"),
    error: z.string().optional().describe("Error message if execution failed"),
  }),
  description: `Run Claude CLI for advanced reasoning and code review.

**When to use:**
- Complex architecture analysis and review
- Security audits and vulnerability assessment
- Deep reasoning tasks requiring careful analysis
- Code refactoring with complex dependencies
- Tasks where Claude's reasoning capabilities are preferred

**When NOT to use:**
- Simple coding tasks (use kimi for general coding)
- Structured workflows (use nativeFlow/kimiFlow/gooseFlow)
- OpenAI-specific features (use codex)

Example prompts:
- "Review this microservices architecture for scaling bottlenecks"
- "Analyze this codebase for security vulnerabilities"
- "Design a migration strategy for this legacy system"
- "Explain the trade-offs between these design patterns"

**Tip:** Use 'sonnet' model for best reasoning, 'haiku' for speed.

The tool returns parsed JSONL events including the final response from Claude.`,

  execute: async ({ prompt, cwd, model, permissionMode, maxTurns, systemPrompt, outputFile }, context) => {
    const workingDir = cwd || process.cwd();
    const writer = context?.writer;

    // Log start
    if (writer) {
      writer.write(`[claude] Starting: "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"\n`).catch(() => {
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
    const args: string[] = [];

    // Add print mode flag
    args.push("-p");

    // Add verbose and output format for streaming JSON
    args.push("--verbose", "--output-format", "stream-json");

    // Add model if specified
    if (model) {
      args.push("--model", model);
    }

    // Add permission mode if specified
    if (permissionMode) {
      args.push("--permission-mode", permissionMode);
    }

    // Add max turns if specified
    if (maxTurns) {
      args.push("--max-turns", String(maxTurns));
    }

    // Add system prompt if specified
    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }

    // Add prompt as the final argument
    args.push(prompt);

    // Handle abort signal
    const abortSignal = context?.abortSignal;
    if (abortSignal?.aborted) {
      if (writer) {
        writer.write("[claude] Aborted by user\n").catch(() => {
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
          .write(`[claude] Running: claude ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`)
          .catch(() => {
            // Ignore write errors
          });
      }
      const result = await spawnClaude(args, workingDir, writer);

      if (abortSignal?.aborted) {
        if (writer) {
          writer.write("[claude] Aborted by user\n").catch(() => {
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

      // Check for errors in events or stderr
      const eventError = extractError(events, result.stderr);

      // Determine success based on exit code and errors
      const success = result.exitCode === 0 && !eventError;

      // Write to output file if specified
      if (outputFile && finalMessage) {
        const fs = await import("node:fs/promises");
        try {
          await fs.writeFile(outputFile, finalMessage, "utf-8");
          if (writer) {
            writer.write(`[claude] Response written to ${outputFile}\n`).catch(() => {
              // Ignore write errors
            });
          }
        } catch (writeError) {
          if (writer) {
            writer.write(`[claude] Warning: Failed to write output file: ${writeError}\n`).catch(() => {
              // Ignore write errors
            });
          }
        }
      }

      // Log summary
      if (writer) {
        const status = success ? "✓ Success" : "✗ Failed";
        const msgPreview = finalMessage
          ? finalMessage.slice(0, 200) + (finalMessage.length > 200 ? "..." : "")
          : "No response";
        writer.write(`[claude] ${status} - ${msgPreview}\n`).catch(() => {
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
            error: result.stderr || `Claude exited with code ${result.exitCode}`,
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
