// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Channel adapter types for multi-platform messaging
 */

/**
 * Media attachment from inbound message
 */
export interface InboundAttachment {
  /** Media type category */
  type: "image" | "audio" | "video" | "document";

  /** Remote URL to download from (platform-specific) */
  url?: string;

  /** Local file path (after download) */
  path?: string;

  /** MIME type */
  mimeType?: string;

  /** Original filename */
  name?: string;

  /** File size in bytes */
  size?: number;

  /** Duration in seconds (for audio/video) */
  duration?: number;

  /** Image dimensions */
  width?: number;
  height?: number;

  /** Transcription text (for audio, if processed) */
  transcript?: string;

  /** Description text (for images, if processed) */
  description?: string;
}

/**
 * Inbound message from a channel to the gateway
 */
export interface InboundMessage {
  /** Unique message ID from the channel */
  id: string;

  /** Message text content */
  text: string;

  /** Channel identifier (e.g., 'slack', 'discord', 'telegram') */
  channelType: string;

  /** Channel-specific conversation ID (e.g., Slack channel ID) */
  channelId: string;

  /** Thread ID for threaded conversations (e.g., Slack thread_ts) */
  threadId?: string;

  /** Sender information */
  sender: {
    id: string;
    name?: string;
    username?: string;
  };

  /** Timestamp of the message */
  timestamp: Date;

  /** Whether this is a direct message */
  isDM: boolean;

  /** Whether the bot was mentioned */
  isMention: boolean;

  /** Media attachments */
  attachments?: InboundAttachment[];

  /** Raw channel-specific payload for advanced use */
  raw?: unknown;
}

/**
 * Media attachment for outbound message
 */
export interface OutboundAttachment {
  /** Media type category */
  type: "image" | "audio" | "video" | "document";

  /** URL to send (will be fetched and forwarded) */
  url?: string;

  /** Local file path to send */
  path?: string;

  /** Buffer content to send */
  content?: Buffer;

  /** Filename for the attachment */
  name?: string;

  /** MIME type */
  mimeType?: string;

  /** Send audio as voice bubble (for supported platforms) */
  asVoice?: boolean;
}

/**
 * Outbound message from the gateway to a channel
 */
export interface OutboundMessage {
  /** Message text content */
  text: string;

  /** Channel-specific conversation ID to send to */
  channelId: string;

  /** Thread ID to reply in (for threaded conversations) */
  threadId?: string;

  /** Media attachments to send */
  attachments?: OutboundAttachment[];

  /** Whether to broadcast in channel (vs reply in thread) */
  broadcastToChannel?: boolean;
}

/**
 * Channel adapter interface
 */
export interface ChannelAdapter {
  /** Unique channel type identifier */
  readonly type: string;

  /** Human-readable channel name */
  readonly name: string;

  /** Whether the channel is currently connected */
  readonly isConnected: boolean;

  /**
   * Connect to the channel
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the channel
   */
  disconnect(): Promise<void>;

  /**
   * Send a message to the channel
   */
  sendMessage(message: OutboundMessage): Promise<void>;

  /**
   * Set the message handler for inbound messages
   */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}

/**
 * Channel configuration base
 */
export interface ChannelConfig {
  /** Whether this channel is enabled */
  enabled: boolean;
}

/**
 * Slack-specific configuration
 */
export interface SlackChannelConfig extends ChannelConfig {
  /** Bot User OAuth Token (xoxb-...) */
  botToken: string;

  /** App-Level Token for Socket Mode (xapp-...) */
  appToken: string;

  /** Signing Secret */
  signingSecret: string;

  /** Whether to respond to all messages or only mentions/DMs */
  respondToAllMessages?: boolean;

  /** Allowlist of Slack user IDs that can interact with the bot */
  allowFrom?: string[];
}

/**
 * Telegram-specific configuration
 */
export interface TelegramChannelConfig extends ChannelConfig {
  /** Bot token from @BotFather */
  token: string;

  /** Whether to respond to all messages or only mentions/DMs */
  respondToAllMessages?: boolean;

