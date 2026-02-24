// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Kimi Flow Tool - Pattern B Implementation
 *
 * Executes flow skills using the Kimi CLI.
 * This allows immediate use of existing .kimi/skills/ flows
 * without native Mastra compilation.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

export interface KimiFlowResult {
  status: "completed" | "suspended" | "error" | "running";
  result?: string;
  executionId: string;
  currentNode?: string;
  decisionQuestion?: string;
  options?: Array<{ value: string; label: string }>;
  error?: string;
  metadata?: {
    skillName: string;
    startTime: string;
    endTime?: string;
    stepsExecuted: number;
  };
}

export interface KimiFlowOptions {
  flowName: string;
  userRequest: string;
  skillPath?: string;
  context?: Record<string, unknown>;
  resume?: boolean;
  executionId?: string;
  choice?: string;
  workingDir?: string;
  timeout?: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Execute a process with timeout and input handling
 */
interface ProcessOptions {
  cwd: string;
  timeout: number;
  input: string;
  env: Record<string, string | undefined>;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function executeKimiProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timeoutId: NodeJS.Timeout;

    // Set timeout
    if (options.timeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`timeout after ${options.timeout}ms`));
      }, options.timeout);
    }

    // Collect stdout
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    // Handle process completion
    child.on("close", (exitCode) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: exitCode || 0,
      });
    });

    // Handle errors
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    // Send input via stdin
    if (options.input) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}

/**
 * Find the project root by looking for .kimi directory
 */
function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = resolve(startDir);

  while (currentDir !== "/") {
    if (existsSync(join(currentDir, ".kimi"))) {
      return currentDir;
    }
    currentDir = resolve(currentDir, "..");
  }

  return process.cwd();
}

/**
 * Generate a unique execution ID
 */
