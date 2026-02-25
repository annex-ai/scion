// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Google Chat channel adapter using Google Chat API
 *
 * Note: This adapter requires googleapis to be installed.
 * Requires a Google Cloud project with Chat API enabled and service account credentials.
 */

import { readFile } from "node:fs/promises";
import { google } from "googleapis";
import { logger } from "../../logger";
import type { ChannelAdapter, GoogleChatChannelConfig, InboundMessage, OutboundMessage } from "../types";
import { chunkForGoogleChat, type GoogleChatMessageEvent, toGoogleChatFormat, toInboundMessage } from "./format";

/**
 * Google Chat channel adapter
 * Connects to Google Chat via HTTP webhook (for receiving) and API (for sending)
 */
export class GoogleChatAdapter implements ChannelAdapter {
  readonly type = "googlechat";
  readonly name = "Google Chat";

  private config: GoogleChatChannelConfig;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private _isConnected = false;
  private botUserId: string | null = null;
  private chatClient: any = null;

  constructor(config: GoogleChatChannelConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to Google Chat API
   * Note: Google Chat uses HTTP webhooks for receiving messages,
   * so this mainly initializes the sending capability
   */
  async connect(): Promise<void> {
    // Parse credentials
    let credentials: any;
    try {
      if (this.config.credentials.startsWith("{")) {
        credentials = JSON.parse(this.config.credentials);
      } else {
        const content = await readFile(this.config.credentials, "utf-8");
        credentials = JSON.parse(content);
      }
    } catch (error) {
      throw new Error(`Failed to load Google Chat credentials: ${error}`);
    }

    // Create auth client
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    });

    this.chatClient = google.chat({
      version: "v1",
      auth,
    });

    this._isConnected = true;
    logger.info({ channel: "googlechat" }, "Connected");
  }

  /**
   * Disconnect from Google Chat
   */
  async disconnect(): Promise<void> {
    this.chatClient = null;
    this._isConnected = false;
    logger.info({ channel: "googlechat" }, "Disconnected");
  }

  /**
   * Send a message to a Google Chat space
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.chatClient) {
      logger.error({ channel: "googlechat" }, "Not connected");
      return;
    }

    const formattedText = toGoogleChatFormat(message.text);
    const chunks = chunkForGoogleChat(formattedText);

    for (const chunk of chunks) {
      const requestBody: any = {
        text: chunk,
      };

      // If threadId is provided, reply in that thread
      if (message.threadId) {
        requestBody.thread = {
          name: message.threadId,
        };
      }

      try {
        await this.chatClient.spaces.messages.create({
          parent: message.channelId,
          requestBody,
          messageReplyOption: message.threadId ? "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : undefined,
        });
      } catch (error) {
        logger.error({ channel: "googlechat", error: String(error) }, "Failed to send message");
      }
    }

    // Send attachments via media upload
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

          if (content) {
            // Google Chat media upload via spaces.messages.create with media
            await this.chatClient.spaces.messages.create({
              parent: message.channelId,
              requestBody: {
                attachment: [
                  {
                    contentName: attachment.name || "file",
                    contentType: attachment.mimeType || "application/octet-stream",
                  },
                ],
                ...(message.threadId && {
                  thread: { name: message.threadId },
                }),
              },
              messageReplyOption: message.threadId ? "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" : undefined,
            });
          }
        } catch (error) {
          logger.error({ channel: "googlechat", error: String(error) }, "Failed to send attachment");
        }
      }
    }
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Handle incoming webhook event from Bun-compatible HTTP handler
   * Call this from the /_gateway/webhook/googlechat route
   */
  async handleWebhook(event: GoogleChatMessageEvent): Promise<void> {
    // Only handle MESSAGE events
    if (event.type !== "MESSAGE") {
      return;
    }

    // Skip bot messages
    if (event.message?.sender.type === "BOT") {
      return;
    }

    const inbound = toInboundMessage(event, this.botUserId || undefined);

    // In rooms, only respond to mentions unless configured otherwise
    if (!inbound.isDM && !this.config.respondToAllMessages && !inbound.isMention) {
      return;
    }

    if (this.messageHandler) {
      await this.messageHandler(inbound);
    }
  }
}
