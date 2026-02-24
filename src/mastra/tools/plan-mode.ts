// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Plan Mode Tool
 *
 * Provides "draft mode" functionality similar to Claude Code's plan mode.
 * Shows proposed file changes before execution, with approval workflow.
 *
 * Actions:
 * - enter: Start a new plan session
 * - get-plan: View current plan with all changes
 * - approve: Approve a specific change
 * - reject: Reject a specific change
 * - execute: Apply all approved changes atomically
 * - exit: Exit plan mode (discard pending changes)
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { formatChange, formatPlanSummary, getChangeOneLine } from "./plan-mode-diff";
import {
  type PlanSession,
  approveChange,
  executeApprovedChanges,
  exitPlanMode,
  getActivePlanSession,
  getChange,
  isInPlanMode,
  rejectChange,
  startPlanSession,
} from "./plan-mode-manager";

/**
 * Action enum
 */
const actionSchema = z.enum(["enter", "get-plan", "approve", "reject", "execute", "exit"]);

/**
 * Input schema for plan-mode tool
 */
const planModeInputSchema = z.object({
  action: actionSchema.describe("Action to perform"),
  metadata: z
    .object({
      initiator: z.string().optional().describe("Who initiated the plan"),
      reason: z.string().optional().describe("Reason for the plan"),
    })
    .optional()
    .describe("Session metadata (for enter action)"),
  changeId: z.string().optional().describe("Change ID (required for approve/reject actions)"),
  sessionId: z.string().optional().describe("Session ID (optional for get-plan/execute/exit)"),
});

/**
 * Output schema for plan-mode tool
 */
const planModeOutputSchema = z.object({
  success: z.boolean().describe("Whether the action succeeded"),
  action: z.string().describe("Action that was performed"),
  sessionId: z.string().optional().describe("Plan session ID"),
  message: z.string().describe("Status message"),
  session: z
    .object({
      id: z.string(),
      status: z.string(),
      changesCount: z.number(),
      pendingCount: z.number(),
      approvedCount: z.number(),
      rejectedCount: z.number(),
      startedAt: z.string(),
    })
    .optional()
    .describe("Session summary"),
  planSummary: z.string().optional().describe("Detailed plan summary (markdown)"),
  change: z
    .object({
      id: z.string(),
      type: z.string(),
      filePath: z.string(),
      status: z.string(),
    })
    .optional()
    .describe("Change details"),
  executionResult: z
    .object({
      executed: z.number(),
      failed: z.number(),
      errors: z.array(
        z.object({
          changeId: z.string(),
          filePath: z.string(),
          error: z.string(),
        }),
      ),
    })
    .optional()
    .describe("Execution result"),
  changesDiscarded: z.number().optional().describe("Number of changes discarded (for exit action)"),
});

/**
 * Format session for output
 */
function formatSession(session: PlanSession) {
  return {
    id: session.id,
    status: session.status,
    changesCount: session.changes.length,
    pendingCount: session.changes.filter((c) => c.status === "pending").length,
    approvedCount: session.changes.filter((c) => c.status === "approved").length,
    rejectedCount: session.changes.filter((c) => c.status === "rejected").length,
    startedAt: session.startedAt.toISOString(),
  };
}

/**
 * Enter plan mode (start a new session)
 */
