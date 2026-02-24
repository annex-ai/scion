// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export type { ChannelId } from "./types.js";

/**
 * Normalize a raw channel string to a canonical ChannelId.
 */
export function normalizeChannelId(channel: string): string {
  return channel.toLowerCase().trim();
}
