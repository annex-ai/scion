// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TUI Entry Point
 *
 * Exports the AgentTUI class and launches when run directly.
 */

export { AgentTUI } from "./app";
export { StateManager, createInitialState } from "./state";
export type { TUIState, Message, OMStatus, PendingToolApproval } from "./state";
export { createEventDispatcher } from "./event-dispatch";
export type { HarnessEvent, HarnessEventType } from "./event-dispatch";

// Components
export { StatusLine } from "./components/status-line";
export { MessagesDisplay } from "./components/messages";
export { ToolApprovalDialog } from "./components/tool-approval";
export { SimpleLoader } from "./components/loader";

// Theme
export * from "./theme";
