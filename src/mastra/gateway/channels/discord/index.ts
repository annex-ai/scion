// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export { DiscordAdapter } from "./adapter";
export {
  chunkForDiscord,
  type DiscordMessageEvent,
  fromDiscordFormat,
  toDiscordFormat,
  toInboundMessage,
} from "./format";
