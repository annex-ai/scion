// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Media storage utilities
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectMime, getExtensionForMime, getMediaKind } from "./mime";

/**
 * Default media storage directory
 */
const DEFAULT_MEDIA_DIR = ".scion/media";

/**
 * Default max file size (5MB)
 */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Saved media file info
 */
export interface SavedMedia {
  path: string;
  mime: string;
  kind: "image" | "audio" | "video" | "document";
  size: number;
  originalName?: string;
}

/**
 * Sanitize filename for storage
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100);
}

/**
 * Ensure media directory exists
 */
async function ensureMediaDir(subdir: "inbound" | "outbound"): Promise<string> {
  const baseDir = process.env.MEDIA_DIR || DEFAULT_MEDIA_DIR;
  const dir = join(baseDir, subdir);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  return dir;
}

/**
 * Save a media buffer to disk
 */
export async function saveMediaBuffer(
  buffer: Buffer,
  opts: {
    mime?: string;
    originalName?: string;
    direction: "inbound" | "outbound";
    maxBytes?: number;
  },
): Promise<SavedMedia> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // Check size limit
  if (buffer.length > maxBytes) {
    throw new Error(`Media file too large: ${buffer.length} bytes (max: ${maxBytes})`);
  }

  // Detect MIME type
  const mime = opts.mime || (await detectMime({ buffer, filePath: opts.originalName }));
  const kind = getMediaKind(mime);

  // Build filename
  const ext = getExtensionForMime(mime) || ".bin";
  const safeName = opts.originalName ? sanitizeFilename(opts.originalName) : "media";
  const uuid = randomUUID().slice(0, 8);
  const filename = `${safeName}---${uuid}${ext}`;

  // Save to disk
  const dir = await ensureMediaDir(opts.direction);
  const path = join(dir, filename);
  await writeFile(path, buffer);

  return {
    path,
    mime,
    kind,
    size: buffer.length,
    originalName: opts.originalName,
  };
}

/**
 * Download media from URL and save
 */
export async function downloadAndSaveMedia(
  url: string,
  opts: {
    direction: "inbound" | "outbound";
    maxBytes?: number;
    timeoutMs?: number;
  },
): Promise<SavedMedia> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? 30000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    const buffer = Buffer.from(await response.arrayBuffer());

    // Extract filename from URL or Content-Disposition
    let originalName: string | undefined;
    const disposition = response.headers.get("content-disposition");
    if (disposition) {
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match) {
        originalName = match[1].replace(/['"]/g, "");
      }
    }
    if (!originalName) {
      const urlPath = new URL(url).pathname;
      originalName = urlPath.split("/").pop() || undefined;
    }

    return saveMediaBuffer(buffer, {
      mime: contentType || undefined,
      originalName,
      direction: opts.direction,
      maxBytes,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read media file from disk
 */
export async function readMediaFile(path: string): Promise<Buffer> {
  return readFile(path);
}

/**
 * Delete media file
 */
export async function deleteMediaFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
