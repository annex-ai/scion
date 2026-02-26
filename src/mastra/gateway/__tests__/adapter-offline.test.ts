// Offline gateway tests — no server, no config required
//
// We replicate the pure logic from adapter.ts to avoid triggering
// the config/agent import chain.

import { describe, expect, test } from "bun:test";

// Replicate generateThreadId from adapter.ts
function generateThreadId(channelType: string, channelId: string, threadId?: string, resourceId?: string): string {
  if (resourceId) {
    return resourceId;
  }
  const parts = [channelType, channelId, threadId].filter(Boolean);
  const sanitized = parts.join("_").replace(/[^a-zA-Z0-9]/g, "_");
  return `thread_${sanitized}`;
}

// Replicate isResetCommand from adapter.ts
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

  test("G1b: Thread IDs handle special characters", () => {
    const id = generateThreadId("slack", "C-123.45", "ts:001");
    expect(id).toBe("thread_slack_C_123_45_ts_001");
  });

  test("G1c: Thread IDs work without optional threadId", () => {
    const id = generateThreadId("telegram", "12345");
    expect(id).toBe("thread_telegram_12345");
  });

  test("G6: Resource memory mode uses resourceId as thread ID", () => {
    const resourceId = "interactive-agent";
    // When resourceId is provided, all channels collapse to the same thread
    const slackId = generateThreadId("slack", "C12345", "ts-001", resourceId);
    const telegramId = generateThreadId("telegram", "99999", undefined, resourceId);
    expect(slackId).toBe(resourceId);
    expect(telegramId).toBe(resourceId);
  });

  test("G6b: Without resourceId, thread IDs are per-channel", () => {
    const slackId = generateThreadId("slack", "C12345", "ts-001");
    const telegramId = generateThreadId("telegram", "99999");
    expect(slackId).not.toBe(telegramId);
    expect(slackId).toBe("thread_slack_C12345_ts_001");
  });
});
