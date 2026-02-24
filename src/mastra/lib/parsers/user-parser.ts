// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * User Parser
 *
 * Parses USER.md configuration files that define the user's context,
 * preferences, and personalization settings.
 *
 * Format:
 * ```markdown
 * # User
 *
 * **Name**: Sacha
 * **Timezone**: Europe/Berlin
 * **Pronouns**: they/them
 *
 * # Preferences
 * - Concise responses
 * - Code examples in TypeScript
 * - Dark mode friendly formatting
 *
 * # Context
 * Additional context about the user...
 *
 * # Goals
 * - Current project goals
 * - Learning objectives
 * ```
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export interface UserConfig {
  name: string;
  timezone: string;
  pronouns: string;
  preferences: string[];
  context: string;
  goals: string[];
  raw: string;
}

/**
 * Parse a USER.md file and extract structured configuration
 */
export async function parseUserFile(filePath: string): Promise<UserConfig> {
  if (!existsSync(filePath)) {
    throw new UserParseError(`User file not found: ${filePath}`);
  }

  const content = await readFile(filePath, "utf-8");
  return parseUserContent(content);
}

/**
 * Parse user content from a string
 */
export function parseUserContent(content: string): UserConfig {
  // Extract key-value pairs
  const keyValues = extractKeyValues(content);

  // Extract sections
  const sections = extractSections(content);

  return {
    name: keyValues.name || "User",
    timezone: keyValues.timezone || "UTC",
    pronouns: keyValues.pronouns || "",
    preferences: extractListFromSection(sections, ["preferences", "prefs", "likes"]),
    context: extractParagraphFromSection(sections, ["context", "about", "background"]),
    goals: extractListFromSection(sections, ["goals", "objectives", "focus"]),
    raw: content,
  };
}

/**
 * Extract **Key**: Value pairs from content
 */
function extractKeyValues(content: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    // Match **Key**: Value patterns
    const boldMatch = line.match(/\*\*(\w+)\*\*:\s*(.+)$/i);
    if (boldMatch) {
      const key = boldMatch[1].toLowerCase();
      const value = boldMatch[2].trim();
      pairs[key] = value;
      continue;
    }

    // Match Key: Value at line start
    const simpleMatch = line.match(/^(\w+):\s*(.+)$/);
    if (simpleMatch && !pairs[simpleMatch[1].toLowerCase()]) {
      const key = simpleMatch[1].toLowerCase();
      const value = simpleMatch[2].trim();
      pairs[key] = value;
    }
  }

  return pairs;
}

interface Section {
  name: string;
  content: string;
}

/**
 * Extract markdown sections
 */
function extractSections(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split("\n");

  let currentSection: Section | null = null;
  const contentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,2}\s+(.+)$/);

    if (headerMatch) {
      if (currentSection) {
        currentSection.content = contentLines.join("\n").trim();
        sections.push(currentSection);
        contentLines.length = 0;
      }
      currentSection = {
        name: headerMatch[1].toLowerCase().trim(),
        content: "",
      };
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = contentLines.join("\n").trim();
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Find a section by matching against multiple possible names
 */
function findSection(sections: Section[], possibleNames: string[]): string {
  for (const name of possibleNames) {
    const section = sections.find((s) => s.name.includes(name) || name.includes(s.name));
    if (section) {
      return section.content;
    }
  }
  return "";
}

/**
 * Extract list items from a section
 */
function extractListFromSection(sections: Section[], possibleNames: string[]): string[] {
  const content = findSection(sections, possibleNames);
  if (!content) return [];

  const items: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }

  return items;
}

/**
 * Extract paragraph content from a section
 */
function extractParagraphFromSection(sections: Section[], possibleNames: string[]): string {
  const content = findSection(sections, possibleNames);
  if (!content) return "";

  // Remove list items
  const lines = content.split("\n").filter((line) => !line.match(/^\s*[-*]\s+/));
  return lines.join("\n").trim();
}

/**
 * Custom error for user parsing issues
 */
export class UserParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserParseError";
  }
}

/**
 * Validate a UserConfig has required fields
 */
export function validateUserConfig(config: UserConfig): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!config.name || config.name === "User") {
    warnings.push('No user name defined - using default "User"');
  }

  if (config.timezone === "UTC") {
    warnings.push("Using default timezone UTC - consider setting your local timezone");
  }

  if (config.preferences.length === 0) {
    warnings.push("No preferences defined");
  }

  return {
    valid: true,
    warnings,
  };
}

/**
 * Get a formatted greeting based on user config and current time
 */
export function getTimeBasedGreeting(config: UserConfig): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: config.timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = Number.parseInt(formatter.format(now), 10);

    if (hour >= 5 && hour < 12) {
      return `Good morning, ${config.name}`;
    }
    if (hour >= 12 && hour < 17) {
      return `Good afternoon, ${config.name}`;
    }
    if (hour >= 17 && hour < 21) {
      return `Good evening, ${config.name}`;
    }
    return `Hello, ${config.name}`;
  } catch {
    return `Hello, ${config.name}`;
  }
}
