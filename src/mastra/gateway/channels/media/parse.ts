// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Parse media references from agent output
 *
 * Agent can output media with:
 *   MEDIA: /path/to/file.jpg
 *   MEDIA: https://example.com/image.png
 *   [[audio_as_voice]]  # optional tag for voice bubbles
 */

/**
 * Parsed media output from agent response
 */
export interface ParsedMediaOutput {
  /** Text content with media references removed */
  text: string;
  /** Array of media URLs or paths */
  mediaUrls: string[];
  /** Whether audio should be sent as voice bubble */
  audioAsVoice: boolean;
}

/**
 * Pattern to match MEDIA: lines
 * Supports:
 *   MEDIA: /absolute/path
 *   MEDIA: ./relative/path
 *   MEDIA: https://url
 *   MEDIA: http://url
 */
const MEDIA_PATTERN = /^MEDIA:\s*(.+)$/gm;

/**
 * Pattern to match audio_as_voice tag
 */
const VOICE_TAG_PATTERN = /\[\[audio_as_voice\]\]/gi;

/**
 * Pattern to detect fenced code blocks
 */
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

/**
 * Parse media references from agent output text
 */
export function parseMediaFromOutput(raw: string): ParsedMediaOutput {
  const mediaUrls: string[] = [];
  let audioAsVoice = false;

  // Find code blocks to exclude them from parsing
  const codeBlocks: Array<{ start: number; end: number }> = [];
  const codeBlockRegex = new RegExp(CODE_BLOCK_PATTERN.source, "g");
  for (let match = codeBlockRegex.exec(raw); match !== null; match = codeBlockRegex.exec(raw)) {
    codeBlocks.push({ start: match.index, end: match.index + match[0].length });
  }

  // Check if position is inside a code block
  function isInCodeBlock(pos: number): boolean {
    return codeBlocks.some((block) => pos >= block.start && pos < block.end);
  }

  // Extract MEDIA: references
  const mediaRegex = new RegExp(MEDIA_PATTERN.source, "gm");
  for (let match = mediaRegex.exec(raw); match !== null; match = mediaRegex.exec(raw)) {
    if (!isInCodeBlock(match.index)) {
      const url = match[1].trim();
      if (url && isValidMediaReference(url)) {
        mediaUrls.push(url);
      }
    }
  }

  // Check for voice tag
  const voiceMatch = raw.match(VOICE_TAG_PATTERN);
  if (voiceMatch) {
    // Make sure it's not in a code block
    const voiceIndex = raw.search(VOICE_TAG_PATTERN);
    if (!isInCodeBlock(voiceIndex)) {
      audioAsVoice = true;
    }
  }

  // Remove media references and voice tags from text
  const text = raw
    .replace(MEDIA_PATTERN, "")
    .replace(VOICE_TAG_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n") // Collapse multiple newlines
    .trim();

  return {
    text,
    mediaUrls,
    audioAsVoice,
  };
}

/**
 * Check if string is a valid media reference (path or URL)
 */
function isValidMediaReference(ref: string): boolean {
  // URL
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    try {
      new URL(ref);
      return true;
    } catch {
      return false;
    }
  }

  // Absolute path
  if (ref.startsWith("/")) {
    return true;
  }

  // Relative path
  if (ref.startsWith("./") || ref.startsWith("../")) {
    return true;
  }

  // Windows path
  if (/^[A-Za-z]:\\/.test(ref)) {
    return true;
  }

  return false;
}

/**
 * Build media note for agent context
 * Describes attached media for the LLM
 */
export function buildMediaNote(
  attachments: Array<{
    path?: string;
    url?: string;
    mime?: string;
    kind?: string;
  }>,
): string {
  if (attachments.length === 0) return "";

  const notes = attachments.map((att, i) => {
    const location = att.path || att.url || "unknown";
    const type = att.kind || att.mime || "file";
    return `[${i + 1}] ${location} (${type})`;
  });

  return `[Media attached]\n${notes.join("\n")}`;
}
