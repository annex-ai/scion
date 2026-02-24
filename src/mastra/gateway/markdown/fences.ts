// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

const FENCE_PATTERN = /^(`{3,}|~{3,})/gm;

export function parseFenceSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let openFence: { marker: string; start: number } | null = null;

  FENCE_PATTERN.lastIndex = 0;
  for (let match = FENCE_PATTERN.exec(text); match !== null; match = FENCE_PATTERN.exec(text)) {
    const marker = match[1];
    const fenceChar = marker[0];
    if (openFence) {
      if (fenceChar === openFence.marker[0] && marker.length >= openFence.marker.length) {
        spans.push({ start: openFence.start, end: match.index + marker.length });
        openFence = null;
      }
    } else {
      openFence = { marker, start: match.index };
    }
  }

  if (openFence) {
    spans.push({ start: openFence.start, end: text.length });
  }

  return spans;
}
