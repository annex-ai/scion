// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Context bag for the media understanding pipeline.
 * Carries message metadata and runtime variables for CLI template expansion
 * (e.g., {{MediaPath}}, {{OutputDir}}, {{Prompt}}).
 */
export type MediaContext = Record<string, unknown>;

/**
 * Expand {{key}} placeholders in CLI arguments using context values.
 */
export function applyTemplate(template: string, ctx: MediaContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = ctx[key];
    return val != null ? String(val) : "";
  });
}

/**
 * Normalize inbound context (identity pass-through for now).
 */
export function finalizeInboundContext(ctx: MediaContext): MediaContext {
  return ctx;
}
