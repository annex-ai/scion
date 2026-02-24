// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { openAgentDb } from "./db";

const db = await openAgentDb();

console.log("=== All Threads ===");
const threads = db.query("SELECT * FROM mastra_threads").all();
console.log(JSON.stringify(threads, null, 2));

console.log("\n=== Messages with thread_id ===");
const messages = db.query("SELECT DISTINCT thread_id, COUNT(*) as count FROM mastra_messages GROUP BY thread_id").all();
console.log(JSON.stringify(messages, null, 2));

console.log("\n=== Memory Messages ===");
const memoryMessages = db.query("SELECT thread_id, COUNT(*) as count FROM memory_messages GROUP BY thread_id").all();
console.log(JSON.stringify(memoryMessages, null, 2));

db.close();
