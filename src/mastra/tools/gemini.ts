// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gemini Tool
 *
 * Tool for running Gemini CLI non-interactively with structured JSON output.
 * Allows agents to leverage Gemini's AI capabilities for code analysis, generation,
 * and general AI assistance tasks.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Spawn gemini with JSON output
 * Supports streaming logs via optional writer callback
 */
function spawnGemini(
  args: string[],
  cwd: string,
  writer?: { write: (data: string) => Promise<void> },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("gemini", args, {
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
              writer.write(`[gemini] Event: ${event.type}\n`).catch(() => {
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
          writer.write(`[gemini stderr] ${chunk}`).catch(() => {
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
        writer.write(`[gemini] Completed with exit code ${code}, received ${eventCount} events\n`).catch(() => {
          // Ignore write errors
        });
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Parse JSONL output from gemini --output-format stream-json
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
 * Extract the final message from gemini events
 * Looks for the last message content in the event stream
 */
function extractFinalMessage(events: Array<Record<string, unknown>>): string | null {
  if (events.length === 0) return null;

  // Look for message content in various possible formats
  // Gemini CLI may format events differently than codex
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

export const geminiTool = createTool({
  id: "gemini",
  inputSchema: z.object({
    prompt: z.string().describe("Prompt to send to Gemini (instructions for the AI)"),
    cwd: z.string().optional().describe("Working directory (defaults to process.cwd())"),
    model: z.string().optional().describe('Model to use (e.g., "gemini-2.5-flash", "gemini-2.0-pro")'),
    includeDirectories: z.array(z.string()).optional().describe("Additional directories to include for context"),
    sandbox: z.boolean().optional().describe("Run tools in secure sandbox mode (requires Docker/Podman)"),
    yolo: z.boolean().optional().describe("Auto-approve all tool calls without prompting"),
    outputFile: z.string().optional().describe("File path where the response should be written"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether execution succeeded"),
    exitCode: z.number().nullable().describe("Process exit code"),
    finalMessage: z.string().nullable().describe("The final response from Gemini"),
    events: z.array(z.object({ type: z.string() }).passthrough()).describe("All JSONL events from the execution"),
    outputFile: z.string().optional().describe("Path to output file if outputFile was specified"),
    error: z.string().optional().describe("Error message if execution failed"),
  }),
  description: `Run Gemini CLI non-interactively with structured JSON output. Use this tool to leverage Google's Gemini AI for code analysis, generation, explanation, debugging, and general AI assistance.

Example prompts:
- "Explain how the authentication system works in this codebase"
- "Review my recent code changes for bugs and suggest improvements"
- "Generate comprehensive unit tests for the payment processing module"
- "Refactor this component to improve performance and maintainability"
- "Debug why my API endpoint is returning 500 errors"

The tool returns parsed JSONL events including the final response from Gemini.`,

  execute: async ({ prompt, cwd, model, includeDirectories, sandbox, yolo, outputFile }, context) => {
    const workingDir = cwd || process.cwd();
    const writer = context?.writer;

    // Log start
    if (writer) {
      writer.write(`[gemini] Starting: "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"\n`).catch(() => {
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

    // Add output format for streaming JSON
    args.push("--output-format", "stream-json");

    // Add model if specified
    if (model) {
      args.push("-m", model);
    }

    // Add include directories if specified
    if (includeDirectories && includeDirectories.length > 0) {
      args.push("--include-directories", includeDirectories.join(","));
    }

    // Add sandbox mode if requested
    if (sandbox) {
      args.push("--sandbox");
    }

    // Add yolo mode if requested
    if (yolo) {
      args.push("--yolo");
    }

    // Add prompt using -p flag for non-interactive mode
    args.push("-p", prompt);

    // Handle abort signal
    const abortSignal = context?.abortSignal;
    if (abortSignal?.aborted) {
      if (writer) {
        writer.write("[gemini] Aborted by user\n").catch(() => {
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
          .write(`[gemini] Running: gemini ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`)
          .catch(() => {
            // Ignore write errors
          });
      }
      const result = await spawnGemini(args, workingDir, writer);

      if (abortSignal?.aborted) {
        if (writer) {
          writer.write("[gemini] Aborted by user\n").catch(() => {
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

      // Write to output file if specified
      if (outputFile && finalMessage) {
        const fs = await import("node:fs/promises");
        try {
          await fs.writeFile(outputFile, finalMessage, "utf-8");
          if (writer) {
            writer.write(`[gemini] Response written to ${outputFile}\n`).catch(() => {
              // Ignore write errors
            });
          }
        } catch (writeError) {
          if (writer) {
            writer.write(`[gemini] Warning: Failed to write output file: ${writeError}\n`).catch(() => {
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
        writer.write(`[gemini] ${status} - ${msgPreview}\n`).catch(() => {
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
            error: result.stderr || `Gemini exited with code ${result.exitCode}`,
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
