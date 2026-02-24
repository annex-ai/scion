// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

// Channel types and utilities
import type {
  ChannelAdapter,
  DiscordChannelConfig,
  GoogleChatChannelConfig,
  IMessageChannelConfig,
  SignalChannelConfig,
  SlackChannelConfig,
  TelegramChannelConfig,
  WhatsAppChannelConfig,
} from "./types";

export {
  createThreadKey,
  toMastraCoreMessage,
  SUPPORTED_CHANNELS,
  type InboundMessage,
  type InboundAttachment,
  type OutboundMessage,
  type OutboundAttachment,
  type ChannelAdapter,
  type ChannelConfig,
  type ChannelType,
  type ChannelMeta,
  type SlackChannelConfig,
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type GoogleChatChannelConfig,
  type SignalChannelConfig,
  type IMessageChannelConfig,
} from "./types";

// Media utilities
export {
  detectMime,
  getMediaKind,
  getFileExtension,
  getExtensionForMime,
  isVoiceCompatibleAudio,
  saveMediaBuffer,
  downloadAndSaveMedia,
  readMediaFile,
  deleteMediaFile,
  parseMediaFromOutput,
  buildMediaNote,
  type SavedMedia,
  type ParsedMediaOutput,
} from "./media";

// Slack adapter
export { SlackAdapter } from "./slack";
export {
  toInboundMessage as toSlackInboundMessage,
  toSlackFormat,
  fromSlackFormat,
  chunkForSlack,
} from "./slack/format";

// Telegram adapter
export { TelegramAdapter } from "./telegram";
export {
  toInboundMessage as toTelegramInboundMessage,
  toTelegramFormat,
  fromTelegramFormat,
  chunkForTelegram,
} from "./telegram/format";

// Discord adapter
export { DiscordAdapter } from "./discord";
export {
  toInboundMessage as toDiscordInboundMessage,
  toDiscordFormat,
  fromDiscordFormat,
  chunkForDiscord,
} from "./discord/format";

// WhatsApp adapter
export { WhatsAppAdapter } from "./whatsapp";
export {
  toInboundMessage as toWhatsAppInboundMessage,
  toWhatsAppFormat,
  chunkForWhatsApp,
} from "./whatsapp/format";

// Google Chat adapter
export { GoogleChatAdapter } from "./googlechat";
export {
  toInboundMessage as toGoogleChatInboundMessage,
  toGoogleChatFormat,
  chunkForGoogleChat,
} from "./googlechat/format";

// Signal adapter
export { SignalAdapter } from "./signal";
export {
  toInboundMessage as toSignalInboundMessage,
  toSignalFormat,
  chunkForSignal,
} from "./signal/format";

// iMessage adapter
export { IMessageAdapter } from "./imessage";
export {
  toInboundMessage as toIMessageInboundMessage,
  toIMessageFormat,
  chunkForIMessage,
} from "./imessage/format";

/**
 * Union type for all channel configs
 */
export type AnyChannelConfig =
  | SlackChannelConfig
  | TelegramChannelConfig
  | DiscordChannelConfig
  | WhatsAppChannelConfig
  | GoogleChatChannelConfig
  | SignalChannelConfig
  | IMessageChannelConfig;

import { DiscordAdapter as DiscordAdapterImpl } from "./discord";
import { GoogleChatAdapter as GoogleChatAdapterImpl } from "./googlechat";
import { IMessageAdapter as IMessageAdapterImpl } from "./imessage";
import { SignalAdapter as SignalAdapterImpl } from "./signal";
/**
 * Factory function to create a channel adapter from config
 */
import { SlackAdapter as SlackAdapterImpl } from "./slack";
import { TelegramAdapter as TelegramAdapterImpl } from "./telegram";
import { WhatsAppAdapter as WhatsAppAdapterImpl } from "./whatsapp";

export async function createAdapter<T extends AnyChannelConfig>(type: string, config: T): Promise<ChannelAdapter> {
  switch (type) {
    case "slack":
      return new SlackAdapterImpl(config as unknown as SlackChannelConfig);
    case "telegram":
      return new TelegramAdapterImpl(config as unknown as TelegramChannelConfig);
    case "discord":
      return new DiscordAdapterImpl(config as unknown as DiscordChannelConfig);
    case "whatsapp":
      return new WhatsAppAdapterImpl(config as unknown as WhatsAppChannelConfig);
    case "googlechat":
      return new GoogleChatAdapterImpl(config as unknown as GoogleChatChannelConfig);
    case "signal":
      return new SignalAdapterImpl(config as unknown as SignalChannelConfig);
    case "imessage":
      return new IMessageAdapterImpl(config as unknown as IMessageChannelConfig);
    default:
      throw new Error(
        `Unknown channel type: ${type}. Supported types: slack, telegram, discord, whatsapp, googlechat, signal, imessage`,
      );
  }
}
