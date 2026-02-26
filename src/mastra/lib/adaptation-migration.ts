// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Migration utilities for converting legacy reflection data to the new adaptation system.
 *
 * Converts REFLECTIONS.md patterns to patterns/active.json format.
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { ensureAdaptationDirs, generateId, saveActivePatterns } from "./adaptation-storage";
import type { AdaptationPattern, PatternType } from "./adaptation-types";
import { AGENT_DIR } from "./config";
import { type AggregatedPattern, parseReflectionsMd } from "./reflection-utils";

const LEGACY_REFLECTIONS_PATH = resolve(AGENT_DIR, "REFLECTIONS.md");

/**
 * Map legacy pattern types to new PatternType.
 */
function mapPatternType(legacyType: AggregatedPattern["type"]): PatternType {
  switch (legacyType) {
    case "attention_signal":
      return "attention_signal";
    case "decision_marker":
      return "decision_marker";
    case "noise_pattern":
      return "noise_pattern";
    default:
      return "heuristic";
  }
}

/**
 * Convert a legacy AggregatedPattern to the new AdaptationPattern format.
 */
function convertPattern(legacy: AggregatedPattern): AdaptationPattern {
  const now = new Date().toISOString();

  return {
    id: generateId(),
    type: mapPatternType(legacy.type),
    pattern: legacy.description,
    guidance: legacy.evidence,
    state: "validated", // Legacy patterns are considered validated
    createdAt: legacy.lastValidated || now,
    lastReinforcedAt: legacy.lastValidated || now,
    runsWithoutReinforcement: 0,
    confidence: legacy.confidence,
    occurrences: legacy.occurrences,
    sourceObservations: [], // No trail from legacy
  };
}

/**
 * Check if migration is needed.
 */
export function needsMigration(): boolean {
  return existsSync(LEGACY_REFLECTIONS_PATH);
}

/**
 * Migrate existing REFLECTIONS.md to the new adaptation system.
 *
 * - Parses REFLECTIONS.md
 * - Converts patterns to new format
 * - Saves to patterns/active.json
 * - Renames REFLECTIONS.md to REFLECTIONS.md.legacy
 */
export async function migrateExistingPatterns(): Promise<{
  migrated: boolean;
  patternsCount: number;
  message: string;
}> {
  if (!needsMigration()) {
    return {
      migrated: false,
      patternsCount: 0,
      message: "No REFLECTIONS.md found, nothing to migrate",
    };
  }

  try {
    // Ensure the adaptation directory structure exists
    ensureAdaptationDirs();

    // Read and parse the legacy file
    const content = readFileSync(LEGACY_REFLECTIONS_PATH, "utf-8");
    const { patterns: legacyPatterns, heuristics } = parseReflectionsMd(content);

    // Convert patterns
    const adaptationPatterns: AdaptationPattern[] = legacyPatterns.map(convertPattern);

    // Also convert heuristics to patterns
    for (const heuristic of heuristics) {
      adaptationPatterns.push({
        id: generateId(),
        type: "heuristic",
        pattern: heuristic.condition,
        guidance: heuristic.action,
        state: "validated",
        createdAt: new Date().toISOString(),
        lastReinforcedAt: new Date().toISOString(),
        runsWithoutReinforcement: 0,
        confidence: heuristic.weight,
        occurrences: 1,
        sourceObservations: [],
      });
    }

    // Save to new location
    await saveActivePatterns(adaptationPatterns);

    // Rename legacy file
    const legacyBackupPath = `${LEGACY_REFLECTIONS_PATH}.legacy`;
    renameSync(LEGACY_REFLECTIONS_PATH, legacyBackupPath);

    const message =
      adaptationPatterns.length > 0
        ? `Migrated ${adaptationPatterns.length} patterns from REFLECTIONS.md`
        : "REFLECTIONS.md was empty, created empty patterns file";

    console.log(`[adaptation-migration] ${message}`);

    return {
      migrated: true,
      patternsCount: adaptationPatterns.length,
      message,
    };
  } catch (error) {
    const message = `Migration failed: ${error}`;
    console.error(`[adaptation-migration] ${message}`);
    return {
      migrated: false,
      patternsCount: 0,
      message,
    };
  }
}

/**
 * Run migration as a standalone script.
 */
export async function runMigration(): Promise<void> {
  console.log("[adaptation-migration] Starting migration...");
  const result = await migrateExistingPatterns();
  console.log(`[adaptation-migration] ${result.message}`);
  if (result.migrated) {
    console.log(`[adaptation-migration] Migration complete: ${result.patternsCount} patterns`);
  }
}
