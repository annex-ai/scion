// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export function shouldLogVerbose(): boolean {
  return Boolean(process.env.SCION_VERBOSE || process.env.DEBUG);
}

export function logVerbose(message: string): void {
  if (shouldLogVerbose()) {
    process.stderr.write(`[scion] ${message}\n`);
  }
}

export function danger(message: string): void {
  process.stderr.write(`[scion:warn] ${message}\n`);
}
