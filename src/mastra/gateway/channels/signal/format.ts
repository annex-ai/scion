// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Signal message format conversion utilities
 * Uses signal-cli REST API
 */

import type { InboundMessage } from "../types";

/**
 * Signal message structure (from signal-cli REST API)
 */
export interface SignalMessageEvent {
  envelope: {
    source: string;
    sourceNumber?: string;
    sourceName?: string;
    sourceUuid?: string;
    timestamp: number;
    dataMessage?: {
      timestamp: number;
      message: string;
      groupInfo?: {
        groupId: string;
        type: string;
      };
      quote?: {
        id: number;
        author: string;
        text: string;
      };
    };
  };
  account: string;
}

/**
 * Convert Signal message event to InboundMessage
 */
export function toInboundMessage(event: SignalMessageEvent, botNumber?: string): InboundMessage {
  const dataMessage = event.envelope.dataMessage;
  const text = dataMessage?.message || "";
  const isDM = !dataMessage?.groupInfo;

  // Signal doesn't have traditional @mentions, check if message starts with bot number
  const isMention = botNumber ? text.includes(botNumber) || text.toLowerCase().includes("@bot") : false;

  // Clean the text
  const cleanedText = botNumber ? text.replace(new RegExp(botNumber.replace(/[+]/g, "\\+"), "g"), "").trim() : text;

  return {
    id: String(event.envelope.timestamp),
    text: cleanedText,
    channelType: "signal",
    channelId: dataMessage?.groupInfo?.groupId || event.envelope.source,
    threadId: dataMessage?.quote ? String(dataMessage.quote.id) : undefined,
    sender: {
      id: event.envelope.sourceUuid || event.envelope.source,
      name: event.envelope.sourceName,
      username: event.envelope.sourceNumber,
    },
    timestamp: new Date(event.envelope.timestamp),
    isDM,
    isMention,
    raw: event,
  };
}

/**
 * Convert Mastra response to Signal format
 * Signal supports basic markdown
 */
export function toSignalFormat(text: string): string {
  // Signal supports limited formatting, keep it simple
  return (
    text
      // Remove HTML-style formatting
      .replace(/<[^>]+>/g, "")
      // Keep markdown links as text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
  );
}

/**
 * Chunk text for Signal (no hard limit, but keep reasonable)
 */
export function chunkForSignal(text: string, maxLength = 4000): string[] {
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
