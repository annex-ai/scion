// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Google Chat message format conversion utilities
 * Uses Google Chat API
 */

import type { InboundMessage } from "../types";

/**
 * Google Chat message structure (from Google Chat API)
 */
export interface GoogleChatMessageEvent {
  type: string;
  eventTime: string;
  message?: {
    name: string;
    sender: {
      name: string;
      displayName: string;
      avatarUrl?: string;
      email?: string;
      type: "HUMAN" | "BOT";
    };
    createTime: string;
    text: string;
    thread?: {
      name: string;
      retentionSettings?: {
        state: string;
      };
    };
    space: {
      name: string;
      type: "ROOM" | "DM" | "SPACE";
      displayName?: string;
    };
    argumentText?: string;
    annotations?: Array<{
      type: string;
      startIndex: number;
      length: number;
      userMention?: {
        user: {
          name: string;
          displayName: string;
          type: string;
        };
        type: string;
      };
    }>;
  };
  user?: {
    name: string;
    displayName: string;
    email?: string;
    type: "HUMAN" | "BOT";
  };
  space?: {
    name: string;
    type: "ROOM" | "DM" | "SPACE";
    displayName?: string;
  };
  configCompleteRedirectUrl?: string;
}

/**
 * Convert Google Chat message event to InboundMessage
 */
export function toInboundMessage(event: GoogleChatMessageEvent, botUserId?: string): InboundMessage {
  const message = event.message;
  if (!message) {
    throw new Error("No message in event");
  }

  const text = message.argumentText || message.text || "";
  const isDM = message.space.type === "DM";

  // Check for bot mention in annotations
  const isMention = botUserId
    ? message.annotations?.some((a) => a.type === "USER_MENTION" && a.userMention?.user.name === botUserId) || false
    : false;

  // argumentText already has mentions stripped
  const cleanedText = message.argumentText || text;

  return {
    id: message.name,
    text: cleanedText,
    channelType: "googlechat",
    channelId: message.space.name,
    threadId: message.thread?.name,
    sender: {
      id: message.sender.name,
      name: message.sender.displayName,
      username: message.sender.email,
    },
    timestamp: new Date(message.createTime),
    isDM,
    isMention,
    raw: event,
  };
}

/**
 * Convert Mastra response to Google Chat format
 * Google Chat uses a card-based format but also supports simple text
 */
export function toGoogleChatFormat(text: string): string {
  // Google Chat supports limited markdown
  return (
    text
      // Bold: **text** -> *text*
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      // Italic: _text_ stays the same
      // Strikethrough: ~~text~~ -> ~text~
      .replace(/~~(.+?)~~/g, "~$1~")
      // Code: `code` stays the same
      // Links: [text](url) -> <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
      // Headers: # Header -> *Header*
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
  );
}

/**
 * Chunk text for Google Chat (4096 character limit)
 */
export function chunkForGoogleChat(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let breakPoint = remaining.lastIndexOf("\n\n", maxLength);
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf("\n", maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(" ", maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}
