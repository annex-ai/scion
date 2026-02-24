// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../api/types";
import { LogCollector } from "../log-collector";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: "info",
    component: "test",
    message: "test message",
    ...overrides,
  };
}

describe("LogCollector", () => {
  test("stores and retrieves entries", () => {
    const collector = new LogCollector(100);
    collector.push(makeEntry({ message: "one" }));
    collector.push(makeEntry({ message: "two" }));

    const result = collector.query({});
    expect(result.items.length).toBe(2);
    expect(result.total).toBe(2);
  });

  test("respects capacity (ring buffer)", () => {
    const collector = new LogCollector(3);
    collector.push(makeEntry({ message: "1" }));
    collector.push(makeEntry({ message: "2" }));
    collector.push(makeEntry({ message: "3" }));
    collector.push(makeEntry({ message: "4" }));

    expect(collector.size).toBe(3);
    const result = collector.query({});
    expect(result.items[0].message).toBe("2"); // '1' was evicted
    expect(result.items[2].message).toBe("4");
  });

  test("filters by level", () => {
    const collector = new LogCollector();
    collector.push(makeEntry({ level: "info", message: "a" }));
    collector.push(makeEntry({ level: "error", message: "b" }));
    collector.push(makeEntry({ level: "info", message: "c" }));

    const result = collector.query({ level: "error" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].message).toBe("b");
  });

  test("filters by component", () => {
    const collector = new LogCollector();
    collector.push(makeEntry({ component: "gateway", message: "a" }));
    collector.push(makeEntry({ component: "cron", message: "b" }));

    const result = collector.query({ component: "cron" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].message).toBe("b");
  });

  test("paginates with limit and offset", () => {
    const collector = new LogCollector();
    for (let i = 0; i < 10; i++) {
      collector.push(makeEntry({ message: `msg-${i}` }));
    }

    const page1 = collector.query({ limit: 3, offset: 0 });
    expect(page1.items.length).toBe(3);
    expect(page1.items[0].message).toBe("msg-0");

    const page2 = collector.query({ limit: 3, offset: 3 });
    expect(page2.items.length).toBe(3);
    expect(page2.items[0].message).toBe("msg-3");
  });

  test("subscribe receives new entries", () => {
    const collector = new LogCollector();
    const received: LogEntry[] = [];

    const unsubscribe = collector.subscribe((entry) => {
      received.push(entry);
    });

    collector.push(makeEntry({ message: "live" }));
    expect(received.length).toBe(1);
    expect(received[0].message).toBe("live");

    unsubscribe();
    collector.push(makeEntry({ message: "after-unsub" }));
    expect(received.length).toBe(1); // no more after unsubscribe
  });
});
