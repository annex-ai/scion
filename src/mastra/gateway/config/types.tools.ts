// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export type MediaUnderstandingScopeRule = {
  action?: string;
  match?: {
    channel?: string;
    chatType?: string;
    keyPrefix?: string;
  };
};

export type MediaUnderstandingScopeConfig = {
  default?: string;
  rules?: Array<MediaUnderstandingScopeRule | null>;
};

export type MediaUnderstandingAttachmentsConfig = {
  max?: number;
  maxAttachments?: number;
  prefer?: "first" | "last";
  mode?: string;
};

export type MediaUnderstandingModelConfig = {
  type?: "provider" | "cli";
  provider?: string;
  model?: string;
  command?: string;
  args?: string[];
  prompt?: string;
  maxBytes?: number;
  maxChars?: number;
  timeoutSeconds?: number;
  language?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  profile?: string;
  preferredProfile?: string;
  capabilities?: ("image" | "audio" | "video")[];
  providerOptions?: Record<string, Record<string, string | number | boolean>>;
  deepgram?: {
    detectLanguage?: boolean;
    punctuate?: boolean;
    smartFormat?: boolean;
  };
  [key: string]: unknown;
};

export type MediaUnderstandingConfig = {
  enabled?: boolean;
  maxBytes?: number;
  maxChars?: number;
  timeoutSeconds?: number;
  prompt?: string;
  language?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  scope?: MediaUnderstandingScopeConfig;
  attachments?: MediaUnderstandingAttachmentsConfig;
  models?: MediaUnderstandingModelConfig[];
  providerOptions?: Record<string, Record<string, string | number | boolean>>;
  deepgram?: {
    detectLanguage?: boolean;
    punctuate?: boolean;
    smartFormat?: boolean;
  };
  [key: string]: unknown;
};
