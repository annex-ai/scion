// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Event Dispatch
 *
 * Maps Harness events to TUI state updates.
 */

import type { StateManager, Message, PendingToolApproval } from "./state";

/**
 * Harness event types (from harness-manager)
 */
export type HarnessEventType =
  | "agent_start"
  | "agent_end"
  | "message_start"
  | "message_update"
  | "message_end"
  | "tool_start"
  | "tool_end"
  | "tool_approval_required"
  | "om_status"
  | "om_observation_start"
  | "om_observation_end"
  | "om_reflection_start"
  | "om_reflection_end"
  | "mode_changed"
  | "model_changed"
  | "state_changed"
  | "error";

export interface HarnessEvent {
  type: HarnessEventType;
  // biome-ignore lint/suspicious/noExplicitAny: Event data varies by type
  [key: string]: any;
}

/**
 * Create an event dispatcher that updates TUI state based on harness events
 */
export function createEventDispatcher(stateManager: StateManager) {
  return (event: HarnessEvent): void => {
    const state = stateManager.getState();

    switch (event.type) {
      case "agent_start":
        stateManager.setState({ isProcessing: true, error: null });
        break;

      case "agent_end":
        stateManager.setState({ isProcessing: false, currentMessageId: null });
        break;

      case "message_start": {
        const messageId = event.message?.id || crypto.randomUUID();
        stateManager.setState({ currentMessageId: messageId });
        stateManager.addMessage({
          id: messageId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isStreaming: true,
        });
        break;
      }

      case "message_update": {
        const messageId = state.currentMessageId;
        if (messageId) {
          // Handle delta accumulation
          let deltaContent = "";
          if (event.delta) {
            deltaContent = event.delta;
          } else if (event.message?.content) {
            // Extract text from content
            const content = event.message.content;
            if (typeof content === "string") {
              deltaContent = content;
            } else if (Array.isArray(content)) {
              deltaContent = content
                .filter((part: { type: string }) => part.type === "text")
                .map((part: { text: string }) => part.text)
                .join("");
            }
          }

          if (deltaContent) {
            stateManager.appendToBuffer(messageId, deltaContent);
            const fullContent = stateManager.getBuffer(messageId);
            stateManager.updateMessage(messageId, { content: fullContent });
          }
        }
        break;
      }

      case "message_end": {
        const messageId = state.currentMessageId;
        if (messageId) {
          const finalContent = stateManager.getBuffer(messageId);
          stateManager.updateMessage(messageId, {
            content: finalContent,
            isStreaming: false,
          });
          stateManager.clearBuffer(messageId);
        }
        break;
      }

      case "tool_start":
        stateManager.addMessage({
          id: event.toolCallId || crypto.randomUUID(),
          role: "tool",
          content: `Running: ${event.toolName}`,
          timestamp: new Date(),
          toolName: event.toolName,
          toolArgs: event.args,
        });
        break;

      case "tool_end":
        // Update tool message with result
        if (event.toolCallId) {
          stateManager.updateMessage(event.toolCallId, {
            content: `Completed: ${event.toolName}`,
          });
        }
        break;

      case "tool_approval_required":
        stateManager.setPendingApproval({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          category: event.category || "mcp",
          args: event.args || {},
        });
        break;

      case "om_status":
        stateManager.setState({
          omStatus: {
            state: event.status || "idle",
            progress: event.progress,
          },
        });
        break;

      case "om_observation_start":
        stateManager.setState({
          omStatus: { state: "observing", progress: "Observing context..." },
        });
        break;

      case "om_observation_end":
        stateManager.setState({
          omStatus: { state: "idle" },
        });
        break;

      case "om_reflection_start":
        stateManager.setState({
          omStatus: { state: "reflecting", progress: "Reflecting on patterns..." },
        });
        break;

      case "om_reflection_end":
        stateManager.setState({
          omStatus: { state: "idle" },
        });
        break;

      case "mode_changed":
        stateManager.setState({ currentModeId: event.modeId });
        break;

      case "model_changed":
        stateManager.setState({ currentModelId: event.modelId });
        break;

      case "state_changed":
        // Update relevant state from harness state
        if (event.state) {
          const updates: Partial<typeof state> = {};
          if (event.state.currentModelId) updates.currentModelId = event.state.currentModelId;
          stateManager.setState(updates);
        }
        break;

      case "error":
        stateManager.setState({
          isProcessing: false,
          error: event.error?.message || "An error occurred",
        });
        break;
    }
  };
}
