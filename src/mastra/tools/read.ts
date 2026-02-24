// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import { isAbsolute, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Truncation constants
const DEFAULT_MAX_LINES = 100000; // Effectively no truncation for most use cases
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

// Supported image extensions
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

/**
 * Format bytes as human-readable size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

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
function resolveReadPath(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(cwd, expanded);
}

/**
 * Check if file is an image based on extension
 */
function isImage(filePath: string): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Truncate content from the head (keep first N lines/bytes)
 */
function truncateHead(content: string, maxLines: number, maxBytes: number) {
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  // No truncation needed
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null as "lines" | "bytes" | null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      firstLineExceedsLimit: false,
    };
  }

  // Check if first line alone exceeds byte limit
  const firstLineBytes = Buffer.byteLength(lines[0], "utf-8");
  if (firstLineBytes > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes" as const,
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      firstLineExceedsLimit: true,
    };
  }

  // Collect complete lines that fit
  const outputLinesArr: string[] = [];
  let outputBytesCount = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0); // +1 for newline

    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }

    outputLinesArr.push(line);
    outputBytesCount += lineBytes;
  }

  // If we exited due to line limit
  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = "lines";
  }

  const outputContent = outputLinesArr.join("\n");
  const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");

  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: finalOutputBytes,
    firstLineExceedsLimit: false,
  };
}

export const readTool = createTool({
  id: "read-file",
  inputSchema: z.object({
    file_path: z.string().describe("Path to the file to read (relative or absolute)"),
    offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
    limit: z.number().optional().describe("Maximum number of lines to read"),
  }),
  outputSchema: z.object({
    content: z.string().describe("File contents or error message"),
    truncated: z.boolean().describe("Whether content was truncated"),
    isImage: z.boolean().optional().describe("Whether file is an image"),
    totalLines: z.number().optional().describe("Total lines in file (text files only)"),
  }),
  description: `Reads the contents of a file from disk. Accepts a file path (relative or absolute) and optional offset/limit for pagination. Returns the file content as text with line numbers, or base64 for images. Supports text files and images (jpg, png, gif, webp). Use this tool when you need to examine file contents, review code, or inspect configuration files. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Use offset/limit parameters for large files.`,
  execute: async ({ file_path, offset, limit }) => {
    const cwd = process.cwd();
    const absolutePath = resolveReadPath(file_path, cwd);

    try {
      // Check if file exists and is readable
      await access(absolutePath, constants.R_OK);

      // Check if file is an image
      if (isImage(absolutePath)) {
        const buffer = await readFile(absolutePath);
        const base64 = buffer.toString("base64");
        return {
          content: `[Image file: ${absolutePath}]\n${base64}`,
          truncated: false,
          isImage: true,
        };
      }

      // Read as text file
      const buffer = await readFile(absolutePath);
      const textContent = buffer.toString("utf-8");
      const allLines = textContent.split("\n");
      const totalFileLines = allLines.length;

      // Apply offset if specified (1-indexed to 0-indexed)
      const startLine = offset ? Math.max(0, offset - 1) : 0;
      const startLineDisplay = startLine + 1; // For display (1-indexed)

      // Check if offset is out of bounds
      if (startLine >= allLines.length) {
        throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
      }

      // If limit is specified by user, use it
      let selectedContent: string;
      let userLimitedLines: number | undefined;
      if (limit !== undefined) {
        const endLine = Math.min(startLine + limit, allLines.length);
        selectedContent = allLines.slice(startLine, endLine).join("\n");
        userLimitedLines = endLine - startLine;
      } else {
        selectedContent = allLines.slice(startLine).join("\n");
      }

      // Apply truncation (respects both line and byte limits)
      const truncation = truncateHead(selectedContent, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);

      let outputText: string;

      if (truncation.firstLineExceedsLimit) {
        // First line at offset exceeds limit
        const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
        outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash to read this file]`;
      } else if (truncation.truncated) {
        // Truncation occurred - build actionable notice
        const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
        const nextOffset = endLineDisplay + 1;

        outputText = truncation.content;

        if (truncation.truncatedBy === "lines") {
          outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue]`;
        } else {
          outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue]`;
        }
      } else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
        // User specified limit, there's more content, but no truncation
        const remaining = allLines.length - (startLine + userLimitedLines);
        const nextOffset = startLine + userLimitedLines + 1;

        outputText = truncation.content;
        outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue]`;
      } else {
        // No truncation, no user limit exceeded
        outputText = truncation.content;
      }

      return {
        content: outputText,
        truncated: truncation.truncated,
        isImage: false,
        totalLines: totalFileLines,
      };
    } catch (error: any) {
      return {
        content: `Error reading file: ${error.message}`,
        truncated: false,
        isImage: false,
      };
    }
  },
});
