// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Identity Parser
 *
 * Parses IDENTITY.md configuration files that define the agent's identity,
 * including name, creature type, emoji, and personality vibe.
 *
 * Format:
 * # Identity
 *
 * **Name**: Scion
 * **Vibe**: Curious, helpful, slightly mischievous
 *
 * # Description
 * Extended description of the identity...
 *
 * # Voice
 * How the agent should speak...
 * ```
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export interface IdentityConfig {
  name: string;
  creature: string;
  vibe: string;
  emoji: string;
  description: string;
  voice: string;
  raw: string;
}

/**
 * Parse an IDENTITY.md file and extract structured configuration
 */
export async function parseIdentityFile(filePath: string): Promise<IdentityConfig> {
  if (!existsSync(filePath)) {
    throw new IdentityParseError(`Identity file not found: ${filePath}`);
  }

  const content = await readFile(filePath, "utf-8");
  return parseIdentityContent(content);
}

/**
 * Parse identity content from a string
 */
export function parseIdentityContent(content: string): IdentityConfig {
  // Extract key-value pairs from **Key**: Value format
  const keyValues = extractKeyValues(content);

  // Extract sections for longer content
  const sections = extractSections(content);

  return {
    name: keyValues.name || extractFromSection(sections, "name") || "Agent",
    creature: keyValues.creature || extractFromSection(sections, "creature") || "",
    vibe: keyValues.vibe || extractFromSection(sections, "vibe") || "",
    emoji: keyValues.emoji || extractEmoji(content) || "",
    description: extractFromSection(sections, "description") || "",
    voice: extractFromSection(sections, "voice") || "",
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
    // Match **Key**: Value or **Key:** Value patterns
    const match = line.match(/\*\*(\w+)\*\*:\s*(.+)$/i);
    if (match) {
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      pairs[key] = value;
    }

    // Also match Key: Value at line start (without bold)
    const simpleMatch = line.match(/^(\w+):\s*(.+)$/);
    if (simpleMatch && !pairs[simpleMatch[1].toLowerCase()]) {
      const key = simpleMatch[1].toLowerCase();
      const value = simpleMatch[2].trim();
      pairs[key] = value;
    }
  }

  return pairs;
}

/**
 * Extract markdown sections
 */
function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split("\n");

  let currentSection = "";
  const contentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,2}\s+(.+)$/);

    if (headerMatch) {
      if (currentSection) {
        sections.set(currentSection, contentLines.join("\n").trim());
        contentLines.length = 0;
      }
      currentSection = headerMatch[1].toLowerCase().trim();
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  if (currentSection) {
    sections.set(currentSection, contentLines.join("\n").trim());
  }

  return sections;
}

/**
 * Extract content from a section, removing key-value pairs
 */
function extractFromSection(sections: Map<string, string>, name: string): string {
  const content = sections.get(name);
  if (!content) return "";

  // Remove **Key**: Value lines to get pure description
  const lines = content.split("\n").filter((line) => !line.match(/\*\*\w+\*\*:/));
  return lines.join("\n").trim();
}

/**
 * Extract emoji from content (finds first emoji character)
 */
function extractEmoji(content: string): string {
  // Emoji regex pattern - covers most common emojis
  const emojiRegex =
    /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/u;
  const match = content.match(emojiRegex);
  return match ? match[0] : "";
}

/**
 * Custom error for identity parsing issues
 */
export class IdentityParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityParseError";
  }
}

/**
 * Validate an IdentityConfig has required fields
 */
export function validateIdentityConfig(config: IdentityConfig): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!config.name || config.name === "Agent") {
    warnings.push('No name defined - using default "Agent"');
  }

  if (!config.creature) {
    warnings.push("No creature type defined");
  }

  if (!config.emoji) {
    warnings.push("No emoji defined");
  }

  return {
    valid: !!config.name,
    warnings,
  };
}
