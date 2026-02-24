// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Update User Preferences Tool
 *
 * Allows the agent to update user preferences based on observed behavior
 * or explicit user requests. Preferences persist across all conversations.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  type UserPreferences,
  UserPreferencesSchema,
  mergePreferences,
  validatePreferences,
} from "../memory/user-preferences";

import { getUserPreferencesProcessor } from "../processors/user-preferences";

/**
 * Input schema for updating preferences
 */
const UpdatePreferencesInputSchema = z.object({
  communicationStyle: z
    .enum(["concise", "verbose", "documented", "casual"])
    .optional()
    .describe("How the user prefers responses formatted"),

  preferredLanguage: z.string().optional().describe("Preferred programming language for code examples"),

  expertiseLevel: z
    .enum(["beginner", "intermediate", "expert"])
    .optional()
    .describe("User expertise level for calibrating explanations"),

  addDomainExpertise: z.array(z.string()).optional().describe("Domains to add to user expertise list"),

  addDomainsLearning: z.array(z.string()).optional().describe("Domains to add to user learning list"),

  howTheyLikeToBeAddressed: z.string().optional().describe("How user prefers to be addressed"),

  addTopics: z.array(z.string()).optional().describe("Topics of interest to add"),

  addAvoidTopics: z.array(z.string()).optional().describe("Topics to avoid in conversations"),

  setCurrentProjects: z.array(z.string()).optional().describe("Set active projects (replaces existing list)"),

  setCurrentGoals: z.array(z.string()).optional().describe("Set current goals (replaces existing list)"),

  preferEmoji: z.boolean().optional().describe("Whether to use emoji in responses"),

  preferCodeComments: z.boolean().optional().describe("Whether to add comments in code examples"),

  maxResponseLength: z.enum(["short", "medium", "long"]).optional().describe("Preferred response length"),

  customPreference: z
    .object({
      key: z.string(),
      value: z.string(),
    })
    .optional()
    .describe("Set a custom key-value preference"),
});

type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesInputSchema>;

/**
 * Update User Preferences Tool
 *
 * Use this tool to update user preferences based on:
 * - Explicit user requests ("I prefer concise responses")
 * - Observed patterns ("User keeps asking for TypeScript examples")
 * - Context updates ("User mentioned working on a new project")
 */
export const updatePreferencesTool = createTool({
  id: "update-user-preferences",
  description: `Update user preferences that persist across all conversations.

Use when:
- User explicitly states a preference
- You observe a clear pattern in user requests
- User mentions new projects or goals
- User corrects your response style

Preferences include:
- communicationStyle: 'concise', 'verbose', 'documented', 'casual'
- expertiseLevel: 'beginner', 'intermediate', 'expert'
- preferredLanguage: Programming language for examples
- howTheyLikeToBeAddressed: Name or title preference
- addDomainExpertise: Domains user is expert in
- addDomainsLearning: Domains user is learning
- setCurrentProjects: Active projects
- setCurrentGoals: Current objectives
- preferEmoji: Whether to use emoji
- maxResponseLength: 'short', 'medium', 'long'`,

  inputSchema: UpdatePreferencesInputSchema,

  outputSchema: z.object({
    success: z.boolean(),
    updated: z.array(z.string()).describe("Fields that were updated"),
    current: UserPreferencesSchema.describe("Current preferences after update"),
    message: z.string(),
  }),

  execute: async (input) => {
    const processor = getUserPreferencesProcessor();
    const resourceId = processor.getCurrentResourceId();

    if (!resourceId) {
      return {
        success: false,
        updated: [],
        current: {},
        message: "No resource ID available - preferences cannot be saved",
      };
    }

    // Build updates object from input
    const updates: Partial<UserPreferences> = {};
    const updatedFields: string[] = [];

    if (input.communicationStyle) {
      updates.communicationStyle = input.communicationStyle;
      updatedFields.push("communicationStyle");
    }

    if (input.preferredLanguage) {
      updates.preferredLanguage = input.preferredLanguage;
      updatedFields.push("preferredLanguage");
    }

    if (input.expertiseLevel) {
      updates.expertiseLevel = input.expertiseLevel;
      updatedFields.push("expertiseLevel");
    }

    if (input.addDomainExpertise?.length) {
      updates.domainsOfExpertise = input.addDomainExpertise;
      updatedFields.push("domainsOfExpertise");
    }

    if (input.addDomainsLearning?.length) {
      updates.domainsLearning = input.addDomainsLearning;
      updatedFields.push("domainsLearning");
    }

    if (input.howTheyLikeToBeAddressed) {
      updates.howTheyLikeToBeAddressed = input.howTheyLikeToBeAddressed;
      updatedFields.push("howTheyLikeToBeAddressed");
    }

    if (input.addTopics?.length) {
      updates.topics = input.addTopics;
      updatedFields.push("topics");
    }

    if (input.addAvoidTopics?.length) {
      updates.avoidTopics = input.addAvoidTopics;
      updatedFields.push("avoidTopics");
    }

    if (input.setCurrentProjects) {
      updates.currentProjects = input.setCurrentProjects;
      updatedFields.push("currentProjects");
    }

    if (input.setCurrentGoals) {
      updates.currentGoals = input.setCurrentGoals;
      updatedFields.push("currentGoals");
    }

    if (typeof input.preferEmoji === "boolean") {
      updates.preferEmoji = input.preferEmoji;
      updatedFields.push("preferEmoji");
    }

    if (typeof input.preferCodeComments === "boolean") {
      updates.preferCodeComments = input.preferCodeComments;
      updatedFields.push("preferCodeComments");
    }

    if (input.maxResponseLength) {
      updates.maxResponseLength = input.maxResponseLength;
      updatedFields.push("maxResponseLength");
    }

    if (input.customPreference) {
      updates.custom = { [input.customPreference.key]: input.customPreference.value };
      updatedFields.push(`custom.${input.customPreference.key}`);
    }

    if (updatedFields.length === 0) {
      return {
        success: false,
        updated: [],
        current: processor.getCurrentPreferences() || {},
        message: "No preferences provided to update",
      };
    }

    try {
      // Update preferences
      const newPreferences = await processor.updatePreferences(resourceId, updates);

      return {
        success: true,
        updated: updatedFields,
        current: newPreferences,
        message: `Updated ${updatedFields.length} preference(s): ${updatedFields.join(", ")}`,
      };
    } catch (error) {
      return {
        success: false,
        updated: [],
        current: processor.getCurrentPreferences() || {},
        message: `Failed to update preferences: ${error}`,
      };
    }
  },
});