function generateExecutionId(): string {
  return `kimi-flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse kimi CLI output to extract structured result
 *
 * Kimi doesn't have a structured JSON output mode, so we need to
 * parse the text output and detect suspension points.
 */
function parseKimiOutput(stdout: string, stderr: string, executionId: string): KimiFlowResult {
  const output = stdout + stderr;

  // Check for suspension indicators
  const suspensionPatterns = [
    /\[PAUSED\]|\[SUSPENDED\]|Waiting for input/i,
    /(Choose|Select|Option)\s*:\s*\n/i,
    /(\d+\)\s*.+\n){2,}/, // Numbered options
    /\[yes\/no\]|\[y\/n\]/i,
  ];

  const isSuspended = suspensionPatterns.some((pattern) => pattern.test(output));

  if (isSuspended) {
    // Try to extract decision question
    const questionMatch = output.match(/(?:Question|Decision|Choose|Select)[\s:]*([^\n]+)/i);

    // Try to extract options
    const options: Array<{ value: string; label: string }> = [];

    // Look for numbered options: 1) Option text
    const numberedOptions = output.matchAll(/(\d+)\)\s*([^\n]+)/g);
    for (const match of numberedOptions) {
      options.push({
        value: match[1].trim(),
        label: match[2].trim(),
      });
    }

    // Look for Yes/No options
    if (/\[yes\/no\]|\[y\/n\]|yes\/no/i.test(output)) {
      options.push({ value: "yes", label: "Yes" });
      options.push({ value: "no", label: "No" });
    }

    // Look for arrow options: -->|Option|
    const arrowOptions = output.matchAll(/\-\-\>\|([^|]+)\|/g);
    for (const match of arrowOptions) {
      const label = match[1].trim();
      options.push({ value: label.toLowerCase(), label });
    }

    return {
      status: "suspended",
      executionId,
      result: output.trim(),
      decisionQuestion: questionMatch?.[1]?.trim() || "Please make a selection",
      options: options.length > 0 ? options : undefined,
      metadata: {
        skillName: "",
        startTime: new Date().toISOString(),
        stepsExecuted: 0,
      },
    };
  }

  // Check for errors
  if (stderr.includes("error") || stderr.includes("Error") || stdout.includes("ERROR")) {
    return {
      status: "error",
      executionId,
      error: stderr || "Unknown error occurred",
      result: output.trim(),
      metadata: {
        skillName: "",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        stepsExecuted: 0,
      },
    };
  }

  // Completed successfully
  return {
    status: "completed",
    executionId,
    result: output.trim(),
    metadata: {
      skillName: "",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      stepsExecuted: 1,
    },
  };
}

// ============================================================================
// Skill Discovery
// ============================================================================

/**
 * Find skill file with multiple strategies (A, B, C)
 *
 * Strategy A: Explicit skillPath provided
 * Strategy B: Auto-discover from project root
 * Strategy C: Verify skill exists before execution
 */
export async function findSkillFile(
  flowName: string,
  skillPath?: string,
  workingDir?: string,
): Promise<{ skillFile: string; projectRoot: string; strategy: "explicit" | "discovered" }> {
  // Strategy A: Explicit path provided
  if (skillPath) {
    const resolvedPath = resolve(skillPath);

    // Check if it's a direct file path
    if (existsSync(resolvedPath) && resolvedPath.endsWith("SKILL.md")) {
      return {
        skillFile: resolvedPath,
        projectRoot: findProjectRoot(dirname(resolvedPath)),
        strategy: "explicit",
      };
    }

    // Check if it's a directory containing the skill
    const skillFileInDir = join(resolvedPath, "SKILL.md");
    if (existsSync(skillFileInDir)) {
      return {
        skillFile: skillFileInDir,
        projectRoot: findProjectRoot(resolvedPath),
        strategy: "explicit",
      };
    }

    // Check if it's a skills directory with flow subdirectory
    const skillInSubdir = join(resolvedPath, flowName, "SKILL.md");
    if (existsSync(skillInSubdir)) {
      return {
        skillFile: skillInSubdir,
        projectRoot: findProjectRoot(resolvedPath),
        strategy: "explicit",
      };
    }

    throw new Error(
      `Explicit skill path not found: ${skillPath}\nTried:\n  - ${resolvedPath}\n  - ${skillFileInDir}\n  - ${skillInSubdir}`,
    );
  }

  // Strategy B: Auto-discover project root
  const startDir = workingDir || process.cwd();
  const projectRoot = findProjectRoot(startDir);

  // Common skill locations to check
  const possiblePaths = [
    // Primary: skills/ at project root (workspace standard)
    join(projectRoot, "skills", flowName, "SKILL.md"),
    join(projectRoot, "skills", flowName.toLowerCase(), "SKILL.md"),

    // Legacy paths for backward compatibility
    join(projectRoot, ".kimi", "skills", flowName, "SKILL.md"),
    join(projectRoot, ".kimi", "skills", flowName.toLowerCase(), "SKILL.md"),
    join(projectRoot, ".claude", "skills", flowName, "SKILL.md"),
    join(projectRoot, ".claude", "skills", flowName.toLowerCase(), "SKILL.md"),
    join(projectRoot, ".agents", "skills", flowName, "SKILL.md"),
    join(projectRoot, ".agents", "skills", flowName.toLowerCase(), "SKILL.md"),
    join(projectRoot, ".codex", "skills", flowName, "SKILL.md"),
    join(projectRoot, ".codex", "skills", flowName.toLowerCase(), "SKILL.md"),
  ];

  // Strategy C: Verify skill exists
  for (const skillFile of possiblePaths) {
    if (existsSync(skillFile)) {
      return {
        skillFile,
        projectRoot,
        strategy: "discovered",
      };
    }
  }

  // Not found - provide helpful error with all paths tried
  const searchedPaths = possiblePaths.map((p) => `  - ${p}`).join("\n");
  throw new Error(
    `Flow skill "${flowName}" not found.\n\nStrategy A (Explicit): No skillPath provided\n\nStrategy B (Discovery): Searched in:\n${searchedPaths}\n\nStrategy C (Verify): Skill file does not exist in any standard location\n\nTo fix:\n  1. Create skill at: ${join(projectRoot, "skills", flowName, "SKILL.md")}\n  2. Or provide explicit path: skillPath="/path/to/skill/directory"\n  3. Or provide explicit file: skillPath="/path/to/SKILL.md"\n  4. Or ensure you're in the correct project directory (cwd: ${startDir})`,
  );
}

