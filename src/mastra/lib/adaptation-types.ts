// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Adaptation System Types
 *
 * Types for the Observe → Reflect → Coach adaptation pipeline.
 * Observations are extracted from conversations, synthesized into patterns,
 * which are then used to generate coaching suggestions.
 */

// --- Observations (from Observe workflow) ---

export type ObservationType =
  | "user_frustration" // explicit frustration
  | "user_correction" // user corrected agent
  | "repeated_request" // same request multiple ways
  | "positive_feedback" // explicit satisfaction
  | "workflow_friction" // inefficiency detected
  | "skill_gap" // user struggled
  | "preference_signal" // implicit preference
  | "coaching_opportunity"; // teachable moment

export interface Observation {
  id: string;
  threadId: string;
  messageId: string;
  timestamp: string;
  type: ObservationType;
  content: string; // what was observed
  context: string; // 2-3 messages before/after
  confidence: number; // 0.9 explicit, 0.6 inferred
  linkedPatternId?: string; // Set after reflect links it to a pattern
}

// --- Patterns (from Reflect workflow) ---

export type PatternType = "attention_signal" | "decision_marker" | "noise_pattern" | "heuristic" | "preference";

export type PatternState = "active" | "validated" | "stale";

export interface AdaptationPattern {
  id: string;
  type: PatternType;
  pattern: string; // the pattern description
  guidance: string; // what the agent should do

  // Lifecycle
  state: PatternState;
  createdAt: string;
  lastReinforcedAt: string;
  runsWithoutReinforcement: number;

  // Evidence
  confidence: number;
  occurrences: number;
  sourceObservations: string[]; // observation IDs

  // Coaching potential
  coachingPriority?: "high" | "medium" | "low";
  coachingApproach?: string;
}

// --- Coaching (from Coach workflow) ---

export type CoachingType = "proactive_insight" | "skill_building" | "process_optimization" | "reflection_prompt";

export type CoachingPriority = "high" | "medium" | "low";

export type CoachingSuggestionState = "pending" | "delivered" | "accepted" | "dismissed" | "expired";

export interface CoachingTrigger {
  keywords: string[];
  contexts?: string[];
  excludeKeywords?: string[];
}

export interface CoachingSuggestion {
  id: string;
  createdAt: string;
  expiresAt: string;
  type: CoachingType;
  priority: CoachingPriority;
  trigger: CoachingTrigger;
  suggestion: string;
  sourcePatterns: string[]; // pattern IDs
  state: CoachingSuggestionState;
  deliveredAt?: string;
}

// --- State ---

export interface AdaptationState {
  lastObserveRun: string | null;
  lastReflectRun: string | null;
  lastCoachRun: string | null;
  processedMessageIds: string[];
  runCount: number;
}

// --- Metrics ---

export interface ObserveMetrics {
  lastRun: string;
  lastDuration: number;
  threadsScanned: number;
  observationsCreated: number;
  byType: Record<ObservationType, number>;
}

export interface ReflectMetrics {
  lastRun: string;
  lastDuration: number;
  observationsProcessed: number;
  patternsCreated: number;
  patternsReinforced: number;
  patternsStaled: number;
  patternsActive: number;
}

export interface CoachMetrics {
  lastRun: string;
  lastDuration: number;
  suggestionsGenerated: number;
  suggestionsExpired: number;
  pendingCount: number;
}

export interface DeliveryMetrics {
  totalDelivered: number;
  accepted: number;
  dismissed: number;
  noResponse: number;
  acceptanceRate: number;
}

export interface AdaptationMetrics {
  observe: ObserveMetrics;
  reflect: ReflectMetrics;
  coach: CoachMetrics;
  delivery: DeliveryMetrics;
}

// --- Configuration ---

export interface AdaptationConfig {
  enabled: boolean;
  maxMessagesPerRun: number;
  maxInstructionPatterns: number;
  observerBatchSize: number;
  coachingEnabled: boolean;
  coachingMaxPending: number;
  coachingDedupWindowDays: number;
}

// --- Constants ---

export const COACHING_EXPIRATION_DAYS: Record<CoachingPriority, number> = {
  high: 3,
  medium: 7,
  low: 14,
};

export const COACHING_DEDUP_WINDOW_DAYS = 7;
export const PATTERN_STALE_THRESHOLD_RUNS = 3;
export const PATTERN_VALIDATE_THRESHOLD_OCCURRENCES = 3;
export const PATTERN_ARCHIVE_THRESHOLD_DAYS = 30;
export const JACCARD_SIMILARITY_THRESHOLD = 0.7;
export const MAX_LOCK_AGE_MS = 600000; // 10 minutes
