// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gateway Logger - Simple console-based logging
 *
 * This module provides structured logging for the Gateway without
 * dependencies on Mastra's logging system, avoiding circular imports.
 *
 * All logs include a 'component: gateway' tag for filtering.
 * Entries are also pushed to the LogCollector ring buffer for API access.
 */

import type { LogEntry } from "./api/types";
import { getLogCollector } from "./log-collector";

function emit(level: LogEntry["level"], data: Record<string, unknown>, msg: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component: (data.component as string) || "gateway",
    message: msg,
    ...(Object.keys(data).length > 0 && { metadata: data }),
  };
  getLogCollector().push(entry);
}

/**
 * Structured logger for gateway events
 *
 * Usage:
 *   logger.info({ channel: 'telegram', sessionKey: '...' }, 'Message received');
 *   logger.error({ error: err.message }, 'Processing failed');
 */
export const logger = {
  info: (data: Record<string, unknown>, msg: string) => {
    console.log(JSON.stringify({ ...data, component: "gateway", level: "info", message: msg }));
    emit("info", data, msg);
  },

  error: (data: Record<string, unknown>, msg: string) => {
    console.error(JSON.stringify({ ...data, component: "gateway", level: "error", message: msg }));
    emit("error", data, msg);
  },

  warn: (data: Record<string, unknown>, msg: string) => {
    console.warn(JSON.stringify({ ...data, component: "gateway", level: "warn", message: msg }));
    emit("warn", data, msg);
  },

  debug: (data: Record<string, unknown>, msg: string) => {
    if (process.env.DEBUG || process.env.LOG_LEVEL === "debug") {
      console.debug(JSON.stringify({ ...data, component: "gateway", level: "debug", message: msg }));
    }
    emit("debug", data, msg);
  },
};
