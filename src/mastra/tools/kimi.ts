// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Kimi Tool
 *
 * Tool for running Kimi CLI non-interactively with structured JSON output.
 * Allows agents to leverage Kimi's AI capabilities for code analysis, generation,
 * and general AI assistance tasks.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Spawn kimi with JSON output
 * Supports streaming logs via optional writer callback
 */
function spawnKimi(
  args: string[],
  cwd: string,
  writer?: { write: (data: string) => Promise<void> },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("kimi", args, {
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
              writer.write(`[kimi] Event: ${event.type}\n`).catch(() => {
                // Ignore write errors
              });
            }
            // Stream content in real-time as it arrives
            if (writer) {
              const content = event.content ?? event.text ?? event.message ?? event.delta?.content ?? event.delta?.text;
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
          writer.write(`[kimi stderr] ${chunk}`).catch(() => {
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
        writer.write(`[kimi] Completed with exit code ${code}, received ${eventCount} events\n`).catch(() => {
          // Ignore write errors
        });
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Parse JSONL output from kimi --output-format stream-json
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
 * Extract the final message from kimi events
 * Looks for the last message content in the event stream
 */
function extractFinalMessage(events: Array<Record<string, unknown>>): string | null {
  if (events.length === 0) return null;

  // First pass: look for complete/final message types (most specific)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];

    // Check for completed message events
    if (event.type === "message" && typeof event.content === "string") {
      return event.content;
    }

    // Check for text content
    if (event.type === "content" && typeof event.text === "string") {
      return event.text;
    }

    // Check for response completion
    if (event.type === "response" && event.data && typeof event.data === "object") {
      const data = event.data as any;
      if (typeof data.text === "string") {
        return data.text;
      }
      if (typeof data.content === "string") {
        return data.content;
      }
    }

    // Check for assistant message
    if (event.type === "assistant" && typeof event.content === "string") {
      return event.content;
    }

    // Check for result/completion events
    if ((event.type === "result" || event.type === "completion") && typeof event.content === "string") {
      return event.content;
    }
  }

  // Second pass: look for any event with content/text fields
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];

    // Direct content field
    if (typeof event.content === "string" && event.content.trim()) {
      return event.content;
    }

    // Direct text field
    if (typeof event.text === "string" && event.text.trim()) {
      return event.text;
    }

    // Delta content (streaming chunks)
    if (event.delta && typeof event.delta === "object") {
      const delta = event.delta as any;
      if (typeof delta.content === "string") {
        return delta.content;
      }
      if (typeof delta.text === "string") {
        return delta.text;
      }
    }

    // Output field
    if (typeof event.output === "string" && event.output.trim()) {
      return event.output;
    }

    // Result field
    if (typeof event.result === "string" && event.result.trim()) {
      return event.result;
    }

    // Message field
    if (typeof event.message === "string" && event.message.trim() && !(event.type as string)?.includes("error")) {
      return event.message;
    }
  }

  // Third pass: accumulate text from streaming delta events
  let accumulatedText = "";
  for (const event of events) {
    // text_delta is common in streaming formats
    if (event.type === "text_delta" && typeof event.text === "string") {
      accumulatedText += event.text;
    } else if (event.type === "content_delta" && typeof event.content === "string") {
      accumulatedText += event.content;
    } else if (event.type === "delta" && typeof event.text === "string") {
      accumulatedText += event.text;
    } else if (typeof event.delta === "string") {
      accumulatedText += event.delta;
    }
  }
  if (accumulatedText.trim()) {
    return accumulatedText.trim();
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
    if (event.type === "error" && typeof event.error === "string") {
      return event.error;
    }
  }
  return null;
}

export const kimiTool = createTool({
  id: "kimi",
  inputSchema: z.object({
    prompt: z.string().describe("Prompt to send to Kimi (instructions for the AI)"),
    cwd: z.string().optional().describe("Working directory (defaults to process.cwd())"),
    model: z.string().optional().describe('Model to use (e.g., "kimi-k2", "kimi-k1.5")'),
    thinking: z.boolean().optional().describe("Enable thinking mode for complex reasoning tasks"),
    yolo: z.boolean().optional().describe("Auto-approve all tool calls without prompting"),
    maxSteps: z.number().int().min(1).optional().describe("Maximum number of steps in one turn"),
    maxRetries: z.number().int().min(1).optional().describe("Maximum number of retries in one step"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether execution succeeded"),
    exitCode: z.number().nullable().describe("Process exit code"),
    finalMessage: z.string().nullable().describe("The final response from Kimi"),
    events: z
      .array(z.object({ type: z.string().optional() }).passthrough())
      .describe("All JSONL events from the execution"),
    error: z.string().optional().describe("Error message if execution failed"),
  }),
  description: `Run Kimi CLI for general AI coding assistance.

**When to use:**
- Code explanation and documentation
- Debugging and error analysis
- Code generation and refactoring
- General coding questions and analysis
- Tasks where you need Kimi's specific capabilities

**When NOT to use:**
- Structured workflows with predefined steps (use nativeFlow/kimiFlow instead)
- Complex reasoning requiring deep analysis (consider claude instead)

Example prompts:
- "Explain how the authentication system works in this codebase"
- "Review my recent code changes for bugs and suggest improvements"
- "Generate comprehensive unit tests for the payment processing module"
- "Refactor this component to improve performance and maintainability"
- "Debug why my API endpoint is returning 500 errors"

**Tip:** Enable 'thinking' mode for complex tasks that require reasoning.

The tool returns parsed JSONL events including the final response from Kimi.`,

  execute: async ({ prompt, cwd, model, thinking, yolo, maxSteps, maxRetries }, context) => {
    const workingDir = cwd || process.cwd();
    const writer = context?.writer;

    // Log start
    if (writer) {
      writer.write(`[kimi] Starting: "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"\n`).catch(() => {
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

    // Add print mode for non-interactive execution
    args.push("--print");

    // Add output format for streaming JSON
    args.push("--output-format", "stream-json");

    // Add model if specified
    if (model) {
      args.push("--model", model);
    }

    // Add thinking mode if specified
    if (thinking !== undefined) {
      args.push(thinking ? "--thinking" : "--no-thinking");
    }

    // Add yolo mode if requested
    if (yolo) {
      args.push("--yolo");
    }

    // Add max steps if specified
    if (maxSteps !== undefined) {
      args.push("--max-steps-per-turn", String(maxSteps));
    }

    // Add max retries if specified
    if (maxRetries !== undefined) {
      args.push("--max-retries-per-step", String(maxRetries));
    }

    // Add prompt using -p flag
    args.push("--prompt", prompt);

    // Handle abort signal
    const abortSignal = context?.abortSignal;
    if (abortSignal?.aborted) {
      if (writer) {
        writer.write("[kimi] Aborted by user\n").catch(() => {
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
          .write(`[kimi] Running: kimi ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`)
          .catch(() => {
            // Ignore write errors
          });
      }
      const result = await spawnKimi(args, workingDir, writer);

      if (abortSignal?.aborted) {
        if (writer) {
          writer.write("[kimi] Aborted by user\n").catch(() => {
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

      // Extract final message from events
      let finalMessage = extractFinalMessage(events);

      // Fallback: if no message extracted from events, use raw stdout
      if (!finalMessage && result.stdout.trim()) {
        finalMessage = result.stdout.trim();
      }

      // Check for errors in events
      const eventError = extractError(events);

      // Determine success based on exit code and errors
      const success = result.exitCode === 0 && !eventError;

      // Log summary
      if (writer) {
        const status = success ? "✓ Success" : "✗ Failed";
        const msgPreview = finalMessage
          ? finalMessage.slice(0, 200) + (finalMessage.length > 200 ? "..." : "")
          : "No response";
        writer.write(`[kimi] ${status} - ${msgPreview}\n`).catch(() => {
          // Ignore write errors
        });
      }

      return {
        success,
        exitCode: result.exitCode,
        finalMessage,
        events,
        ...(eventError && { error: eventError }),
        ...(!success &&
          !eventError &&
          result.stderr && {
            error: result.stderr || `Kimi exited with code ${result.exitCode}`,
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