function enterPlanMode(input: z.infer<typeof planModeInputSchema>): z.infer<typeof planModeOutputSchema> {
  const { metadata } = input;

  if (isInPlanMode()) {
    const activeSession = getActivePlanSession();
    return {
      success: false,
      action: "enter",
      sessionId: activeSession?.id,
      message: `Already in plan mode (session: ${activeSession?.id}). Exit current session first.`,
    };
  }

  try {
    const session = startPlanSession(metadata || {});

    return {
      success: true,
      action: "enter",
      sessionId: session.id,
      message: `Entered plan mode. Session: ${session.id}`,
      session: formatSession(session),
    };
  } catch (error) {
    return {
      success: false,
      action: "enter",
      message: `Failed to enter plan mode: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get the current plan
 */
function getPlan(input: z.infer<typeof planModeInputSchema>): z.infer<typeof planModeOutputSchema> {
  const session = getActivePlanSession();

  if (!session) {
    return {
      success: false,
      action: "get-plan",
      message: "Not in plan mode",
    };
  }

  const planSummary = formatPlanSummary(session);

  return {
    success: true,
    action: "get-plan",
    sessionId: session.id,
    message: `Current plan has ${session.changes.length} change(s)`,
    session: formatSession(session),
    planSummary,
  };
}

/**
 * Approve a change
 */
function approveChangeAction(input: z.infer<typeof planModeInputSchema>): z.infer<typeof planModeOutputSchema> {
  const { changeId } = input;

  if (!changeId) {
    return {
      success: false,
      action: "approve",
      message: "Change ID is required for approve action",
    };
  }

  if (!isInPlanMode()) {
    return {
      success: false,
      action: "approve",
      message: "Not in plan mode",
    };
  }

  try {
    approveChange(changeId);

    const change = getChange(changeId);
    const session = getActivePlanSession();

    return {
      success: true,
      action: "approve",
      sessionId: session?.id,
      message: `Approved change: ${changeId}`,
      change: change
        ? {
            id: change.id,
            type: change.type,
            filePath: change.filePath,
            status: change.status,
          }
        : undefined,
      session: session ? formatSession(session) : undefined,
    };
  } catch (error) {
    return {
      success: false,
      action: "approve",
      message: `Failed to approve change: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Reject a change
 */
function rejectChangeAction(input: z.infer<typeof planModeInputSchema>): z.infer<typeof planModeOutputSchema> {
  const { changeId } = input;

  if (!changeId) {
    return {
      success: false,
      action: "reject",
      message: "Change ID is required for reject action",
    };
  }

  if (!isInPlanMode()) {
    return {
      success: false,
      action: "reject",
      message: "Not in plan mode",
    };
  }

  try {
    rejectChange(changeId);

    const change = getChange(changeId);
    const session = getActivePlanSession();

    return {
      success: true,
      action: "reject",
      sessionId: session?.id,
      message: `Rejected change: ${changeId}`,
      change: change
        ? {
            id: change.id,
            type: change.type,
            filePath: change.filePath,
            status: change.status,
          }
        : undefined,
      session: session ? formatSession(session) : undefined,
    };
  } catch (error) {
    return {
      success: false,
      action: "reject",
      message: `Failed to reject change: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Execute all approved changes
 */
function executePlan(input: z.infer<typeof planModeInputSchema>): z.infer<typeof planModeOutputSchema> {
  if (!isInPlanMode()) {
    return {
      success: false,
      action: "execute",
      message: "Not in plan mode",
    };
  }

  const session = getActivePlanSession();
  if (!session) {
    return {
      success: false,
      action: "execute",
      message: "No active session found",
    };
  }

  try {
    const result = executeApprovedChanges();

    return {
      success: result.success,
      action: "execute",
      sessionId: session.id,
      message: result.success
        ? `Successfully executed ${result.executed} change(s)`
        : `Execution failed. Executed ${result.executed}, failed ${result.failed}. Changes rolled back.`,
      executionResult: {
        executed: result.executed,
        failed: result.failed,
        errors: result.errors,
      },
    };
  } catch (error) {
    return {
      success: false,
      action: "execute",
      sessionId: session.id,
      message: `Failed to execute plan: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Exit plan mode
 */
function exitPlan(input: z.infer<typeof planModeInputSchema>): z.infer<typeof planModeOutputSchema> {
  if (!isInPlanMode()) {
    return {
      success: false,
      action: "exit",
      message: "Not in plan mode",
    };
  }

  try {
    const result = exitPlanMode();

    return {
      success: true,
      action: "exit",
      sessionId: result.sessionId,
      message: `Exited plan mode. Discarded ${result.changesDiscarded} change(s).`,
      changesDiscarded: result.changesDiscarded,
    };
  } catch (error) {
    return {
      success: false,
      action: "exit",
      message: `Failed to exit plan mode: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Plan Mode Tool
 *
 * Manages plan mode for showing proposed file changes before execution.
 */
export const planModeTool = createTool({
  id: "plan-mode",
  inputSchema: planModeInputSchema,
  outputSchema: planModeOutputSchema,
  description:
    "Manages plan mode (draft mode) for file changes. Actions: enter (start planning), get-plan (view changes), approve/reject (review changes), execute (apply changes), exit (cancel). Use this to show proposed changes before modifying files.",
  execute: async (input) => {
    const { action } = input;

    try {
      switch (action) {
        case "enter":
          return enterPlanMode(input);

        case "get-plan":
          return getPlan(input);

        case "approve":
          return approveChangeAction(input);

        case "reject":
          return rejectChangeAction(input);

        case "execute":
          return executePlan(input);

        case "exit":
          return exitPlan(input);

        default:
          return {
            success: false,
            action,
            message: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        action,
        message: `Error executing ${action}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
