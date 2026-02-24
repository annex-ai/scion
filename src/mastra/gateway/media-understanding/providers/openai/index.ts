// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { MediaUnderstandingProvider } from "../../types.js";
import { transcribeOpenAiCompatibleAudio } from "./audio.js";

export const openaiProvider: MediaUnderstandingProvider = {
  id: "openai",
  capabilities: ["audio"],
  transcribeAudio: transcribeOpenAiCompatibleAudio,
};
