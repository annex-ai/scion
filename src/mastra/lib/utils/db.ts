// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import Database from "bun:sqlite";
import { getMemoryConfig, resolveConfigPath } from "../config";

/**
 * Open the agent database (readonly) using the path from agent.toml [memory].
 */
export async function openAgentDb(): Promise<Database> {
  const config = await getMemoryConfig();
  const dbPath = resolveConfigPath(config.database_url);
  return new Database(dbPath, { readonly: true });
}
