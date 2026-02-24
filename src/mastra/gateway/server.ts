// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gateway server - main entry point for the messaging gateway
 */

import * as path from "node:path";
import { getSecurityConfig } from "../lib/config";
import { GatewayToMastraAdapter } from "./adapter";
import { DiscordAdapter } from "./channels/discord";
import { GoogleChatAdapter } from "./channels/googlechat";
import { IMessageAdapter } from "./channels/imessage";
import { SignalAdapter } from "./channels/signal";
import { SlackAdapter } from "./channels/slack";
import { TelegramAdapter } from "./channels/telegram";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "./channels/types";
import { createThreadKey } from "./channels/types";
import { WhatsAppAdapter } from "./channels/whatsapp";
import type { GatewayConfig } from "./config";
import { type CronService, createCronService, destroyCronService } from "./cron";
import { type HeartbeatService, createHeartbeatService } from "./heartbeat";
import { logger } from "./logger";

/**
 * Rate limit entry for a single key (session or user)
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Gateway server that manages channel connections and message routing
 */
export class GatewayServer {
  private channels: ChannelAdapter[] = [];
  private adapter: GatewayToMastraAdapter | null = null;
  private cron: CronService | null = null;
  private heartbeat: HeartbeatService | null = null;

  /** Webhook adapters for channels that receive inbound via HTTP (e.g., Google Chat) */
  private webhookAdapters = new Map<string, ChannelAdapter>();

  /**
   * Rate limiter map (key -> entry).
   * NOTE: This is an in-memory, single-instance rate limiter.
   * For production multi-instance deployments, replace with Redis-backed limiter (Bun.redis).
   */
  private rateLimiter = new Map<string, RateLimitEntry>();

  /** Rate limit: max requests per session per window */
  private readonly rateLimitPerSession = 30;

  /** Rate limit: max requests per user per window */
  private readonly rateLimitPerUser = 50;

  /** Rate limit window in milliseconds (1 minute) */
  private readonly rateLimitWindowMs = 60_000;

