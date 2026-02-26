// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * File-based locking for adaptation workflows.
 *
 * Uses PID-based locks with staleness detection to prevent race conditions
 * between concurrent workflow runs (cron vs manual triggers).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_LOCK_AGE_MS } from "./adaptation-types";
import { AGENT_DIR } from "./config";

const LOCKS_DIR = resolve(AGENT_DIR, "adaptation/locks");

interface LockData {
  pid: number;
  timestamp: number;
  workflow: string;
}

/**
 * Check if a process with the given PID is still running.
 * Uses process.kill with signal 0 to check without killing.
 */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the locks directory exists.
 */
function ensureLocksDir(): void {
  if (!existsSync(LOCKS_DIR)) {
    mkdirSync(LOCKS_DIR, { recursive: true });
  }
}

/**
 * Get the path to a lock file.
 */
function getLockPath(name: string): string {
  return resolve(LOCKS_DIR, `${name}.lock`);
}

/**
 * Acquire a lock for a workflow.
 *
 * @param name - The name of the workflow (e.g., 'observe', 'reflect', 'coach')
 * @param maxAgeMs - Maximum age of a lock before it's considered stale (default: 10 minutes)
 * @returns true if the lock was acquired, false otherwise
 */
export async function acquireLock(name: string, maxAgeMs: number = MAX_LOCK_AGE_MS): Promise<boolean> {
  ensureLocksDir();
  const lockPath = getLockPath(name);

  try {
    // Check for existing lock
    let existing: string | null = null;
    if (existsSync(lockPath)) {
      try { existing = readFileSync(lockPath, "utf-8"); } catch { existing = null; }
    }

    if (existing) {
      try {
        const lockData: LockData = JSON.parse(existing);
        const age = Date.now() - lockData.timestamp;

        // If lock is fresh and held by another process, can't acquire
        if (age < maxAgeMs && lockData.pid !== process.pid) {
          if (processExists(lockData.pid)) {
            console.log(
              `[adaptation-lock] Lock '${name}' held by process ${lockData.pid} (age: ${Math.round(age / 1000)}s)`,
            );
            return false;
          }
          // Process no longer exists, lock is stale
          console.log(`[adaptation-lock] Stale lock '${name}' from dead process ${lockData.pid}, acquiring`);
        } else if (age >= maxAgeMs) {
          console.log(`[adaptation-lock] Stale lock '${name}' (age: ${Math.round(age / 1000)}s), acquiring`);
        }
        // Lock is stale or held by us, proceed to overwrite
      } catch {
        // Invalid lock file, proceed to overwrite
        console.log(`[adaptation-lock] Invalid lock file '${name}', overwriting`);
      }
    }

    // Write our lock
    const lockData: LockData = {
      pid: process.pid,
      timestamp: Date.now(),
      workflow: name,
    };
    writeFileSync(lockPath, JSON.stringify(lockData, null, 2), "utf-8");
    console.log(`[adaptation-lock] Acquired lock '${name}'`);
    return true;
  } catch (error) {
    console.error(`[adaptation-lock] Failed to acquire lock '${name}':`, error);
    return false;
  }
}

/**
 * Release a lock for a workflow.
 *
 * @param name - The name of the workflow
 */
export async function releaseLock(name: string): Promise<void> {
  const lockPath = getLockPath(name);

  try {
    if (existsSync(lockPath)) {
      // Only delete if we own the lock
      let existing: string | null = null;
      try { existing = readFileSync(lockPath, "utf-8"); } catch { existing = null; }
      if (existing) {
        try {
          const lockData: LockData = JSON.parse(existing);
          if (lockData.pid === process.pid) {
            unlinkSync(lockPath);
            console.log(`[adaptation-lock] Released lock '${name}'`);
          } else {
            console.warn(`[adaptation-lock] Not releasing lock '${name}' - owned by process ${lockData.pid}`);
          }
        } catch {
          // Invalid lock file, delete it
          unlinkSync(lockPath);
        }
      }
    }
  } catch (error) {
    console.error(`[adaptation-lock] Failed to release lock '${name}':`, error);
  }
}

/**
 * Check if a lock is currently held.
 *
 * @param name - The name of the workflow
 * @returns true if the lock is held by any process, false otherwise
 */
export async function isLockHeld(name: string): Promise<boolean> {
  const lockPath = getLockPath(name);

  try {
    if (!existsSync(lockPath)) return false;
    let existing: string | null = null;
    try { existing = readFileSync(lockPath, "utf-8"); } catch { return false; }

    if (!existing) return false;

    const lockData: LockData = JSON.parse(existing);
    const age = Date.now() - lockData.timestamp;

    // Lock is held if it's fresh and the process exists
    if (age < MAX_LOCK_AGE_MS && processExists(lockData.pid)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Execute a function with a lock, automatically releasing it afterwards.
 *
 * @param name - The name of the workflow
 * @param fn - The function to execute while holding the lock
 * @returns The result of the function, or throws if lock couldn't be acquired
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!(await acquireLock(name))) {
    throw new Error(`Failed to acquire lock '${name}'`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(name);
  }
}
