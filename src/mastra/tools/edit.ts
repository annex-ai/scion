// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { isAbsolute, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { addChangeToSession, isInPlanMode } from "./plan-mode-manager";

/**
 * Expand ~ in path to home directory
 */
function expandPath(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }
  if (filePath.startsWith("~/")) {
    return os.homedir() + filePath.slice(1);
  }
  return filePath;
}

/**
 * Resolve path relative to cwd, handling ~ expansion and absolute paths
 */
function resolveEditPath(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(cwd, expanded);
}

/**
 * Strip BOM (Byte Order Mark) from text content
 */
function stripBom(text: string): { bom: string; text: string } {
  if (text.charCodeAt(0) === 0xfeff) {
    return { bom: "\uFEFF", text: text.slice(1) };
  }
  return { bom: "", text };
}

/**
 * Detect line ending style from content
 */
function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfCount ? "\r\n" : "\n";
}

/**
 * Normalize line endings to LF
 */
function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Restore original line endings
 */
function restoreLineEndings(text: string, originalEnding: "\r\n" | "\n"): string {
  if (originalEnding === "\r\n") {
    return text.replace(/\n/g, "\r\n");
  }
  return text;
}

/**
 * Normalize whitespace for fuzzy matching:
 * - Collapse multiple spaces/tabs to single space
 * - Trim trailing whitespace from lines
 * - Normalize line endings
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n") // Normalize line endings
    .replace(/[ \t]+/g, " ") // Collapse spaces/tabs
    .replace(/ +$/gm, "") // Trim trailing spaces
    .replace(/^\s+$/gm, ""); // Empty lines become truly empty
}

/**
 * Count occurrences of a string in text
 */
function countOccurrences(text: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  for (let pos = text.indexOf(search, 0); pos !== -1; pos = text.indexOf(search, pos + search.length)) {
    count++;
  }
  return count;
}

/**
 * Find match position using whitespace-normalized comparison
 * Returns the actual substring from content that matches the normalized pattern
 */
function findNormalizedMatch(
  content: string,
  searchPattern: string,
): { start: number; end: number; match: string } | null {
  const normalizedSearch = normalizeWhitespace(searchPattern);
  const lines = content.split("\n");
  const searchLines = normalizedSearch.split("\n").filter((l) => l.length > 0 || searchPattern.includes("\n\n"));

  // Try to find a block of lines that matches when normalized
  for (let startLine = 0; startLine <= lines.length - searchLines.length; startLine++) {
    let matches = true;
    let endLine = startLine;
    let searchIdx = 0;

    while (searchIdx < searchLines.length && endLine < lines.length) {
      const normalizedContentLine = normalizeWhitespace(lines[endLine]);
      const normalizedSearchLine = searchLines[searchIdx];

      // Skip empty lines in content if search line is also empty
      if (normalizedContentLine === "" && normalizedSearchLine === "") {
        endLine++;
        searchIdx++;
        continue;
      }

      if (normalizedContentLine === normalizedSearchLine) {
        endLine++;
        searchIdx++;
      } else if (normalizedContentLine === "" && normalizedSearchLine !== "") {
        // Skip extra empty lines in content
        endLine++;
      } else {
        matches = false;
        break;
      }
    }

    if (matches && searchIdx === searchLines.length) {
      // Calculate character positions
      let startPos = 0;
      for (let i = 0; i < startLine; i++) {
        startPos += lines[i].length + 1; // +1 for newline
      }
      let endPos = startPos;
      for (let i = startLine; i < endLine; i++) {
        endPos += lines[i].length + 1;
      }
      // Remove trailing newline from end position
      if (endPos > startPos) endPos--;

      return {
        start: startPos,
        end: endPos,
        match: content.substring(startPos, endPos),
      };
    }
  }

  return null;
}

/**
 * Generate a unified diff between old and new text
 */
