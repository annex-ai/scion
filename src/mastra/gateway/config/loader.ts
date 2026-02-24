// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Configuration loader for the gateway
 *
 * Note: Personality, identity, skills, and flows are loaded at AGENT level.
 * The gateway only loads channel and server configuration.
 */

import { type GatewayConfig, gatewayConfigSchema } from "./schema";

/**
 * Load gateway configuration from environment variables and agent.toml
 */
export async function loadConfig(): Promise<GatewayConfig> {
  const rawConfig = {
    slack: loadSlackConfig(),
    telegram: loadTelegramConfig(),
    discord: loadDiscordConfig(),
    whatsapp: loadWhatsAppConfig(),
    googlechat: loadGoogleChatConfig(),
    signal: loadSignalConfig(),
    imessage: loadIMessageConfig(),
    mastraUrl: process.env.MASTRA_URL || "http://localhost:4111",
  };

  return gatewayConfigSchema.parse(rawConfig);
}

/**
 * Load Slack configuration from environment variables
 * Returns undefined if required variables are not set
 */
function loadSlackConfig() {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  // All three are required for Slack to be enabled
  if (!botToken || !appToken || !signingSecret) {
    return undefined;
  }

  // Parse allowFrom — comma-separated Slack user IDs (e.g., U01ABC123,U02DEF456)
  let allowFrom: string[] | undefined;
  if (process.env.SLACK_ALLOW_FROM) {
    allowFrom = process.env.SLACK_ALLOW_FROM.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    enabled: process.env.SLACK_ENABLED !== "false",
    botToken,
    appToken,
    signingSecret,
    respondToAllMessages: process.env.SLACK_RESPOND_ALL === "true",
    allowFrom,
  };
}

/**
 * Load Telegram configuration from environment variables
 * Returns undefined if required variables are not set
 */
function loadTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  // Token is required for Telegram to be enabled
  if (!token) {
    return undefined;
  }

  // Parse allowFrom - can be comma-separated list of usernames or IDs
  let allowFrom: Array<string | number> | undefined;
  if (process.env.TELEGRAM_ALLOW_FROM) {
    allowFrom = process.env.TELEGRAM_ALLOW_FROM.split(",").map((item) => {
      const trimmed = item.trim();
      const asNumber = Number.parseInt(trimmed, 10);
      return Number.isNaN(asNumber) ? trimmed : asNumber;
    });
  }

  return {
    enabled: process.env.TELEGRAM_ENABLED !== "false",
    token,
    respondToAllMessages: process.env.TELEGRAM_RESPOND_ALL === "true",
    allowFrom,
    handleEditedMessages: process.env.TELEGRAM_HANDLE_EDITS === "true",
    dropPendingUpdates: process.env.TELEGRAM_DROP_PENDING !== "false",
  };
}

/**
 * Load Discord configuration from environment variables
 * Returns undefined if required variables are not set
 */
function loadDiscordConfig() {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    return undefined;
  }

  // Explicit disable check
  if (process.env.DISCORD_ENABLED === "false") {
    return undefined;
  }

  let allowFrom: Array<string | number> | undefined;
  if (process.env.DISCORD_ALLOW_FROM) {
    allowFrom = process.env.DISCORD_ALLOW_FROM.split(",").map((item) => {
      const trimmed = item.trim();
      const asNumber = Number.parseInt(trimmed, 10);
      return Number.isNaN(asNumber) ? trimmed : asNumber;
    });
  }

  return {
    enabled: true,
    token,
    applicationId: process.env.DISCORD_APPLICATION_ID || undefined,
    guildId: process.env.DISCORD_GUILD_ID || undefined,
    respondToAllMessages: process.env.DISCORD_RESPOND_ALL === "true",
    allowFrom,
  };
}

/**
 * Load WhatsApp configuration from environment variables
 * Returns undefined unless explicitly enabled (no required token — uses QR auth)
 */