// ============================================================================
// Core Execution Functions
// ============================================================================

/**
 * Execute a flow using Kimi CLI
 */
async function executeKimiFlow(options: KimiFlowOptions): Promise<KimiFlowResult> {
  const {
    flowName,
    userRequest,
    skillPath,
    context,
    resume,
    executionId: existingExecutionId,
    choice,
    workingDir,
    timeout = 300000, // 5 minutes default
  } = options;

  const executionId = existingExecutionId || generateExecutionId();

  // ==========================================================================
  // STEP 1: Find skill file (Strategies A, B, C)
  // ==========================================================================
  let skillInfo: { skillFile: string; projectRoot: string; strategy: "explicit" | "discovered" };
  try {
    skillInfo = await findSkillFile(flowName, skillPath, workingDir);
  } catch (error: any) {
    return {
      status: "error",
      executionId,
      error: error.message,
      metadata: {
        skillName: flowName,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        stepsExecuted: 0,
      },
    };
  }

  const { skillFile, projectRoot, strategy } = skillInfo;

  // ==========================================================================
  // STEP 2: Build kimi command
  // ==========================================================================
  let args: string[] = [];
  let input: string | undefined;
  const cwd = projectRoot;

  if (resume) {
    // Resume mode - pass choice as input
    if (!choice) {
      return {
        status: "error",
        executionId,
        error: "Choice is required when resuming a flow",
        metadata: {
          skillName: flowName,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          stepsExecuted: 0,
        },
      };
    }
    input = `<choice>${choice}</choice>`;
    args = [`/flow:${flowName}`];
  } else {
    // New execution
    args = [`/flow:${flowName}`];
    input = userRequest;

    // Add context if provided
    if (context && Object.keys(context).length > 0) {
      const contextStr = JSON.stringify(context, null, 2);
      input += `\n\nContext:\n${contextStr}`;
    }

    // If explicit skill path provided, use --skills-dir flag
    if (strategy === "explicit" && skillPath) {
      // Find the skills directory (parent of flow directory)
      const skillDir = dirname(skillFile);
      const skillsDir = dirname(skillDir);
      args.push("--skills-dir", skillsDir);
    }
  }

  try {
    // Execute kimi CLI using spawn
    const result = await executeKimiProcess("kimi", args, {
      cwd,
      timeout,
      input: input || "",
      env: {
        ...process.env,
        KIMI_WORK_DIR: cwd,
      },
    });

    // Parse output with strategy info for debugging
    const parsedResult = parseKimiOutput(result.stdout, result.stderr, executionId);

    // Add debug info about which strategy was used
    if (parsedResult.metadata) {
      (parsedResult.metadata as any).discoveryStrategy = strategy;
      (parsedResult.metadata as any).skillFile = skillFile;
    }

    return parsedResult;
  } catch (error: any) {
    // Handle timeout
    if (error.message?.includes("timeout")) {
      return {
        status: "error",
        executionId,
        error: `Flow execution timed out after ${timeout}ms`,
        metadata: {
          skillName: flowName,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          stepsExecuted: 0,
        },
      };
    }

    // Handle kimi not found
    if (error.code === "ENOENT" || error.message?.includes("not found")) {
      return {
        status: "error",
        executionId,
        error: "Kimi CLI not found. Please install with: pip install kimi-cli",
        metadata: {
          skillName: flowName,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          stepsExecuted: 0,
        },
      };
    }

    // Parse error output
    return parseKimiOutput(error.stdout || "", error.stderr || error.message, executionId);
  }
}

// ============================================================================
// Mastra Tool Definition
// ============================================================================

/**
 * Kimi Flow Tool - Execute flow skills via Kimi CLI
 *
 * This tool allows Mastra agents to execute Kimi flow skills
 * without native compilation. Perfect for:
 * - Using existing .kimi/skills/ flows
 * - Prototyping flow execution
 * - When native compilation isn't needed
 */
