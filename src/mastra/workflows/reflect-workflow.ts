// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Reflect Workflow
 *
 * Second stage of the Observe → Reflect → Coach adaptation pipeline.
 * Synthesizes observations into patterns, applies the pattern state machine,
 * and archives stale patterns.
 *
 * Pattern State Machine:
 *   active ──(3+ occurrences)──▶ validated
 *     │                              │
 *     │ (3 runs no reinforcement)    │ (3 runs no reinforcement)
 *     ▼                              ▼
 *   stale ◀─────────────────────── stale
 *     │                              │
 *     │ (reinforced again)           │ (30 days stale)
 *     ▼                              ▼
 *   validated                    archived
 *
 * Pipeline:
 *   acquireLock → loadData → synthesize → archiveStale → writePatterns →
 *   archiveObservations → updateMetrics → releaseLock
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { acquireLock, releaseLock } from "../lib/adaptation-lock";
import {
  archivePatterns,
  archiveProcessedObservations,
  daysSince,
  ensureAdaptationDirs,
  generateId,
  loadActivePatterns,
  loadPendingObservations,
  loadState,
  saveActivePatterns,
  updateMetrics,
  updateState,
} from "../lib/adaptation-storage";
import type { AdaptationPattern, Observation, PatternType, SynthesizeReflectorOutput } from "../lib/adaptation-types";
import {
  JACCARD_SIMILARITY_THRESHOLD,
  PATTERN_ARCHIVE_THRESHOLD_DAYS,
  PATTERN_STALE_THRESHOLD_RUNS,
  PATTERN_VALIDATE_THRESHOLD_OCCURRENCES,
  synthesizeReflectorSchema,
} from "../lib/adaptation-types";
import { tokenize } from "../lib/reflection-utils";

// ============================================================================
// Schemas
// ============================================================================

const workflowInputSchema = z.object({
  resourceId: z.string().default("interactive-agent"),
});

const lockStepOutputSchema = z.object({
  acquired: z.boolean(),
  resourceId: z.string(),
});

const loadDataOutputSchema = z.object({
  resourceId: z.string(),
  observations: z.array(z.any()),
  patterns: z.array(z.any()),
});

const synthesizeOutputSchema = z.object({
  resourceId: z.string(),
  patterns: z.array(z.any()),
  patternsCreated: z.number(),
  patternsReinforced: z.number(),
  patternsStaled: z.number(),
  observationsProcessed: z.number(),
});

const archiveOutputSchema = z.object({
  resourceId: z.string(),
  patterns: z.array(z.any()),
  patternsCreated: z.number(),
  patternsReinforced: z.number(),
  patternsStaled: z.number(),
  patternsArchived: z.number(),
  observationsProcessed: z.number(),
});

const workflowOutputSchema = z.object({
  patternsCreated: z.number(),
  patternsReinforced: z.number(),
  patternsStaled: z.number(),
  patternsArchived: z.number(),
  patternsActive: z.number(),
  observationsProcessed: z.number(),
  summary: z.string(),
});

// ============================================================================
// Step 1: Acquire Lock
// ============================================================================

const acquireLockStep = createStep({
  id: "acquire-lock",
  description: "Acquire the reflect workflow lock to prevent concurrent runs",
  inputSchema: workflowInputSchema,
  outputSchema: lockStepOutputSchema,

  execute: async ({ inputData }) => {
    ensureAdaptationDirs();
    const acquired = await acquireLock("reflect");
    if (!acquired) {
      console.log("[Reflect Workflow] Could not acquire lock, another instance is running");
    }
    return { acquired, resourceId: inputData.resourceId };
  },
});

// ============================================================================
// Step 2: Load Data
// ============================================================================

const loadDataStep = createStep({
  id: "load-data",
  description: "Load pending observations and active patterns",
  inputSchema: lockStepOutputSchema,
  outputSchema: loadDataOutputSchema,

  execute: async ({ inputData }) => {
    if (!inputData.acquired) {
      return {
        resourceId: inputData.resourceId,
        observations: [],
        patterns: [],
      };
    }

    const [observations, patterns] = await Promise.all([loadPendingObservations(), loadActivePatterns()]);

    console.log(`[Reflect Workflow] Loaded ${observations.length} observations and ${patterns.length} patterns`);

    return {
      resourceId: inputData.resourceId,
      observations,
      patterns,
    };
  },
});

