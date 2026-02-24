// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Parse inline directive tags like [[audio_as_voice]] from message text.
 * Returns the cleaned text and extracted flags.
 */
export function parseInlineDirectives(
  text: string | undefined,
  options: { stripReplyTags: boolean },
): { text: string; audioAsVoice: boolean; hasAudioTag: boolean } {
  if (!text) {
    return { text: "", audioAsVoice: false, hasAudioTag: false };
  }

  let audioAsVoice = false;
  let hasAudioTag = false;
  let cleaned = text;

  const tagPattern = /\[\[(\w+)\]\]/g;
  cleaned = cleaned.replace(tagPattern, (_match, tag: string) => {
    const normalized = tag.toLowerCase();
    if (normalized === "audio_as_voice") {
      audioAsVoice = true;
      hasAudioTag = true;
      return "";
    }
    if (normalized === "audio" || normalized === "audio_as_file") {
      hasAudioTag = true;
      return "";
    }
    return _match;
  });

  if (options.stripReplyTags) {
    cleaned = cleaned.replace(/\[\[reply\]\]/gi, "");
  }

  return { text: cleaned.trim(), audioAsVoice, hasAudioTag };
}