  /** Allowlist of user IDs or usernames that can interact with the bot */
  allowFrom?: Array<string | number>;

  /** Whether to handle edited messages */
  handleEditedMessages?: boolean;

  /** Whether to drop pending updates on startup */
  dropPendingUpdates?: boolean;
}

/**
 * Discord-specific configuration
 */
export interface DiscordChannelConfig extends ChannelConfig {
  /** Discord bot token */
  token: string;

  /** Application ID for slash commands */
  applicationId?: string;

  /** Guild ID for guild-specific commands (optional) */
  guildId?: string;

  /** Whether to respond to all messages or only mentions/DMs */
  respondToAllMessages?: boolean;

  /** Allowlist of user IDs or usernames that can interact with the bot */
  allowFrom?: Array<string | number>;
}

/**
 * WhatsApp-specific configuration (via WhatsApp Web / Baileys)
 */
export interface WhatsAppChannelConfig extends ChannelConfig {
  /** Session data directory path */
  sessionPath: string;

  /** Whether to respond to all messages or only mentions/DMs */
  respondToAllMessages?: boolean;

  /** Allowlist of phone numbers that can interact with the bot */
  allowFrom?: string[];
}

/**
 * Google Chat-specific configuration
 */
export interface GoogleChatChannelConfig extends ChannelConfig {
  /** Service account credentials JSON path or content */
  credentials: string;

  /** Project ID */
  projectId: string;

  /** Whether to respond to all messages or only mentions/DMs */
  respondToAllMessages?: boolean;
}

/**
 * Signal-specific configuration (via signal-cli)
 */
export interface SignalChannelConfig extends ChannelConfig {
  /** Signal REST API URL (e.g., http://localhost:8080) */
  apiUrl: string;

  /** Registered phone number */
  phoneNumber: string;

  /** Whether to respond to all messages or only mentions/DMs */
  respondToAllMessages?: boolean;

  /** Allowlist of phone numbers that can interact with the bot */
  allowFrom?: string[];
}

/**
 * iMessage-specific configuration
 */
export interface IMessageChannelConfig extends ChannelConfig {
  /** iMessage REST API URL */
  apiUrl: string;

  /** BlueBubbles API password */
  apiPassword?: string;

  /** Whether to respond to all messages */
  respondToAllMessages?: boolean;

  /** Allowlist of contacts that can interact with the bot */
  allowFrom?: string[];
}

/**
 * Supported channel types
 */
export type ChannelType =
  | "slack"
  | "telegram"
  | "discord"
  | "whatsapp"
  | "googlechat"
  | "signal"
  | "imessage"
  | "agent";

/**
 * Channel metadata
 */
export interface ChannelMeta {
  id: ChannelType;
  label: string;
  description: string;
}

/**
 * All supported channels with metadata
 */
export const SUPPORTED_CHANNELS: ChannelMeta[] = [
  {
    id: "telegram",
    label: "Telegram",
    description: "Telegram Bot API - simplest way to get started",
  },
  {
    id: "slack",
    label: "Slack",
    description: "Slack Bot via Socket Mode",
  },
  {
    id: "discord",
    label: "Discord",
    description: "Discord Bot API",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "WhatsApp Web via QR link",
  },
  {
    id: "googlechat",
    label: "Google Chat",
    description: "Google Chat API with HTTP webhook",
  },
  {
    id: "signal",
    label: "Signal",
    description: "Signal via signal-cli linked device",
  },
  {
    id: "imessage",
    label: "iMessage",
    description: "iMessage REST API",
  },
  {
    id: "agent",
    label: "Agent",
    description: "Internal agent channel - no external delivery",
  },
];

/**
 * Thread key generator - creates unique key for conversation tracking
 */
export function createThreadKey(channelType: string, channelId: string, threadId?: string): string {
  if (threadId) {
    return `${channelType}:${channelId}:${threadId}`;
  }
  return `${channelType}:${channelId}`;
}

/**
 * Convert InboundMessage to Mastra message format
 */
export function toMastraCoreMessage(message: InboundMessage): { role: "user"; content: string } {
  return {
    role: "user",
    content: message.text,
  };
}
