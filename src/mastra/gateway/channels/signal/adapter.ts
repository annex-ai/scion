// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Signal channel adapter using signal-cli REST API
 */

import { readFile } from "node:fs/promises";
import { logger } from "../../logger";
import { saveMediaBuffer } from "../media";
import type { ChannelAdapter, InboundAttachment, InboundMessage, OutboundMessage, SignalChannelConfig } from "../types";
import { type SignalMessageEvent, chunkForSignal, toInboundMessage, toSignalFormat } from "./format";

/**
 * Signal channel adapter
 * Connects to Signal via signal-cli REST API
 */
export class SignalAdapter implements ChannelAdapter {
  readonly type = "signal";
  readonly name = "Signal";

  private config: SignalChannelConfig;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private _isConnected = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastTimestamp = 0;

  constructor(config: SignalChannelConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to Signal via REST API polling
   */
  async connect(): Promise<void> {
    // Verify connection to signal-cli REST API
    try {
      const response = await fetch(`${this.config.apiUrl}/v1/about`);
      if (!response.ok) {
        throw new Error(`Signal API not available: ${response.status}`);
      }
      logger.info({ channel: "signal", apiUrl: this.config.apiUrl }, "API connection verified");
    } catch (error) {
      throw new Error(`Failed to connect to Signal API: ${error}`);
    }

    // Start polling for messages
    this.pollInterval = setInterval(async () => {
      await this.pollMessages();
    }, 1000);

    this._isConnected = true;
    logger.info({ channel: "signal", phoneNumber: this.config.phoneNumber }, "Connected");
  }

  /**
   * Disconnect from Signal
   */
  async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this._isConnected = false;
    logger.info({ channel: "signal" }, "Disconnected");
  }

  /**
   * Send a message to a Signal chat
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    const formattedText = toSignalFormat(message.text);
    const chunks = chunkForSignal(formattedText);

    for (const chunk of chunks) {
      // Build base64 attachments for outbound media
      const base64Attachments: string[] = [];
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
              base64Attachments.push(content.toString("base64"));
            }
          } catch (error) {
            logger.error({ channel: "signal", error: String(error) }, "Failed to prepare attachment");
          }
        }
      }

      const isGroup = message.channelId.startsWith("group.");

      const body: any = {
        message: chunk,
        number: this.config.phoneNumber,
        recipients: [message.channelId],
      };

      if (base64Attachments.length > 0) {
        body.base64_attachments = base64Attachments;
      }

      const response = await fetch(`${this.config.apiUrl}/v2/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        logger.error({ channel: "signal", status: response.status }, "Failed to send message");
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
   * Download an attachment from signal-cli
   */
  private async downloadAttachment(attachmentId: string): Promise<InboundAttachment | null> {
    try {
      const response = await fetch(`${this.config.apiUrl}/v1/attachments/${encodeURIComponent(attachmentId)}`);

      if (!response.ok) {
        logger.error({ channel: "signal", attachmentId, status: response.status }, "Failed to download attachment");
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || undefined;

      const saved = await saveMediaBuffer(buffer, {
        direction: "inbound",
        mime: contentType,
      });

      return {
        type: saved.kind,
        path: saved.path,
        mimeType: saved.mime,
        size: saved.size,
      };
    } catch (error) {
      logger.error({ channel: "signal", error: String(error) }, "Failed to download attachment");
      return null;
    }
  }

  /**
   * Poll for new messages
   */
  private async pollMessages(): Promise<void> {
    try {
      const response = await fetch(`${this.config.apiUrl}/v1/receive/${encodeURIComponent(this.config.phoneNumber)}`);

      if (!response.ok) {
        return;
      }

      const messages: SignalMessageEvent[] = await response.json();

      for (const message of messages) {
        // Skip messages we've already processed
        if (message.envelope.timestamp <= this.lastTimestamp) {
          continue;
        }
        this.lastTimestamp = message.envelope.timestamp;

        // Skip messages without data (receipts, etc.)
        if (!message.envelope.dataMessage?.message) {
          continue;
        }

        // Check allowlist if configured
        if (this.config.allowFrom && this.config.allowFrom.length > 0) {
          const senderNumber = message.envelope.sourceNumber || message.envelope.source;
          const isAllowed = this.config.allowFrom.some((allowed) => {
            // Normalize phone numbers for comparison
            const normalizedAllowed = allowed.replace(/\D/g, "");
            const normalizedSender = senderNumber.replace(/\D/g, "");
            return (
              normalizedAllowed === normalizedSender ||
              normalizedAllowed.endsWith(normalizedSender) ||
              normalizedSender.endsWith(normalizedAllowed)
            );
          });

          if (!isAllowed) {
            continue;
          }
        }

        const inbound = toInboundMessage(message, this.config.phoneNumber);

        // Download attachments if present
        const dataMessage = message.envelope.dataMessage as any;
        if (dataMessage.attachments && dataMessage.attachments.length > 0) {
          const attachments: InboundAttachment[] = [];
          for (const att of dataMessage.attachments) {
            const saved = await this.downloadAttachment(att.id);
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
      logger.error({ channel: "signal", error: String(error) }, "Error polling messages");
    }
  }
}
