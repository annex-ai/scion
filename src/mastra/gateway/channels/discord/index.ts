// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export { DiscordAdapter } from "./adapter";
export {
  toInboundMessage,
  toDiscordFormat,
  fromDiscordFormat,
  chunkForDiscord,
  type DiscordMessageEvent,
} from "./format";
