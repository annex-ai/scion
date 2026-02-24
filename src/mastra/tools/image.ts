// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import sharp from "sharp";
import { z } from "zod";

/**
 * Expand ~ in path to home directory
 */
function expandPath(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }
  if (filePath.startsWith("~/")) {
    return os.homedir() + filePath.slice(1);
  }
  return filePath;
}

/**
 * Resolve path relative to cwd
 */
function resolvePath(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(cwd, expanded);
}

/**
 * Get MIME type from extension
 */
function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
  };
  return types[ext.toLowerCase()] || "application/octet-stream";
}

/**
 * Format bytes as human-readable size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const imageTool = createTool({
  id: "read-image",
  inputSchema: z.object({
    file_path: z.string().describe("Path to the image file (relative or absolute)"),
    max_width: z
      .number()
      .optional()
      .describe("Maximum width in pixels. Image will be scaled down if larger, preserving aspect ratio."),
    max_height: z
      .number()
      .optional()
      .describe("Maximum height in pixels. Image will be scaled down if larger, preserving aspect ratio."),
    quality: z.number().optional().default(80).describe("JPEG/WebP quality (1-100). Default: 80"),
    format: z
      .enum(["jpeg", "png", "webp", "original"])
      .optional()
      .default("original")
      .describe("Output format. Default: original"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    file_name: z.string().optional(),
    mime_type: z.string().optional(),
    original_size: z.string().optional(),
    original_dimensions: z
      .object({
        width: z.number(),
        height: z.number(),
      })
      .optional(),
    output_dimensions: z
      .object({
        width: z.number(),
        height: z.number(),
      })
      .optional(),
    output_size: z.string().optional(),
    base64: z.string().optional().describe("Base64-encoded image data"),
    data_url: z.string().optional().describe("Data URL ready for embedding"),
    error: z.string().optional(),
  }),
  description:
    "Reads and processes an image file. Accepts a file path and optional resizing parameters (max_width, max_height, quality, format). Returns base64-encoded image data, dimensions, and a data URL ready for embedding. Use this tool when you need to read images, resize them for processing, convert formats, or prepare images for embedding in documents or web pages. Supports JPEG, PNG, WebP, GIF, and other common formats.",
  execute: async ({ file_path, max_width, max_height, quality, format }) => {
    const cwd = process.cwd();
    const absolutePath = resolvePath(file_path, cwd);

    try {
      // Get file stats
      const stats = await stat(absolutePath);
      const originalSize = formatSize(stats.size);
      const ext = extname(absolutePath);
      const fileName = basename(absolutePath);

      // Read the image
      const buffer = await readFile(absolutePath);

      // Use sharp for metadata and resizing
      let image = sharp(buffer);
      const metadata = await image.metadata();

      const originalDimensions = {
        width: metadata.width || 0,
        height: metadata.height || 0,
      };

      // Determine if resizing is needed
      const needsResize =
        (max_width && originalDimensions.width > max_width) || (max_height && originalDimensions.height > max_height);

      let outputBuffer: Buffer;
      let outputMimeType: string;
      let outputDimensions = { ...originalDimensions };

      if (needsResize || format !== "original") {
        // Apply resizing if needed
        if (needsResize) {
          image = image.resize({
            width: max_width,
            height: max_height,
            fit: "inside",
            withoutEnlargement: true,
          });
        }

        // Apply format conversion
        switch (format) {
          case "jpeg":
            image = image.jpeg({ quality: quality || 80 });
            outputMimeType = "image/jpeg";
            break;
          case "png":
            image = image.png();
            outputMimeType = "image/png";
            break;
          case "webp":
            image = image.webp({ quality: quality || 80 });
            outputMimeType = "image/webp";
            break;
          default:
            // Keep original format but still process through sharp for resizing
            outputMimeType = getMimeType(ext);
            if (metadata.format === "jpeg") {
              image = image.jpeg({ quality: quality || 80 });
            } else if (metadata.format === "png") {
              image = image.png();
            } else if (metadata.format === "webp") {
              image = image.webp({ quality: quality || 80 });
            }
        }

        outputBuffer = await image.toBuffer();

        // Get output dimensions
        const outputMetadata = await sharp(outputBuffer).metadata();
        outputDimensions = {
          width: outputMetadata.width || 0,
          height: outputMetadata.height || 0,
        };
      } else {
        // No processing needed, use original
        outputBuffer = buffer;
        outputMimeType = getMimeType(ext);
      }

      const base64 = outputBuffer.toString("base64");
      const dataUrl = `data:${outputMimeType};base64,${base64}`;

      return {
        success: true,
        file_name: fileName,
        mime_type: outputMimeType,
        original_size: originalSize,
        original_dimensions: originalDimensions,
        output_dimensions: outputDimensions,
        output_size: formatSize(outputBuffer.length),
        base64,
        data_url: dataUrl,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read image: ${error.message}`,
      };
    }
  },
});