// ============================================================================
// LLM Synthesis Helpers
// ============================================================================

const MAX_PROMPT_OBSERVATIONS = 25;
const MAX_PROMPT_PATTERNS = 40;

/**
 * Build a prompt for the reflector agent with observations and existing patterns.
 * Excludes stale patterns to reduce noise.
 */
function buildSynthesizePrompt(observations: Observation[], patterns: AdaptationPattern[]): string {
  const sections: string[] = [];

  // Filter out stale patterns and cap
  const activePatterns = patterns.filter((p) => p.state !== "stale").slice(0, MAX_PROMPT_PATTERNS);

  if (activePatterns.length > 0) {
    const patternLines = activePatterns.map(
      (p) =>
        `- ID: ${p.id} | State: ${p.state} | Type: ${p.type} | Confidence: ${p.confidence.toFixed(2)} | Occurrences: ${p.occurrences}\n  Pattern: ${p.pattern}\n  Guidance: ${p.guidance}`,
    );
    sections.push(`## Existing Patterns (${activePatterns.length})\n\n${patternLines.join("\n\n")}`);
  }

  const cappedObs = observations.slice(0, MAX_PROMPT_OBSERVATIONS);
  const obsLines = cappedObs.map(
    (o) =>
      `- ID: ${o.id} | Type: ${o.type} | Confidence: ${o.confidence.toFixed(2)}\n  Content: ${o.content}\n  Context: ${o.context}`,
  );
  sections.push(`## New Observations (${cappedObs.length})\n\n${obsLines.join("\n\n")}`);

  return `Analyze the following observations and existing patterns. Match observations to patterns (reinforcements), create new patterns from unmatched observations, and flag contradictions.\n\n${sections.join("\n\n")}`;
}

/**
 * Process reflector agent output into pattern mutations.
 * Silently skips hallucinated IDs.
 */
function processReflectorOutput(
  output: SynthesizeReflectorOutput,
  observations: Observation[],
  patterns: AdaptationPattern[],
): {
  patternsCreated: number;
  patternsReinforced: number;
  newPatterns: AdaptationPattern[];
  reinforcedPatternIds: Set<string>;
} {
  const obsMap = new Map(observations.map((o) => [o.id, o]));
  const patMap = new Map(patterns.map((p) => [p.id, p]));
  const reinforcedPatternIds = new Set<string>();
  let patternsReinforced = 0;

  // Process reinforcements
  for (const r of output.reinforcements) {
    const obs = obsMap.get(r.observationId);
    const pat = patMap.get(r.patternId);
    if (!obs || !pat) continue;

    reinforcePattern(pat, obs);
    reinforcedPatternIds.add(pat.id);
    obs.linkedPatternId = pat.id;
    patternsReinforced++;
  }

  // Process contradictions
  for (const c of output.contradictions) {
    const pat = patMap.get(c.patternId);
    const obs = obsMap.get(c.observationId);
    if (!pat || !obs) continue;

    pat.confidence = Math.max(0, pat.confidence - 0.1);
    console.log(
      `[Reflect Workflow] Contradiction: pattern ${pat.id} (confidence now ${pat.confidence.toFixed(2)}): ${c.explanation}`,
    );
  }

  // Process new patterns
  const now = new Date().toISOString();
  const newPatterns: AdaptationPattern[] = [];

  for (const np of output.newPatterns) {
    // Resolve source observations, skip if none are valid
    const validSourceIds = np.sourceObservationIds.filter((id) => obsMap.has(id));
    if (validSourceIds.length === 0) continue;

    const newPattern: AdaptationPattern = {
      id: generateId(),
      type: np.type,
      pattern: np.pattern,
      guidance: np.guidance,
      state: "active",
      createdAt: now,
      lastReinforcedAt: now,
      runsWithoutReinforcement: 0,
      confidence: np.confidence,
      occurrences: 1,
      sourceObservations: validSourceIds,
      coachingPriority: np.coachingPriority,
    };

    // Link observations to this pattern
    for (const id of validSourceIds) {
      const obs = obsMap.get(id);
      if (obs) obs.linkedPatternId = newPattern.id;
    }

    newPatterns.push(newPattern);
  }

  return {
    patternsCreated: newPatterns.length,
    patternsReinforced,
    newPatterns,
    reinforcedPatternIds,
  };
}