function generateDiff(oldText: string, newText: string, contextLines = 3): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple line-by-line diff
  const diff: string[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      // Only new lines left
      diff.push(`+ ${newLines[newIdx]}`);
      newIdx++;
    } else if (newIdx >= newLines.length) {
      // Only old lines left
      diff.push(`- ${oldLines[oldIdx]}`);
      oldIdx++;
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      // Lines match
      diff.push(`  ${oldLines[oldIdx]}`);
      oldIdx++;
      newIdx++;
    } else {
      // Lines differ - show removal then addition
      diff.push(`- ${oldLines[oldIdx]}`);
      oldIdx++;
      // Check if next old line matches current new line
      if (oldIdx < oldLines.length && oldLines[oldIdx] === newLines[newIdx]) {
        continue;
      }
      diff.push(`+ ${newLines[newIdx]}`);
      newIdx++;
    }
  }

  // Filter to show only changed regions with context
  const result: string[] = [];
  let inChange = false;
  let contextBuffer: string[] = [];

  for (let i = 0; i < diff.length; i++) {
    const line = diff[i];
    const isChange = line.startsWith("+") || line.startsWith("-");

    if (isChange) {
      // Add context before change
      if (!inChange) {
        const contextStart = Math.max(0, contextBuffer.length - contextLines);
        for (let j = contextStart; j < contextBuffer.length; j++) {
          result.push(contextBuffer[j]);
        }
        contextBuffer = [];
      }
      result.push(line);
      inChange = true;
    } else {
      if (inChange) {
        // Add context after change
        result.push(line);
        contextBuffer.push(line);
        if (contextBuffer.length >= contextLines) {
          inChange = false;
          contextBuffer = [];
        }
      } else {
        contextBuffer.push(line);
        if (contextBuffer.length > contextLines * 2) {
          contextBuffer.shift();
        }
      }
    }
  }

  return result.join("\n");
}

