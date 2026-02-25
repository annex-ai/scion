// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Tool Registry
 *
 * This file exports all cross-domain tools available in the Mastra system.
 * Tools are system interfaces that can be used by agents, workflows, and other primitives.
 *
 * NOTE: This file imports core-tools to avoid duplication, but adds
 * orchestration tools that may depend on workflows.
 */

// Core tools (no workflow dependencies)
import {
  bashTool,
  coreTools,
  editTool,
  globTool,
  grepTool,
  imageTool,
  lsTool,
  notebookEditTool,
  processTool,
  readTool,
  webFetchTool,
  webSearchTool,
  writeTool,
} from "./core-tools";

// Orchestration tools (may depend on workflows)

import { askUserTool } from "./ask-user";
import { browserTool } from "./browser";
import { claudeTool } from "./claude";
import { codexTool } from "./codex";
import { cronListTool } from "./cron-list";
// Cron management
import { cronManageTool } from "./cron-manage";
// Agent delegation (swarm & team patterns)
import { delegateToAgentTool } from "./delegate-agent";
import { geminiTool } from "./gemini";

import { gooseFlowTool } from "./goose-flow";
import { handoffToAgentTool } from "./handoff-agent";
// Heartbeat control
import { heartbeatControlTool } from "./heartbeat-control";
import { kimiTool } from "./kimi";
import { kimiFlowTool } from "./kimi-flow";
import { newSessionTool } from "./new-session";
import { planModeTool } from "./plan-mode";
import { sequentialThinkingTool } from "./sequential-thinking";
import { taskArchiveTool } from "./task-archive";
// Task tools (Claude Code-style progress tracking)
import { taskCreateTool } from "./task-create";
import { taskGetTool } from "./task-get";
import { taskListTool } from "./task-list";
import { taskUpdateTool } from "./task-update";
import { textToSpeechTool } from "./text-to-speech";
// Adaptation system
import { triggerAdaptationTool } from "./trigger-adaptation";
// Soul system tools
import { updatePreferencesTool } from "./update-preferences";

// Re-export all tools for external use
export {
  // Core tools
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  bashTool,
  lsTool,
  imageTool,
  notebookEditTool,
  askUserTool,
  webFetchTool,
  webSearchTool,
  // Process management
  processTool,
  // Orchestration tools
  sequentialThinkingTool,
  claudeTool,
  codexTool,
  geminiTool,
  kimiTool,
  planModeTool,
  kimiFlowTool,
  // Task tools (Claude Code-style)
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
  taskArchiveTool,
  // Browser automation
  browserTool,
  // Soul system
  updatePreferencesTool,
  newSessionTool,
  // Heartbeat control
  heartbeatControlTool,
  // Cron management
  cronManageTool,
  cronListTool,
  // Agent delegation (swarm & team patterns)
  delegateToAgentTool,
  handoffToAgentTool,
  // Adaptation system
  triggerAdaptationTool,
};

/**
 * Convenience array of ALL tools for registration by the main agent
 * This includes orchestration tools that the taskAgent doesn't need.
 */
export const tools = [
  ...coreTools,
  sequentialThinkingTool,
  claudeTool,
  codexTool,
  geminiTool,
  kimiTool,
  planModeTool,
  kimiFlowTool,
  gooseFlowTool,
  // Task tools (Claude Code-style)
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
  taskArchiveTool,
  textToSpeechTool,
  browserTool,
  // Soul system tools
  updatePreferencesTool,
  newSessionTool,
  // Heartbeat control
  heartbeatControlTool,
  // Cron management
  cronManageTool,
  cronListTool,
  // Agent delegation (swarm & team patterns)
  delegateToAgentTool,
  handoffToAgentTool,
  // Adaptation system
  triggerAdaptationTool,
];
