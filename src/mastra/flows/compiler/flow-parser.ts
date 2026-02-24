// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Flow Parser
 *
 * Parses FLOW.md files to extract:
 * - Frontmatter metadata (name, description, triggers, etc.)
 * - Mermaid flowchart diagram
 * - Instructions text
 */

import { readFileSync } from "node:fs";
import type { FlowFrontmatter, ParsedFlow } from "../types";

/**
 * Parse a FLOW.md file
 */
export function parseFlowFile(filePath: string): ParsedFlow {
  const content = readFileSync(filePath, "utf-8");
  return parseFlowContent(content, filePath);
}

/**
 * Parse flow content from string
 */
export function parseFlowContent(content: string, filePath: string): ParsedFlow {
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
      version: frontmatter.version,
      tags: parseArrayField(frontmatter.tags),
      triggers: parseArrayField(frontmatter.triggers),
      model: frontmatter.model,
      ...frontmatter,
    },
    instructions,
    mermaidDiagram,
    flowPath: filePath,
  };
}

/**
 * Parse YAML frontmatter from markdown
 */
function parseFrontmatter(lines: string[]): { frontmatter: Record<string, any>; contentStartLine: number } {
  if (lines.length < 3 || lines[0].trim() !== "---") {
    return { frontmatter: {}, contentStartLine: 0 };
  }

  const frontmatter: Record<string, any> = {};
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
 * Parse a frontmatter value (handle numbers, booleans, strings, arrays)
 */
function parseFrontmatterValue(value: string): any {
  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);

  // Array notation ["a", "b"]
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      return JSON.parse(value);
    } catch {
      // Fall through to string handling
    }
  }

  // String (remove quotes if present)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

/**
 * Parse array field from frontmatter value
 */
function parseArrayField(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value.split(",").map((s) => s.trim());
  }
  return undefined;
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
 * Infer flow name from file path
 */
function inferNameFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const dirName = parts[parts.length - 2] || parts[parts.length - 1];
  return dirName.replace(/-/g, " ");
}

/**
 * Check if a file is a valid flow file (has FLOW.md structure)
 */
export function isFlowFile(filePath: string): boolean {
  try {
    const flow = parseFlowFile(filePath);
    // A flow must have either a mermaid diagram or be explicitly typed
    return flow.mermaidDiagram.includes("flowchart") || flow.mermaidDiagram.includes("graph ");
  } catch {
    return false;
  }
}

/**
 * Get flow metadata from file
 */
export function getFlowMetadata(filePath: string): {
  name: string;
  description: string;
  triggers: string[];
  isValid: boolean;
} {
  try {
    const flow = parseFlowFile(filePath);
    return {
      name: flow.frontmatter.name,
      description: flow.frontmatter.description || "",
      triggers: flow.frontmatter.triggers || [],
      isValid: flow.mermaidDiagram.includes("flowchart") || flow.mermaidDiagram.includes("graph "),
    };
  } catch {
    return {
      name: inferNameFromPath(filePath),
      description: "",
      triggers: [],
      isValid: false,
    };
  }
}
