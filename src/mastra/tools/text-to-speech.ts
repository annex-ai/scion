// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { createTool } from "@mastra/core/tools";
import { OpenAIVoice } from "@mastra/voice-openai";
import { z } from "zod";
import { saveMediaBuffer } from "../gateway/channels/media/store";

// Lazy-initialized voice client to avoid startup crash when OPENAI_API_KEY is missing
let voiceClient: OpenAIVoice | null = null;

function getVoiceClient(): OpenAIVoice {
  if (!voiceClient) {
    voiceClient = new OpenAIVoice({
      speaker: "alloy",
    });
  }
  return voiceClient;
}

/**
 * Channel-specific output formats for TTS
 * Opus format is natively supported by Telegram for voice bubbles
 */
const OUTPUT_FORMATS = {
  telegram: {
    responseFormat: "opus" as const,
    extension: ".opus",
    mime: "audio/opus",
    voiceCompatible: true,
  },
  default: {
    responseFormat: "mp3" as const,
    extension: ".mp3",
    mime: "audio/mpeg",
    voiceCompatible: false,
  },
} as const;

export const textToSpeechTool = createTool({
  id: "text-to-speech",
  description:
    "Convert text to speech/audio. Use when the user asks for voice responses or when delivering long responses as audio.",
  inputSchema: z.object({
    text: z.string().describe("The text to convert to speech"),
    voice: z
      .enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"])
      .optional()
      .describe("Voice to use (default: alloy)"),
    channel: z
      .enum(["telegram", "slack", "discord", "whatsapp"])
      .optional()
      .describe("Target channel for optimized audio format"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    filePath: z.string().optional(),
    voiceCompatible: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ text, voice, channel }) => {
    // Select output format based on channel
    const format = channel === "telegram" ? OUTPUT_FORMATS.telegram : OUTPUT_FORMATS.default;

    try {
      // Generate speech using Mastra voice with channel-appropriate format
      const audioStream = await getVoiceClient().speak(text, {
        speaker: voice || "alloy",
        responseFormat: format.responseFormat,
      });

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      // Save to media storage with appropriate MIME type
      const saved = await saveMediaBuffer(buffer, {
        mime: format.mime,
        originalName: `speech-${Date.now()}${format.extension}`,
        direction: "outbound",
      });

      return {
        success: true,
        filePath: saved.path,
        voiceCompatible: format.voiceCompatible,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
});
