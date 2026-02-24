// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export {
  detectMime,
  getMediaKind,
  getFileExtension,
  getExtensionForMime,
  isVoiceCompatibleAudio,
} from "./mime";

export {
  saveMediaBuffer,
  downloadAndSaveMedia,
  readMediaFile,
  deleteMediaFile,
  type SavedMedia,
} from "./store";

export {
  parseMediaFromOutput,
  buildMediaNote,
  type ParsedMediaOutput,
} from "./parse";

export {
  processMediaAttachments,
  type MediaUnderstandingOptions,
} from "./understand";

export {
  formatMediaBlocks,
  formatMediaIntoMessage,
  type FormatOptions,
} from "./format";
