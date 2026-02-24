// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { ScionConfig } from "../config/config.js";

const ENV_KEY_MAP: Record<string, string[]> = {
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  deepgram: ["DEEPGRAM_API_KEY"],
  groq: ["GROQ_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY", "XI_API_KEY"],
};

export async function resolveApiKeyForProvider(params: {
  provider: string;
  cfg?: ScionConfig;
  agentDir?: string;
  profileId?: string;
  preferredProfile?: string;
}): Promise<{ apiKey?: string; source?: string }> {
  const envKeys = ENV_KEY_MAP[params.provider] ?? [];
  for (const envKey of envKeys) {
    const value = process.env[envKey]?.trim();
    if (value) {
      return { apiKey: value, source: `env:${envKey}` };
    }
  }

  const configKey = params.cfg?.models?.providers?.[params.provider]?.apiKey?.trim();
  if (configKey) {
    return { apiKey: configKey, source: "config" };
  }

  return {};
}

export function requireApiKey(auth: { apiKey?: string } | undefined, provider: string): string {
  const apiKey = auth?.apiKey?.trim();
  if (!apiKey) {
    throw new Error(`Missing API key for provider "${provider}"`);
  }
  return apiKey;
}

export async function getApiKeyForModel(params: {
  model: { provider: string; [key: string]: unknown };
  cfg?: ScionConfig;
  agentDir?: string;
  profileId?: string;
  preferredProfile?: string;
}): Promise<{ apiKey?: string; source?: string }> {
  return resolveApiKeyForProvider({
    provider: params.model.provider,
    cfg: params.cfg,
    agentDir: params.agentDir,
    profileId: params.profileId,
    preferredProfile: params.preferredProfile,
  });
}
