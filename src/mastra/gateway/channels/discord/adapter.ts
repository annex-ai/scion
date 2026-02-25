// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Discord channel adapter using Discord.js
 */

import { readFile } from "node:fs/promises";
import { AttachmentBuilder, Client, GatewayIntentBits, type Message, Partials } from "discord.js";
import { logger } from "../../logger";
import { downloadAndSaveMedia, saveMediaBuffer } from "../media";
import type {
  ChannelAdapter,
  DiscordChannelConfig,
  InboundAttachment,
  InboundMessage,
  OutboundMessage,
} from "../types";
import { chunkForDiscord, type DiscordMessageEvent, toDiscordFormat, toInboundMessage } from "./format";

/**
 * Discord channel adapter
 * Connects to Discord via Gateway and routes messages
 */
export class DiscordAdapter implements ChannelAdapter {
  readonly type = "discord";
  readonly name = "Discord";

  private client: Client;
  private config: DiscordChannelConfig;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private _isConnected = false;
  private botUserId: string | null = null;

  constructor(config: DiscordChannelConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to Discord via Gateway
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.once("ready", () => {
        this.botUserId = this.client.user?.id || null;
        logger.info({ channel: "discord", botUser: this.client.user?.tag, botUserId: this.botUserId }, "Connected");
        this._isConnected = true;
        resolve();
      });

      this.client.on("messageCreate", async (message) => {
        await this.handleMessage(message);
      });

      this.client.on("error", (error) => {
        logger.error({ channel: "discord", error: String(error) }, "Client error");
      });

      this.client.login(this.config.token).catch(reject);
    });
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    await this.client.destroy();
    this._isConnected = false;
    logger.info({ channel: "discord" }, "Disconnected");
  }

  /**
   * Send a message to a Discord channel
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    const channel = await this.client.channels.fetch(message.channelId);

    if (!channel || !("send" in channel)) {
      logger.error({ channel: "discord", channelId: message.channelId }, "Cannot send to channel: not a text channel");
      return;
    }

    const textChannel = channel as any;

    // Send typing indicator
    try {
      await textChannel.sendTyping();
    } catch {
      // Non-fatal
    }

    // Build attachment files for discord.js
    const files: AttachmentBuilder[] = [];
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
            files.push(new AttachmentBuilder(content, { name: attachment.name || "file" }));
          }
        } catch (error) {
          logger.error({ channel: "discord", error: String(error) }, "Failed to prepare attachment");
        }
      }
    }

    const formattedText = toDiscordFormat(message.text);
    const chunks = chunkForDiscord(formattedText);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Attach files only to the first chunk
      const chunkFiles = i === 0 ? files : [];

      if (message.threadId) {
        try {
          // Check if the channel is a thread
          if (textChannel.isThread?.()) {
            await textChannel.send({ content: chunk, files: chunkFiles });
          } else {
            // Reply to a specific message
            const originalMessage = await textChannel.messages.fetch(message.threadId);
            await originalMessage.reply({ content: chunk, files: chunkFiles });
          }
        } catch {
          // Fallback to regular send if reply fails
          await textChannel.send({ content: chunk, files: chunkFiles });
        }
      } else {
        await textChannel.send({ content: chunk, files: chunkFiles });
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
   * Extract attachments from a Discord message
   */
  private async extractAttachments(message: Message): Promise<InboundAttachment[]> {
    const attachments: InboundAttachment[] = [];

    for (const [, attachment] of message.attachments) {
      try {
        const saved = await downloadAndSaveMedia(attachment.url, { direction: "inbound" });

        let type: "image" | "audio" | "video" | "document" = "document";
        const contentType = attachment.contentType || saved.mime;
        if (contentType?.startsWith("image/")) type = "image";
        else if (contentType?.startsWith("audio/")) type = "audio";
        else if (contentType?.startsWith("video/")) type = "video";

        attachments.push({
          type,
          url: attachment.url,
          path: saved.path,
          mimeType: saved.mime,
          name: attachment.name || undefined,
          size: attachment.size,
          width: attachment.width || undefined,
          height: attachment.height || undefined,
        });
      } catch (error) {
        logger.error({ channel: "discord", error: String(error) }, "Failed to download attachment");
      }
    }

    return attachments;
  }

  /**
   * Handle incoming message events
   */
  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages (including our own)
    if (message.author.bot) {
      return;
    }

    // Check if this is a DM or if we should respond
    const isDM = !message.guild;
    const isMention = this.botUserId ? message.mentions.users.has(this.botUserId) : false;

    // In guilds, only respond to mentions unless configured otherwise
    if (!isDM && !this.config.respondToAllMessages && !isMention) {
      return;
    }

    // Check allowlist if configured
    if (this.config.allowFrom && this.config.allowFrom.length > 0) {
      const senderId = message.author.id;
      const senderUsername = message.author.username.toLowerCase();

      const isAllowed = this.config.allowFrom.some((allowed) => {
        if (typeof allowed === "number") {
          return String(allowed) === senderId;
        }
        if (typeof allowed === "string") {
          return allowed.toLowerCase() === senderUsername || allowed === senderId;
        }
        return false;
      });

      if (!isAllowed) {
        return;
      }
    }

    // Extract attachments
    const attachments = await this.extractAttachments(message);

    // Build message event
    const messageEvent: DiscordMessageEvent = {
      id: message.id,
      content: message.content,
      author: {
        id: message.author.id,
        username: message.author.username,
        discriminator: message.author.discriminator,
        bot: message.author.bot,
        globalName: message.author.globalName,
      },
      channelId: message.channelId,
      guildId: message.guildId,
      createdTimestamp: message.createdTimestamp,
      reference: message.reference
        ? {
            messageId: message.reference.messageId || undefined,
            channelId: message.reference.channelId || undefined,
            guildId: message.reference.guildId || undefined,
          }
        : null,
      mentions: {
        users: message.mentions.users,
      },
    };

    const inbound = toInboundMessage(messageEvent, this.botUserId || undefined);

    // Attach media to the inbound message
    if (attachments.length > 0) {
      inbound.attachments = attachments;
    }

    if (this.messageHandler) {
      await this.messageHandler(inbound);
    }
  }
}
