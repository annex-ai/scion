// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { openAgentDb } from "./db";

const db = await openAgentDb();

console.log("=== Tables ===");
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tables:", tables.map((t: any) => t.name).join(", ") || "none");

for (const table of tables as any[]) {
  const count = db.query(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
  console.log(`  - ${table.name}: ${count.count} rows`);
}

db.close();
