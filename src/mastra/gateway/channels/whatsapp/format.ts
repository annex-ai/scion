// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * WhatsApp message format conversion utilities
 * Uses WhatsApp Web via Baileys or similar library
 */

import type { InboundMessage } from "../types";

/**
 * WhatsApp message structure
 */
export interface WhatsAppMessageEvent {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  };
  messageTimestamp: number;
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text: string;
      contextInfo?: {
        quotedMessage?: {
          conversation?: string;
        };
        stanzaId?: string;
        participant?: string;
      };
    };
    imageMessage?: {
      caption?: string;
      mimetype?: string;
    };
    videoMessage?: {
      caption?: string;
      mimetype?: string;
    };
    audioMessage?: {
      mimetype?: string;
      seconds?: number;
      ptt?: boolean;
    };
    documentMessage?: {
      caption?: string;
      mimetype?: string;
      fileName?: string;
    };
  };
}

/**
 * Extract text from WhatsApp message
 */
function extractText(message: WhatsAppMessageEvent["message"]): string {
  if (!message) return "";
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ""
  );
}

/**
 * Check if JID is a group
 */
function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

/**
 * Extract phone number from JID
 */
function extractPhoneFromJid(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

/**
 * Convert WhatsApp message event to InboundMessage
 */
export function toInboundMessage(event: WhatsAppMessageEvent, botNumber?: string): InboundMessage {
  const text = extractText(event.message);
  const isDM = !isGroupJid(event.key.remoteJid);

  // WhatsApp doesn't have traditional mentions, check for @mention pattern
  const isMention = botNumber ? text.includes(`@${botNumber}`) || text.toLowerCase().includes("@bot") : false;

  const cleanedText = botNumber ? text.replace(new RegExp(`@${botNumber}`, "g"), "").trim() : text;

  // Determine sender ID
  const senderId = event.key.participant || event.key.remoteJid;

  return {
    id: event.key.id,
    text: cleanedText,
    channelType: "whatsapp",
    channelId: event.key.remoteJid,
    threadId: event.message?.extendedTextMessage?.contextInfo?.stanzaId,
    sender: {
      id: extractPhoneFromJid(senderId),
      name: event.pushName,
      username: extractPhoneFromJid(senderId),
    },
    timestamp: new Date(event.messageTimestamp * 1000),
    isDM,
    isMention,
    raw: event,
  };
}

/**
 * Convert Mastra response to WhatsApp format
 * WhatsApp supports limited formatting
 */
export function toWhatsAppFormat(text: string): string {
  return (
    text
      // Bold: **text** -> *text*
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      // Italic: _text_ stays the same
      // Strikethrough: ~~text~~ -> ~text~
      .replace(/~~(.+?)~~/g, "~$1~")
      // Code: `code` -> ```code```
      .replace(/`([^`]+)`/g, "```$1```")
      // Links: [text](url) -> text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      // Headers: # Header -> *Header*
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
  );
}

/**
 * Chunk text for WhatsApp (no hard limit, but keep reasonable)
 */
export function chunkForWhatsApp(text: string, maxLength = 4000): string[] {
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
