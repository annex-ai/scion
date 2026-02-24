// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * User Preferences Processor
 *
 * Input processor that loads resource-scoped user preferences
 * and injects them into the message context.
 *
 * Since Mastra Memory only supports one workingMemory config per Memory instance,
 * this processor handles resource-scoped preferences separately using the storage layer.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MastraDBMessage } from "@mastra/core/agent";
import type { ProcessInputArgs, ProcessInputResult, Processor } from "@mastra/core/processors";
import { AGENT_DIR } from "../lib/config";

import {
  DEFAULT_PREFERENCES,
  type UserPreferences,
  formatPreferencesContext,
  mergePreferences,
  validatePreferences,
} from "../memory/user-preferences";

/**
 * Storage key prefix for user preferences
 */
const PREFERENCES_PREFIX = "user-preferences";

/**
 * Configuration options for UserPreferencesProcessor
 */
export interface UserPreferencesProcessorOptions {
  /**
   * Whether to log preference loading/updates
   * @default false
   */
  verbose?: boolean;

  /**
   * Directory for storing preferences files
   * @default join(AGENT_DIR, 'preferences')
   */
  preferencesDir?: string;
}

/**
 * UserPreferencesProcessor loads and manages user preferences that persist
 * across all conversations for a given resource (user).
 *
 * @example
 * ```typescript
 * import { UserPreferencesProcessor } from '../processors/user-preferences';
 *
 * const prefsProcessor = new UserPreferencesProcessor();
 *
 * const agent = new Agent({
 *   inputProcessors: [
 *     soulLoader,
 *     prefsProcessor,  // Load preferences after soul config
 *     ...
 *   ],
 * });
 * ```
 */
export class UserPreferencesProcessor implements Processor<"user-preferences"> {
  readonly id = "user-preferences" as const;
  readonly name = "User Preferences";
  readonly description = "Loads and manages resource-scoped user preferences";

  private verbose: boolean;
  private preferencesDir: string;

  // In-memory cache for current request
  private currentResourceId: string | null = null;
  private currentPreferences: UserPreferences | null = null;

  constructor(options: UserPreferencesProcessorOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.preferencesDir = options.preferencesDir ?? join(AGENT_DIR, "preferences");
  }

  /**
   * Get preferences file path for a resource
   */
  private getPreferencesPath(resourceId: string): string {
    // Sanitize resourceId for filesystem
    const safeId = resourceId.replace(/[^a-zA-Z0-9-_]/g, "_");
    return join(this.preferencesDir, `${safeId}.json`);
  }

  /**
   * Load preferences from file
   */
  async loadPreferences(resourceId: string): Promise<UserPreferences> {
    const filePath = this.getPreferencesPath(resourceId);

    try {
      if (!existsSync(filePath)) {
        if (this.verbose) {
          console.log(`[UserPreferences] No preferences found for ${resourceId}, using defaults`);
        }
        return { ...DEFAULT_PREFERENCES };
      }

      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content);
      const validation = validatePreferences(parsed);

      if (!validation.valid) {
        console.warn(`[UserPreferences] Invalid stored preferences: ${validation.error}`);
        return { ...DEFAULT_PREFERENCES };
      }

      if (this.verbose) {
        console.log(`[UserPreferences] Loaded preferences for ${resourceId}`);
      }

      return validation.data!;
    } catch (error) {
      console.error("[UserPreferences] Error loading preferences:", error);
      return { ...DEFAULT_PREFERENCES };
    }
  }

  /**
   * Save preferences to file
   */
  async savePreferences(resourceId: string, preferences: UserPreferences): Promise<void> {
    const filePath = this.getPreferencesPath(resourceId);

    try {
      // Ensure directory exists
      if (!existsSync(this.preferencesDir)) {
        await mkdir(this.preferencesDir, { recursive: true });
      }

      await writeFile(filePath, JSON.stringify(preferences, null, 2), "utf-8");

      if (this.verbose) {
        console.log(`[UserPreferences] Saved preferences for ${resourceId}`);
      }
    } catch (error) {
      console.error("[UserPreferences] Error saving preferences:", error);
    }
  }

  /**
   * Update preferences (merge with existing)
   */
  async updatePreferences(resourceId: string, updates: Partial<UserPreferences>): Promise<UserPreferences> {
    const existing = await this.loadPreferences(resourceId);
    const merged = mergePreferences(existing, updates);
    await this.savePreferences(resourceId, merged);
    return merged;
  }

  /**
   * Process input messages, injecting preferences context
   */
  async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
    const { messages, requestContext } = args;

    // Get resource ID from context
    const resourceId = (requestContext?.get as any)?.("resourceId") as string | undefined;

    if (!resourceId) {
      if (this.verbose) {
        console.log("[UserPreferences] No resourceId in context, skipping");
      }
      return messages;
    }

    // Load preferences
    const preferences = await this.loadPreferences(resourceId);

    // Cache for potential output processing
    this.currentResourceId = resourceId;
    this.currentPreferences = preferences;

    // Check if we have any non-default preferences to inject
    const hasCustomPrefs = Object.keys(preferences).some((key) => {
      const defaultValue = (DEFAULT_PREFERENCES as any)[key];
      const currentValue = (preferences as any)[key];
      return JSON.stringify(defaultValue) !== JSON.stringify(currentValue);
    });

    if (!hasCustomPrefs) {
      // No custom preferences set, don't inject context
      return messages;
    }

    // Build preferences context
    const prefsContext = formatPreferencesContext(preferences);

    // Create preferences message using proper MastraDBMessage format
    const prefsMessage: MastraDBMessage = {
      id: `user-preferences-${Date.now()}`,
      role: "system",
      content: {
        format: 2,
        parts: [{ type: "text", text: prefsContext }],
      },
      createdAt: new Date(),
    };

    // Inject after soul config but before user messages
    // Find the last system message and insert after it
    // Find the last system message index
    let lastSystemIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((messages[i] as any).role === "system") {
        lastSystemIndex = i;
        break;
      }
    }

    if (lastSystemIndex >= 0) {
      return [...messages.slice(0, lastSystemIndex + 1), prefsMessage, ...messages.slice(lastSystemIndex + 1)];
    }

    // No system messages, prepend
    return [prefsMessage, ...messages];
  }

  /**
   * Get current cached preferences (for tools to access)
   */
  getCurrentPreferences(): UserPreferences | null {
    return this.currentPreferences;
  }

  /**
   * Get current resource ID (for tools to access)
   */
  getCurrentResourceId(): string | null {
    return this.currentResourceId;
  }
}

/**
 * Singleton instance for access by tools
 */
let processorInstance: UserPreferencesProcessor | null = null;

/**
 * Get or create the singleton processor instance
 */
export function getUserPreferencesProcessor(options?: UserPreferencesProcessorOptions): UserPreferencesProcessor {
  if (!processorInstance) {
    processorInstance = new UserPreferencesProcessor(options);
  }
  return processorInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetUserPreferencesProcessor(): void {
  processorInstance = null;
}
