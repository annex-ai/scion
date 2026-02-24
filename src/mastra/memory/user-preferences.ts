// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * User Preferences Schema
 *
 * Defines the schema for resource-scoped user preferences that persist
 * across all conversations. These preferences are learned and updated
 * over time based on user interactions.
 */

import { z } from "zod";

/**
 * Communication style preferences
 */
export const CommunicationStyleSchema = z.enum([
  "concise", // Brief, to-the-point responses
  "verbose", // Detailed explanations with context
  "documented", // Formal with documentation-style formatting
  "casual", // Relaxed, conversational tone
]);

export type CommunicationStyle = z.infer<typeof CommunicationStyleSchema>;

/**
 * Expertise level for calibrating explanations
 */
export const ExpertiseLevelSchema = z.enum([
  "beginner", // Needs detailed explanations of basics
  "intermediate", // Understands fundamentals, learning advanced
  "expert", // Deep knowledge, prefers concise technical content
]);

export type ExpertiseLevel = z.infer<typeof ExpertiseLevelSchema>;

/**
 * User preferences that persist across conversations
 */
export const UserPreferencesSchema = z.object({
  // Communication preferences
  communicationStyle: CommunicationStyleSchema.optional(),
  preferredLanguage: z.string().optional().describe("Preferred programming language for examples"),
  codeStyle: z.string().optional().describe("Code style preferences (e.g., functional, OOP)"),

  // Calibration
  expertiseLevel: ExpertiseLevelSchema.optional(),
  domainsOfExpertise: z.array(z.string()).optional().describe("Domains where user has expertise"),
  domainsLearning: z.array(z.string()).optional().describe("Domains user is actively learning"),

  // Personalization
  howTheyLikeToBeAddressed: z.string().optional().describe("How user prefers to be addressed"),
  topics: z.array(z.string()).optional().describe("Topics of interest"),
  avoidTopics: z.array(z.string()).optional().describe("Topics to avoid"),

  // Goals and context
  currentProjects: z.array(z.string()).optional().describe("Active projects for context"),
  currentGoals: z.array(z.string()).optional().describe("Current objectives"),

  // Interaction preferences
  preferEmoji: z.boolean().optional().describe("Whether to use emoji in responses"),
  preferCodeComments: z.boolean().optional().describe("Whether to add comments in code examples"),
  maxResponseLength: z.enum(["short", "medium", "long"]).optional(),

  // Custom key-value preferences
  custom: z.record(z.string(), z.string()).optional().describe("Custom user-defined preferences"),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/**
 * Default preferences used when none are set
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  communicationStyle: "concise",
  expertiseLevel: "intermediate",
  preferEmoji: false,
  preferCodeComments: true,
  maxResponseLength: "medium",
};

/**
 * Merge new preferences with existing ones
 */
export function mergePreferences(existing: UserPreferences, updates: Partial<UserPreferences>): UserPreferences {
  return {
    ...existing,
    ...updates,
    // Deep merge arrays instead of replacing
    domainsOfExpertise: mergeArrays(existing.domainsOfExpertise, updates.domainsOfExpertise),
    domainsLearning: mergeArrays(existing.domainsLearning, updates.domainsLearning),
    topics: mergeArrays(existing.topics, updates.topics),
    avoidTopics: mergeArrays(existing.avoidTopics, updates.avoidTopics),
    currentProjects: updates.currentProjects ?? existing.currentProjects,
    currentGoals: updates.currentGoals ?? existing.currentGoals,
    // Deep merge custom object
    custom: { ...existing.custom, ...updates.custom },
  };
}

/**
 * Merge two arrays, removing duplicates
 */
function mergeArrays(existing?: string[], updates?: string[]): string[] | undefined {
  if (!updates) return existing;
  if (!existing) return updates;
  return [...new Set([...existing, ...updates])];
}

/**
 * Format preferences as a context string for the agent
 */
export function formatPreferencesContext(prefs: UserPreferences): string {
  const lines: string[] = ["## User Preferences (Learned)", ""];

  if (prefs.communicationStyle) {
    lines.push(`- **Communication Style**: ${prefs.communicationStyle}`);
  }

  if (prefs.expertiseLevel) {
    lines.push(`- **Expertise Level**: ${prefs.expertiseLevel}`);
  }

  if (prefs.preferredLanguage) {
    lines.push(`- **Preferred Language**: ${prefs.preferredLanguage}`);
  }

  if (prefs.howTheyLikeToBeAddressed) {
    lines.push(`- **Address as**: ${prefs.howTheyLikeToBeAddressed}`);
  }

  if (prefs.domainsOfExpertise?.length) {
    lines.push(`- **Expert in**: ${prefs.domainsOfExpertise.join(", ")}`);
  }

  if (prefs.domainsLearning?.length) {
    lines.push(`- **Learning**: ${prefs.domainsLearning.join(", ")}`);
  }

  if (prefs.currentProjects?.length) {
    lines.push(`- **Active Projects**: ${prefs.currentProjects.join(", ")}`);
  }

  if (prefs.currentGoals?.length) {
    lines.push("");
    lines.push("### Current Goals");
    for (const goal of prefs.currentGoals) {
      lines.push(`- ${goal}`);
    }
  }

  if (prefs.avoidTopics?.length) {
    lines.push("");
    lines.push(`**Avoid topics**: ${prefs.avoidTopics.join(", ")}`);
  }

  // Format response calibration
  const calibrations: string[] = [];
  if (prefs.preferEmoji === false) {
    calibrations.push("no emoji");
  }
  if (prefs.maxResponseLength === "short") {
    calibrations.push("keep responses brief");
  }
  if (calibrations.length > 0) {
    lines.push("");
    lines.push(`**Response calibration**: ${calibrations.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Validate preferences against schema
 */
export function validatePreferences(prefs: unknown): { valid: boolean; data?: UserPreferences; error?: string } {
  const result = UserPreferencesSchema.safeParse(prefs);

  if (result.success) {
    return { valid: true, data: result.data };
  }

  return {
    valid: false,
    error: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
  };
}
