// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Adaptation System Tests
 *
 * Tests for the Observe → Reflect → Coach adaptation pipeline.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { acquireLock, isLockHeld, releaseLock, withLock } from "./adaptation-lock";
import {
  ADAPTATION_DIR,
  daysSince,
  ensureAdaptationDirs,
  generateId,
  loadActivePatterns,
  loadPendingSuggestions,
  loadState,
  saveActivePatterns,
  savePendingSuggestions,
  saveState,
} from "./adaptation-storage";
import type { AdaptationPattern, AdaptationState, CoachingSuggestion } from "./adaptation-types";

// Test directory for isolation
const TEST_ADAPTATION_DIR = resolve(ADAPTATION_DIR, "../adaptation-test");

describe("adaptation-lock", () => {
  const testLockName = "test-lock";

  beforeEach(async () => {
    // Clean up any existing test locks
    await releaseLock(testLockName);
  });

  afterEach(async () => {
    await releaseLock(testLockName);
  });

  it("should acquire and release lock", async () => {
    const acquired = await acquireLock(testLockName);
    expect(acquired).toBe(true);

    const isHeld = await isLockHeld(testLockName);
    expect(isHeld).toBe(true);

    await releaseLock(testLockName);

    const isHeldAfter = await isLockHeld(testLockName);
    expect(isHeldAfter).toBe(false);
  });

  it("should not allow double acquisition", async () => {
    const first = await acquireLock(testLockName);
    expect(first).toBe(true);

    // Same process can re-acquire (idempotent)
    const second = await acquireLock(testLockName);
    expect(second).toBe(true);

    await releaseLock(testLockName);
  });

  it("should execute withLock correctly", async () => {
    let executed = false;

    const result = await withLock(testLockName, async () => {
      executed = true;
      return "success";
    });

    expect(executed).toBe(true);
    expect(result).toBe("success");

    // Lock should be released after withLock
    const isHeld = await isLockHeld(testLockName);
    expect(isHeld).toBe(false);
  });

  it("should release lock even on error in withLock", async () => {
    try {
      await withLock(testLockName, async () => {
        throw new Error("Test error");
      });
    } catch (error) {
      // Expected
    }

    // Lock should still be released
    const isHeld = await isLockHeld(testLockName);
    expect(isHeld).toBe(false);
  });
});

describe("adaptation-storage", () => {
  it("should generate unique IDs", () => {
    const id1 = generateId();
    const id2 = generateId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it("should calculate days since correctly", () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    expect(daysSince(now.toISOString())).toBe(0);
    expect(daysSince(yesterday.toISOString())).toBe(1);
    expect(daysSince(lastWeek.toISOString())).toBe(7);
  });

  it("should ensure adaptation directories exist", () => {
    ensureAdaptationDirs();
    expect(existsSync(ADAPTATION_DIR)).toBe(true);
  });

  it("should load and save state", async () => {
    const state = await loadState();
    expect(state).toBeDefined();
    expect(state.runCount).toBeGreaterThanOrEqual(0);

    // Update state
    const newState: AdaptationState = {
      ...state,
      runCount: state.runCount + 1,
      lastObserveRun: new Date().toISOString(),
    };

    await saveState(newState);

    const loadedState = await loadState();
    expect(loadedState.runCount).toBe(newState.runCount);
    expect(loadedState.lastObserveRun).toBe(newState.lastObserveRun);
  });

  it("should load and save patterns", async () => {
    const patterns = await loadActivePatterns();
    expect(Array.isArray(patterns)).toBe(true);

    // Add a test pattern
    const testPattern: AdaptationPattern = {
      id: generateId(),
      type: "preference",
      pattern: "Test pattern",
      guidance: "Test guidance",
      state: "active",
      createdAt: new Date().toISOString(),
      lastReinforcedAt: new Date().toISOString(),
      runsWithoutReinforcement: 0,
      confidence: 0.8,
      occurrences: 1,
      sourceObservations: [],
    };

    await saveActivePatterns([...patterns, testPattern]);

    const loadedPatterns = await loadActivePatterns();
    const found = loadedPatterns.find((p) => p.id === testPattern.id);
    expect(found).toBeDefined();
    expect(found?.pattern).toBe("Test pattern");

    // Cleanup: restore original patterns
    await saveActivePatterns(patterns);
  });
});

describe("adaptation-types", () => {
  it("should have correct coaching expiration days", async () => {
    const { COACHING_EXPIRATION_DAYS } = await import("./adaptation-types");

    expect(COACHING_EXPIRATION_DAYS.high).toBe(3);
    expect(COACHING_EXPIRATION_DAYS.medium).toBe(7);
    expect(COACHING_EXPIRATION_DAYS.low).toBe(14);
  });

  it("should have correct thresholds", async () => {
    const {
      PATTERN_STALE_THRESHOLD_RUNS,
      PATTERN_VALIDATE_THRESHOLD_OCCURRENCES,
      PATTERN_ARCHIVE_THRESHOLD_DAYS,
      JACCARD_SIMILARITY_THRESHOLD,
    } = await import("./adaptation-types");

    expect(PATTERN_STALE_THRESHOLD_RUNS).toBe(3);
    expect(PATTERN_VALIDATE_THRESHOLD_OCCURRENCES).toBe(3);
    expect(PATTERN_ARCHIVE_THRESHOLD_DAYS).toBe(30);
    expect(JACCARD_SIMILARITY_THRESHOLD).toBe(0.7);
  });
});
