// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import os from "node:os";
import path from "node:path";

/**
 * Root configuration directory for Scion.
 */
export const CONFIG_DIR = process.env.SCION_STATE_DIR ?? path.join(os.homedir(), ".scion");

/**
 * Resolve a user-provided path, expanding ~ to the home directory.
 */
export function resolveUserPath(userPath: string): string {
  if (userPath.startsWith("~/")) {
    return path.join(os.homedir(), userPath.slice(2));
  }
  if (userPath === "~") {
    return os.homedir();
  }
  if (path.isAbsolute(userPath)) {
    return userPath;
  }
  return path.join(CONFIG_DIR, userPath);
}

/**
 * Return the root config directory path.
 */
export function resolveConfigDir(): string {
  return CONFIG_DIR;
}
