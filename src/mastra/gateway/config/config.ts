// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { MediaUnderstandingConfig, MediaUnderstandingModelConfig } from "./types.tools.js";

export type ScionConfig = {
  messages?: {
    tts?: {
      enabled?: boolean;
      auto?: string;
      mode?: string;
      provider?: string;
      summaryModel?: string;
      prefsPath?: string;
      maxTextLength?: number;
      timeoutMs?: number;
      modelOverrides?: {
        enabled?: boolean;
        allowText?: boolean;
        allowProvider?: boolean;
        allowVoice?: boolean;
        allowModelId?: boolean;
        allowVoiceSettings?: boolean;
        allowNormalization?: boolean;
        allowSeed?: boolean;
      };
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
  };
  tools?: {
    media?: {
      enabled?: boolean;
      concurrency?: number;
      models?: MediaUnderstandingModelConfig[];
      audio?: MediaUnderstandingConfig;
      image?: MediaUnderstandingConfig;
      video?: MediaUnderstandingConfig;
    };
  };
  models?: {
    providers?: Record<string, { baseUrl?: string; headers?: Record<string, string>; apiKey?: string }>;
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
      };
    };
  };
  [key: string]: unknown;
};
