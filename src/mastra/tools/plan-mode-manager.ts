// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Plan Mode Manager
 *
 * Core state management for plan mode. Tracks active plan sessions,
 * records file changes, and manages the plan approval workflow.
 *
 * Plan mode allows showing proposed file changes before execution,
 * providing a "draft mode" similar to Claude Code's plan mode.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateDiff } from "./plan-mode-diff";

/**
 * Change types
 */
export type ChangeType = "write" | "edit" | "delete";

/**
 * Change status
 */
export type ChangeStatus = "pending" | "approved" | "rejected" | "executed";

/**
 * Session status
 */
export type SessionStatus = "active" | "executed" | "cancelled";

/**
 * Plan change metadata
 */
export interface ChangeMetadata {
  /** Tool that created the change */
  tool: string;
  /** When the change was recorded */
  timestamp: Date;
  /** Optional reason for the change */
  reason?: string;
}

/**
 * A single file change in a plan
 */
export interface PlanChange {
  /** Unique change identifier */
  id: string;
  /** Type of change */
  type: ChangeType;
  /** Path to the file */
  filePath: string;
  /** Original content (undefined for new files) */
  before?: string;
  /** New content (undefined for deletions) */
  after?: string;
  /** Current status */
  status: ChangeStatus;
  /** Change metadata */
  metadata: ChangeMetadata;
  /** Generated diff */
  diff?: string;
}

/**
 * Plan session metadata
 */
export interface PlanSessionMetadata {
  /** Who initiated the plan */
  initiator?: string;
  /** Reason for the plan */
  reason?: string;
}

/**
 * A plan session containing multiple changes
 */
export interface PlanSession {
  /** Session ID */
  id: string;
  /** When the session started */
  startedAt: Date;
  /** Array of changes */
  changes: PlanChange[];
  /** Current session status */
  status: SessionStatus;
  /** Session metadata */
  metadata: PlanSessionMetadata;
}

// Module-level state
let activePlanSessionId: string | null = null;
const planSessions = new Map<string, PlanSession>();

/**
 * Get the plans directory path
 */
export function getPlansDir(): string {
  return join(process.cwd(), ".blackboard", "plans");
}

/**
 * Get the session directory path
 */
export function getSessionDir(sessionId: string): string {
  return join(getPlansDir(), sessionId);
}

/**
 * Get the session file path
 */
export function getSessionPath(sessionId: string): string {
  return join(getSessionDir(sessionId), "session.json");
}

/**
 * Get the changes directory path
 */
export function getChangesDir(sessionId: string): string {
  return join(getSessionDir(sessionId), "changes");
}

/**
 * Get the change file path
 */
export function getChangePath(sessionId: string, changeId: string): string {
  return join(getChangesDir(sessionId), `${changeId}.json`);
}

/**
 * Initialize plans directory structure
 */
export function initializePlansDir(): void {
  const plansDir = getPlansDir();
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }
}

/**
 * Load a session from disk
 */
export function loadSession(sessionId: string): PlanSession | null {
  const sessionPath = getSessionPath(sessionId);

  if (!existsSync(sessionPath)) {
    return null;
  }

  try {
    const content = readFileSync(sessionPath, "utf-8");
    const session = JSON.parse(content) as PlanSession;

    // Convert date strings back to Date objects
    session.startedAt = new Date(session.startedAt);
    session.changes.forEach((change) => {
      change.metadata.timestamp = new Date(change.metadata.timestamp);
    });

    return session;
  } catch (error) {
    console.error(`[plan-mode-manager] Failed to load session ${sessionId}:`, error);
    return null;
  }
}

/**
 * Save a session to disk
 */
