// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Storage utilities for the adaptation system.
 *
 * Provides JSON read/write helpers for observations, patterns, coaching,
 * state, and metrics files in the .agent/adaptation/ directory.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type {
  AdaptationMetrics,
  AdaptationPattern,
  AdaptationState,
  CoachingSuggestion,
  Observation,
} from "./adaptation-types";
import { AGENT_DIR } from "./config";

// Base directory for adaptation data
export const ADAPTATION_DIR = resolve(AGENT_DIR, "adaptation");

// Subdirectories
export const OBSERVATIONS_PENDING_DIR = resolve(ADAPTATION_DIR, "observations/pending");
export const OBSERVATIONS_PROCESSED_DIR = resolve(ADAPTATION_DIR, "observations/processed");
export const PATTERNS_DIR = resolve(ADAPTATION_DIR, "patterns");
export const PATTERNS_ARCHIVE_DIR = resolve(ADAPTATION_DIR, "patterns/archive");
export const COACHING_DIR = resolve(ADAPTATION_DIR, "coaching");
export const COACHING_DELIVERED_DIR = resolve(ADAPTATION_DIR, "coaching/delivered");
export const COACHING_EXPIRED_DIR = resolve(ADAPTATION_DIR, "coaching/expired");
export const LOCKS_DIR = resolve(ADAPTATION_DIR, "locks");
export const METRICS_DIR = resolve(ADAPTATION_DIR, "metrics");

// File paths
export const STATE_FILE = resolve(ADAPTATION_DIR, "state.json");
export const METRICS_FILE = resolve(ADAPTATION_DIR, "metrics.json");
export const ACTIVE_PATTERNS_FILE = resolve(PATTERNS_DIR, "active.json");
export const PENDING_COACHING_FILE = resolve(COACHING_DIR, "pending.json");

/**
 * Ensure the adaptation directory structure exists.
 */
export function ensureAdaptationDirs(): void {
  const dirs = [
    ADAPTATION_DIR,
    OBSERVATIONS_PENDING_DIR,
    OBSERVATIONS_PROCESSED_DIR,
    PATTERNS_DIR,
    PATTERNS_ARCHIVE_DIR,
    COACHING_DIR,
    COACHING_DELIVERED_DIR,
    COACHING_EXPIRED_DIR,
    LOCKS_DIR,
    METRICS_DIR,
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Read a JSON file.
 */
async function readJson<T>(path: string): Promise<T | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const text = await file.text();
    return JSON.parse(text) as T;
  } catch (error) {
    console.error(`[adaptation-storage] Failed to read ${path}:`, error);
    return null;
  }
}

/**
 * Write a JSON file.
 */
async function writeJson<T>(path: string, data: T): Promise<boolean> {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await Bun.write(path, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`[adaptation-storage] Failed to write ${path}:`, error);
    return false;
  }
}

// --- State ---

/**
 * Load the adaptation state.
 */
export async function loadState(): Promise<AdaptationState> {
  const state = await readJson<AdaptationState>(STATE_FILE);
  return (
    state ?? {
      lastObserveRun: null,
      lastReflectRun: null,
      lastCoachRun: null,
      processedMessageIds: [],
      runCount: 0,
    }
  );
}

/**
 * Save the adaptation state.
 */
export async function saveState(state: AdaptationState): Promise<boolean> {
  return writeJson(STATE_FILE, state);
}

/**
 * Update the adaptation state with partial data.
 */
export async function updateState(updates: Partial<AdaptationState>): Promise<boolean> {
  const current = await loadState();
  return saveState({ ...current, ...updates });
}

// --- Patterns ---

/**
 * Load active patterns.
 */
export async function loadActivePatterns(): Promise<AdaptationPattern[]> {
  const patterns = await readJson<AdaptationPattern[]>(ACTIVE_PATTERNS_FILE);
  return patterns ?? [];
}

/**
 * Save active patterns.
 */
export async function saveActivePatterns(patterns: AdaptationPattern[]): Promise<boolean> {
  return writeJson(ACTIVE_PATTERNS_FILE, patterns);
}

/**
 * Archive stale patterns.
 */
export async function archivePatterns(patterns: AdaptationPattern[]): Promise<boolean> {
  if (patterns.length === 0) return true;

  const date = new Date();
  const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const archivePath = resolve(PATTERNS_ARCHIVE_DIR, `${monthStr}.json`);

  // Load existing archive for this month
  const existing = (await readJson<AdaptationPattern[]>(archivePath)) ?? [];
  const merged = [...existing, ...patterns];

  return writeJson(archivePath, merged);
}

// --- Observations ---

/**
 * Get the path for a new observation batch file.
 */
export function getObservationBatchPath(): string {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  return resolve(OBSERVATIONS_PENDING_DIR, `${timestamp}.json`);
}

/**
 * Save a batch of observations.
 */
export async function saveObservations(observations: Observation[]): Promise<boolean> {
  if (observations.length === 0) return true;
  return writeJson(getObservationBatchPath(), observations);
}

/**
 * Load all pending observations.
 */
export async function loadPendingObservations(): Promise<Observation[]> {
  ensureAdaptationDirs();

  const files = readdirSync(OBSERVATIONS_PENDING_DIR).filter((f) => f.endsWith(".json"));
  const observations: Observation[] = [];

  for (const file of files) {
    const batch = await readJson<Observation[]>(resolve(OBSERVATIONS_PENDING_DIR, file));
    if (batch) {
      observations.push(...batch);
    }
  }

  return observations;
}

