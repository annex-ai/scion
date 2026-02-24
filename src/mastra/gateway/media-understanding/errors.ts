// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export type MediaUnderstandingSkipReason = "maxBytes" | "timeout" | "unsupported" | "empty";

export class MediaUnderstandingSkipError extends Error {
  readonly reason: MediaUnderstandingSkipReason;

  constructor(reason: MediaUnderstandingSkipReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "MediaUnderstandingSkipError";
  }
}

export function isMediaUnderstandingSkipError(err: unknown): err is MediaUnderstandingSkipError {
  return err instanceof MediaUnderstandingSkipError;
}