export function saveSession(session: PlanSession): void {
  initializePlansDir();

  const sessionDir = getSessionDir(session.id);
  const changesDir = getChangesDir(session.id);

  // Create directories
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  if (!existsSync(changesDir)) {
    mkdirSync(changesDir, { recursive: true });
  }

  // Save session file
  const sessionPath = getSessionPath(session.id);
  try {
    writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8");
  } catch (error) {
    console.error(`[plan-mode-manager] Failed to save session ${session.id}:`, error);
    throw new Error(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Save individual change files
  for (const change of session.changes) {
    const changePath = getChangePath(session.id, change.id);
    try {
      writeFileSync(changePath, JSON.stringify(change, null, 2), "utf-8");
    } catch (error) {
      console.error(`[plan-mode-manager] Failed to save change ${change.id}:`, error);
    }
  }
}

/**
 * Check if currently in plan mode
 */
export function isInPlanMode(): boolean {
  return activePlanSessionId !== null;
}

/**
 * Get the active plan session
 */
export function getActivePlanSession(): PlanSession | null {
  if (!activePlanSessionId) {
    return null;
  }

  // Check cache first
  if (planSessions.has(activePlanSessionId)) {
    return planSessions.get(activePlanSessionId)!;
  }

  // Load from disk
  const session = loadSession(activePlanSessionId);
  if (session) {
    planSessions.set(activePlanSessionId, session);
  }

  return session;
}

/**
 * Start a new plan session
 */
export function startPlanSession(metadata: PlanSessionMetadata = {}): PlanSession {
  if (activePlanSessionId) {
    throw new Error("A plan session is already active. Exit the current session before starting a new one.");
  }

  const sessionId = `plan-${Date.now()}`;
  const session: PlanSession = {
    id: sessionId,
    startedAt: new Date(),
    changes: [],
    status: "active",
    metadata,
  };

  activePlanSessionId = sessionId;
  planSessions.set(sessionId, session);
  saveSession(session);

  console.log(`[plan-mode-manager] Started plan session: ${sessionId}`);
  return session;
}

/**
 * Exit plan mode (discard pending changes)
 */
export function exitPlanMode(): { sessionId: string; changesDiscarded: number } {
  if (!activePlanSessionId) {
    throw new Error("No active plan session");
  }

  const session = getActivePlanSession();
  if (!session) {
    throw new Error("Active plan session not found");
  }

  const changesDiscarded = session.changes.filter((c) => c.status === "pending" || c.status === "approved").length;

  // Update session status
  session.status = "cancelled";
  saveSession(session);

  // Clear active session
  const sessionId = activePlanSessionId;
  activePlanSessionId = null;
  planSessions.delete(sessionId);

  console.log(`[plan-mode-manager] Exited plan session: ${sessionId}, discarded ${changesDiscarded} changes`);

  return { sessionId, changesDiscarded };
}

/**
 * Generate a unique change ID
 */
function generateChangeId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `change-${timestamp}-${random}`;
}

/**
 * Add a change to the active session
 */
export function addChangeToSession(change: Omit<PlanChange, "id" | "diff">): string {
  const session = getActivePlanSession();
  if (!session) {
    throw new Error("No active plan session");
  }

  const changeId = generateChangeId();

  // Generate diff
  const diff = generateDiff(change.filePath, change.before, change.after, change.type);

  const fullChange: PlanChange = {
    ...change,
    id: changeId,
    diff,
  };

  session.changes.push(fullChange);
  saveSession(session);

  console.log(
    `[plan-mode-manager] Added change ${changeId} to session ${session.id}: ${change.type} ${change.filePath}`,
  );

  return changeId;
}

/**
 * Get a change by ID from the active session
 */
export function getChange(changeId: string): PlanChange | null {
  const session = getActivePlanSession();
  if (!session) {
    return null;
  }

  return session.changes.find((c) => c.id === changeId) || null;
}

/**
 * Approve a change
 */
export function approveChange(changeId: string): void {
  const session = getActivePlanSession();
  if (!session) {
    throw new Error("No active plan session");
  }

  const change = session.changes.find((c) => c.id === changeId);
  if (!change) {
    throw new Error(`Change not found: ${changeId}`);
  }

  if (change.status === "executed") {
    throw new Error(`Change ${changeId} has already been executed`);
  }

  change.status = "approved";
  saveSession(session);

  console.log(`[plan-mode-manager] Approved change ${changeId}`);
}

/**
 * Reject a change
 */
export function rejectChange(changeId: string): void {
  const session = getActivePlanSession();
  if (!session) {
    throw new Error("No active plan session");
  }

  const change = session.changes.find((c) => c.id === changeId);
  if (!change) {
    throw new Error(`Change not found: ${changeId}`);
  }

  if (change.status === "executed") {
    throw new Error(`Change ${changeId} has already been executed`);
  }

  change.status = "rejected";
  saveSession(session);

  console.log(`[plan-mode-manager] Rejected change ${changeId}`);
}

/**
 * Execute all approved changes atomically
 *
 * @returns Execution result with success/failure details
 */
export function executeApprovedChanges(): {
  success: boolean;
  executed: number;
  failed: number;
  errors: Array<{ changeId: string; filePath: string; error: string }>;
} {
  const session = getActivePlanSession();
  if (!session) {
    throw new Error("No active plan session");
  }

  const approvedChanges = session.changes.filter((c) => c.status === "approved");

  if (approvedChanges.length === 0) {
    throw new Error("No approved changes to execute");
  }

  const executedChanges: PlanChange[] = [];
  const errors: Array<{ changeId: string; filePath: string; error: string }> = [];

  // Execute changes
  for (const change of approvedChanges) {
    try {
      if (change.type === "write" || change.type === "edit") {
        // Ensure directory exists
        const dir = dirname(change.filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // Write file
        writeFileSync(change.filePath, change.after || "", "utf-8");
      } else if (change.type === "delete") {
        if (existsSync(change.filePath)) {
          unlinkSync(change.filePath);
        }
      }

      // Mark as executed
      change.status = "executed";
      executedChanges.push(change);

      console.log(`[plan-mode-manager] Executed change ${change.id}: ${change.type} ${change.filePath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[plan-mode-manager] Failed to execute change ${change.id}:`, error);

      errors.push({
        changeId: change.id,
        filePath: change.filePath,
        error: errorMessage,
      });

      // Rollback executed changes
      console.log(`[plan-mode-manager] Rolling back ${executedChanges.length} executed changes...`);
      for (const executed of executedChanges) {
        try {
          if (executed.type === "write" || executed.type === "edit") {
            if (executed.before !== undefined) {
              // Restore original content
              writeFileSync(executed.filePath, executed.before, "utf-8");
            } else {
              // Was a new file, delete it
              if (existsSync(executed.filePath)) {
                unlinkSync(executed.filePath);
              }
            }
          } else if (executed.type === "delete") {
            if (executed.before !== undefined) {
              // Restore deleted file
              writeFileSync(executed.filePath, executed.before, "utf-8");
            }
          }

          executed.status = "approved"; // Reset to approved
          console.log(`[plan-mode-manager] Rolled back change ${executed.id}`);
        } catch (rollbackError) {
          console.error(`[plan-mode-manager] Failed to rollback change ${executed.id}:`, rollbackError);
        }
      }

      break; // Stop on first error
    }
  }

  // Save session
  session.status = errors.length === 0 ? "executed" : "active";
  saveSession(session);

  // Exit plan mode if all succeeded
  if (errors.length === 0) {
    activePlanSessionId = null;
    planSessions.delete(session.id);
    console.log(`[plan-mode-manager] Successfully executed ${executedChanges.length} changes, exiting plan mode`);
  }

  return {
    success: errors.length === 0,
    executed: executedChanges.length,
    failed: errors.length,
    errors,
  };
}

/**
 * List all plan sessions (including historical ones)
 */
export function listSessions(): PlanSession[] {
  initializePlansDir();

  const plansDir = getPlansDir();
  if (!existsSync(plansDir)) {
    return [];
  }

  const sessionDirs = readdirSync(plansDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  const sessions: PlanSession[] = [];

  for (const dir of sessionDirs) {
    const session = loadSession(dir.name);
    if (session) {
      sessions.push(session);
    }
  }

  return sessions;
}
