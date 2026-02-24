// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Browser Tool Zod Schemas
 *
 * Defines input and output schemas for the browser control tool.
 */

import { z } from "zod";

// ==================== Action Enums ====================

export const browserActKinds = [
  "click",
  "type",
  "press",
  "hover",
  "drag",
  "select",
  "fill",
  "resize",
  "wait",
  "evaluate",
  "close",
] as const;

export const browserActions = [
  "status",
  "start",
  "stop",
  "profiles",
  "tabs",
  "open",
  "focus",
  "close",
  "snapshot",
  "screenshot",
  "navigate",
  "console",
  "pdf",
  "upload",
  "dialog",
  "act",
] as const;

export const browserSnapshotFormats = ["aria", "ai"] as const;
export const browserSnapshotModes = ["efficient"] as const;
export const browserSnapshotRefs = ["role", "aria"] as const;
export const browserImageTypes = ["png", "jpeg"] as const;

// ==================== Act Request Schema ====================

export const browserActSchema = z.object({
  kind: z.enum(browserActKinds).describe("The type of action to perform"),
  // Common fields
  targetId: z.string().optional().describe("Target tab ID"),
  ref: z.string().optional().describe("Element reference (e.g., e1, e2)"),
  // click
  doubleClick: z.boolean().optional().describe("Double-click instead of single click"),
  button: z.string().optional().describe("Mouse button to use"),
  modifiers: z.array(z.string()).optional().describe("Keyboard modifiers"),
  // type
  text: z.string().optional().describe("Text to type"),
  submit: z.boolean().optional().describe("Press Enter after typing"),
  slowly: z.boolean().optional().describe("Type slowly with delays"),
  // press
  key: z.string().optional().describe("Key to press"),
  // drag
  startRef: z.string().optional().describe("Drag start element ref"),
  endRef: z.string().optional().describe("Drag end element ref"),
  // select
  values: z.array(z.string()).optional().describe("Values to select"),
  // fill
  fields: z.array(z.record(z.string(), z.unknown())).optional().describe("Form fields to fill"),
  // resize
  width: z.number().optional().describe("New viewport width"),
  height: z.number().optional().describe("New viewport height"),
  // wait
  timeMs: z.number().optional().describe("Time to wait in milliseconds"),
  textGone: z.string().optional().describe("Wait until this text disappears"),
  // evaluate
  fn: z.string().optional().describe("JavaScript code to evaluate"),
});

// ==================== Main Input Schema ====================

export const browserToolInputSchema = z.object({
  action: z.enum(browserActions).describe("The browser action to perform"),
  profile: z.string().optional().describe('Browser profile name (default: "mastra")'),
  targetUrl: z.string().optional().describe("URL for open/navigate actions"),
  targetId: z.string().optional().describe("Target tab ID for tab-specific actions"),
  limit: z.number().optional().describe("Limit for snapshot/query results"),
  maxChars: z.number().optional().describe("Maximum characters in snapshot"),
  mode: z.enum(browserSnapshotModes).optional().describe("Snapshot mode"),
  snapshotFormat: z
    .enum(browserSnapshotFormats)
    .optional()
    .describe('Snapshot format: "ai" for AI-optimized, "aria" for ARIA tree'),
  refs: z
    .enum(browserSnapshotRefs)
    .optional()
    .describe('Reference mode: "role" for role+name, "aria" for Playwright refs'),
  interactive: z.boolean().optional().describe("Only include interactive elements"),
  compact: z.boolean().optional().describe("Remove empty structural elements"),
  depth: z.number().optional().describe("Maximum depth for snapshot"),
  selector: z.string().optional().describe("CSS selector for scoping"),
  frame: z.string().optional().describe("Frame selector for iframe content"),
  labels: z.boolean().optional().describe("Include labeled screenshot with refs"),
  fullPage: z.boolean().optional().describe("Capture full page screenshot"),
  ref: z.string().optional().describe("Element ref for element screenshot"),
  element: z.string().optional().describe("CSS selector for element screenshot"),
  type: z.enum(browserImageTypes).optional().describe("Image format"),
  level: z.string().optional().describe("Console message level filter"),
  paths: z.array(z.string()).optional().describe("File paths for upload"),
  inputRef: z.string().optional().describe("File input element ref"),
  timeoutMs: z.number().optional().describe("Timeout in milliseconds"),
  accept: z.boolean().optional().describe("Accept or dismiss dialog"),
  promptText: z.string().optional().describe("Text for prompt dialogs"),
  request: browserActSchema.optional().describe("Action request for act command"),
});

// ==================== Output Schemas ====================

export const browserStatusOutputSchema = z.object({
  status: z.enum(["running", "stopped"]),
  profile: z.string(),
  cdpUrl: z.string().optional(),
  pid: z.number().optional(),
});

export const browserTabOutputSchema = z.object({
  targetId: z.string(),
  title: z.string(),
  url: z.string(),
  type: z.string(),
});

export const browserSnapshotOutputSchema = z.object({
  format: z.enum(browserSnapshotFormats),
  snapshot: z.string(),
  targetId: z.string(),
  url: z.string(),
  title: z.string(),
  imagePath: z.string().optional(),
});

export const browserScreenshotOutputSchema = z.object({
  path: z.string(),
  width: z.number(),
  height: z.number(),
  format: z.enum(browserImageTypes),
});

export const browserToolOutputSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  data: z.unknown().optional(),
});

// Type exports
export type BrowserToolInput = z.infer<typeof browserToolInputSchema>;
export type BrowserActInput = z.infer<typeof browserActSchema>;
export type BrowserToolOutput = z.infer<typeof browserToolOutputSchema>;
