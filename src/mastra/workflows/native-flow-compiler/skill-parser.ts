// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Skill Parser
 *
 * Parses SKILL.md files to extract:
 * - Frontmatter metadata (name, description, type, etc.)
 * - Mermaid flowchart diagram
 * - Instructions text
 */

import { readFileSync } from "node:fs";
import type { ParsedSkill } from "./ast-types";

interface Frontmatter {
  [key: string]: any;
}

/**
 * Parse a SKILL.md file
 */
export function parseSkillFile(filePath: string): ParsedSkill {
  const content = readFileSync(filePath, "utf-8");
  return parseSkillContent(content, filePath);
}

/**
 * Parse skill content from string
 */
export function parseSkillContent(content: string, filePath: string): ParsedSkill {
  const lines = content.split("\n");

  // Parse frontmatter
  const { frontmatter, contentStartLine } = parseFrontmatter(lines);

  // Extract mermaid diagram
  const { mermaidDiagram, remainingContent } = extractMermaidDiagram(lines, contentStartLine);

  // Instructions = everything else
  const instructions = remainingContent
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n")
    .trim();

  return {
    frontmatter: {
      name: frontmatter.name || inferNameFromPath(filePath),
      description: frontmatter.description || "",
      type: frontmatter.type || "standard",
      ...frontmatter,
    },
    instructions,
    mermaidDiagram,
    skillPath: filePath,
  };
}

/**
 * Parse YAML frontmatter from markdown
 */
function parseFrontmatter(lines: string[]): { frontmatter: Frontmatter; contentStartLine: number } {
  if (lines.length < 3 || lines[0].trim() !== "---") {
    return { frontmatter: {}, contentStartLine: 0 };
  }

  const frontmatter: Frontmatter = {};
  let i = 1;

  while (i < lines.length && lines[i].trim() !== "---") {
    const line = lines[i];
    const colonIndex = line.indexOf(":");

    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = parseFrontmatterValue(value);
    }

    i++;
  }

  return { frontmatter, contentStartLine: i + 1 };
}

/**
 * Parse a frontmatter value (handle numbers, booleans, strings)
 */
function parseFrontmatterValue(value: string): any {
  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);

  // String (remove quotes if present)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

/**
 * Extract mermaid diagram from content
 */
function extractMermaidDiagram(
  lines: string[],
  startLine: number,
): {
  mermaidDiagram: string;
  remainingContent: string[];
} {
  let mermaidStart = -1;
  let mermaidEnd = -1;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("```mermaid") || line === "```mermaid") {
      mermaidStart = i;
    } else if (mermaidStart >= 0 && line === "```") {
      mermaidEnd = i;
      break;
    }
  }

  if (mermaidStart >= 0 && mermaidEnd > mermaidStart) {
    const mermaidDiagram = lines
      .slice(mermaidStart + 1, mermaidEnd)
      .join("\n")
      .trim();

    // Remove the diagram from content
    const remainingContent = [...lines.slice(startLine, mermaidStart), ...lines.slice(mermaidEnd + 1)];

    return { mermaidDiagram, remainingContent };
  }

  return { mermaidDiagram: "", remainingContent: lines.slice(startLine) };
}

/**
 * Infer skill name from file path
 */
function inferNameFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const dirName = parts[parts.length - 2] || parts[parts.length - 1];
  return dirName.replace(/-/g, " ");
}

/**
 * Check if a skill file is a flow skill
 */
export function isFlowSkill(filePath: string): boolean {
  try {
    const skill = parseSkillFile(filePath);
    return skill.frontmatter.type === "flow" || skill.mermaidDiagram.includes("flowchart");
  } catch {
    return false;
  }
}

/**
 * Get flow metadata from skill
 */
export function getFlowMetadata(filePath: string): {
  name: string;
  description: string;
  isFlow: boolean;
} {
  try {
    const skill = parseSkillFile(filePath);
    return {
      name: skill.frontmatter.name,
      description: skill.frontmatter.description,
      isFlow: skill.frontmatter.type === "flow" || skill.mermaidDiagram.includes("flowchart"),
    };
  } catch {
    return {
      name: inferNameFromPath(filePath),
      description: "",
      isFlow: false,
    };
  }
}
