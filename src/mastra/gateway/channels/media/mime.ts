// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * MIME type detection and utilities
 */

import { fileTypeFromBuffer } from "file-type";

/**
 * Extension to MIME type mapping
 */
const MIME_BY_EXT: Record<string, string> = {
  // Images
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  // Documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".json": "application/json",
  ".xml": "application/xml",
};

/**
 * Voice-compatible audio formats (can be sent as voice bubbles)
 */
const VOICE_AUDIO_EXTENSIONS = new Set([".oga", ".ogg", ".opus"]);
const VOICE_AUDIO_MIMES = new Set(["audio/ogg", "audio/opus"]);

/**
 * Get file extension from path or filename
 */
export function getFileExtension(filePath?: string | null): string {
  if (!filePath) return "";
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filePath.slice(lastDot).toLowerCase();
}

/**
 * Detect MIME type from buffer, extension, and header
 */
export async function detectMime(opts: {
  buffer?: Buffer;
  headerMime?: string | null;
  filePath?: string | null;
}): Promise<string> {
  // Strategy 1: Sniff buffer magic bytes
  if (opts.buffer) {
    const detected = await fileTypeFromBuffer(opts.buffer);
    if (detected?.mime) {
      return detected.mime;
    }
  }

  // Strategy 2: Map file extension
  const ext = getFileExtension(opts.filePath);
  if (ext && MIME_BY_EXT[ext]) {
    return MIME_BY_EXT[ext];
  }

  // Strategy 3: Use header MIME (if not generic)
  if (opts.headerMime && !isGenericMime(opts.headerMime)) {
    return opts.headerMime;
  }

  return "application/octet-stream";
}

/**
 * Check if MIME type is generic/uninformative
 */
function isGenericMime(mime: string): boolean {
  const generic = ["application/octet-stream", "application/zip", "binary/octet-stream"];
  return generic.includes(mime.toLowerCase());
}

/**
 * Get media kind from MIME type
 */
export function getMediaKind(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/**
 * Check if audio can be sent as voice bubble
 */
export function isVoiceCompatibleAudio(opts: { contentType?: string | null; fileName?: string | null }): boolean {
  const mime = opts.contentType?.toLowerCase();
  if (mime && VOICE_AUDIO_MIMES.has(mime)) {
    return true;
  }
  const ext = getFileExtension(opts.fileName);
  return VOICE_AUDIO_EXTENSIONS.has(ext);
}

/**
 * Get appropriate file extension for MIME type
 * @throws Error if MIME type is not in the lookup table
 */
export function getExtensionForMime(mime: string): string {
  for (const [ext, m] of Object.entries(MIME_BY_EXT)) {
    if (m === mime) return ext;
  }
  throw new Error(`Unknown MIME type: ${mime}. Add it to MIME_BY_EXT in mime.ts`);
}
