// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import fs from "node:fs/promises";
import path from "node:path";

export class SafeOpenError extends Error {
  code: "invalid-path" | "not-found";
  constructor(message: string, code: "invalid-path" | "not-found") {
    super(message);
    this.name = "SafeOpenError";
    this.code = code;
  }
}

/**
 * Open a file safely, ensuring it stays within the given root directory.
 * Prevents path traversal attacks.
 */
export async function openFileWithinRoot(params: { rootDir: string; relativePath: string }): Promise<{
  handle: fs.FileHandle;
  realPath: string;
  stat: Awaited<ReturnType<typeof fs.stat>>;
}> {
  const resolved = path.resolve(params.rootDir, params.relativePath);
  const rootResolved = path.resolve(params.rootDir);

  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new SafeOpenError(`Path traversal detected: ${params.relativePath}`, "invalid-path");
  }

  let realPath: string;
  try {
    realPath = await fs.realpath(resolved);
  } catch {
    throw new SafeOpenError(`File not found: ${params.relativePath}`, "not-found");
  }

  if (!realPath.startsWith(rootResolved + path.sep) && realPath !== rootResolved) {
    throw new SafeOpenError(`Symlink escapes root: ${params.relativePath}`, "invalid-path");
  }

  const stat = await fs.stat(realPath);
  const handle = await fs.open(realPath, "r");
  return { handle, realPath, stat };
}
