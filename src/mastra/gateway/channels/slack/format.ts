// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Slack message format conversion utilities
 */

import type { InboundMessage } from "../types";

/**
 * Slack file attachment structure
 * See: https://api.slack.com/types/file
 */
export interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  /** Private URL (may be a preview/thumbnail for some file types) */
  url_private?: string;
  /** Direct download URL */
  url_private_download?: string;
  mode?: string;
  /** Audio/video duration in seconds (for voice messages) */
  duration_ms?: number;
  /** Subtype like 'slack_audio' for voice messages */
  subtype?: string;
  /** Media display type */
  media_display_type?: string;
  /** Audio/video specific URLs */
  mp4?: string;
  vtt?: string;
  hls?: string;
  hls_embed?: string;
  /** Transcription (if Slack already transcribed it) */
  transcription?: {
    status: string;
    locale?: string;
  };
  /** For audio clips - the actual audio URL */
  aac?: string;
  audio_wave_samples?: number[];
}

/**
 * Slack message event structure (simplified)
 */
export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  text?: string;
  user?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  channel_type?: string;
  bot_id?: string;
  /** File attachments */
  files?: SlackFile[];
}

/**
 * Slack user info (from users.info API)
 */
export interface SlackUserInfo {
  id: string;
  name?: string;
  real_name?: string;
}

/**
 * Convert Slack message event to InboundMessage
 */
export function toInboundMessage(
  event: SlackMessageEvent,
  userInfo?: SlackUserInfo,
  botUserId?: string,
): InboundMessage {
  const text = event.text || "";
  const isDM = event.channel_type === "im";
  const isMention = botUserId ? text.includes(`<@${botUserId}>`) : false;

  // Remove bot mention from text for cleaner processing
  const cleanedText = botUserId ? text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim() : text;

  return {
    id: event.ts,
    text: cleanedText,
    channelType: "slack",
    channelId: event.channel,
    threadId: event.thread_ts,
    sender: {
      id: event.user || "unknown",
      name: userInfo?.real_name,
      username: userInfo?.name,
    },
    timestamp: new Date(Number.parseFloat(event.ts) * 1000),
    isDM,
    isMention,
    raw: event,
  };
}

/**
 * Convert Mastra response to Slack-compatible format
 */
export function toSlackFormat(text: string): string {
  // Convert standard markdown to Slack markdown (mrkdwn)
  return (
    text
      // Bold: **text** -> *text*
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      // Italic: _text_ stays the same in Slack
      // Code blocks: ```lang\ncode``` stays the same
      // Inline code: `code` stays the same
      // Links: [text](url) -> <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
      // Headers: # Header -> *Header*
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
  );
}

/**
 * Convert Slack mrkdwn to standard markdown
 */
export function fromSlackFormat(text: string): string {
  return (
    text
      // Bold: *text* -> **text** (but not *text* that's italic)
      // This is tricky - Slack uses * for bold, markdown uses ** for bold
      // For simplicity, we'll leave it as-is since Mastra can handle both
      // Links: <url|text> -> [text](url)
      .replace(/<([^|>]+)\|([^>]+)>/g, "[$2]($1)")
      // Plain links: <url> -> url
      .replace(/<([^|>]+)>/g, "$1")
      // User mentions: <@USER_ID> -> @USER_ID
      .replace(/<@([A-Z0-9]+)>/g, "@$1")
      // Channel mentions: <#CHANNEL_ID|name> -> #name
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
  );
}

/**
 * Chunk text for Slack's 4000 character limit
 */
export function chunkForSlack(text: string, maxLength = 3900): string[] {
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