// ============================================================================
// Step 3: Synthesize Patterns
// ============================================================================

const synthesizeStep = createStep({
  id: "synthesize",
  description: "Match observations to patterns, create new patterns, apply state machine",
  inputSchema: loadDataOutputSchema,
  outputSchema: synthesizeOutputSchema,

  execute: async ({ inputData, mastra }) => {
    const observations = inputData.observations as Observation[];
    const patterns = inputData.patterns as AdaptationPattern[];

    if (observations.length === 0) {
      console.log("[Reflect Workflow] No observations to process");
      const { staled, updated } = applyStaleTransitions(patterns);
      return {
        resourceId: inputData.resourceId,
        patterns: updated,
        patternsCreated: 0,
        patternsReinforced: 0,
        patternsStaled: staled,
        observationsProcessed: 0,
      };
    }

    let patternsCreated = 0;
    let patternsReinforced = 0;
    let reinforcedPatternIds = new Set<string>();
    let createdPatterns: AdaptationPattern[] = [];
    let synthesisMethod = "heuristic";

    // Try LLM synthesis first (with full fallback to heuristic)
    try {
      const reflector = mastra?.getAgentById("reflector-agent");
      if (reflector) {
        const prompt = buildSynthesizePrompt(observations, patterns);
        const result = await reflector.generate(prompt, {
          structuredOutput: { schema: synthesizeReflectorSchema },
          modelSettings: { temperature: 0 },
        });

        const llmOutput = result.object as SynthesizeReflectorOutput | undefined;
        if (llmOutput) {
          const processed = processReflectorOutput(llmOutput, observations, patterns);
          patternsReinforced = processed.patternsReinforced;
          reinforcedPatternIds = processed.reinforcedPatternIds;

          // Deduplicate LLM-created patterns
          createdPatterns = mergeSimilarPatterns(processed.newPatterns);
          patternsCreated = createdPatterns.length;
          synthesisMethod = "LLM";
        } else {
          console.warn("[Reflect Workflow] Reflector returned no structured output, using heuristic fallback");
        }
      } else {
        console.warn("[Reflect Workflow] Mastra context not available, using heuristic fallback");
      }
    } catch (err) {
      console.warn(`[Reflect Workflow] LLM synthesis failed, using heuristic fallback: ${err}`);
    }

    // Heuristic fallback if LLM path didn't produce results
    if (synthesisMethod === "heuristic") {
      const newPatterns: AdaptationPattern[] = [];

      for (const obs of observations) {
        const matchedPattern = findBestMatchingPattern(obs, patterns);

        if (matchedPattern) {
          reinforcePattern(matchedPattern, obs);
          reinforcedPatternIds.add(matchedPattern.id);
          obs.linkedPatternId = matchedPattern.id;
          patternsReinforced++;
        } else {
          const newPattern = createPatternFromObservation(obs);
          newPatterns.push(newPattern);
          obs.linkedPatternId = newPattern.id;
        }
      }

      createdPatterns = mergeSimilarPatterns(newPatterns);
      patternsCreated = createdPatterns.length;
    }

    // Combine all patterns
    const allPatterns = [...patterns, ...createdPatterns];

    // Always apply stale transitions
    const { staled, updated } = applyStaleTransitions(allPatterns, reinforcedPatternIds);

    console.log(
      `[Reflect Workflow] [${synthesisMethod}] Created ${patternsCreated}, reinforced ${patternsReinforced}, staled ${staled}`,
    );

    return {
      resourceId: inputData.resourceId,
      patterns: updated,
      patternsCreated,
      patternsReinforced,
      patternsStaled: staled,
      observationsProcessed: observations.length,
    };
  },
});

