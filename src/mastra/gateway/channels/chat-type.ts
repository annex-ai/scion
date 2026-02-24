// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

const KNOWN_CHAT_TYPES = new Set(["direct", "channel"]);

const CHAT_TYPE_ALIASES: Record<string, string> = {
  dm: "direct",
  "direct-message": "direct",
  private: "direct",
  group: "channel",
};

export function normalizeChatType(raw?: string): string | undefined {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return undefined;
  const resolved = CHAT_TYPE_ALIASES[trimmed] ?? trimmed;
  return KNOWN_CHAT_TYPES.has(resolved) ? resolved : undefined;
}
