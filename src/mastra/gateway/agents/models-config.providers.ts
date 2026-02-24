// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export function normalizeGoogleModelId(modelId: string): string {
  let normalized = modelId.trim();
  if (normalized.startsWith("models/")) {
    normalized = normalized.slice("models/".length);
  }
  // Google Gemini API requires -preview suffix for non-production models
  if (normalized.startsWith("gemini-") && !normalized.endsWith("-preview") && !normalized.endsWith("-latest")) {
    normalized = `${normalized}-preview`;
  }
  return normalized;
}
