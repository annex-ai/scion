// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Format a CLI command for display in error messages and logs.
 */
export function formatCliCommand(command: string): string {
  return `\`${command}\``;
}
