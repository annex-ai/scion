// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Media text formatting utilities
 *
 * Formats media descriptions and transcripts into readable text blocks
 * that can be prepended to message text for the main agent.
 */

import type { InboundAttachment } from "../types.js";

/**
 * Format options
 */
export interface FormatOptions {
  /** Prefix for image descriptions (default: "Image") */
  imagePrefix?: string;
  /** Prefix for audio transcripts (default: "Audio Transcript") */
  audioPrefix?: string;
  /** Prefix for video descriptions (default: "Video") */
  videoPrefix?: string;
  /** Whether to include metadata like duration/dimensions (default: false) */
  includeMetadata?: boolean;
}

/**
 * Format a single attachment into a text block
 */
function formatAttachment(attachment: InboundAttachment, options: FormatOptions = {}): string | null {
  const {
    imagePrefix = "Image",
    audioPrefix = "Audio Transcript",
    videoPrefix = "Video",
    includeMetadata = false,
  } = options;

  // Build metadata string if requested
  let metadata = "";
  if (includeMetadata) {
    const parts: string[] = [];

    if (attachment.name) {
      parts.push(attachment.name);
    }
    if (attachment.duration !== undefined) {
      parts.push(`${attachment.duration}s`);
    }
    if (attachment.width && attachment.height) {
      parts.push(`${attachment.width}x${attachment.height}`);
    }

    if (parts.length) {
      metadata = ` (${parts.join(", ")})`;
    }
  }

  switch (attachment.type) {
    case "image":
      if (attachment.description) {
        return `[${imagePrefix}${metadata}: ${attachment.description}]`;
      }
      break;

    case "audio":
      if (attachment.transcript) {
        return `[${audioPrefix}${metadata}: ${attachment.transcript}]`;
      }
      break;

    case "video":
      if (attachment.description) {
        return `[${videoPrefix}${metadata}: ${attachment.description}]`;
      }
      break;

    case "document":
      // Documents are not processed for understanding
      // Could add filename note here if needed
      break;
  }

  return null;
}

/**
 * Format all media attachments into text blocks
 *
 * Creates formatted blocks like:
 * - [Image: A sunset over mountains with orange clouds]
 * - [Audio Transcript: Hello, can you help me with...]
 * - [Video: A person demonstrating how to fold paper]
 *
 * @param attachments - Array of processed attachments
 * @param options - Formatting options
 * @returns Formatted text with newlines between blocks, or empty string if no content
 */
export function formatMediaBlocks(attachments: InboundAttachment[], options: FormatOptions = {}): string {
  if (!attachments?.length) {
    return "";
  }

  const blocks: string[] = [];

  for (const attachment of attachments) {
    const block = formatAttachment(attachment, options);
    if (block) {
      blocks.push(block);
    }
  }

  return blocks.join("\n");
}

/**
 * Format media descriptions into a message
 *
 * Prepends media blocks to the original message text.
 *
 * @param originalText - The original message text
 * @param attachments - Array of processed attachments
 * @param options - Formatting options
 * @returns Combined message with media blocks prepended
 */
export function formatMediaIntoMessage(
  originalText: string,
  attachments: InboundAttachment[],
  options: FormatOptions = {},
): string {
  const mediaBlocks = formatMediaBlocks(attachments, options);

  if (!mediaBlocks) {
    return originalText;
  }

  // Combine media blocks with original text
  // Add double newline for separation
  if (originalText.trim()) {
    return `${mediaBlocks}\n\n${originalText}`;
  }

  // If no original text, just return the media blocks
  return mediaBlocks;
}
