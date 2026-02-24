// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Telegram channel adapter using Grammy (Bot API)
 */

import { Bot, type Context, InputFile } from "grammy";
import {
  detectMime,
  downloadAndSaveMedia,
  getMediaKind,
  isVoiceCompatibleAudio,
  readMediaFile,
  saveMediaBuffer,
} from "../media";
import type {
  ChannelAdapter,
  InboundAttachment,
  InboundMessage,
  OutboundAttachment,
  OutboundMessage,
  TelegramChannelConfig,
} from "../types";
import { chunkForTelegram, type TelegramMessageEvent, toInboundMessage, toTelegramFormat } from "./format";

/**
 * Telegram channel adapter
 * Connects to Telegram via Bot API (long polling) and routes messages
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly type = "telegram";
  readonly name = "Telegram";

  private bot: Bot;
  private config: TelegramChannelConfig;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private _isConnected = false;
  private botUsername: string | null = null;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
    this.bot = new Bot(config.token);
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to Telegram via long polling
   */
  async connect(): Promise<void> {
    // Get bot info for mention detection
    const me = await this.bot.api.getMe();
    this.botUsername = me.username;
    console.log(`Telegram bot connected as @${this.botUsername} (${me.id})`);

    // Handle all messages (text, captions, media, etc.)
    this.bot.on("message", async (ctx) => {
      await this.handleMessage(ctx);
    });

    // Handle edited messages if configured
    if (this.config.handleEditedMessages) {
      this.bot.on("edited_message", async (ctx) => {
        await this.handleMessage(ctx);
      });
    }

    // Start long polling
    this.bot.start({
      drop_pending_updates: this.config.dropPendingUpdates ?? true,
      allowed_updates: ["message", "edited_message"],
    });

    this._isConnected = true;
    console.log("Telegram adapter connected (long polling)");
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect(): Promise<void> {
    await this.bot.stop();
    this._isConnected = false;
    console.log("Telegram adapter disconnected");
  }

  /**
   * Send a message to a Telegram chat
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    const chatId = message.channelId;

    // Send attachments first
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        await this.sendAttachment(chatId, attachment);
      }
    }

    // Send text message if present
    if (message.text?.trim()) {
      const formattedText = toTelegramFormat(message.text);
      const chunks = chunkForTelegram(formattedText);

      for (const chunk of chunks) {
        await this.bot.api.sendMessage(chatId, chunk, {
          parse_mode: "HTML",
        });
      }
    }
  }

  /**
   * Send a media attachment
   */
  private async sendAttachment(chatId: string, attachment: OutboundAttachment): Promise<void> {
    let file: InputFile;
    let mimeType = attachment.mimeType;

    // Get file content
    if (attachment.content) {
      file = new InputFile(attachment.content, attachment.name);
      if (!mimeType) {
        mimeType = await detectMime({ buffer: attachment.content, filePath: attachment.name });
      }
    } else if (attachment.path) {
      const buffer = await readMediaFile(attachment.path);
      file = new InputFile(buffer, attachment.name || attachment.path.split("/").pop());
      if (!mimeType) {
        mimeType = await detectMime({ buffer, filePath: attachment.path });
      }
    } else if (attachment.url) {
      // Download and send
      const media = await downloadAndSaveMedia(attachment.url, { direction: "outbound" });
      const buffer = await readMediaFile(media.path);
      file = new InputFile(buffer, attachment.name || media.originalName);
      mimeType = media.mime;
    } else {
      console.warn("Attachment has no content, path, or URL");
      return;
    }

    // Send based on type
    const kind = attachment.type || getMediaKind(mimeType || "application/octet-stream");

    if (kind === "image") {
      await this.bot.api.sendPhoto(chatId, file);
    } else if (kind === "audio") {
      // Check if should send as voice
      const useVoice =
        attachment.asVoice &&
        isVoiceCompatibleAudio({
          contentType: mimeType,
          fileName: attachment.name,
        });

      if (useVoice) {
        await this.bot.api.sendVoice(chatId, file);
      } else {
        await this.bot.api.sendAudio(chatId, file);
      }
    } else if (kind === "video") {
      await this.bot.api.sendVideo(chatId, file);
    } else {
      await this.bot.api.sendDocument(chatId, file);
    }
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Download a file from Telegram
   */
  private async downloadFile(fileId: string): Promise<InboundAttachment | null> {
    try {
      const file = await this.bot.api.getFile(fileId);
      if (!file.file_path) {
        console.warn("Telegram file has no file_path:", fileId);
        return null;
      }

      const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error("Failed to download Telegram file:", response.status);
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type");

      const saved = await saveMediaBuffer(buffer, {
        mime: contentType || undefined,
        originalName: file.file_path.split("/").pop(),
        direction: "inbound",
      });

      return {
        type: saved.kind,
        path: saved.path,
        mimeType: saved.mime,
        name: saved.originalName,
        size: saved.size,
      };
    } catch (error) {
      console.error("Error downloading Telegram file:", error);
      return null;
    }
  }

  /**
   * Extract attachments from a Telegram message
   */
  private async extractAttachments(msg: any): Promise<InboundAttachment[]> {
    const attachments: InboundAttachment[] = [];

    // Photo (array of sizes, get largest)
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      const attachment = await this.downloadFile(largest.file_id);
      if (attachment) {
        attachment.width = largest.width;
        attachment.height = largest.height;
        attachments.push(attachment);
      }
    }

    // Voice message
    if (msg.voice) {
      const attachment = await this.downloadFile(msg.voice.file_id);
      if (attachment) {
        attachment.type = "audio";
        attachment.duration = msg.voice.duration;
        attachments.push(attachment);
      }
    }

    // Audio file
    if (msg.audio) {
      const attachment = await this.downloadFile(msg.audio.file_id);
      if (attachment) {
        attachment.type = "audio";
        attachment.duration = msg.audio.duration;
        attachment.name = msg.audio.file_name || attachment.name;
        attachments.push(attachment);
      }
    }

    // Video
    if (msg.video) {
      const attachment = await this.downloadFile(msg.video.file_id);
      if (attachment) {
        attachment.type = "video";
        attachment.duration = msg.video.duration;
        attachment.width = msg.video.width;
        attachment.height = msg.video.height;
        attachments.push(attachment);
      }
    }

    // Video note (round video)
    if (msg.video_note) {
      const attachment = await this.downloadFile(msg.video_note.file_id);
      if (attachment) {
        attachment.type = "video";
        attachment.duration = msg.video_note.duration;
        attachments.push(attachment);
      }
    }

    // Document (generic file)
    if (msg.document) {
      const attachment = await this.downloadFile(msg.document.file_id);
      if (attachment) {
        attachment.name = msg.document.file_name || attachment.name;
        attachments.push(attachment);
      }
    }

    // Sticker (as image)
    if (msg.sticker) {
      const attachment = await this.downloadFile(msg.sticker.file_id);
      if (attachment) {
        attachment.type = "image";
        attachment.width = msg.sticker.width;
        attachment.height = msg.sticker.height;
        attachments.push(attachment);
      }
    }

    return attachments;
  }

  /**
   * Handle incoming message events
   */
  private async handleMessage(ctx: Context): Promise<void> {
    const msg = ctx.message || ctx.editedMessage;
    if (!msg) return;

    // Ignore bot messages
    if (msg.from?.is_bot) {
      return;
    }

    // Get text content (text or caption for media messages)
    const text = msg.text || msg.caption || "";

    // Check if we have content (text or media)
    const hasMedia = msg.photo || msg.voice || msg.audio || msg.video || msg.video_note || msg.document || msg.sticker;

    if (!text && !hasMedia) {
      return;
    }

    // Build message event
    const messageEvent: TelegramMessageEvent = {
      message_id: msg.message_id,
      text: msg.text,
      caption: msg.caption,
      from: msg.from
        ? {
            id: msg.from.id,
            is_bot: msg.from.is_bot,
            first_name: msg.from.first_name,
            last_name: msg.from.last_name,
            username: msg.from.username,
          }
        : undefined,
      chat: {
        id: msg.chat.id,
        type: msg.chat.type as "private" | "group" | "supergroup" | "channel",
        title: "title" in msg.chat ? msg.chat.title : undefined,
        username: "username" in msg.chat ? msg.chat.username : undefined,
      },
      date: msg.date,
      message_thread_id: msg.message_thread_id,
    };

    // Check message policy
    const isDM = messageEvent.chat.type === "private";
    const isMention =
      this.botUsername && text ? text.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`) : false;

    // In groups, only respond to mentions unless configured otherwise
    if (!isDM && !this.config.respondToAllMessages && !isMention) {
      return;
    }

    // Check allowlist if configured
    if (this.config.allowFrom && this.config.allowFrom.length > 0) {
      const senderId = msg.from?.id;
      const senderUsername = msg.from?.username?.toLowerCase();

      const isAllowed = this.config.allowFrom.some((allowed) => {
        if (typeof allowed === "number") {
          return allowed === senderId;
        }
        if (typeof allowed === "string") {
          const normalized = allowed.toLowerCase().replace(/^@/, "");
          return normalized === senderUsername;
        }
        return false;
      });

      if (!isAllowed) {
        console.warn(
          JSON.stringify({
            component: "gateway",
            level: "warn",
            message: "Blocked: user not in allowlist",
            senderId,
            senderUsername,
            channel: "telegram",
          }),
        );
        return;
      }
    }

    // Convert to inbound message
    const inbound = toInboundMessage(messageEvent, this.botUsername || undefined);

    // Extract and attach media
    if (hasMedia) {
      const attachments = await this.extractAttachments(msg);
      if (attachments.length > 0) {
        inbound.attachments = attachments;
      }
    }

    if (this.messageHandler) {
      await this.messageHandler(inbound);
    }
  }
}
