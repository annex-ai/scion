// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { openAgentDb } from "./db";

const db = await openAgentDb();

// Tables overview
console.log("=== Tables ===");
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(tables.map((t: any) => t.name).join(", "));

// mastra_resources (working memory lives here with resource scope)
console.log("\n=== mastra_resources ===");
const resSchema = db.query("PRAGMA table_info(mastra_resources)").all();
console.log("schema:", resSchema.map((c: any) => `${c.name}(${c.type})`).join(", "));

const resources = db.query("SELECT * FROM mastra_resources").all();
for (const r of resources as any[]) {
  console.log(`\n  id: ${r.id}`);
  console.log(`  createdAt: ${r.createdAt}`);
  console.log(`  updatedAt: ${r.updatedAt}`);
  console.log(`  metadata: ${r.metadata}`);
  console.log(`  workingMemory (${r.workingMemory?.length ?? 0} chars):`);
  if (r.workingMemory) {
    for (const line of r.workingMemory.split("\n")) {
      console.log(`    ${line}`);
    }
  }
}
if ((resources as any[]).length === 0) {
  console.log("  (empty)");
}

// mastra_threads
console.log("\n=== mastra_threads ===");
const threadSchema = db.query("PRAGMA table_info(mastra_threads)").all();
console.log("schema:", threadSchema.map((c: any) => `${c.name}(${c.type})`).join(", "));

const threads = db
  .query("SELECT id, resourceId, title, createdAt, updatedAt FROM mastra_threads ORDER BY updatedAt DESC")
  .all();
for (const t of threads as any[]) {
  console.log(`  thread=${t.id}  resource=${t.resourceId}  title="${t.title}"  updated=${t.updatedAt}`);
}

// mastra_messages by resourceId, sorted by recent
console.log("\n=== mastra_messages by resourceId (most recent first) ===");
const msgSchema = db.query("PRAGMA table_info(mastra_messages)").all();
console.log("schema:", msgSchema.map((c: any) => `${c.name}(${c.type})`).join(", "));

const msgsByResource = db
  .query(`
  SELECT
    m.resourceId,
    m.thread_id,
    DATE(m.createdAt) as date,
    m.role,
    COUNT(*) as count,
    MIN(m.createdAt) as earliest,
    MAX(m.createdAt) as latest
  FROM mastra_messages m
  GROUP BY m.resourceId, m.thread_id, DATE(m.createdAt), m.role
  ORDER BY latest DESC, m.resourceId, m.role
`)
  .all();

let currentGroup = "";
for (const r of msgsByResource as any[]) {
  const group = `${r.resourceId ?? "(null)"}/${r.thread_id}/${r.date}`;
  if (group !== currentGroup) {
    currentGroup = group;
    console.log(`\n  resourceId=${r.resourceId ?? "(null)"}  thread=${r.thread_id}  date=${r.date}`);
  }
  console.log(`    ${r.role}: ${r.count} messages  (${r.earliest} → ${r.latest})`);
}

// Recent messages (last 10)
console.log("\n=== Last 10 messages ===");
const recentMsgs = db
  .query(`
  SELECT id, thread_id, resourceId, role, type, createdAt,
         SUBSTR(content, 1, 120) as preview
  FROM mastra_messages
  ORDER BY createdAt DESC
  LIMIT 10
`)
  .all();

for (const m of recentMsgs as any[]) {
  const preview = m.preview?.replace(/\n/g, "\\n") ?? "";
  console.log(`  [${m.createdAt}] ${m.role}(${m.type}) resource=${m.resourceId ?? "null"} thread=${m.thread_id}`);
  console.log(`    ${preview}${(m.preview?.length ?? 0) >= 120 ? "..." : ""}`);
}

// Summary
console.log("\n=== Summary ===");
const totalMsgs = db.query("SELECT COUNT(*) as n FROM mastra_messages").get() as any;
const totalThreads = db.query("SELECT COUNT(*) as n FROM mastra_threads").get() as any;
const totalResources = db.query("SELECT COUNT(*) as n FROM mastra_resources").get() as any;
console.log(`  Resources: ${totalResources.n}`);
console.log(`  Threads: ${totalThreads.n}`);
console.log(`  Messages: ${totalMsgs.n}`);

db.close();
