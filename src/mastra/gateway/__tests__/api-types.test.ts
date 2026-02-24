// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { describe, expect, test } from "bun:test";
import { apiError, SendMessageSchema } from "../api/types";

describe("apiError", () => {
  test("returns a Response with error JSON", async () => {
    const res = apiError("TEST_CODE", "test message");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("TEST_CODE");
    expect(body.error.message).toBe("test message");
  });

  test("includes details when provided", async () => {
    const res = apiError("X", "msg", { foo: 1 }, 500);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.details).toEqual({ foo: 1 });
  });
});

describe("SendMessageSchema", () => {
  test("validates a correct message", () => {
    const result = SendMessageSchema.safeParse({
      channel: "telegram",
      to: "123456",
      message: "Hello",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty channel", () => {
    const result = SendMessageSchema.safeParse({
      channel: "",
      to: "123",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty message", () => {
    const result = SendMessageSchema.safeParse({
      channel: "slack",
      to: "#general",
      message: "",
    });
    expect(result.success).toBe(false);
  });

  test("accepts optional threadId", () => {
    const result = SendMessageSchema.safeParse({
      channel: "slack",
      to: "#general",
      message: "hi",
      threadId: "thread-123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threadId).toBe("thread-123");
    }
  });
});