export const editTool = createTool({
  id: "edit-file",
  inputSchema: z.object({
    file_path: z.string().describe("Path to the file to edit (relative or absolute)"),
    old_string: z.string().describe("Text to find and replace"),
    new_string: z.string().describe("New text to replace the old text with"),
    replace_all: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace all occurrences (default: false, requires uniqueness)"),
    normalize_whitespace: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Normalize whitespace when matching (collapse spaces, trim trailing). Useful when exact whitespace is uncertain.",
      ),
    show_diff: z.boolean().optional().default(true).describe("Include diff output showing changes (default: true)"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether the edit operation succeeded"),
    message: z.string().describe("Success or error message"),
    replacements_made: z.number().optional().describe("Number of replacements made (on success)"),
    diff: z.string().optional().describe("Unified diff showing the changes"),
  }),
  description:
    "Modifies an existing file by finding and replacing text. Accepts file path, old_string to find, and new_string to replace with. Returns success status, replacement count, and diff output. Use this tool when you need to update specific parts of a file without rewriting the entire contents. Requires exact text matching by default. Set normalize_whitespace=true for whitespace-insensitive matching. Set replace_all=true to replace all occurrences.",
  execute: async ({ file_path, old_string, new_string, replace_all, normalize_whitespace, show_diff }) => {
    const cwd = process.cwd();
    const absolutePath = resolveEditPath(file_path, cwd);

    try {
      // Check if file exists and is readable/writable
      try {
        await access(absolutePath, constants.R_OK | constants.W_OK);
      } catch {
        return {
          success: false,
          message: `File not found or not accessible: ${file_path}`,
        };
      }

      // Check if in plan mode - handle before doing the edit
      if (isInPlanMode()) {
        // Read the file to get current content
        const buffer = await readFile(absolutePath);
        const rawContent = buffer.toString("utf-8");

        // For plan mode, we'll record the full file change
        // We need to compute what the new content would be
        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);
        const normalizedOldString = normalizeToLF(old_string);
        const normalizedNewString = normalizeToLF(new_string);

        let newContent: string;
        let replacementsMade: number;

        if (normalize_whitespace) {
          const match = findNormalizedMatch(normalizedContent, normalizedOldString);
          if (!match) {
            return {
              success: false,
              message: `Could not find matching text in ${file_path} (even with whitespace normalization)`,
            };
          }
          newContent =
            normalizedContent.substring(0, match.start) + normalizedNewString + normalizedContent.substring(match.end);
          replacementsMade = 1;
        } else {
          const occurrences = countOccurrences(normalizedContent, normalizedOldString);
          if (occurrences === 0) {
            return {
              success: false,
              message: `Could not find the exact text in ${file_path}`,
            };
          }
          if (!replace_all && occurrences > 1) {
            return {
              success: false,
              message: `Found ${occurrences} occurrences in ${file_path}. Use replace_all=true or provide more context.`,
            };
          }
          if (replace_all) {
            newContent = normalizedContent.split(normalizedOldString).join(normalizedNewString);
            replacementsMade = occurrences;
          } else {
            newContent = normalizedContent.replace(normalizedOldString, normalizedNewString);
            replacementsMade = 1;
          }
        }

        const finalContent = bom + restoreLineEndings(newContent, originalEnding);

        // Record change in plan mode
        const changeId = addChangeToSession({
          type: "edit",
          filePath: absolutePath,
          before: rawContent,
          after: finalContent,
          status: "pending",
          metadata: {
            tool: "edit-file",
            timestamp: new Date(),
          },
        });

        return {
          success: true,
          message: `[PLAN MODE] Recorded edit to ${file_path} (change ID: ${changeId})`,
          replacements_made: replacementsMade,
        };
      }

      // Read the file
      const buffer = await readFile(absolutePath);
      const rawContent = buffer.toString("utf-8");

      // Strip BOM (LLM won't include invisible BOM in old_string)
      const { bom, text: content } = stripBom(rawContent);

      // Detect and preserve line ending style
      const originalEnding = detectLineEnding(content);
      const normalizedContent = normalizeToLF(content);
      const normalizedOldString = normalizeToLF(old_string);
      const normalizedNewString = normalizeToLF(new_string);

      let newContent: string;
      let replacementsMade: number;
      let actualOldText: string = normalizedOldString;

      if (normalize_whitespace) {
        // Whitespace-normalized matching
        const match = findNormalizedMatch(normalizedContent, normalizedOldString);

        if (!match) {
          return {
            success: false,
            message: `Could not find matching text in ${file_path} (even with whitespace normalization). Check that the text structure matches.`,
          };
        }

        actualOldText = match.match;

        // For replace_all with normalization, we only replace the first match
        // (finding all normalized matches is complex and error-prone)
        if (replace_all) {
          return {
            success: false,
            message: "replace_all is not supported with normalize_whitespace. Use exact matching for replace_all.",
          };
        }

        newContent =
          normalizedContent.substring(0, match.start) + normalizedNewString + normalizedContent.substring(match.end);
        replacementsMade = 1;
      } else {
        // Exact matching (original behavior)
        const occurrences = countOccurrences(normalizedContent, normalizedOldString);

        if (occurrences === 0) {
          return {
            success: false,
            message: `Could not find the exact text in ${file_path}. The old_string must match exactly including all whitespace and newlines. Try normalize_whitespace=true if whitespace differs.`,
          };
        }

        // Check uniqueness if replace_all is false
        if (!replace_all && occurrences > 1) {
          return {
            success: false,
            message: `Found ${occurrences} occurrences of the text in ${file_path}. The text must be unique. Use replace_all=true to replace all occurrences, or provide more context to make it unique.`,
          };
        }

        // Perform replacement
        if (replace_all) {
          newContent = normalizedContent.split(normalizedOldString).join(normalizedNewString);
          replacementsMade = occurrences;
        } else {
          newContent = normalizedContent.replace(normalizedOldString, normalizedNewString);
          replacementsMade = 1;
        }
      }

      // Verify the replacement actually changed something
      if (normalizedContent === newContent) {
        return {
          success: false,
          message: `No changes made to ${file_path}. The replacement produced identical content.`,
        };
      }

      // Generate diff if requested
      let diff: string | undefined;
      if (show_diff) {
        diff = generateDiff(actualOldText, normalizedNewString);
      }

      // Restore original line endings and BOM
      const finalContent = bom + restoreLineEndings(newContent, originalEnding);

      // Write the file
      await writeFile(absolutePath, finalContent, "utf-8");

      return {
        success: true,
        message: `Successfully replaced ${replacementsMade} occurrence(s) in ${file_path}`,
        replacements_made: replacementsMade,
        ...(diff && { diff }),
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Error editing file: ${error.message}`,
      };
    }
  },
});
