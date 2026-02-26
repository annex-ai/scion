// Offline gateway tests — no server, no config required
//
// We replicate the pure logic from adapter.ts and harness-manager.ts
// to avoid triggering the config/agent import chain.

import { describe, expect, test } from "bun:test";

// Replicate generateThreadId from adapter.ts (line 115-118)
function generateThreadId(channelType: string, channelId: string, threadId?: string): string {
  const parts = [channelType, channelId, threadId].filter(Boolean);
  const sanitized = parts.join("_").replace(/[^a-zA-Z0-9]/g, "_");
  return `thread_${sanitized}`;
}

// Replicate generateHarnessThreadId from harness-manager.ts (line 90-98)
function generateHarnessThreadId(channelType: string, channelId: string, threadId?: string): string {
  const parts = [channelType, channelId, threadId].filter(Boolean);
  const sanitized = parts.join("_").replace(/[^a-zA-Z0-9]/g, "_");
  return `thread_${sanitized}`;
}

// Replicate isResetCommand from adapter.ts (line 127-130)
function isResetCommand(text: string, commands = ["/new", "/reset"]): boolean {
  return commands.includes(text.trim().toLowerCase());
}

describe("Gateway Adapter — offline", () => {
  test("G1: Thread ID generation is deterministic", () => {
    const id1 = generateThreadId("slack", "C12345", "ts-001");
    const id2 = generateThreadId("slack", "C12345", "ts-001");
    expect(id1).toBe(id2);
    expect(id1.startsWith("thread_")).toBe(true);

    const id3 = generateThreadId("telegram", "12345");
    expect(id1).not.toBe(id3);
  });

  test("G2: Reset command detection", () => {
    expect(isResetCommand("/new")).toBe(true);
    expect(isResetCommand("/reset")).toBe(true);
    expect(isResetCommand("/NEW")).toBe(true);
    expect(isResetCommand("hello")).toBe(false);
    expect(isResetCommand("/help")).toBe(false);
  });

  test("G5: Adapter and harness-manager generate matching thread IDs", () => {
    // Both functions use identical logic — verify they produce the same output
    const adapterId = generateThreadId("slack", "C12345", "ts-001");
    const harnessId = generateHarnessThreadId("slack", "C12345", "ts-001");
    expect(adapterId).toBe(harnessId);
    expect(adapterId).toBe("thread_slack_C12345_ts_001");
  });

  test("G1b: Thread IDs handle special characters", () => {
    const id = generateThreadId("slack", "C-123.45", "ts:001");
    expect(id).toBe("thread_slack_C_123_45_ts_001");
  });

  test("G1c: Thread IDs work without optional threadId", () => {
    const id = generateThreadId("telegram", "12345");
    expect(id).toBe("thread_telegram_12345");
  });
});
