// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { MediaUnderstandingProvider } from "../../types.js";
import { transcribeGeminiAudio } from "./audio.js";
import { describeGeminiImage } from "./image.js";
import { describeGeminiVideo } from "./video.js";

export const googleProvider: MediaUnderstandingProvider = {
  id: "google",
  capabilities: ["image", "audio", "video"],
  describeImage: describeGeminiImage,
  transcribeAudio: transcribeGeminiAudio,
  describeVideo: describeGeminiVideo,
};
