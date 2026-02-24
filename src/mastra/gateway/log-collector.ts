// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Log Collector — in-memory ring buffer for structured log entries.
 *
 * Captures log entries from the gateway logger and exposes them via API.
 * Supports SSE streaming for real-time log tailing.
 */

import type { LogEntry } from "./api/types";

const DEFAULT_CAPACITY = 1000;

export class LogCollector {
  private buffer: LogEntry[] = [];
  private capacity: number;
  private listeners = new Set<(entry: LogEntry) => void>();

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  push(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // ignore listener errors
      }
    }
  }

  query(opts: {
    limit?: number;
    offset?: number;
    level?: string;
    component?: string;
    since?: string;
    until?: string;
  }): { items: LogEntry[]; total: number } {
    let filtered = this.buffer;

    if (opts.level) {
      filtered = filtered.filter((e) => e.level === opts.level);
    }
    if (opts.component) {
      filtered = filtered.filter((e) => e.component === opts.component);
    }
    if (opts.since) {
      const sinceTs = new Date(opts.since).getTime();
      filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= sinceTs);
    }
    if (opts.until) {
      const untilTs = new Date(opts.until).getTime();
      filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= untilTs);
    }

    const total = filtered.length;
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    const items = filtered.slice(offset, offset + limit);

    return { items, total };
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size(): number {
    return this.buffer.length;
  }
}

/** Singleton log collector */
let collectorInstance: LogCollector | null = null;

export function getLogCollector(): LogCollector {
  if (!collectorInstance) {
    collectorInstance = new LogCollector();
  }
  return collectorInstance;
}
