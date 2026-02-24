// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Goose Flow Tool - CLI Pattern Implementation
 *
 * Executes Goose recipes using the Goose CLI.
 * This follows the same pattern as kimiFlowTool (Pattern B - CLI execution).
 *
 * Usage:
 *   goose run --recipe recipe.yaml --params key=value --output-format json -q
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

export interface GooseFlowResult {
  status: "completed" | "suspended" | "error" | "running";
  result?: string;
  executionId: string;
  currentStep?: string;
  decisionQuestion?: string;
  options?: Array<{ value: string; label: string }>;
  error?: string;
  metadata?: {
    recipeName: string;
    recipePath: string;
    startTime: string;
    endTime?: string;
    stepsExecuted: number;
    subrecipes?: string[];
  };
}

export interface GooseFlowOptions {
  recipePath: string;
  parameters?: Record<string, string>;
  userRequest?: string;
  resume?: boolean;
  executionId?: string;
  choice?: string;
  workingDir?: string;
  timeout?: number;
  interactive?: boolean;
}

export interface GooseRecipe {
  version: string;
  title: string;
  description?: string;
  instructions?: string;
  prompt?: string;
  parameters?: Array<{
    key: string;
    input_type: string;
    requirement: "required" | "optional";
    description?: string;
    default?: string;
  }>;
  sub_recipes?: Array<{
    name: string;
    path: string;
    values?: Record<string, string>;
  }>;
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
  env: Record<string, string | undefined>;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function executeGooseProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
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
  });
}

/**
 * Find the project root by looking for common markers
 */
function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = resolve(startDir);

  while (currentDir !== "/") {
    // Check for common project markers
    if (
      existsSync(join(currentDir, "flows")) ||
      existsSync(join(currentDir, ".goose")) ||
      existsSync(join(currentDir, ".git")) ||
      existsSync(join(currentDir, "package.json"))
    ) {
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
  return `goose-flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse Goose recipe YAML
 */
function parseGooseRecipe(yamlContent: string): GooseRecipe {
  try {
    return parseYaml(yamlContent) as GooseRecipe;
  } catch (error) {
    throw new Error(`Failed to parse Goose recipe: ${error}`);
  }
}

/**
 * Find recipe file with multiple strategies
 */
export async function findRecipeFile(
  recipeName: string,
  recipePath?: string,
  workingDir?: string,
): Promise<{ recipeFile: string; projectRoot: string; strategy: "explicit" | "discovered" }> {
  // Strategy A: Explicit path provided
  if (recipePath) {
    const resolvedPath = resolve(recipePath);

    // Check if it's a direct file path
    if (existsSync(resolvedPath) && (resolvedPath.endsWith(".yaml") || resolvedPath.endsWith(".yml"))) {
      return {
        recipeFile: resolvedPath,
        projectRoot: findProjectRoot(dirname(resolvedPath)),
        strategy: "explicit",
      };
    }

    // Check if it's a directory containing the recipe
    const recipeFileInDir = join(resolvedPath, "recipe.yaml");
    if (existsSync(recipeFileInDir)) {
      return {
        recipeFile: recipeFileInDir,
        projectRoot: findProjectRoot(resolvedPath),
        strategy: "explicit",
      };
    }

    throw new Error(
      `Explicit recipe path not found: ${recipePath}\nTried:\n  - ${resolvedPath}\n  - ${recipeFileInDir}`,
    );
  }

  // Strategy B: Auto-discover from project root
  const startDir = workingDir || process.cwd();
  const projectRoot = findProjectRoot(startDir);

  // Common recipe locations
  const possiblePaths = [
    // Primary: flows/ directory
    join(projectRoot, "flows", `${recipeName}.yaml`),
    join(projectRoot, "flows", `${recipeName}.yml`),
    join(projectRoot, "flows", recipeName, "recipe.yaml"),

    // Fallback: recipes/ directory
    join(projectRoot, "recipes", `${recipeName}.yaml`),
    join(projectRoot, "recipes", `${recipeName}.yml`),

    // Fallback: .goose/recipes/
    join(projectRoot, ".goose", "recipes", `${recipeName}.yaml`),
  ];

  // Strategy C: Verify recipe exists
  for (const recipeFile of possiblePaths) {
    if (existsSync(recipeFile)) {
      return {
        recipeFile,
        projectRoot,
        strategy: "discovered",
      };
    }
  }

  // Not found - provide helpful error
  const searchedPaths = possiblePaths.map((p) => `  - ${p}`).join("\n");
  throw new Error(
    `Goose recipe "${recipeName}" not found.\n\nStrategy A (Explicit): No recipePath provided\n\nStrategy B (Discovery): Searched in:\n${searchedPaths}\n\nTo fix:\n  1. Create recipe at: ${join(projectRoot, "flows", `${recipeName}.yaml`)}\n  2. Or provide explicit path: recipePath="/path/to/recipe.yaml"\n  3. Or ensure you're in the correct project directory (cwd: ${startDir})`,
  );
}

