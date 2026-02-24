// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Discord message format conversion utilities
 */

import type { InboundMessage } from "../types";

/**
 * Discord message structure (from Discord.js)
 */
export interface DiscordMessageEvent {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    discriminator?: string;
    bot: boolean;
    globalName?: string | null;
  };
  channelId: string;
  guildId?: string | null;
  createdTimestamp: number;
  reference?: {
    messageId?: string;
    channelId?: string;
    guildId?: string;
  } | null;
  mentions?: {
    users: Map<string, { id: string }>;
  };
}

/**
 * Convert Discord message event to InboundMessage
 */
export function toInboundMessage(message: DiscordMessageEvent, botUserId?: string): InboundMessage {
  const text = message.content || "";
  const isDM = !message.guildId;

  // Check for mention
  const isMention = botUserId ? message.mentions?.users.has(botUserId) || text.includes(`<@${botUserId}>`) : false;

  // Remove bot mention from text for cleaner processing
  const cleanedText = botUserId ? text.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim() : text;

  return {
    id: message.id,
    text: cleanedText,
    channelType: "discord",
    channelId: message.channelId,
    threadId: message.reference?.messageId,
    sender: {
      id: message.author.id,
      name: message.author.globalName || message.author.username,
      username: message.author.username,
    },
    timestamp: new Date(message.createdTimestamp),
    isDM,
    isMention,
    raw: message,
  };
}

/**
 * Convert Mastra response (markdown) to Discord format
 * Discord supports most standard markdown, with some extensions
 */
export function toDiscordFormat(text: string): string {
  // Discord supports standard markdown, so minimal conversion needed
  return (
    text
      // Headers: # Header -> **Header** (Discord renders # but not as prominently)
      .replace(/^#{1,6}\s+(.+)$/gm, "**$1**")
  );
}

/**
 * Convert Discord format to standard markdown
 */
export function fromDiscordFormat(text: string): string {
  // Discord markdown is mostly standard, so minimal conversion needed
  return (
    text
      // User mentions: <@USER_ID> -> @USER_ID
      .replace(/<@!?(\d+)>/g, "@$1")
      // Channel mentions: <#CHANNEL_ID> -> #CHANNEL_ID
      .replace(/<#(\d+)>/g, "#$1")
      // Role mentions: <@&ROLE_ID> -> @ROLE_ID
      .replace(/<@&(\d+)>/g, "@$1")
      // Custom emojis: <:name:id> -> :name:
      .replace(/<:(\w+):\d+>/g, ":$1:")
      // Animated emojis: <a:name:id> -> :name:
      .replace(/<a:(\w+):\d+>/g, ":$1:")
  );
}

/**
 * Chunk text for Discord's 2000 character limit
 */
export function chunkForDiscord(text: string, maxLength = 1900): string[] {
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

    // Try to break at a code block boundary
    const codeBlockEnd = remaining.lastIndexOf("```", maxLength);
    if (codeBlockEnd > maxLength / 2) {
      // Find the end of the code block
      const nextCodeBlock = remaining.indexOf("```", codeBlockEnd + 3);
      if (nextCodeBlock !== -1 && nextCodeBlock < maxLength) {
        const breakPoint = nextCodeBlock + 3;
        chunks.push(remaining.slice(0, breakPoint));
        remaining = remaining.slice(breakPoint).trimStart();
        continue;
      }
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
