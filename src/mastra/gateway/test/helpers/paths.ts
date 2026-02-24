// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import path from "node:path";

/**
 * Test helper: check if a path is within a base directory.
 */
export function isPathWithinBase(basePath: string, checkPath: string): boolean {
  const resolved = path.resolve(checkPath);
  const base = path.resolve(basePath);
  return resolved.startsWith(base + path.sep) || resolved === base;
}
