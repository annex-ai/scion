// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * iMessage channel adapter using BlueBubbles REST API
 *
 * Note: This adapter requires a BlueBubbles server running on a Mac
 * with iMessage configured.
 */

import { readFile } from "node:fs/promises";
import { logger } from "../../logger";
import { saveMediaBuffer } from "../media";
import type {
  ChannelAdapter,
  IMessageChannelConfig,
  InboundAttachment,
  InboundMessage,
  OutboundMessage,
} from "../types";
import { type IMessageMessageEvent, chunkForIMessage, toIMessageFormat, toInboundMessage } from "./format";

/**
 * iMessage channel adapter
 * Connects to iMessage via BlueBubbles REST API
 */
export class IMessageAdapter implements ChannelAdapter {
  readonly type = "imessage";
  readonly name = "iMessage";

  private config: IMessageChannelConfig;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private _isConnected = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastTimestamp = 0;

  constructor(config: IMessageChannelConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Build a URL with the BlueBubbles API password appended
   */
  private buildUrl(path: string, params?: Record<string, string>): string {
    const url = new URL(path, this.config.apiUrl);
    if (this.config.apiPassword) {
      url.searchParams.set("password", this.config.apiPassword);
    }
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  /**
   * Connect to iMessage via REST API polling
   */
  async connect(): Promise<void> {
    // Verify connection to iMessage REST API
    try {
      const response = await fetch(this.buildUrl("/api/v1/server/info"));
      if (!response.ok) {
        throw new Error(`iMessage API not available: ${response.status}`);
      }
      const info = await response.json();
      logger.info(
        { channel: "imessage", apiUrl: this.config.apiUrl, osVersion: info.os_version },
        "API connection verified",
      );
    } catch (error) {
      throw new Error(`Failed to connect to iMessage API: ${error}`);
    }

    // Start polling for messages
    this.pollInterval = setInterval(async () => {
      await this.pollMessages();
    }, 2000);

    this._isConnected = true;
    logger.info({ channel: "imessage" }, "Connected");
  }

  /**
   * Disconnect from iMessage
   */
  async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this._isConnected = false;
    logger.info({ channel: "imessage" }, "Disconnected");
  }

  /**
   * Send a message to an iMessage chat
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
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

          if (content) {
            // BlueBubbles attachment upload via multipart form
            const formData = new FormData();
            formData.append("chatGuid", message.channelId);
            formData.append("name", attachment.name || "file");
            const blob = new Blob([new Uint8Array(content)], {
              type: attachment.mimeType || "application/octet-stream",
            });
            formData.append("attachment", blob, attachment.name || "file");

            const response = await fetch(this.buildUrl("/api/v1/message/attachment"), {
              method: "POST",
              body: formData,
            });

            if (!response.ok) {
              logger.error({ channel: "imessage", status: response.status }, "Failed to send attachment");
            }
          }
        } catch (error) {
          logger.error({ channel: "imessage", error: String(error) }, "Failed to send attachment");
        }
      }
    }

    // Send text message
    const formattedText = toIMessageFormat(message.text);
    const chunks = chunkForIMessage(formattedText);

    for (const chunk of chunks) {
      const response = await fetch(this.buildUrl("/api/v1/message/text"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatGuid: message.channelId,
          message: chunk,
        }),
      });

      if (!response.ok) {
        logger.error({ channel: "imessage", status: response.status }, "Failed to send message");
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
   * Download an attachment from BlueBubbles
   */
  private async downloadAttachment(
    guid: string,
    mimeType?: string,
    transferName?: string,
  ): Promise<InboundAttachment | null> {
    try {
      const response = await fetch(this.buildUrl(`/api/v1/attachment/${encodeURIComponent(guid)}/download`));

      if (!response.ok) {
        logger.error({ channel: "imessage", guid, status: response.status }, "Failed to download attachment");
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const saved = await saveMediaBuffer(buffer, {
        direction: "inbound",
        mime: mimeType || response.headers.get("content-type") || undefined,
        originalName: transferName,
      });

      return {
        type: saved.kind,
        path: saved.path,
        mimeType: saved.mime,
        size: saved.size,
        name: transferName,
      };
    } catch (error) {
      logger.error({ channel: "imessage", error: String(error) }, "Failed to download attachment");
      return null;
    }
  }

  /**
   * Poll for new messages
   */
  private async pollMessages(): Promise<void> {
    try {
      const params: Record<string, string> = {
        limit: "50",
        offset: "0",
        with: "chat,handle",
        sort: "desc",
      };

      if (this.lastTimestamp > 0) {
        params.after = String(this.lastTimestamp);
      }

      const response = await fetch(this.buildUrl("/api/v1/message", params));

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const messages: IMessageMessageEvent[] = data.data || [];

      // Process messages in chronological order (oldest first)
      for (const message of messages.reverse()) {
        // Skip messages we've already processed
        if (message.dateCreated <= this.lastTimestamp) {
          continue;
        }
        this.lastTimestamp = message.dateCreated;

        // Skip our own messages
        if (message.isFromMe) {
          continue;
        }

        // Skip messages without text and without attachments
        if (!message.text && !message.hasAttachments) {
          continue;
        }

        // Check allowlist if configured
        if (this.config.allowFrom && this.config.allowFrom.length > 0) {
          const senderAddress = message.handle.address;
          const isAllowed = this.config.allowFrom.some((allowed) => {
            // Normalize for comparison (remove special chars)
            const normalizedAllowed = allowed.replace(/[\s\-\(\)]/g, "").toLowerCase();
            const normalizedSender = senderAddress.replace(/[\s\-\(\)]/g, "").toLowerCase();
            return (
              normalizedAllowed === normalizedSender ||
              normalizedAllowed.includes(normalizedSender) ||
              normalizedSender.includes(normalizedAllowed)
            );
          });

          if (!isAllowed) {
            continue;
          }
        }

        const inbound = toInboundMessage(message);

        // Download attachments if present
        if (message.hasAttachments && message.attachments && message.attachments.length > 0) {
          const attachments: InboundAttachment[] = [];
          for (const att of message.attachments) {
            const saved = await this.downloadAttachment(att.guid, att.mimeType, att.transferName);
            if (saved) attachments.push(saved);
          }
          if (attachments.length > 0) {
            inbound.attachments = attachments;
          }
        }

        // In groups, only respond if configured to respond to all
        if (!inbound.isDM && !this.config.respondToAllMessages && !inbound.isMention) {
          continue;
        }

        if (this.messageHandler) {
          await this.messageHandler(inbound);
        }
      }
    } catch (error) {
      logger.error({ channel: "imessage", error: String(error) }, "Error polling messages");
    }
  }

  /**
   * Handle incoming webhook event (alternative to polling)
   * Call this from your HTTP webhook endpoint if using webhooks
   */
  async handleWebhook(event: IMessageMessageEvent): Promise<void> {
    // Skip our own messages
    if (event.isFromMe) {
      return;
    }

    // Skip messages without text
    if (!event.text) {
      return;
    }

    const inbound = toInboundMessage(event);

    // In groups, only respond if configured to respond to all
    if (!inbound.isDM && !this.config.respondToAllMessages && !inbound.isMention) {
      return;
    }

    if (this.messageHandler) {
      await this.messageHandler(inbound);
    }
  }
}
