// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { ScionConfig } from "../config/config.js";

export type ModelRef = {
  provider: string;
  model: string;
};

export type ModelAliasIndex = Map<string, ModelRef>;

const PROVIDER_ALIASES: Record<string, string> = {
  gemini: "google",
  "google-ai": "google",
};

export function normalizeProviderId(id: string): string {
  const normalized = id.trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

export function resolveDefaultModelForAgent(params: { cfg: ScionConfig }): ModelRef {
  const primary = params.cfg.agents?.defaults?.model?.primary?.trim();
  if (primary) {
    const slashIndex = primary.indexOf("/");
    if (slashIndex > 0) {
      return {
        provider: normalizeProviderId(primary.slice(0, slashIndex)),
        model: primary.slice(slashIndex + 1),
      };
    }
    return { provider: "openai", model: primary };
  }
  return { provider: "openai", model: "gpt-4o-mini" };
}

export function buildModelAliasIndex(_params: {
  cfg: ScionConfig;
  defaultProvider?: string;
}): ModelAliasIndex {
  return new Map();
}

export function resolveModelRefFromString(params: {
  raw: string;
  defaultProvider?: string;
  aliasIndex?: ModelAliasIndex;
}): { ref: ModelRef } | null {
  const raw = params.raw.trim();
  if (!raw) {
    return null;
  }

  const aliasRef = params.aliasIndex?.get(raw);
  if (aliasRef) {
    return { ref: aliasRef };
  }

  const slashIndex = raw.indexOf("/");
  if (slashIndex > 0) {
    return {
      ref: {
        provider: normalizeProviderId(raw.slice(0, slashIndex)),
        model: raw.slice(slashIndex + 1),
      },
    };
  }

  const provider = params.defaultProvider ?? "openai";
  return { ref: { provider: normalizeProviderId(provider), model: raw } };
}
