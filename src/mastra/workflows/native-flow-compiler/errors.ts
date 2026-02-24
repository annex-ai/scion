// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Custom Error Types for Compiled Workflows
 *
 * Domain-specific errors aligned with Mastra best practices for
 * proper error handling in workflow execution.
 */

/**
 * Base error for compiled workflow execution failures
 */
export class CompiledWorkflowError extends Error {
  constructor(
    message: string,
    public readonly workflowId: string,
    public readonly stepId?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "CompiledWorkflowError";
    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CompiledWorkflowError);
    }
  }
}

/**
 * Error during task step execution (LLM call failure, timeout, etc.)
 */
export class TaskExecutionError extends CompiledWorkflowError {
  constructor(
    message: string,
    workflowId: string,
    stepId: string,
    public readonly taskLabel: string,
    cause?: Error,
  ) {
    super(message, workflowId, stepId, cause);
    this.name = "TaskExecutionError";
  }
}

/**
 * Error during loop execution (max iterations, invalid state, etc.)
 */
export class LoopExecutionError extends CompiledWorkflowError {
  constructor(
    message: string,
    workflowId: string,
    public readonly loopConditionNode: string,
    public readonly iterationCount: number,
    cause?: Error,
  ) {
    super(message, workflowId, loopConditionNode, cause);
    this.name = "LoopExecutionError";
  }
}

/**
 * Error during decision step execution (invalid choice, resume failure, etc.)
 */
export class DecisionExecutionError extends CompiledWorkflowError {
  constructor(
    message: string,
    workflowId: string,
    stepId: string,
    public readonly availableChoices: string[],
    public readonly invalidChoice?: string,
    cause?: Error,
  ) {
    super(message, workflowId, stepId, cause);
    this.name = "DecisionExecutionError";
  }
}

/**
 * Error during workflow compilation (invalid AST, missing nodes, etc.)
 */
export class WorkflowCompilationError extends Error {
  constructor(
    message: string,
    public readonly workflowId: string,
    public readonly details?: Record<string, any>,
  ) {
    super(message);
    this.name = "WorkflowCompilationError";
  }
}
