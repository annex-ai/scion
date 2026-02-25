// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * WhatsApp channel adapter using Baileys (WhatsApp Web)
 *
 * Note: This adapter requires @whiskeysockets/baileys to be installed.
 * WhatsApp Web connection requires QR code scanning on first use.
 */

import { readFile } from "node:fs/promises";
import baileys from "@whiskeysockets/baileys";
import { logger } from "../../logger";
import { saveMediaBuffer } from "../media";
import type {
  ChannelAdapter,
  InboundAttachment,
  InboundMessage,
  OutboundMessage,
  WhatsAppChannelConfig,
} from "../types";
import { chunkForWhatsApp, toInboundMessage, toWhatsAppFormat, type WhatsAppMessageEvent } from "./format";

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = baileys as any;

type WASocket = any;

/**
 * WhatsApp channel adapter
 * Connects to WhatsApp via WhatsApp Web (Baileys)
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = "whatsapp";
  readonly name = "WhatsApp";

  private config: WhatsAppChannelConfig;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private _isConnected = false;
  private socket: WASocket | null = null;
  private botNumber: string | null = null;

  // Baileys modules loaded dynamically
  private downloadMediaMessage: any = null;

  constructor(config: WhatsAppChannelConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to WhatsApp via Baileys
   */
  async connect(): Promise<void> {
    this.downloadMediaMessage = downloadMediaMessage;

    const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionPath);

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });

    this.socket.ev.on("creds.update", saveCreds);

    this.socket.ev.on("connection.update", (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info({ channel: "whatsapp" }, "Scan QR code to connect");
      }

      if (connection === "close") {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.info({ channel: "whatsapp", shouldReconnect }, "Connection closed");

        if (shouldReconnect) {
          this.connect();
        } else {
          this._isConnected = false;
        }
      } else if (connection === "open") {
        this._isConnected = true;
        this.botNumber = this.socket?.user?.id?.split(":")[0] || null;
        logger.info({ channel: "whatsapp", botNumber: this.botNumber }, "Connected");
      }
    });

    this.socket.ev.on("messages.upsert", async (m: any) => {
      const message = m.messages[0];
      if (!message || message.key.fromMe) return;

      await this.handleMessage(message);
    });
  }

  /**
   * Disconnect from WhatsApp
   * Uses end() instead of logout() to preserve the linked device session
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this._isConnected = false;
    logger.info({ channel: "whatsapp" }, "Disconnected");
  }

  /**
   * Send a message to a WhatsApp chat
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.socket) {
      logger.error({ channel: "whatsapp" }, "Not connected");
      return;
    }

    // Send composing indicator
    try {
      await this.socket.sendPresenceUpdate("composing", message.channelId);
    } catch {
      // Non-fatal: composing indicator may fail
    }

    // Send attachments first
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        try {
          let content: Buffer | undefined;

          if (attachment.content) {
            content = attachment.content;
          } else if (attachment.path) {
            content = await readFile(attachment.path);
          } else if (attachment.url) {
            const resp = await fetch(attachment.url);
            content = Buffer.from(await resp.arrayBuffer());
          }

          if (!content) continue;

          const mime = attachment.mimeType || "application/octet-stream";
          if (attachment.type === "image") {
            await this.socket.sendMessage(message.channelId, {
              image: content,
              caption: undefined,
              mimetype: mime,
            });
          } else if (attachment.type === "audio") {
            await this.socket.sendMessage(message.channelId, {
              audio: content,
              mimetype: mime,
              ptt: attachment.asVoice ?? false,
            });
          } else if (attachment.type === "video") {
            await this.socket.sendMessage(message.channelId, {
              video: content,
              mimetype: mime,
            });
          } else {
            await this.socket.sendMessage(message.channelId, {
              document: content,
              mimetype: mime,
              fileName: attachment.name || "file",
            });
          }
        } catch (error) {
          logger.error({ channel: "whatsapp", error: String(error) }, "Failed to send attachment");
        }
      }
    }

    // Send text message
    const formattedText = toWhatsAppFormat(message.text);
    const chunks = chunkForWhatsApp(formattedText);

    for (const chunk of chunks) {
      await this.socket.sendMessage(message.channelId, {
        text: chunk,
      });
    }

    // Clear composing indicator
    try {
      await this.socket.sendPresenceUpdate("paused", message.channelId);
    } catch {
      // Non-fatal
    }
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Handle incoming message events
   */
  private async handleMessage(message: WhatsAppMessageEvent): Promise<void> {
    const msg = message.message;
    if (!msg) return;

    // Extract text from various message types
    const text =
      msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || "";

    // Process media attachments
    const attachments: InboundAttachment[] = [];

    if (msg.imageMessage) {
      const saved = await this.downloadAndSave(message, "image", msg.imageMessage.mimetype);
      if (saved) attachments.push(saved);
    } else if (msg.videoMessage) {
      const saved = await this.downloadAndSave(message, "video", msg.videoMessage.mimetype);
      if (saved) attachments.push(saved);
    } else if (msg.audioMessage) {
      const saved = await this.downloadAndSave(message, "audio", msg.audioMessage.mimetype);
      if (saved) attachments.push(saved);
    } else if (msg.documentMessage) {
      const saved = await this.downloadAndSave(
        message,
        "document",
        msg.documentMessage.mimetype,
        msg.documentMessage.fileName,
      );
      if (saved) attachments.push(saved);
    }

    // Skip if no text and no attachments
    if (!text && attachments.length === 0) {
      return;
    }

    // Check allowlist if configured
    if (this.config.allowFrom && this.config.allowFrom.length > 0) {
      const senderJid = message.key.participant || message.key.remoteJid;
      const senderNumber = senderJid.split("@")[0].split(":")[0];

      const isAllowed = this.config.allowFrom.some((allowed) => {
        const normalizedAllowed = allowed.replace(/\D/g, "");
        const normalizedSender = senderNumber.replace(/\D/g, "");
        return (
          normalizedAllowed === normalizedSender ||
          normalizedAllowed.endsWith(normalizedSender) ||
          normalizedSender.endsWith(normalizedAllowed)
        );
      });

      if (!isAllowed) {
        return;
      }
    }

    const inbound = toInboundMessage(message, this.botNumber || undefined);

    // Attach media to the inbound message
    if (attachments.length > 0) {
      inbound.attachments = attachments;
    }

    // In groups, only respond if configured to respond to all
    if (!inbound.isDM && !this.config.respondToAllMessages && !inbound.isMention) {
      return;
    }

    if (this.messageHandler) {
      await this.messageHandler(inbound);
    }
  }

  /**
   * Download media from a WhatsApp message and save to disk
   */
  private async downloadAndSave(
    message: WhatsAppMessageEvent,
    type: "image" | "audio" | "video" | "document",
    mimeType?: string,
    fileName?: string,
  ): Promise<InboundAttachment | null> {
    if (!this.downloadMediaMessage) return null;

    try {
      const buffer = await this.downloadMediaMessage(message, "buffer", {});
      const saved = await saveMediaBuffer(Buffer.from(buffer), {
        direction: "inbound",
        mime: mimeType || undefined,
        originalName: fileName || undefined,
      });

      return {
        type,
        path: saved.path,
        mimeType: saved.mime,
        size: saved.size,
        name: fileName,
      };
    } catch (error) {
      logger.error({ channel: "whatsapp", error: String(error) }, "Failed to download media");
      return null;
    }
  }
}
