// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { sharedMemory } from "../../memory.js";

async function test() {
  console.log("=== Test: Create task ===");

  try {
    const result = await sharedMemory.getWorkingMemory({ threadId: "default", resourceId: "interactive-agent" });
    console.log("Working Memory type:", typeof result);
    console.log("Working Memory null?", result === null);

    if (result && typeof result === "string") {
      console.log("Working Memory length:", result.length);
      console.log("Working Memory preview (first 200 chars):");
      console.log(result.slice(0, 200));

      // Try creating task directly via sharedMemory
      const updated = `${result}\n- [ ] [#TEST] Direct test via sharedMemory`;
      await sharedMemory.updateWorkingMemory({
        threadId: "default",
        resourceId: "interactive-agent",
        workingMemory: updated,
      });

      console.log("\n=== Test: Verify update ===");
      const after = await sharedMemory.getWorkingMemory({ threadId: "default", resourceId: "interactive-agent" });
      console.log("Updated length:", after!.length);
      console.log("Contains [#TEST]?", after!.includes("[#TEST]"));

      // Now use TaskCreate tool
      console.log("\n=== Test: Using TaskCreate tool ===");
      // We can't call the tool directly, so the user needs to test it
    } else {
      console.log("ERROR: getWorkingMemory did not return a string");
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

test()
  .then(() => {
    console.log("\n=== Test Complete ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
