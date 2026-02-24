// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Soul Parser
 *
 * Parses SOUL.md configuration files that define the core personality,
 * boundaries, and behavioral guidelines for the agent.
 *
 * Format:
 * ```markdown
 * # Core Truths
 * - Truth 1
 * - Truth 2
 *
 * # Boundaries
 * - Boundary 1
 * - Boundary 2
 *
 * # Vibe
 * Description of the overall vibe/tone...
 *
 * # Continuity
 * Guidelines for maintaining continuity across sessions...
 * ```
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export interface SoulConfig {
  coreTruths: string[];
  boundaries: string[];
  vibe: string;
  continuity: string;
  raw: string;
}

interface Section {
  name: string;
  content: string;
}

/**
 * Parse a SOUL.md file and extract structured configuration
 */
export async function parseSoulFile(filePath: string): Promise<SoulConfig> {
  if (!existsSync(filePath)) {
    throw new SoulParseError(`Soul file not found: ${filePath}`);
  }

  const content = await readFile(filePath, "utf-8");
  return parseSoulContent(content);
}

/**
 * Parse soul content from a string
 */
export function parseSoulContent(content: string): SoulConfig {
  const sections = extractSections(content);

  const coreTruths = extractListItems(findSection(sections, ["core truths", "truths", "core beliefs", "beliefs"]));

  const boundaries = extractListItems(findSection(sections, ["boundaries", "limits", "constraints", "rules"]));

  const vibe = extractParagraph(findSection(sections, ["vibe", "tone", "personality", "style"]));

  const continuity = extractParagraph(findSection(sections, ["continuity", "memory", "persistence", "context"]));

  return {
    coreTruths,
    boundaries,
    vibe,
    continuity,
    raw: content,
  };
}

/**
 * Extract markdown sections (# Headers)
 */
function extractSections(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split("\n");

  let currentSection: Section | null = null;
  const contentLines: string[] = [];

  for (const line of lines) {
    // Match # or ## headers
    const headerMatch = line.match(/^#{1,2}\s+(.+)$/);

    if (headerMatch) {
      // Save previous section
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

  // Save last section
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
 * Extract list items from markdown content
 * Supports both - and * bullet points
 */
function extractListItems(content: string): string[] {
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
 * Extract paragraph content (non-list text)
 */
function extractParagraph(content: string): string {
  if (!content) return "";

  const lines = content.split("\n");
  const paragraphLines: string[] = [];

  for (const line of lines) {
    // Skip list items and empty lines at the start
    if (line.match(/^\s*[-*]\s+/)) continue;
    paragraphLines.push(line);
  }

  return paragraphLines.join("\n").trim();
}

/**
 * Custom error for soul parsing issues
 */
export class SoulParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoulParseError";
  }
}

/**
 * Validate a SoulConfig has required fields
 */
export function validateSoulConfig(config: SoulConfig): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (config.coreTruths.length === 0) {
    warnings.push("No core truths defined - consider adding guiding principles");
  }

  if (config.boundaries.length === 0) {
    warnings.push("No boundaries defined - consider adding behavioral limits");
  }

  if (!config.vibe) {
    warnings.push("No vibe/tone defined - consider describing personality");
  }

  return {
    valid: true, // Config is structurally valid even with warnings
    warnings,
  };
}
