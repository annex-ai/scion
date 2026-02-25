// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export {
  type FormatOptions,
  formatMediaBlocks,
  formatMediaIntoMessage,
} from "./format";
export {
  detectMime,
  getExtensionForMime,
  getFileExtension,
  getMediaKind,
  isVoiceCompatibleAudio,
} from "./mime";

export {
  buildMediaNote,
  type ParsedMediaOutput,
  parseMediaFromOutput,
} from "./parse";
export {
  deleteMediaFile,
  downloadAndSaveMedia,
  readMediaFile,
  type SavedMedia,
  saveMediaBuffer,
} from "./store";
export {
  type MediaUnderstandingOptions,
  processMediaAttachments,
} from "./understand";
