// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { openAgentDb } from "./db";

const db = await openAgentDb();

console.log("=== Threads ===");
const threads = db.query("SELECT * FROM mastra_threads").all();
console.log(JSON.stringify(threads, null, 2));

console.log("\n=== Messages ===");
const messages = db.query("SELECT thread_id, role, content FROM mastra_messages LIMIT 10").all();
console.log(JSON.stringify(messages, null, 2));

db.close();
