// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Soul Configuration Loader
 *
 * Loads soul configuration files (SOUL.md, IDENTITY.md, USER.md) from
 * the public config directory. Uses mtime-based caching for hot reload.
 */

import * as fs from "node:fs/promises";
import { AGENT_DIR } from "../config";

const CONFIG_DIR = AGENT_DIR;

let cache: { identity: string; soul: string; user: string } | null = null;
let cachedMtime = 0;

async function getMaxMtime(): Promise<number> {
  const stats = await Promise.all([
    fs.stat(`${CONFIG_DIR}/IDENTITY.md`).catch(() => null),
    fs.stat(`${CONFIG_DIR}/SOUL.md`).catch(() => null),
    fs.stat(`${CONFIG_DIR}/USER.md`).catch(() => null),
  ]);
  return Math.max(...stats.map((s) => s?.mtimeMs ?? 0));
}

export async function loadSoulFiles() {
  const mtime = await getMaxMtime();

  if (cache && cachedMtime === mtime) {
    return cache;
  }

  cache = {
    identity: await fs.readFile(`${CONFIG_DIR}/IDENTITY.md`, "utf-8").catch(() => ""),
    soul: await fs.readFile(`${CONFIG_DIR}/SOUL.md`, "utf-8").catch(() => ""),
    user: await fs.readFile(`${CONFIG_DIR}/USER.md`, "utf-8").catch(() => ""),
  };
  cachedMtime = mtime;
  return cache;
}
