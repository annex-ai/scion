// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Core Tools Registry
 *
 * Essential tools for task execution that DON'T depend on workflows.
 * This prevents circular dependencies with agents/task.ts.
 *
 * These are the tools available to the taskAgent for executing individual tasks.
 */

import { bashTool } from "./bash";
import { editTool } from "./edit";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { imageTool } from "./image";
import { lsTool } from "./ls";
import { notebookEditTool } from "./notebook-edit";
import { processTool } from "./process";
import { readTool } from "./read";
import { webFetchTool } from "./web-fetch";
import { webSearchTool } from "./web-search";
import { writeTool } from "./write";

// Core tools for task execution (no workflow dependencies)
export const coreTools = [
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  bashTool,
  lsTool,
  imageTool,
  notebookEditTool,
  webFetchTool,
  webSearchTool,
  processTool,
];

// Re-export for convenience
export {
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  bashTool,
  lsTool,
  imageTool,
  notebookEditTool,
  webFetchTool,
  webSearchTool,
  processTool,
};
