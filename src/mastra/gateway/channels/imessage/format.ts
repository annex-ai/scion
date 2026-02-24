// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * iMessage format conversion utilities
 * Uses iMessage REST API (e.g., BlueBubbles or similar)
 */

import type { InboundMessage } from "../types";

/**
 * iMessage message structure (from iMessage REST API)
 */
export interface IMessageMessageEvent {
  guid: string;
  text: string;
  subject?: string;
  handle: {
    id: number;
    address: string;
    country?: string;
    uncanonicalizedId?: string;
  };
  chat: {
    guid: string;
    chatIdentifier: string;
    displayName?: string;
    participants: Array<{
      id: number;
      address: string;
    }>;
    isGroup: boolean;
  };
  dateCreated: number;
  dateRead?: number;
  dateDelivered?: number;
  isFromMe: boolean;
  hasAttachments: boolean;
  attachments?: Array<{
    guid: string;
    mimeType: string;
    filePath: string;
    transferName: string;
  }>;
}

/**
 * Convert iMessage message event to InboundMessage
 */
export function toInboundMessage(message: IMessageMessageEvent, _botAddress?: string): InboundMessage {
  const text = message.text || "";
  const isDM = !message.chat.isGroup;

  // iMessage doesn't have traditional mentions
  const isMention = text.toLowerCase().includes("@bot");

  const cleanedText = text.replace(/@bot/gi, "").trim();

  return {
    id: message.guid,
    text: cleanedText,
    channelType: "imessage",
    channelId: message.chat.guid,
    sender: {
      id: String(message.handle.id),
      name: message.handle.uncanonicalizedId,
      username: message.handle.address,
    },
    timestamp: new Date(message.dateCreated),
    isDM,
    isMention,
    raw: message,
  };
}

/**
 * Convert Mastra response to iMessage format
 * iMessage has very limited formatting - mostly plain text
 */
export function toIMessageFormat(text: string): string {
  return (
    text
      // Remove all markdown formatting - iMessage doesn't support it
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, ""))
      // Links: [text](url) -> text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      // Headers: # Header -> Header
      .replace(/^#{1,6}\s+(.+)$/gm, "$1")
  );
}

/**
 * Chunk text for iMessage (keep messages reasonable length)
 */
export function chunkForIMessage(text: string, maxLength = 5000): string[] {
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
