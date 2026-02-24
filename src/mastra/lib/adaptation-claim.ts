// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Adaptation Claim Mechanism
 *
 * Provides atomic claim operations for coaching suggestions.
 * Prevents race conditions when multiple requests try to claim
 * the same coaching suggestion simultaneously.
 */

import { acquireLock, releaseLock } from "./adaptation-lock";
import { loadPendingSuggestions, moveToDelivered, savePendingSuggestions } from "./adaptation-storage";
import type { CoachingSuggestion, CoachingTrigger } from "./adaptation-types";

/**
 * Score how well a trigger matches a user message.
 * Returns positive score for good matches, negative for exclusions.
 */
function scoreTriggerMatch(trigger: CoachingTrigger, message: string): number {
  const msg = message.toLowerCase();
  let score = 0;

  // Keyword matching (+1 per match)
  for (const kw of trigger.keywords) {
    if (msg.includes(kw.toLowerCase())) {
      score += 1;
    }
  }

  // Context boost (+0.5 if any context matches)
  if (trigger.contexts?.some((ctx) => msg.includes(ctx.toLowerCase()))) {
    score += 0.5;
  }

  // Exclude penalty (-2 per exclude match, can go negative)
  for (const ex of trigger.excludeKeywords || []) {
    if (msg.includes(ex.toLowerCase())) {
      score -= 2;
    }
  }

  return score;
}

/**
 * Atomically claim a matching coaching suggestion.
 *
 * Uses file locking to prevent race conditions. Only one request
 * can claim a suggestion at a time. Finds the best-matching pending
 * suggestion, marks it as delivered, and returns it.
 *
 * @param userMessage - The user's message to match against triggers
 * @returns The claimed suggestion, or null if no match found
 */
export async function claimMatchingSuggestion(userMessage: string): Promise<CoachingSuggestion | null> {
  // Skip if message is too short to be meaningful
  if (!userMessage || userMessage.trim().length < 5) {
    return null;
  }

  // Try to acquire lock with short timeout
  const acquired = await acquireLock("coaching-claim", 5000);
  if (!acquired) {
    console.log("[adaptation-claim] Could not acquire claim lock, skipping");
    return null;
  }

  try {
    const pending = await loadPendingSuggestions();

    // Find pending suggestions with positive match scores
    const scored = pending
      .filter((s) => s.state === "pending")
      .map((s) => ({
        suggestion: s,
        score: scoreTriggerMatch(s.trigger, userMessage),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => {
        // Sort by score descending, then priority
        if (b.score !== a.score) return b.score - a.score;
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.suggestion.priority] - priorityOrder[a.suggestion.priority];
      });

    if (scored.length === 0) {
      return null;
    }

    // Claim the best match
    const best = scored[0].suggestion;
    best.state = "delivered";
    best.deliveredAt = new Date().toISOString();

    // Update pending list and move to delivered
    await savePendingSuggestions(pending);
    await moveToDelivered(best);

    console.log(`[adaptation-claim] Claimed suggestion ${best.id} (score: ${scored[0].score}, type: ${best.type})`);

    return best;
  } catch (error) {
    console.error("[adaptation-claim] Error claiming suggestion:", error);
    return null;
  } finally {
    await releaseLock("coaching-claim");
  }
}

/**
 * Check if there's a potentially matching suggestion without claiming it.
 * Useful for deciding whether to show a coaching indicator.
 */
export async function hasMatchingSuggestion(userMessage: string): Promise<boolean> {
  if (!userMessage || userMessage.trim().length < 5) {
    return false;
  }

  try {
    const pending = await loadPendingSuggestions();

    return pending.filter((s) => s.state === "pending").some((s) => scoreTriggerMatch(s.trigger, userMessage) > 0);
  } catch {
    return false;
  }
}
