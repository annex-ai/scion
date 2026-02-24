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

// Discord adapter
export { DiscordAdapter } from "./discord";
export {
  chunkForDiscord,
  fromDiscordFormat,
  toDiscordFormat,
  toInboundMessage as toDiscordInboundMessage,
} from "./discord/format";
// Google Chat adapter
export { GoogleChatAdapter } from "./googlechat";
export {
  chunkForGoogleChat,
  toGoogleChatFormat,
  toInboundMessage as toGoogleChatInboundMessage,
} from "./googlechat/format";
// iMessage adapter
export { IMessageAdapter } from "./imessage";
export {
  chunkForIMessage,
  toIMessageFormat,
  toInboundMessage as toIMessageInboundMessage,
} from "./imessage/format";
// Media utilities
export {
  buildMediaNote,
  deleteMediaFile,
  detectMime,
  downloadAndSaveMedia,
  getExtensionForMime,
  getFileExtension,
  getMediaKind,
  isVoiceCompatibleAudio,
  type ParsedMediaOutput,
  parseMediaFromOutput,
  readMediaFile,
  type SavedMedia,
  saveMediaBuffer,
} from "./media";
// Signal adapter
export { SignalAdapter } from "./signal";
export {
  chunkForSignal,
  toInboundMessage as toSignalInboundMessage,
  toSignalFormat,
} from "./signal/format";
// Slack adapter
export { SlackAdapter } from "./slack";
export {
  chunkForSlack,
  fromSlackFormat,
  toInboundMessage as toSlackInboundMessage,
  toSlackFormat,
} from "./slack/format";
// Telegram adapter
export { TelegramAdapter } from "./telegram";
export {
  chunkForTelegram,
  fromTelegramFormat,
  toInboundMessage as toTelegramInboundMessage,
  toTelegramFormat,
} from "./telegram/format";
export {
  type ChannelAdapter,
  type ChannelConfig,
  type ChannelMeta,
  type ChannelType,
  createThreadKey,
  type DiscordChannelConfig,
  type GoogleChatChannelConfig,
  type IMessageChannelConfig,
  type InboundAttachment,
  type InboundMessage,
  type OutboundAttachment,
  type OutboundMessage,
  type SignalChannelConfig,
  type SlackChannelConfig,
  SUPPORTED_CHANNELS,
  type TelegramChannelConfig,
  toMastraCoreMessage,
  type WhatsAppChannelConfig,
} from "./types";
// WhatsApp adapter
export { WhatsAppAdapter } from "./whatsapp";
export {
  chunkForWhatsApp,
  toInboundMessage as toWhatsAppInboundMessage,
  toWhatsAppFormat,
} from "./whatsapp/format";

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