function loadWhatsAppConfig() {
  // WhatsApp requires explicit opt-in since there's no required token
  if (process.env.WHATSAPP_ENABLED !== "true") {
    return undefined;
  }

  let allowFrom: string[] | undefined;
  if (process.env.WHATSAPP_ALLOW_FROM) {
    allowFrom = process.env.WHATSAPP_ALLOW_FROM.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    enabled: true,
    sessionPath: process.env.WHATSAPP_SESSION_PATH || ".agent/whatsapp-session",
    respondToAllMessages: process.env.WHATSAPP_RESPOND_ALL === "true",
    allowFrom,
  };
}

/**
 * Load Google Chat configuration from environment variables
 * Returns undefined if required variables are not set
 */
function loadGoogleChatConfig() {
  const credentials = process.env.GOOGLE_CHAT_CREDENTIALS;
  const projectId = process.env.GOOGLE_CHAT_PROJECT_ID;

  if (!credentials || !projectId) {
    return undefined;
  }

  if (process.env.GOOGLE_CHAT_ENABLED === "false") {
    return undefined;
  }

  return {
    enabled: true,
    credentials,
    projectId,
    respondToAllMessages: process.env.GOOGLE_CHAT_RESPOND_ALL === "true",
  };
}

/**
 * Load Signal configuration from environment variables
 * Returns undefined if required variables are not set
 */
function loadSignalConfig() {
  const apiUrl = process.env.SIGNAL_API_URL;
  const phoneNumber = process.env.SIGNAL_PHONE_NUMBER;

  if (!apiUrl || !phoneNumber) {
    return undefined;
  }

  if (process.env.SIGNAL_ENABLED === "false") {
    return undefined;
  }

  let allowFrom: string[] | undefined;
  if (process.env.SIGNAL_ALLOW_FROM) {
    allowFrom = process.env.SIGNAL_ALLOW_FROM.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    enabled: true,
    apiUrl,
    phoneNumber,
    respondToAllMessages: process.env.SIGNAL_RESPOND_ALL === "true",
    allowFrom,
  };
}

/**
 * Load iMessage configuration from environment variables
 * Returns undefined if required variables are not set
 */
function loadIMessageConfig() {
  const apiUrl = process.env.IMESSAGE_API_URL;

  if (!apiUrl) {
    return undefined;
  }

  if (process.env.IMESSAGE_ENABLED === "false") {
    return undefined;
  }

  let allowFrom: string[] | undefined;
  if (process.env.IMESSAGE_ALLOW_FROM) {
    allowFrom = process.env.IMESSAGE_ALLOW_FROM.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    enabled: true,
    apiUrl,
    apiPassword: process.env.IMESSAGE_API_PASSWORD || undefined,
    respondToAllMessages: process.env.IMESSAGE_RESPOND_ALL === "true",
    allowFrom,
  };
}

/**
 * Validate that at least one channel is configured.
 * Returns true if valid, false if no channels — does NOT throw.
 */
export function validateConfig(config: GatewayConfig): boolean {
  const hasChannel =
    config.slack?.enabled ||
    config.telegram?.enabled ||
    config.discord?.enabled ||
    config.whatsapp?.enabled ||
    config.googlechat?.enabled ||
    config.signal?.enabled ||
    config.imessage?.enabled;

  if (!hasChannel) {
    console.warn(
      "[gateway] No channels configured. Set env vars to enable:\n" +
        "  Slack:       SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET\n" +
        "  Telegram:    TELEGRAM_BOT_TOKEN\n" +
        "  Discord:     DISCORD_BOT_TOKEN\n" +
        "  WhatsApp:    WHATSAPP_ENABLED=true\n" +
        "  Signal:      SIGNAL_API_URL, SIGNAL_PHONE_NUMBER\n" +
        "  Google Chat: GOOGLE_CHAT_CREDENTIALS, GOOGLE_CHAT_PROJECT_ID\n" +
        "  iMessage:    IMESSAGE_API_URL",
    );
    return false;
  }

  return true;
}