export const kimiFlowTool = createTool({
  id: "kimiFlow",
  description: `Execute a Kimi flow skill using the Kimi CLI subprocess (Pattern B - CLI execution).

**When to use:**
- Quick testing of flow skills during development
- Compatibility with existing Kimi workflows
- When native compilation has issues
- Development and iteration on SKILL.md flows

**When NOT to use:**
- Production workflows requiring Studio visibility (use nativeFlow instead)
- Goose YAML recipes (use gooseFlow instead)
- General AI tasks (use kimi tool instead)

**Examples:**
- Execute: { flowName: "codex-orchestrator", userRequest: "Build auth system" }
- Resume: { flowName: "codex-orchestrator", resume: true, executionId: "...", choice: "complex" }

**Note:** This spawns the Kimi CLI as a subprocess. For production use with full Mastra Studio integration, use nativeFlow instead.

The tool returns:
- status: "completed" | "suspended" | "error" | "running"
- result: The flow output (when completed)
- decisionQuestion: Question to ask user (when suspended)
- options: Available choices (when suspended)
- executionId: Unique ID for this flow execution`,

  inputSchema: z.object({
    flowName: z.string().describe("Name of the flow skill to execute (e.g., 'codex-orchestrator')"),

    userRequest: z.string().describe("The user's request or input for the flow").default(""),

    skillPath: z.string().optional().describe("Override path to skills directory (default: auto-detect)"),

    context: z.record(z.string(), z.any()).optional().describe("Additional context to pass to the flow"),

    resume: z.boolean().default(false).describe("Set to true to resume a previously suspended flow"),

    executionId: z.string().optional().describe("Execution ID from a suspended flow (required when resume=true)"),

    choice: z.string().optional().describe("User's choice for a decision node (required when resume=true)"),

    workingDir: z.string().optional().describe("Working directory for execution (default: auto-detect project root)"),

    timeout: z.number().default(300000).describe("Timeout in milliseconds (default: 5 minutes)"),
  }),

  outputSchema: z.object({
    status: z.enum(["completed", "suspended", "error", "running"]),
    result: z.string().optional(),
    executionId: z.string(),
    currentNode: z.string().optional(),
    decisionQuestion: z.string().optional(),
    options: z
      .array(
        z.object({
          value: z.string(),
          label: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
    metadata: z
      .object({
        skillName: z.string(),
        startTime: z.string(),
        endTime: z.string().optional(),
        stepsExecuted: z.number(),
        discoveryStrategy: z.enum(["explicit", "discovered"]).optional(),
        skillFile: z.string().optional(),
      })
      .optional(),
  }),

  execute: async (input, _context): Promise<any> => {
    // Validate resume parameters
    if (input.resume && !input.choice) {
      return {
        status: "error" as const,
        executionId: input.executionId || generateExecutionId(),
        error: "Choice is required when resuming a flow",
      };
    }

    // Execute the flow
    const result = await executeKimiFlow({
      flowName: input.flowName,
      userRequest: input.userRequest,
      skillPath: input.skillPath,
      context: input.context,
      resume: input.resume,
      executionId: input.executionId,
      choice: input.choice,
      workingDir: input.workingDir,
      timeout: input.timeout,
    });

    // Add metadata
    return {
      ...result,
      metadata: {
        ...result.metadata,
        skillName: input.flowName,
      },
    };
  },
});

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Quick execution helper for simple use cases
 */
export async function runKimiFlow(
  flowName: string,
  userRequest: string,
  options?: Omit<KimiFlowOptions, "flowName" | "userRequest">,
): Promise<KimiFlowResult> {
  return executeKimiFlow({
    flowName,
    userRequest,
    ...options,
  });
}

/**
 * Resume a suspended flow
 */
export async function resumeKimiFlow(executionId: string, choice: string, flowName: string): Promise<KimiFlowResult> {
  return executeKimiFlow({
    flowName,
    userRequest: "", // Not needed for resume
    resume: true,
    executionId,
    choice,
  });
}

// Types are exported at their declaration above
