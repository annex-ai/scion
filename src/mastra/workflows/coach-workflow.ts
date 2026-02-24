// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Coach Workflow
 *
 * Third stage of the Observe → Reflect → Coach adaptation pipeline.
 * Generates coaching suggestions based on validated patterns.
 *
 * Pipeline:
 *   acquireLock → loadPatterns → checkExisting → generateSuggestions →
 *   writeSuggestions → expireOld → updateMetrics → releaseLock
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { type CoachingOutput, coachingOutputSchema } from "../agents/coach";
import { acquireLock, releaseLock } from "../lib/adaptation-lock";
import {
  ensureAdaptationDirs,
  generateId,
  loadActivePatterns,
  loadPendingSuggestions,
  loadRecentlyDelivered,
  loadState,
  moveToExpired,
  savePendingSuggestions,
  updateMetrics,
  updateState,
} from "../lib/adaptation-storage";
import type { AdaptationPattern, CoachingPriority, CoachingSuggestion, CoachingType } from "../lib/adaptation-types";
import { COACHING_DEDUP_WINDOW_DAYS, COACHING_EXPIRATION_DAYS } from "../lib/adaptation-types";
import { getAdaptationConfig } from "../lib/config";

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

const loadPatternsOutputSchema = z.object({
  resourceId: z.string(),
  candidates: z.array(z.any()),
  pendingSuggestions: z.array(z.any()),
  recentlyDelivered: z.array(z.any()),
});

const filteredOutputSchema = z.object({
  resourceId: z.string(),
  candidates: z.array(z.any()),
  pendingSuggestions: z.array(z.any()),
  slotsAvailable: z.number(),
});

const generateOutputSchema = z.object({
  resourceId: z.string(),
  newSuggestions: z.array(z.any()),
  pendingSuggestions: z.array(z.any()),
  suggestionsGenerated: z.number(),
});

const writeOutputSchema = z.object({
  resourceId: z.string(),
  pendingCount: z.number(),
  suggestionsGenerated: z.number(),
  suggestionsExpired: z.number(),
});

const workflowOutputSchema = z.object({
  suggestionsGenerated: z.number(),
  suggestionsExpired: z.number(),
  pendingCount: z.number(),
  summary: z.string(),
});

// ============================================================================
// Step 1: Acquire Lock
// ============================================================================

const acquireLockStep = createStep({
  id: "acquire-lock",
  description: "Acquire the coach workflow lock to prevent concurrent runs",
  inputSchema: workflowInputSchema,
  outputSchema: lockStepOutputSchema,

  execute: async ({ inputData }) => {
    ensureAdaptationDirs();
    const acquired = await acquireLock("coach");
    if (!acquired) {
      console.log("[Coach Workflow] Could not acquire lock, another instance is running");
    }
    return { acquired, resourceId: inputData.resourceId };
  },
});

// ============================================================================
// Step 2: Load Patterns and Existing Suggestions
// ============================================================================

const loadPatternsStep = createStep({
  id: "load-patterns",
  description: "Load patterns with coaching potential and existing suggestions",
  inputSchema: lockStepOutputSchema,
  outputSchema: loadPatternsOutputSchema,

  execute: async ({ inputData }) => {
    if (!inputData.acquired) {
      return {
        resourceId: inputData.resourceId,
        candidates: [],
        pendingSuggestions: [],
        recentlyDelivered: [],
      };
    }

    const [patterns, pendingSuggestions, recentlyDelivered] = await Promise.all([
      loadActivePatterns(),
      loadPendingSuggestions(),
      loadRecentlyDelivered(COACHING_DEDUP_WINDOW_DAYS),
    ]);

    // Filter for high-confidence patterns that are validated
    // and have coaching potential
    const candidates = patterns.filter(
      (p) =>
        p.confidence >= 0.7 && (p.state === "validated" || p.state === "active") && p.coachingPriority !== undefined,
    );

    console.log(`[Coach Workflow] Found ${candidates.length} coaching candidates from ${patterns.length} patterns`);

    return {
      resourceId: inputData.resourceId,
      candidates,
      pendingSuggestions,
      recentlyDelivered,
    };
  },
});

// ============================================================================
// Step 3: Check Existing and Filter
// ============================================================================

