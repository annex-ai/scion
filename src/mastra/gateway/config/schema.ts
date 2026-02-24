// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Configuration schemas for the gateway
 */

import { z } from "zod";

/**
 * Slack channel configuration schema
 */
export const slackConfigSchema = z.object({
  enabled: z.boolean().default(true),
  botToken: z.string().startsWith("xoxb-").describe("Bot User OAuth Token"),
  appToken: z.string().startsWith("xapp-").describe("App-Level Token for Socket Mode"),
  signingSecret: z.string().min(1).describe("Signing Secret"),
  respondToAllMessages: z.boolean().default(false).describe("Respond to all messages, not just mentions/DMs"),
  allowFrom: z.array(z.string()).optional().describe("Allowlist of Slack user IDs"),
});

export type SlackConfig = z.infer<typeof slackConfigSchema>;

/**
 * Telegram channel configuration schema
 */
export const telegramConfigSchema = z.object({
  enabled: z.boolean().default(true),
  token: z.string().min(1).describe("Bot token from @BotFather"),
  respondToAllMessages: z.boolean().default(false).describe("Respond to all messages in groups, not just mentions"),
  allowFrom: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe("Allowlist of user IDs or usernames"),
  handleEditedMessages: z.boolean().default(false).describe("Whether to handle edited messages"),
  dropPendingUpdates: z.boolean().default(true).describe("Whether to drop pending updates on startup"),
});

export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

/**
 * Personality configuration schema
 */
export const personalityConfigSchema = z.object({
  path: z.string().default("~/.scion/personality/PERSONALITY.md"),
  enabled: z.boolean().default(true),
});

export type PersonalityConfig = z.infer<typeof personalityConfigSchema>;

/**
 * Flows configuration schema
 */
export const flowsConfigSchema = z.object({
  configPath: z.string().optional().describe("Path to flows.config.json"),
  enabled: z.boolean().default(true),
});

export type FlowsConfig = z.infer<typeof flowsConfigSchema>;

/**
 * Discord channel configuration schema
 */
export const discordConfigSchema = z.object({
  enabled: z.boolean().default(true),
  token: z.string().min(1).describe("Discord bot token"),
  applicationId: z.string().optional().describe("Application ID for slash commands"),
  guildId: z.string().optional().describe("Guild ID for guild-specific commands"),
  respondToAllMessages: z.boolean().default(false).describe("Respond to all messages, not just mentions/DMs"),
  allowFrom: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe("Allowlist of user IDs or usernames"),
});

export type DiscordConfig = z.infer<typeof discordConfigSchema>;

/**
 * WhatsApp channel configuration schema
 */
export const whatsappConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sessionPath: z.string().default(".agent/whatsapp-session").describe("Session data directory path"),
  respondToAllMessages: z.boolean().default(false).describe("Respond to all messages, not just mentions/DMs"),
  allowFrom: z.array(z.string()).optional().describe("Allowlist of phone numbers"),
});

export type WhatsAppConfig = z.infer<typeof whatsappConfigSchema>;

/**
 * Google Chat channel configuration schema
 */
export const googleChatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  credentials: z.string().min(1).describe("Service account credentials JSON path or content"),
  projectId: z.string().min(1).describe("Google Cloud project ID"),
  respondToAllMessages: z.boolean().default(false).describe("Respond to all messages in spaces, not just mentions"),
});

export type GoogleChatConfig = z.infer<typeof googleChatConfigSchema>;

/**
 * Signal channel configuration schema
 */
export const signalConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiUrl: z.string().url().describe("signal-cli REST API URL"),
  phoneNumber: z.string().min(1).describe("Registered phone number"),
  respondToAllMessages: z.boolean().default(false).describe("Respond to all group messages"),
  allowFrom: z.array(z.string()).optional().describe("Allowlist of phone numbers"),
});

export type SignalConfig = z.infer<typeof signalConfigSchema>;

/**
 * iMessage channel configuration schema
 */
export const imessageConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiUrl: z.string().url().describe("BlueBubbles REST API URL"),
  apiPassword: z.string().optional().describe("BlueBubbles API password"),
  respondToAllMessages: z.boolean().default(false).describe("Respond to all messages in group chats"),
  allowFrom: z.array(z.string()).optional().describe("Allowlist of phone numbers or emails"),
});

export type IMessageConfig = z.infer<typeof imessageConfigSchema>;

/**
 * Gateway configuration schema
 *
 * Note: Personality, identity, skills, and flows are loaded at AGENT level.
 * The gateway only handles channel configuration and thread management.
 * Scheduler/cron config is loaded directly from agent.toml via getCronConfig().
 */
export const gatewayConfigSchema = z.object({
  slack: slackConfigSchema.optional(),
  telegram: telegramConfigSchema.optional(),
  discord: discordConfigSchema.optional(),
  whatsapp: whatsappConfigSchema.optional(),
  googlechat: googleChatConfigSchema.optional(),
  signal: signalConfigSchema.optional(),
  imessage: imessageConfigSchema.optional(),
  mastraUrl: z
    .string()
    .default("http://localhost:4111")
    .describe("Mastra server URL for HTTP-based agent communication"),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;