/**
 * Move processed observations to the processed directory.
 */
export async function archiveProcessedObservations(): Promise<boolean> {
  ensureAdaptationDirs();

  const files = readdirSync(OBSERVATIONS_PENDING_DIR).filter((f) => f.endsWith(".json"));

  if (files.length === 0) return true;

  const date = new Date();
  const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const processedMonthDir = resolve(OBSERVATIONS_PROCESSED_DIR, monthStr);

  if (!existsSync(processedMonthDir)) {
    mkdirSync(processedMonthDir, { recursive: true });
  }

  for (const file of files) {
    const src = resolve(OBSERVATIONS_PENDING_DIR, file);
    const dst = resolve(processedMonthDir, file);
    try {
      renameSync(src, dst);
    } catch (error) {
      console.error(`[adaptation-storage] Failed to archive observation ${file}:`, error);
      return false;
    }
  }

  return true;
}

// --- Coaching ---

/**
 * Load pending coaching suggestions.
 */
export async function loadPendingSuggestions(): Promise<CoachingSuggestion[]> {
  const suggestions = await readJson<CoachingSuggestion[]>(PENDING_COACHING_FILE);
  return suggestions ?? [];
}

/**
 * Save pending coaching suggestions.
 */
export async function savePendingSuggestions(suggestions: CoachingSuggestion[]): Promise<boolean> {
  return writeJson(PENDING_COACHING_FILE, suggestions);
}

/**
 * Move a delivered suggestion to the delivered directory.
 */
export async function moveToDelivered(suggestion: CoachingSuggestion): Promise<boolean> {
  ensureAdaptationDirs();

  const date = new Date();
  const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const dayStr = String(date.getDate()).padStart(2, "0");
  const deliveredMonthDir = resolve(COACHING_DELIVERED_DIR, monthStr);

  if (!existsSync(deliveredMonthDir)) {
    mkdirSync(deliveredMonthDir, { recursive: true });
  }

  const deliveredPath = resolve(deliveredMonthDir, `${dayStr}.json`);
  const existing = (await readJson<CoachingSuggestion[]>(deliveredPath)) ?? [];
  existing.push(suggestion);

  return writeJson(deliveredPath, existing);
}

/**
 * Load recently delivered suggestions within the specified window.
 */
export async function loadRecentlyDelivered(daysBack: number): Promise<CoachingSuggestion[]> {
  ensureAdaptationDirs();

  const suggestions: CoachingSuggestion[] = [];
  const now = new Date();

  // Check files for the last N days
  for (let i = 0; i < daysBack; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);

    const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const dayStr = String(date.getDate()).padStart(2, "0");
    const filePath = resolve(COACHING_DELIVERED_DIR, monthStr, `${dayStr}.json`);

    const batch = await readJson<CoachingSuggestion[]>(filePath);
    if (batch) {
      suggestions.push(...batch);
    }
  }

  return suggestions;
}

/**
 * Move expired suggestions to the expired directory.
 */
export async function moveToExpired(suggestions: CoachingSuggestion[]): Promise<boolean> {
  if (suggestions.length === 0) return true;

  ensureAdaptationDirs();

  const date = new Date();
  const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const expiredPath = resolve(COACHING_EXPIRED_DIR, `${monthStr}.json`);

  const existing = (await readJson<CoachingSuggestion[]>(expiredPath)) ?? [];
  const merged = [...existing, ...suggestions];

  return writeJson(expiredPath, merged);
}

// --- Metrics ---

/**
 * Load adaptation metrics.
 */
export async function loadMetrics(): Promise<AdaptationMetrics | null> {
  return readJson<AdaptationMetrics>(METRICS_FILE);
}

/**
 * Save adaptation metrics.
 */
export async function saveMetrics(metrics: AdaptationMetrics): Promise<boolean> {
  return writeJson(METRICS_FILE, metrics);
}

/**
 * Update a specific section of the metrics.
 */
export async function updateMetrics<K extends keyof AdaptationMetrics>(
  section: K,
  data: Partial<AdaptationMetrics[K]>,
): Promise<boolean> {
  const current = await loadMetrics();
  const updated: AdaptationMetrics = {
    observe: {
      lastRun: "",
      lastDuration: 0,
      threadsScanned: 0,
      observationsCreated: 0,
      byType: {} as any,
      ...current?.observe,
    },
    reflect: {
      lastRun: "",
      lastDuration: 0,
      observationsProcessed: 0,
      patternsCreated: 0,
      patternsReinforced: 0,
      patternsStaled: 0,
      patternsActive: 0,
      ...current?.reflect,
    },
    coach: {
      lastRun: "",
      lastDuration: 0,
      suggestionsGenerated: 0,
      suggestionsExpired: 0,
      pendingCount: 0,
      ...current?.coach,
    },
    delivery: {
      totalDelivered: 0,
      accepted: 0,
      dismissed: 0,
      noResponse: 0,
      acceptanceRate: 0,
      ...current?.delivery,
    },
  };

  (updated[section] as any) = { ...updated[section], ...data };

  return saveMetrics(updated);
}

// --- Utilities ---

/**
 * Generate a unique ID.
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate days since a date string.
 */
export function daysSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