/**
 * Parse Goose CLI output to extract structured result
 */
function parseGooseOutput(stdout: string, stderr: string, executionId: string, recipeName: string): GooseFlowResult {
  const output = stdout + stderr;

  // Check for suspension indicators (Goose uses similar patterns)
  const suspensionPatterns = [
    /\[PAUSED\]|\[SUSPENDED\]|Waiting for input|waiting for user input/i,
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

    return {
      status: "suspended",
      executionId,
      result: output.trim(),
      decisionQuestion: questionMatch?.[1]?.trim() || "Please make a selection",
      options: options.length > 0 ? options : undefined,
      metadata: {
        recipeName,
        recipePath: "",
        startTime: new Date().toISOString(),
        stepsExecuted: 0,
      },
    };
  }

  // Check for errors
  if (
    stderr.includes("error") ||
    stderr.includes("Error") ||
    stdout.includes("ERROR") ||
    stderr.includes("not found")
  ) {
    return {
      status: "error",
      executionId,
      error: stderr || "Unknown error occurred",
      result: output.trim(),
      metadata: {
        recipeName,
        recipePath: "",
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
      recipeName,
      recipePath: "",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      stepsExecuted: 1,
    },
  };
}

// ============================================================================
// Core Execution Functions
// ============================================================================

/**
 * Execute a Goose recipe using the Goose CLI
 */
async function executeGooseFlow(options: GooseFlowOptions): Promise<GooseFlowResult> {
  const {
    recipePath,
    parameters = {},
    userRequest = "",
    resume,
    executionId: existingExecutionId,
    choice,
    workingDir,
    timeout = 300000, // 5 minutes default
    interactive = false,
  } = options;

  const executionId = existingExecutionId || generateExecutionId();

  // ==========================================================================
  // STEP 1: Find recipe file
  // ==========================================================================
  let recipeInfo: { recipeFile: string; projectRoot: string; strategy: "explicit" | "discovered" };
  try {
    recipeInfo = await findRecipeFile(recipePath, recipePath, workingDir);
  } catch (error: any) {
    return {
      status: "error",
      executionId,
      error: error.message,
      metadata: {
        recipeName: recipePath,
        recipePath: recipePath,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        stepsExecuted: 0,
      },
    };
  }

  const { recipeFile, projectRoot, strategy } = recipeInfo;

  // Parse recipe to get metadata
  let recipe: GooseRecipe;
  try {
    const yamlContent = readFileSync(recipeFile, "utf-8");
    recipe = parseGooseRecipe(yamlContent);
  } catch (error: any) {
    return {
      status: "error",
      executionId,
      error: `Failed to parse recipe: ${error.message}`,
      metadata: {
        recipeName: recipePath,
        recipePath: recipeFile,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        stepsExecuted: 0,
      },
    };
  }

  // ==========================================================================
  // STEP 2: Build goose command
  // ==========================================================================
  const args: string[] = ["run", "--recipe", recipeFile];

  // Add parameters
  for (const [key, value] of Object.entries(parameters)) {
    args.push("--params", `${key}=${value}`);
  }

  // Add user request as text if provided
  if (userRequest && !resume) {
    args.push("-t", userRequest);
  }

  // Resume mode
  if (resume && choice) {
    // Goose doesn't have direct resume, we might need to handle this differently
    // For now, pass the choice as a parameter
    args.push("--params", `choice=${choice}`);
  }

  // Quiet mode for cleaner output
  args.push("-q");

  // Output format (JSON for structured results)
  args.push("--output-format", "json");

  // Interactive mode if requested
  if (interactive) {
    args.push("-s");
  }

  // No session storage for one-off executions
  args.push("--no-session");

  try {
    // Execute goose CLI
    const result = await executeGooseProcess("goose", args, {
      cwd: projectRoot,
      timeout,
      env: {
        ...process.env,
        GOOSE_WORK_DIR: projectRoot,
      },
    });

    // Parse output
    const parsedResult = parseGooseOutput(result.stdout, result.stderr, executionId, recipe.title || recipePath);

    // Add metadata
    if (parsedResult.metadata) {
      (parsedResult.metadata as any).discoveryStrategy = strategy;
      parsedResult.metadata.recipePath = recipeFile;
      parsedResult.metadata.subrecipes = recipe.sub_recipes?.map((sr) => sr.name);
    }

    return parsedResult;
  } catch (error: any) {
    // Handle timeout
    if (error.message?.includes("timeout")) {
      return {
        status: "error",
        executionId,
        error: `Goose recipe execution timed out after ${timeout}ms`,
        metadata: {
          recipeName: recipe.title || recipePath,
          recipePath: recipeFile,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          stepsExecuted: 0,
        },
      };
    }

    // Handle goose not found
    if (error.code === "ENOENT" || error.message?.includes("not found")) {
      return {
        status: "error",
        executionId,
        error:
          "Goose CLI not found. Please install with: curl -fsSL https://github.com/block/goose/releases/latest/download/download_cli.sh | bash",
        metadata: {
          recipeName: recipe.title || recipePath,
          recipePath: recipeFile,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          stepsExecuted: 0,
        },
      };
    }

    // Parse error output
    return parseGooseOutput(error.stdout || "", error.stderr || error.message, executionId, recipe.title || recipePath);
  }
}

// ============================================================================
// Mastra Tool Definition
// ============================================================================

/**
 * Goose Flow Tool - Execute Goose recipes via CLI
 *
 * This tool allows Mastra agents to execute Goose recipes
 * using the Goose CLI subprocess (Pattern B - CLI execution).
 *
 * Similar to kimiFlowTool but for Goose recipes.
 */
export const gooseFlowTool = createTool({
  id: "gooseFlow",
  description: `Execute a Goose recipe using the Goose CLI (Pattern B - CLI execution).

**When to use:**
- Executing existing Goose YAML recipes
- Workflows with subrecipes that need orchestration
- Recipes in the .goose/recipes/ directory
- When you need Goose-specific features

**When NOT to use:**
- SKILL.md flows (use nativeFlow or kimiFlow instead)
- General AI tasks (use kimi, claude, codex, or gemini)

**Examples:**
- Execute: { recipePath: "./flows/multi-step.yaml", parameters: { topic: "AI" } }
- Resume: { recipePath: "./flows/multi-step.yaml", resume: true, executionId: "...", choice: "yes" }

**Note:** This is a CLI subprocess tool (Pattern B). For native Mastra execution with Studio visibility, consider converting Goose recipes to SKILL.md format and using nativeFlow.

The tool returns:
- status: "completed" | "suspended" | "error" | "running"
- result: The recipe output (when completed)
- decisionQuestion: Question to ask user (when suspended)
- options: Available choices (when suspended)
- executionId: Unique ID for this execution`,

  inputSchema: z.object({
    recipePath: z.string().describe("Path to the Goose recipe YAML file (e.g., './flows/multi-step.yaml')"),

    parameters: z
      .record(z.string(), z.string())
      .optional()
      .describe("Recipe parameters as key-value pairs (e.g., { topic: 'AI' })"),

    userRequest: z.string().optional().describe("Additional user request text to pass to the recipe"),

    resume: z.boolean().default(false).describe("Set to true to resume a previously suspended recipe"),

    executionId: z.string().optional().describe("Execution ID from a suspended recipe (required when resume=true)"),

    choice: z.string().optional().describe("User's choice for a decision node (required when resume=true)"),

    workingDir: z.string().optional().describe("Working directory for execution (default: auto-detect project root)"),

    timeout: z.number().default(300000).describe("Timeout in milliseconds (default: 5 minutes)"),

    interactive: z
      .boolean()
      .default(false)
      .describe("Stay in interactive mode after initial execution (not recommended for automation)"),
  }),

  outputSchema: z.object({
    status: z.enum(["completed", "suspended", "error", "running"]),
    result: z.string().optional(),
    executionId: z.string(),
    currentStep: z.string().optional(),
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
        recipeName: z.string(),
        recipePath: z.string(),
        startTime: z.string(),
        endTime: z.string().optional(),
        stepsExecuted: z.number(),
        subrecipes: z.array(z.string()).optional(),
        discoveryStrategy: z.enum(["explicit", "discovered"]).optional(),
      })
      .optional(),
  }),

  execute: async (input, _context) => {
    // Validate resume parameters
    if (input.resume && !input.choice) {
      return {
        status: "error" as const,
        executionId: input.executionId || generateExecutionId(),
        error: "Choice is required when resuming a recipe",
      };
    }

    // Execute the recipe
    const result = await executeGooseFlow({
      recipePath: input.recipePath,
      parameters: input.parameters,
      userRequest: input.userRequest,
      resume: input.resume,
      executionId: input.executionId,
      choice: input.choice,
      workingDir: input.workingDir,
      timeout: input.timeout,
      interactive: input.interactive,
    });

    return result;
  },
});

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Quick execution helper for simple use cases
 */
export async function runGooseFlow(
  recipePath: string,
  parameters?: Record<string, string>,
  options?: Omit<GooseFlowOptions, "recipePath" | "parameters">,
): Promise<GooseFlowResult> {
  return executeGooseFlow({
    recipePath,
    parameters,
    ...options,
  });
}

/**
 * Resume a suspended recipe
 */
export async function resumeGooseFlow(
  executionId: string,
  choice: string,
  recipePath: string,
): Promise<GooseFlowResult> {
  return executeGooseFlow({
    recipePath,
    resume: true,
    executionId,
    choice,
  });
}

// Types are exported at their declaration above