  /** Cleanup interval handle */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Check rate limit for a key. Returns true if allowed, false if exceeded.
   */
  private checkRateLimit(key: string, maxRequests: number): boolean {
    const now = Date.now();
    const entry = this.rateLimiter.get(key);

    if (!entry || now > entry.resetTime) {
      this.rateLimiter.set(key, { count: 1, resetTime: now + this.rateLimitWindowMs });
      return true;
    }

    if (entry.count >= maxRequests) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Remove expired rate limit entries to prevent memory leaks
   */
  private cleanupRateLimiter(): void {
    const now = Date.now();
    for (const [key, entry] of this.rateLimiter.entries()) {
      if (now > entry.resetTime) {
        this.rateLimiter.delete(key);
      }
    }
  }

  /**
   * Start the gateway server
   */
  async start(config: GatewayConfig): Promise<void> {
    logger.info({}, "Starting gateway server");

    // Start rate limiter cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => this.cleanupRateLimiter(), 5 * 60_000);

    // NOTE: MCP tools are loaded once at Mastra client initialization (client.ts)
    // NOTE: Personality, identity, skills, flows are loaded at agent initialization
    // The gateway only handles channel connections and session management

    this.adapter = new GatewayToMastraAdapter({
      mastraUrl: config.mastraUrl,
    });

    // Per-channel connect timeout (2 min — Slack Socket Mode can be slow)
    const CHANNEL_CONNECT_TIMEOUT = 120_000;

    /** Connect a channel with a timeout covering the entire init (import + create + connect). */
    const connectWithTimeout = async (
      name: string,
      createAdapter: () => Promise<ChannelAdapter>,
    ): Promise<ChannelAdapter | null> => {
      logger.info({ channel: name }, "Connecting channel...");
      // Track the adapter ref so we can clean it up on timeout
      let adapterRef: ChannelAdapter | null = null;
      try {
        const adapter = await Promise.race([
          (async () => {
            const a = await createAdapter();
            adapterRef = a;
            a.onMessage(async (message) => {
              await this.handleMessage(a, message);
            });
            await a.connect();
            return a;
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Connect timed out after ${CHANNEL_CONNECT_TIMEOUT / 1000}s`)),
              CHANNEL_CONNECT_TIMEOUT,
            ),
          ),
        ]);

        logger.info({ channel: name }, "Channel connected");
        return adapter;
      } catch (error) {
        logger.error({ channel: name, error: String(error) }, "Failed to connect channel — skipping");
        // Clean up orphaned adapter to stop background retries (e.g. Bolt Socket Mode)
        if (adapterRef) {
          try {
            logger.info({ channel: name }, "Disconnecting orphaned adapter after timeout");
            await (adapterRef as ChannelAdapter).disconnect();
          } catch (cleanupErr) {
            logger.warn({ channel: name, error: String(cleanupErr) }, "Failed to clean up orphaned adapter");
          }
        }
        return null;
      }
    };

    // Build list of channel init tasks (only for enabled channels)
    const channelTasks: Array<{ name: string; task: Promise<ChannelAdapter | null> }> = [];

    if (config.slack?.enabled) {
      channelTasks.push({
        name: "slack",
        task: connectWithTimeout("slack", async () => new SlackAdapter(config.slack!)),
      });
    }

    if (config.telegram?.enabled) {
      channelTasks.push({
        name: "telegram",
        task: connectWithTimeout("telegram", async () => new TelegramAdapter(config.telegram!)),
      });
    }

    if (config.discord?.enabled) {
      channelTasks.push({
        name: "discord",
        task: connectWithTimeout("discord", async () => new DiscordAdapter(config.discord!)),
      });
    }

    if (config.whatsapp?.enabled) {
      channelTasks.push({
        name: "whatsapp",
        task: connectWithTimeout("whatsapp", async () => new WhatsAppAdapter(config.whatsapp!)),
      });
    }

    if (config.googlechat?.enabled) {
      channelTasks.push({
        name: "googlechat",
        task: connectWithTimeout("googlechat", async () => new GoogleChatAdapter(config.googlechat!)),
      });
    }

    if (config.signal?.enabled) {
      channelTasks.push({
        name: "signal",
        task: connectWithTimeout("signal", async () => new SignalAdapter(config.signal!)),
      });
    }

    if (config.imessage?.enabled) {
      channelTasks.push({
        name: "imessage",
        task: connectWithTimeout("imessage", async () => new IMessageAdapter(config.imessage!)),
      });
    }

    logger.info(
      { enabled: channelTasks.map((t) => t.name) },
      `Connecting ${channelTasks.length} channel(s) in parallel`,
    );

    // Connect all channels in parallel
    const results = await Promise.all(channelTasks.map((t) => t.task));
    const failedChannels: string[] = [];

    for (let i = 0; i < channelTasks.length; i++) {
      const adapter = results[i];
      const name = channelTasks[i].name;
      if (adapter) {
        this.channels.push(adapter);
        if (name === "googlechat") {
          this.webhookAdapters.set("googlechat", adapter);
        }
      } else {
        failedChannels.push(name);
      }
    }

    // Summary
    if (failedChannels.length > 0) {
      logger.warn(
        { failed: failedChannels, connected: this.channels.map((c) => c.name) },
        `${failedChannels.length} channel(s) failed to connect`,
      );
    }

    if (this.channels.length === 0 && channelTasks.length > 0) {
      throw new Error(`All ${channelTasks.length} enabled channel(s) failed to connect: ${failedChannels.join(", ")}`);
    }

    if (channelTasks.length === 0) {
      logger.info({}, "No channels configured — gateway running without messaging channels");
    }

    // Load security config for resource ID
    const securityConfig = await getSecurityConfig();
    const resourceId = securityConfig.resource_id;

    // Initialize heartbeat service (runs in-process, not via scheduler)
    logger.info({}, "Initializing heartbeat service");
    try {
      this.heartbeat = createHeartbeatService({});
      this.heartbeat.setAdapter(this.adapter);
      this.heartbeat.setResourceId(resourceId);
      await this.heartbeat.start();
      logger.info({}, "Heartbeat service started");
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to start heartbeat service");
      // Non-fatal: continue without heartbeat
    }

    // Initialize cron service (config loaded from agent.toml [cron] section)
    logger.info({}, "Initializing cron service");
    try {
      this.cron = createCronService();

      // Set adapter and resource ID for thread operations
      this.cron.setAdapter(this.adapter);
      this.cron.setResourceId(resourceId);

      // Set Mastra URL for workflow execution
      if (config.mastraUrl) {
        this.cron.setMastraUrl(config.mastraUrl);
      }

      // Register all connected channels for result delivery
      for (const channel of this.channels) {
        this.cron.registerChannel(channel.type, channel);
      }

      // Start the cron service (loads its own config from agent.toml)
      await this.cron.start();

      // Log status (will log 'disabled' if not enabled in agent.toml)
      if (this.cron.isRunning()) {
        logger.info({}, "Cron service started");
      }
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to start cron service");
      // Non-fatal: continue without cron service
    }

    logger.info({ channelCount: this.channels.length }, "Gateway started");
  }

  /**
   * Stop the gateway server
   */
  async stop(): Promise<void> {
    logger.info({}, "Stopping gateway server");

    // Clear rate limiter cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.rateLimiter.clear();

    // Stop heartbeat first
    if (this.heartbeat) {
      try {
        await this.heartbeat.stop();
        logger.info({}, "Heartbeat service stopped");
      } catch (error) {
        logger.error({ error: String(error) }, "Error stopping heartbeat service");
      }
      this.heartbeat = null;
    }

    // Stop cron service
    if (this.cron) {
      try {
        await this.cron.stop();
        logger.info({}, "Cron service stopped");
      } catch (error) {
        logger.error({ error: String(error) }, "Error stopping cron service");
      }
      this.cron = null;
    }

    // Then disconnect channels
    for (const channel of this.channels) {
      try {
        await channel.disconnect();
        logger.info({ channel: channel.name }, "Channel disconnected");
      } catch (error) {
        logger.error({ channel: channel.name, error: String(error) }, "Error disconnecting channel");
      }
    }

    // Disconnect MCP client to prevent process leaks
    // try {
    //   await disconnectMcp();
    //   logger.info({}, 'MCP client disconnected');
    // } catch (error) {
    //   logger.error({ error: String(error) }, 'Error disconnecting MCP client');
    // }

    this.channels = [];
    this.adapter = null;
    logger.info({}, "Gateway stopped");
  }

  /**
   * Handle an incoming message from any channel
   */
  private async handleMessage(channel: ChannelAdapter, message: InboundMessage): Promise<void> {
    if (!this.adapter) {
      logger.error({}, "Gateway adapter not initialized");
      return;
    }

    // Rate limit check (per-thread and per-user)
    const threadKey = createThreadKey(message.channelType, message.channelId, message.threadId);
    const userKey = `user:${message.sender.id}`;

    const sessionAllowed = this.checkRateLimit(threadKey, this.rateLimitPerSession);
    const userAllowed = this.checkRateLimit(userKey, this.rateLimitPerUser);

    if (!sessionAllowed || !userAllowed) {
      logger.warn(
        {
          threadKey,
          userKey,
          sessionAllowed,
          userAllowed,
          channel: channel.name,
        },
        "Rate limit exceeded",
      );

      try {
        await channel.sendMessage({
          text: "Rate limit exceeded. Please slow down.",
          channelId: message.channelId,
          threadId: message.threadId || message.id,
        });
      } catch (sendError) {
        logger.error({ error: String(sendError) }, "Failed to send rate limit message");
      }
      return;
    }

    logger.info(
      {
        channel: channel.name,
        sender: message.sender.name || message.sender.id,
        messagePreview: message.text.slice(0, 100),
        channelId: message.channelId,
        threadId: message.threadId,
      },
      "Message received",
    );

    try {
      // Process message through Mastra agent
      const result = await this.adapter.processMessage(message);

      // Send response back to channel
      const outbound: OutboundMessage = {
        text: result.text,
        channelId: message.channelId,
        // Reply in thread: use existing thread_ts or start new thread with message ts
        threadId: message.threadId || message.id,
        // Include any attachments (e.g., TTS audio files)
        attachments: result.attachments,
      };

      await channel.sendMessage(outbound);

      logger.info(
        {
          channel: channel.name,
          responsePreview: result.text.slice(0, 100),
          channelId: message.channelId,
          attachmentCount: result.attachments?.length ?? 0,
        },
        "Response sent",
      );
    } catch (error) {
      const errorObj = error as any;
      const errorMessage = errorObj?.message || String(error);

      logger.error(
        {
          channel: channel.name,
          error: errorMessage,
          errorCode: errorObj?.code,
          channelId: message.channelId,
        },
        "Error processing message",
      );

      // Send error message back to user
      // If the error has a user-friendly message, use it; otherwise use generic
      const userMessage = errorMessage.startsWith("⚠️")
        ? errorMessage
        : "⚠️ Sorry, I encountered an error processing your message. Please try again.";

      try {
        await channel.sendMessage({
          text: userMessage,
          channelId: message.channelId,
          threadId: message.threadId || message.id,
        });
      } catch (sendError) {
        logger.error({ error: String(sendError) }, "Failed to send error message");
      }
    }
  }

  /**
   * Get list of connected channels
   */
  getConnectedChannels(): string[] {
    return this.channels.filter((c) => c.isConnected).map((c) => c.name);
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.channels.length > 0 && this.channels.some((c) => c.isConnected);
  }

  /**
   * Get the heartbeat service for manual checks
   */
  getHeartbeatService(): HeartbeatService | null {
    return this.heartbeat;
  }

  /**
   * Get the cron service for schedule management
   */
  getCronService(): CronService | null {
    return this.cron;
  }

  /**
   * Get a webhook adapter by channel type (for routing inbound webhooks)
   */
  getWebhookAdapter(channelType: string): ChannelAdapter | undefined {
    return this.webhookAdapters.get(channelType);
  }

  /**
   * Get a channel adapter by its type identifier (e.g. 'slack', 'telegram')
   */
  getChannelByType(type: string): ChannelAdapter | undefined {
    return this.channels.find((c) => c.type === type);
  }

  /**
   * Get the Mastra adapter for thread/memory operations
   */
  getAdapter(): GatewayToMastraAdapter | null {
    return this.adapter;
  }

  /**
   * Get status summary for all configured channels
   */
  getChannelStatuses(): Array<{ type: string; name: string; connected: boolean }> {
    return this.channels.map((c) => ({
      type: c.type,
      name: c.name,
      connected: c.isConnected,
    }));
  }
}
