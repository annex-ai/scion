// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { normalizeGoogleModelId } from "../../../agents/models-config.providers.js";
import type { ImageDescriptionRequest, ImageDescriptionResult } from "../../types.js";
import { fetchWithTimeout, normalizeBaseUrl, readErrorResponse } from "../shared.js";

export const DEFAULT_GOOGLE_IMAGE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-3-flash-preview";
const DEFAULT_GOOGLE_IMAGE_PROMPT = "Describe the image.";

function resolveModel(model?: string): string {
  const trimmed = model?.trim();
  if (!trimmed) {
    return DEFAULT_GOOGLE_IMAGE_MODEL;
  }
  return normalizeGoogleModelId(trimmed);
}

function resolvePrompt(prompt?: string): string {
  const trimmed = prompt?.trim();
  return trimmed || DEFAULT_GOOGLE_IMAGE_PROMPT;
}

export async function describeGeminiImage(params: ImageDescriptionRequest): Promise<ImageDescriptionResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const baseUrl = normalizeBaseUrl(params.baseUrl, DEFAULT_GOOGLE_IMAGE_BASE_URL);
  const model = resolveModel(params.model);
  const url = `${baseUrl}/models/${model}:generateContent`;

  const headers = new Headers(params.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("x-goog-api-key")) {
    headers.set("x-goog-api-key", params.apiKey);
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: resolvePrompt(params.prompt) },
          {
            inline_data: {
              mime_type: params.mime ?? "image/jpeg",
              data: params.buffer.toString("base64"),
            },
          },
        ],
      },
    ],
  };

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    params.timeoutMs,
    fetchFn,
  );

  if (!res.ok) {
    const detail = await readErrorResponse(res);
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`Image description failed (HTTP ${res.status})${suffix}`);
  }

  const payload = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part?.text?.trim())
    .filter(Boolean)
    .join("\n");
  if (!text) {
    throw new Error("Image description response missing text");
  }
  return { text, model };
}