const checkExistingStep = createStep({
  id: "check-existing",
  description: "Skip patterns with pending or recently delivered suggestions",
  inputSchema: loadPatternsOutputSchema,
  outputSchema: filteredOutputSchema,

  execute: async ({ inputData }) => {
    const { candidates, pendingSuggestions, recentlyDelivered } = inputData;
    const config = await getAdaptationConfig();

    // Get pattern IDs that already have suggestions
    const existingPatternIds = new Set<string>();

    for (const suggestion of pendingSuggestions as CoachingSuggestion[]) {
      for (const patternId of suggestion.sourcePatterns) {
        existingPatternIds.add(patternId);
      }
    }

    for (const suggestion of recentlyDelivered as CoachingSuggestion[]) {
      for (const patternId of suggestion.sourcePatterns) {
        existingPatternIds.add(patternId);
      }
    }

    // Filter out patterns that already have suggestions
    const filtered = (candidates as AdaptationPattern[]).filter((p) => !existingPatternIds.has(p.id));

    // Calculate available slots
    const pendingCount = (pendingSuggestions as CoachingSuggestion[]).filter((s) => s.state === "pending").length;
    const slotsAvailable = Math.max(0, config.coaching_max_pending - pendingCount);

    console.log(`[Coach Workflow] ${filtered.length} patterns eligible, ${slotsAvailable} slots available`);

    return {
      resourceId: inputData.resourceId,
      candidates: filtered.slice(0, slotsAvailable), // Limit to available slots
      pendingSuggestions: pendingSuggestions as CoachingSuggestion[],
      slotsAvailable,
    };
  },
});

// ============================================================================
// Step 4: Generate Suggestions
// ============================================================================

const generateSuggestionsStep = createStep({
  id: "generate-suggestions",
  description: "Call coach agent to generate suggestions for each candidate",
  inputSchema: filteredOutputSchema,
  outputSchema: generateOutputSchema,

  execute: async ({ inputData, mastra }) => {
    const { candidates, pendingSuggestions, slotsAvailable } = inputData;

    if (candidates.length === 0 || slotsAvailable === 0) {
      console.log("[Coach Workflow] No candidates or no available slots");
      return {
        resourceId: inputData.resourceId,
        newSuggestions: [],
        pendingSuggestions,
        suggestionsGenerated: 0,
      };
    }

    const coach = mastra?.getAgentById("coach-agent");
    if (!coach) {
      console.error("[Coach Workflow] Coach agent not found");
      return {
        resourceId: inputData.resourceId,
        newSuggestions: [],
        pendingSuggestions,
        suggestionsGenerated: 0,
      };
    }

    const newSuggestions: CoachingSuggestion[] = [];

    for (const pattern of candidates as AdaptationPattern[]) {
      try {
        const prompt = formatCoachingPrompt(pattern);
        const response = await coach.generate(prompt, {
          structuredOutput: { schema: coachingOutputSchema },
          modelSettings: { temperature: 0.3 },
        });

        const output = response.object as CoachingOutput;

        if (output?.suggestion) {
          const suggestion = createSuggestionFromOutput(output, pattern);
          newSuggestions.push(suggestion);
        }
      } catch (error) {
        console.error(`[Coach Workflow] Failed to generate suggestion for pattern ${pattern.id}:`, error);
      }
    }

    console.log(`[Coach Workflow] Generated ${newSuggestions.length} new suggestions`);

    return {
      resourceId: inputData.resourceId,
      newSuggestions,
      pendingSuggestions,
      suggestionsGenerated: newSuggestions.length,
    };
  },
});

// ============================================================================
// Step 5: Write Suggestions
// ============================================================================

const writeSuggestionsStep = createStep({
  id: "write-suggestions",
  description: "Append new suggestions to pending.json",
  inputSchema: generateOutputSchema,
  outputSchema: writeOutputSchema,

  execute: async ({ inputData }) => {
    const { newSuggestions, pendingSuggestions, suggestionsGenerated } = inputData;

    // Combine existing and new suggestions
    const allPending = [...(pendingSuggestions as CoachingSuggestion[]), ...(newSuggestions as CoachingSuggestion[])];

    await savePendingSuggestions(allPending);

    return {
      resourceId: inputData.resourceId,
      pendingCount: allPending.filter((s) => s.state === "pending").length,
      suggestionsGenerated,
      suggestionsExpired: 0,
    };
  },
});

// ============================================================================
// Step 6: Expire Old Suggestions
// ============================================================================

