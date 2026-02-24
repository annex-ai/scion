// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { sharedMemory } from "../../memory.js";

console.log("=== Checking for threads ===");

// Try to get the default thread
try {
  const defaultThread = await sharedMemory.getThreadById({ threadId: "default" });
  console.log("Default thread:", JSON.stringify(defaultThread, null, 2));
} catch (err) {
  console.log("No default thread found");
}

// List threads if there's a method
if ((sharedMemory as any).listThreads) {
  const threads = await (sharedMemory as any).listThreads();
  console.log("All threads:", JSON.stringify(threads, null, 2));
}

// Check what thread ID might be set in working memory
const workingMemory = await sharedMemory.getThreadById({ threadId: "user-working-memory" });
console.log("Working memory thread:", JSON.stringify(workingMemory, null, 2));