// ============================================================================
// Step 4: Archive Stale Patterns
// ============================================================================

const archiveStaleStep = createStep({
  id: "archive-stale",
  description: "Move patterns that have been stale for 30+ days to archive",
  inputSchema: synthesizeOutputSchema,
  outputSchema: archiveOutputSchema,

  execute: async ({ inputData }) => {
    const patterns = inputData.patterns as AdaptationPattern[];

    // Find patterns to archive (stale for 30+ days)
    const toArchive: AdaptationPattern[] = [];
    const toKeep: AdaptationPattern[] = [];

    for (const pattern of patterns) {
      if (pattern.state === "stale") {
        const daysSinceReinforced = daysSince(pattern.lastReinforcedAt);
        if (daysSinceReinforced >= PATTERN_ARCHIVE_THRESHOLD_DAYS) {
          toArchive.push(pattern);
        } else {
          toKeep.push(pattern);
        }
      } else {
        toKeep.push(pattern);
      }
    }

    if (toArchive.length > 0) {
      await archivePatterns(toArchive);
      console.log(`[Reflect Workflow] Archived ${toArchive.length} stale patterns`);
    }

    return {
      resourceId: inputData.resourceId,
      patterns: toKeep,
      patternsCreated: inputData.patternsCreated,
      patternsReinforced: inputData.patternsReinforced,
      patternsStaled: inputData.patternsStaled,
      patternsArchived: toArchive.length,
      observationsProcessed: inputData.observationsProcessed,
    };
  },
});

// ============================================================================
// Step 5: Write Patterns
// ============================================================================

const writePatternsStep = createStep({
  id: "write-patterns",
  description: "Write updated patterns to active.json",
  inputSchema: archiveOutputSchema,
  outputSchema: archiveOutputSchema,

  execute: async ({ inputData }) => {
    const patterns = inputData.patterns as AdaptationPattern[];
    await saveActivePatterns(patterns);
    console.log(`[Reflect Workflow] Saved ${patterns.length} active patterns`);
    return inputData;
  },
});

// ============================================================================
// Step 6: Archive Observations
// ============================================================================

const archiveObservationsStep = createStep({
  id: "archive-observations",
  description: "Move processed observations from pending to processed",
  inputSchema: archiveOutputSchema,
  outputSchema: archiveOutputSchema,

  execute: async ({ inputData }) => {
    if (inputData.observationsProcessed > 0) {
      await archiveProcessedObservations();
      console.log(`[Reflect Workflow] Archived ${inputData.observationsProcessed} processed observations`);
    }
    return inputData;
  },
});

// ============================================================================
// Step 7: Update State & Metrics
// ============================================================================

const updateStateStep = createStep({
  id: "update-state",
  description: "Update state and metrics",
  inputSchema: archiveOutputSchema,
  outputSchema: workflowOutputSchema,

  execute: async ({ inputData }) => {
    const startTime = Date.now();
    const patterns = inputData.patterns as AdaptationPattern[];

    // Update state
    const state = await loadState();
    await updateState({
      lastReflectRun: new Date().toISOString(),
      runCount: state.runCount + 1,
    });

    // Update metrics
    await updateMetrics("reflect", {
      lastRun: new Date().toISOString(),
      lastDuration: Date.now() - startTime,
      observationsProcessed: inputData.observationsProcessed,
      patternsCreated: inputData.patternsCreated,
      patternsReinforced: inputData.patternsReinforced,
      patternsStaled: inputData.patternsStaled,
      patternsActive: patterns.length,
    });

    const summary = `Processed ${inputData.observationsProcessed} observations: ${inputData.patternsCreated} created, ${inputData.patternsReinforced} reinforced, ${inputData.patternsStaled} staled, ${inputData.patternsArchived} archived. ${patterns.length} patterns active.`;
    console.log(`[Reflect Workflow] ${summary}`);

    return {
      patternsCreated: inputData.patternsCreated,
      patternsReinforced: inputData.patternsReinforced,
      patternsStaled: inputData.patternsStaled,
      patternsArchived: inputData.patternsArchived,
      patternsActive: patterns.length,
      observationsProcessed: inputData.observationsProcessed,
      summary,
    };
  },
});

