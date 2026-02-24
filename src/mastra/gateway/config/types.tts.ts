// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export type TtsAutoMode = "off" | "always" | "inbound" | "tagged";
export type TtsMode = "final" | "streaming";
export type TtsProvider = "openai" | "elevenlabs" | "edge";

export type TtsModelOverrideConfig = {
  enabled?: boolean;
  allowText?: boolean;
  allowProvider?: boolean;
  allowVoice?: boolean;
  allowModelId?: boolean;
  allowVoiceSettings?: boolean;
  allowNormalization?: boolean;
  allowSeed?: boolean;
};

export type TtsConfig = {
  enabled?: boolean;
  auto?: string;
  mode?: TtsMode;
  provider?: TtsProvider;
  summaryModel?: string;
  prefsPath?: string;
  maxTextLength?: number;
  timeoutMs?: number;
  modelOverrides?: TtsModelOverrideConfig;
  elevenlabs?: {
    apiKey?: string;
    baseUrl?: string;
    voiceId?: string;
    modelId?: string;
    seed?: number;
    applyTextNormalization?: "auto" | "on" | "off";
    languageCode?: string;
    voiceSettings?: {
      stability?: number;
      similarityBoost?: number;
      style?: number;
      useSpeakerBoost?: boolean;
      speed?: number;
    };
  };
  openai?: {
    apiKey?: string;
    model?: string;
    voice?: string;
  };
  edge?: {
    enabled?: boolean;
    voice?: string;
    lang?: string;
    outputFormat?: string;
    pitch?: string;
    rate?: string;
    volume?: string;
    saveSubtitles?: boolean;
    proxy?: string;
    timeoutMs?: number;
  };
};
