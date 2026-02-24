// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Media understanding module
 *
 * Uses Google's Gemini model to process media attachments:
 * - Images → description text
 * - Audio → transcript text
 * - Video → description text
 *
 * This preprocessing allows fast text-only models to handle the conversation
 * while Gemini handles the heavy lifting of media understanding.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import type { InboundAttachment } from "../types.js";
import { readMediaFile } from "./store.js";

/**
 * Default model for media understanding
 * gemini-2.0-flash is fast and supports image, audio, and video
 */
const DEFAULT_MODEL = "gemini-3-flash-preview";

/**
 * Default timeout for API calls (3 minutes)
 */
const DEFAULT_TIMEOUT_MS = 180000;

/**
 * Prompts for each media type
 */
const PROMPTS = {
  image: "Describe this image concisely for a chat assistant.",
  audio:
    "Transcribe this audio word-for-word. Return ONLY the exact transcript text with no commentary, analysis, formatting, or additional text. Do not add any introduction, summary, or suggestions. If the audio contains no speech, is silent, is corrupted, or cannot be understood, respond with exactly: No audio detected",
  video: "Describe what happens in this video concisely.",
} as const;

/**
 * Media understanding options
 */
export interface MediaUnderstandingOptions {
  /** Google API key (defaults to GOOGLE_API_KEY env var) */
  apiKey?: string;
  /** Model to use (defaults to gemini-2.0-flash) */
  model?: string;
  /** Timeout in milliseconds (defaults to 30000) */
  timeoutMs?: number;
}

/**
 * Create the Google AI provider
 */
function createProvider(apiKey?: string) {
  const key = apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable is required for media understanding");
  }
  return createGoogleGenerativeAI({ apiKey: key });
}

/**
 * Process a single media attachment with Gemini
 */
async function processAttachment(
  attachment: InboundAttachment,
  options: MediaUnderstandingOptions = {},
): Promise<InboundAttachment> {
  console.log("[media-understand] processAttachment called:", {
    type: attachment.type,
    path: attachment.path,
    mimeType: attachment.mimeType,
    hasTranscript: !!attachment.transcript,
    hasDescription: !!attachment.description,
  });

  // Skip if no local path available
  if (!attachment.path) {
    console.warn("[media-understand] No local path for attachment, skipping");
    return attachment;
  }

  // Skip document type - not supported for understanding
  if (attachment.type === "document") {
    console.log("[media-understand] Skipping document type");
    return attachment;
  }

  // Skip if already processed
  if (attachment.description || attachment.transcript) {
    console.log("[media-understand] Already processed, skipping");
    return attachment;
  }

  try {
    const google = createProvider(options.apiKey);
    const modelId = options.model ?? DEFAULT_MODEL;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    console.log("[media-understand] Using model:", modelId, "timeout:", timeoutMs);

    // Read the media file and convert to Uint8Array
    // See: https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai#file-inputs
    const buffer = await readMediaFile(attachment.path);
    const uint8Array = new Uint8Array(buffer);
    console.log("[media-understand] Read file, size:", buffer.length, "bytes, Uint8Array length:", uint8Array.length);

    // Determine MIME type
    const mimeType = attachment.mimeType ?? getMimeTypeForType(attachment.type);
    console.log("[media-understand] Using mimeType:", mimeType);

    // Get the appropriate prompt
    const prompt = PROMPTS[attachment.type];
    console.log("[media-understand] Using prompt:", prompt);

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log("[media-understand] Calling Gemini generateText with mediaType:", mimeType);
      const result = await generateText({
        model: google(modelId),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              {
                type: "file",
                data: uint8Array,
                mediaType: mimeType,
              },
            ],
          },
        ],
        abortSignal: controller.signal,
      });

      clearTimeout(timeout);

      console.log("[media-understand] Gemini response received, text length:", result.text?.length);
      console.log("[media-understand] ========== TRANSCRIPT START ==========");
      console.log(result.text);
      console.log("[media-understand] ========== TRANSCRIPT END ==========");

      // Return enriched attachment
      const enriched: InboundAttachment = { ...attachment };

      if (attachment.type === "audio") {
        enriched.transcript = result.text;
        console.log("[media-understand] Set transcript for audio");
      } else {
        // image or video
        enriched.description = result.text;
        console.log("[media-understand] Set description for", attachment.type);
      }

      return enriched;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    // Log error but don't fail - return original attachment
    console.error("[media-understand] Failed to process attachment:", error);
    return attachment;
  }
}

/**
 * Get a default MIME type for an attachment type
 */
function getMimeTypeForType(type: "image" | "audio" | "video"): string {
  switch (type) {
    case "image":
      return "image/jpeg";
    case "audio":
      return "audio/mp3";
    case "video":
      return "video/mp4";
  }
}

/**
 * Process all media attachments in a message
 *
 * @param attachments - Array of inbound attachments
 * @param options - Processing options
 * @returns Attachments with description/transcript fields populated
 */
export async function processMediaAttachments(
  attachments: InboundAttachment[],
  options: MediaUnderstandingOptions = {},
): Promise<InboundAttachment[]> {
  console.log("[media-understand] processMediaAttachments called with", attachments.length, "attachments");

  if (!attachments.length) {
    console.log("[media-understand] No attachments to process");
    return attachments;
  }

  // Check if API key is available
  const apiKey = options.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.warn("[media-understand] GOOGLE_GENERATIVE_AI_API_KEY not set, skipping media processing");
    return attachments;
  }

  console.log("[media-understand] API key available, processing attachments...");

  // Process each attachment
  // We could parallelize this, but sequential is safer for rate limits
  const processed: InboundAttachment[] = [];

  for (const attachment of attachments) {
    console.log("[media-understand] Processing attachment:", attachment.type, attachment.path);
    const result = await processAttachment(attachment, { ...options, apiKey });
    processed.push(result);
  }

  console.log("[media-understand] All attachments processed");
  return processed;
}
