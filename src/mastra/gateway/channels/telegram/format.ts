// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Telegram message format conversion utilities
 */

import type { InboundMessage } from "../types";

/**
 * Telegram message structure (from Grammy/Bot API)
 */
export interface TelegramMessageEvent {
  message_id: number;
  text?: string;
  caption?: string;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    username?: string;
  };
  date: number;
  message_thread_id?: number;
  reply_to_message?: TelegramMessageEvent;
}

/**
 * Convert Telegram message event to InboundMessage
 */
export function toInboundMessage(message: TelegramMessageEvent, botUsername?: string): InboundMessage {
  const text = message.text || message.caption || "";
  const isDM = message.chat.type === "private";

  // Check for mention - Telegram mentions are @username in text
  const isMention = botUsername ? text.toLowerCase().includes(`@${botUsername.toLowerCase()}`) : false;

  // Remove bot mention from text for cleaner processing
  const cleanedText = botUsername ? text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim() : text;

  return {
    id: String(message.message_id),
    text: cleanedText,
    channelType: "telegram",
    channelId: String(message.chat.id),
    threadId: message.message_thread_id ? String(message.message_thread_id) : undefined,
    sender: {
      id: String(message.from?.id || "unknown"),
      name: message.from ? [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") : undefined,
      username: message.from?.username,
    },
    timestamp: new Date(message.date * 1000),
    isDM,
    isMention,
    raw: message,
  };
}

/**
 * Escape HTML special characters for Telegram HTML parse mode
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert Mastra response (markdown) to Telegram HTML format
 */
export function toTelegramFormat(text: string): string {
  // Convert markdown to Telegram HTML
  return (
    text
      // Bold: **text** -> <b>text</b>
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      // Italic: _text_ or *text* -> <i>text</i>
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>")
      .replace(/_(.+?)_/g, "<i>$1</i>")
      // Strikethrough: ~~text~~ -> <s>text</s>
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      // Code blocks: ```lang\ncode``` -> <pre><code>code</code></pre>
      .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      // Inline code: `code` -> <code>code</code>
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Links: [text](url) -> <a href="url">text</a>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Headers: # Header -> <b>Header</b>
      .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
  );
}

/**
 * Convert Telegram HTML to markdown (for processing)
 */
export function fromTelegramFormat(text: string): string {
  return (
    text
      // Bold: <b>text</b> -> **text**
      .replace(/<b>(.+?)<\/b>/gi, "**$1**")
      // Italic: <i>text</i> -> _text_
      .replace(/<i>(.+?)<\/i>/gi, "_$1_")
      // Strikethrough: <s>text</s> -> ~~text~~
      .replace(/<s>(.+?)<\/s>/gi, "~~$1~~")
      // Code: <code>text</code> -> `text`
      .replace(/<code>(.+?)<\/code>/gi, "`$1`")
      // Pre: <pre>text</pre> -> ```text```
      .replace(/<pre>(.+?)<\/pre>/gi, "```$1```")
      // Links: <a href="url">text</a> -> [text](url)
      .replace(/<a href="([^"]+)">(.+?)<\/a>/gi, "[$2]($1)")
  );
}

/**
 * Chunk text for Telegram's 4096 character limit
 */
export function chunkForTelegram(text: string, maxLength = 4000): string[] {
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

    // Try to break at a paragraph
    let breakPoint = remaining.lastIndexOf("\n\n", maxLength);
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      // Try to break at a newline
      breakPoint = remaining.lastIndexOf("\n", maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      // Try to break at a space
      breakPoint = remaining.lastIndexOf(" ", maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      // Force break
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}