const expireOldStep = createStep({
  id: "expire-old",
  description: "Move expired suggestions from pending to expired",
  inputSchema: writeOutputSchema,
  outputSchema: writeOutputSchema,

  execute: async ({ inputData }) => {
    const pending = await loadPendingSuggestions();
    const now = new Date();

    const expired: CoachingSuggestion[] = [];
    const stillPending: CoachingSuggestion[] = [];

    for (const suggestion of pending) {
      const expiresAt = new Date(suggestion.expiresAt);
      if (expiresAt < now && suggestion.state === "pending") {
        suggestion.state = "expired";
        expired.push(suggestion);
      } else {
        stillPending.push(suggestion);
      }
    }

    if (expired.length > 0) {
      await moveToExpired(expired);
      await savePendingSuggestions(stillPending);
      console.log(`[Coach Workflow] Expired ${expired.length} old suggestions`);
    }

    return {
      ...inputData,
      pendingCount: stillPending.filter((s) => s.state === "pending").length,
      suggestionsExpired: expired.length,
    };
  },
});

// ============================================================================
// Step 7: Update State & Metrics
// ============================================================================

const updateStateStep = createStep({
  id: "update-state",
  description: "Update state and metrics",
  inputSchema: writeOutputSchema,
  outputSchema: workflowOutputSchema,

  execute: async ({ inputData }) => {
    const startTime = Date.now();

    // Update state
    const state = await loadState();
    await updateState({
      lastCoachRun: new Date().toISOString(),
      runCount: state.runCount + 1,
    });

    // Update metrics
    await updateMetrics("coach", {
      lastRun: new Date().toISOString(),
      lastDuration: Date.now() - startTime,
      suggestionsGenerated: inputData.suggestionsGenerated,
      suggestionsExpired: inputData.suggestionsExpired,
      pendingCount: inputData.pendingCount,
    });

    const summary = `Generated ${inputData.suggestionsGenerated} suggestions, expired ${inputData.suggestionsExpired}. ${inputData.pendingCount} pending.`;
    console.log(`[Coach Workflow] ${summary}`);

    return {
      suggestionsGenerated: inputData.suggestionsGenerated,
      suggestionsExpired: inputData.suggestionsExpired,
      pendingCount: inputData.pendingCount,
      summary,
    };
  },
});

// ============================================================================
// Step 8: Release Lock
// ============================================================================

const releaseLockStep = createStep({
  id: "release-lock",
  description: "Release the coach workflow lock",
  inputSchema: workflowOutputSchema,
  outputSchema: workflowOutputSchema,

  execute: async ({ inputData }) => {
    await releaseLock("coach");
    return inputData;
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function formatCoachingPrompt(pattern: AdaptationPattern): string {
  return `Generate a coaching suggestion for this pattern:

Pattern: "${pattern.pattern}"
Type: ${pattern.type}
Guidance: ${pattern.guidance}
Confidence: ${pattern.confidence.toFixed(2)}
Occurrences: ${pattern.occurrences}
Priority: ${pattern.coachingPriority || "medium"}
${pattern.coachingApproach ? `Approach hint: ${pattern.coachingApproach}` : ""}

Create a non-intrusive, actionable coaching suggestion that can be naturally incorporated into conversation when the right context arises.`;
}

function createSuggestionFromOutput(output: CoachingOutput, pattern: AdaptationPattern): CoachingSuggestion {
  const now = new Date();
  const priority = output.suggestion.priority as CoachingPriority;
  const expirationDays = COACHING_EXPIRATION_DAYS[priority];
  const expiresAt = new Date(now.getTime() + expirationDays * 24 * 60 * 60 * 1000);

  return {
    id: generateId(),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    type: output.suggestion.type as CoachingType,
    priority,
    trigger: {
      keywords: output.suggestion.triggerKeywords,
      contexts: output.suggestion.triggerContexts,
      excludeKeywords: output.suggestion.excludeKeywords,
    },
    suggestion: output.suggestion.suggestion,
    sourcePatterns: [pattern.id],
    state: "pending",
  };
}

// ============================================================================
// Workflow Composition
// ============================================================================

export const coachWorkflow = createWorkflow({
  id: "coach-workflow",
  description: "Coach stage: generate coaching suggestions from patterns",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(acquireLockStep)
  .then(loadPatternsStep)
  .then(checkExistingStep)
  .then(generateSuggestionsStep)
  .then(writeSuggestionsStep)
  .then(expireOldStep)
  .then(updateStateStep)
  .then(releaseLockStep)
  .commit();
