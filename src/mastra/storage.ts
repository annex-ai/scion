// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { getMemoryConfig, resolveConfigPath } from "./lib/config";

// Load database URL from agent.toml [memory] section
const memoryConfig = await getMemoryConfig();
const dbUrl = memoryConfig.database_url;

// Resolve relative paths (e.g. "data/local.db") against agent.toml directory.
// Absolute paths and URLs (e.g. "libsql://...") are passed through as-is.
const isUrl = dbUrl.includes("://");
const DB_PATH = isUrl ? dbUrl : `file:${resolveConfigPath(dbUrl)}`;

console.log(`[storage] Using database: ${DB_PATH}`);

// Shared storage instance - used by Mastra for observability, workflows, etc.
// and can be shared with Memory for persistence
export const storage = new LibSQLStore({
  id: "agent-storage",
  url: DB_PATH,
});

export const vector = new LibSQLVector({
  id: "agent-vector",
  url: DB_PATH,
});
