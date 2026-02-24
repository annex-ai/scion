// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { MediaUnderstandingProvider } from "../../types.js";
import { transcribeDeepgramAudio } from "./audio.js";

export const deepgramProvider: MediaUnderstandingProvider = {
  id: "deepgram",
  capabilities: ["audio"],
  transcribeAudio: transcribeDeepgramAudio,
};