// ============================================================================
// Step 8: Release Lock
// ============================================================================

const releaseLockStep = createStep({
  id: "release-lock",
  description: "Release the reflect workflow lock",
  inputSchema: workflowOutputSchema,
  outputSchema: workflowOutputSchema,

  execute: async ({ inputData }) => {
    await releaseLock("reflect");
    return inputData;
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate Jaccard similarity between two strings.
 */
function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const aWords = tokenize(a.toLowerCase());
  const bWords = tokenize(b.toLowerCase());

  if (aWords.size === 0 || bWords.size === 0) return 0;

  let intersection = 0;
  for (const word of aWords) {
    if (bWords.has(word)) intersection++;
  }

  const union = new Set([...aWords, ...bWords]).size;
  return intersection / union;
}

/**
 * Find the best matching pattern for an observation.
 * Returns the pattern with highest Jaccard similarity above threshold,
 * or null if no match found.
 */
function findBestMatchingPattern(obs: Observation, patterns: AdaptationPattern[]): AdaptationPattern | null {
  let bestMatch: AdaptationPattern | null = null;
  let bestScore = 0;

  for (const pattern of patterns) {
    const score = jaccardSimilarity(obs.content, pattern.pattern);
    if (score > JACCARD_SIMILARITY_THRESHOLD && score > bestScore) {
      bestScore = score;
      bestMatch = pattern;
    }
  }

  return bestMatch;
}

/**
 * Reinforce an existing pattern with a new observation.
 */
function reinforcePattern(pattern: AdaptationPattern, obs: Observation): void {
  pattern.occurrences += 1;
  pattern.lastReinforcedAt = new Date().toISOString();
  pattern.runsWithoutReinforcement = 0;
  pattern.sourceObservations.push(obs.id);

  // Update confidence
  pattern.confidence = calculateConfidence(pattern);

  // Auto-validate if threshold reached
  if (pattern.state === "active" && pattern.occurrences >= PATTERN_VALIDATE_THRESHOLD_OCCURRENCES) {
    pattern.state = "validated";
  }

  // Stale patterns come back to validated when reinforced
  if (pattern.state === "stale") {
    pattern.state = "validated";
  }
}

/**
 * Create a new pattern from an observation.
 */
function createPatternFromObservation(obs: Observation): AdaptationPattern {
  const now = new Date().toISOString();

  return {
    id: generateId(),
    type: mapObservationTypeToPatternType(obs.type),
    pattern: obs.content,
    guidance: generateGuidanceFromObservation(obs),
    state: "active",
    createdAt: now,
    lastReinforcedAt: now,
    runsWithoutReinforcement: 0,
    confidence: obs.confidence,
    occurrences: 1,
    sourceObservations: [obs.id],
    coachingPriority: determineCoachingPriority(obs),
  };
}

/**
 * Determine coaching priority based on observation type.
 * Higher priority for explicit signals, lower for inferred.
 */
function determineCoachingPriority(obs: Observation): "high" | "medium" | "low" | undefined {
  // Explicit frustration or correction = high priority
  if (obs.type === "user_frustration" || obs.type === "user_correction") {
    return obs.confidence >= 0.8 ? "high" : "medium";
  }

  // Repeated requests or workflow friction = medium priority
  if (obs.type === "repeated_request" || obs.type === "workflow_friction") {
    return "medium";
  }

  // Skill gaps and coaching opportunities = medium/low
  if (obs.type === "skill_gap" || obs.type === "coaching_opportunity") {
    return obs.confidence >= 0.7 ? "medium" : "low";
  }

  // Positive feedback doesn't need coaching
  if (obs.type === "positive_feedback") {
    return undefined; // No coaching needed
  }

  // Preferences = low priority (subtle guidance)
  if (obs.type === "preference_signal") {
    return "low";
  }

  return undefined;
}

/**
 * Map observation type to pattern type.
 */
function mapObservationTypeToPatternType(obsType: string): PatternType {
  switch (obsType) {
    case "user_frustration":
    case "user_correction":
    case "repeated_request":
      return "attention_signal";
    case "positive_feedback":
      return "decision_marker";
    case "workflow_friction":
    case "skill_gap":
      return "heuristic";
    case "preference_signal":
      return "preference";
    case "coaching_opportunity":
      return "heuristic";
    default:
      return "heuristic";
  }
}

/**
 * Generate guidance from an observation.
 */
function generateGuidanceFromObservation(obs: Observation): string {
  switch (obs.type) {
    case "user_frustration":
      return `Address frustration: ${obs.content}`;
    case "user_correction":
      return `Remember correction: ${obs.content}`;
    case "repeated_request":
      return `Pay attention to repeated request: ${obs.content}`;
    case "positive_feedback":
      return `Continue approach: ${obs.content}`;
    case "workflow_friction":
      return `Improve workflow: ${obs.content}`;
    case "skill_gap":
      return `Opportunity to help learn: ${obs.content}`;
    case "preference_signal":
      return `Honor preference: ${obs.content}`;
    case "coaching_opportunity":
      return `Consider coaching: ${obs.content}`;
    default:
      return obs.content;
  }
}

/**
 * Calculate pattern confidence based on occurrences and recency.
 */
function calculateConfidence(pattern: AdaptationPattern): number {
  const baseConfidence = Math.min(0.5, pattern.occurrences * 0.2);
  const reinforcementBonus = Math.min(0.4, pattern.occurrences * 0.1);
  const recencyBonus = daysSince(pattern.lastReinforcedAt) < 7 ? 0.1 : 0;
  return Math.min(1.0, baseConfidence + reinforcementBonus + recencyBonus);
}

/**
 * Merge similar new patterns.
 */
function mergeSimilarPatterns(patterns: AdaptationPattern[]): AdaptationPattern[] {
  const merged: AdaptationPattern[] = [];

  for (const pattern of patterns) {
    let wasMerged = false;

    for (const existing of merged) {
      const similarity = jaccardSimilarity(pattern.pattern, existing.pattern);
      if (similarity > JACCARD_SIMILARITY_THRESHOLD) {
        // Merge into existing
        existing.occurrences += pattern.occurrences;
        existing.confidence = Math.max(existing.confidence, pattern.confidence);
        existing.sourceObservations.push(...pattern.sourceObservations);
        wasMerged = true;
        break;
      }
    }

    if (!wasMerged) {
      merged.push(pattern);
    }
  }

  return merged;
}

/**
 * Apply state transitions for unreinforced patterns.
 * Returns count of patterns that became stale and the updated patterns array.
 */
function applyStaleTransitions(
  patterns: AdaptationPattern[],
  reinforcedPatternIds: Set<string> = new Set(),
): { staled: number; updated: AdaptationPattern[] } {
  let staled = 0;

  for (const pattern of patterns) {
    if (reinforcedPatternIds.has(pattern.id)) {
      continue; // Already processed
    }

    // Increment runsWithoutReinforcement
    pattern.runsWithoutReinforcement += 1;

    // Check for stale transition
    if (
      (pattern.state === "active" || pattern.state === "validated") &&
      pattern.runsWithoutReinforcement >= PATTERN_STALE_THRESHOLD_RUNS
    ) {
      pattern.state = "stale";
      staled++;
    }
  }

  return { staled, updated: patterns };
}

// ============================================================================
// Workflow Composition
// ============================================================================

export const reflectWorkflow = createWorkflow({
  id: "reflect-workflow",
  description: "Reflect stage: synthesize observations into patterns",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(acquireLockStep)
  .then(loadDataStep)
  .then(synthesizeStep)
  .then(archiveStaleStep)
  .then(writePatternsStep)
  .then(archiveObservationsStep)
  .then(updateStateStep)
  .then(releaseLockStep)
  .commit();
