// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { parseInlineDirectives } from "../../utils/directive-tags.js";

/**
 * Extract audio mode tag from text.
 * Supports [[audio_as_voice]] to send audio as voice bubble instead of file.
 * Default is file (preserves backward compatibility).
 */
export function parseAudioTag(text?: string): {
  text: string;
  audioAsVoice: boolean;
  hadTag: boolean;
} {
  const result = parseInlineDirectives(text, { stripReplyTags: false });
  return {
    text: result.text,
    audioAsVoice: result.audioAsVoice,
    hadTag: result.hasAudioTag,
  };
}
