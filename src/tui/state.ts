// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TUI State Management
 *
 * Manages TUI-specific state separate from harness state.
 */

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface OMStatus {
  state: "idle" | "observing" | "reflecting" | "buffering" | "active" | "error";
  progress?: string;
}

export interface PendingToolApproval {
  toolCallId: string;
  toolName: string;
  category: string;
  args: Record<string, unknown>;
}

export interface PendingQuestion {
  questionId: string;
  question: string;
  options?: string[];
}

export interface PendingPlanApproval {
  planId: string;
  plan: string;
  summary?: string;
}

export interface TUIState {
  // Connection
  connected: boolean;
  error: string | null;

  // Processing
  isProcessing: boolean;
  currentMessageId: string | null;

  // Messages
  messages: Message[];
  messageBuffer: Map<string, string>;

  // Mode & Model
  currentModeId: string;
  currentModelId: string;
  currentThreadId: string | null;

  // OM Status
  omStatus: OMStatus;

  // Tool Approval
  pendingApproval: PendingToolApproval | null;

  // Question from agent (ask_user built-in tool)
  pendingQuestion: PendingQuestion | null;

  // Plan approval (submit_plan built-in tool)
  pendingPlan: PendingPlanApproval | null;

  // UI
  showHelp: boolean;
}

export function createInitialState(): TUIState {
  return {
    connected: false,
    error: null,
    isProcessing: false,
    currentMessageId: null,
    messages: [],
    messageBuffer: new Map(),
    currentModeId: "default",
    currentModelId: "",
    currentThreadId: null,
    omStatus: { state: "idle" },
    pendingApproval: null,
    pendingQuestion: null,
    pendingPlan: null,
    showHelp: false,
  };
}

export class StateManager {
  private state: TUIState;
  private listeners: Set<(state: TUIState) => void> = new Set();

  constructor() {
    this.state = createInitialState();
  }

  getState(): TUIState {
    return this.state;
  }

  setState(partial: Partial<TUIState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  subscribe(listener: (state: TUIState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  // Message management
  addMessage(message: Message): void {
    this.state.messages.push(message);
    this.notify();
  }

  updateMessage(id: string, update: Partial<Message>): void {
    const idx = this.state.messages.findIndex((m) => m.id === id);
    if (idx !== -1) {
      this.state.messages[idx] = { ...this.state.messages[idx], ...update };
      this.notify();
    }
  }

  clearMessages(): void {
    this.state.messages = [];
    this.notify();
  }

  // Buffer management for streaming
  appendToBuffer(messageId: string, delta: string): void {
    const current = this.state.messageBuffer.get(messageId) || "";
    this.state.messageBuffer.set(messageId, current + delta);
    this.notify();
  }

  getBuffer(messageId: string): string {
    return this.state.messageBuffer.get(messageId) || "";
  }

  clearBuffer(messageId: string): void {
    this.state.messageBuffer.delete(messageId);
  }

  // Tool approval
  setPendingApproval(approval: PendingToolApproval | null): void {
    this.state.pendingApproval = approval;
    this.notify();
  }
}
