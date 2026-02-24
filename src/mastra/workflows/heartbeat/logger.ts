// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Logger - Structured logging for heartbeat system
 *
 * Provides consistent, structured logging for all heartbeat operations.
 * Logs are JSON-formatted for easy parsing and filtering.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogData {
  [key: string]: unknown;
}

/**
 * Format a log entry as JSON
 */
function formatLog(level: LogLevel, data: LogData, message: string): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    component: "heartbeat",
    level,
    message,
    ...data,
  });
}

/**
 * Structured logger for heartbeat system
 */
export const heartbeatLogger = {
  /**
   * Debug level - verbose information for troubleshooting
   */
  debug: (data: LogData, msg: string) => {
    if (process.env.DEBUG || process.env.LOG_LEVEL === "debug") {
      console.debug(formatLog("debug", data, msg));
    }
  },

  /**
   * Info level - normal operational messages
   */
  info: (data: LogData, msg: string) => {
    console.log(formatLog("info", data, msg));
  },

  /**
   * Warn level - potential issues that don't prevent operation
   */
  warn: (data: LogData, msg: string) => {
    console.warn(formatLog("warn", data, msg));
  },

  /**
   * Error level - failures that prevent normal operation
   */
  error: (data: LogData, msg: string) => {
    console.error(formatLog("error", data, msg));
  },

  /**
   * Log step entry with timing
   */
  stepStart: (stepId: string, data: LogData = {}) => {
    console.log(formatLog("info", { step: stepId, event: "start", ...data }, `Step ${stepId} starting`));
    return Date.now();
  },

  /**
   * Log step completion with duration
   */
  stepEnd: (stepId: string, startTime: number, data: LogData = {}) => {
    const duration = Date.now() - startTime;
    console.log(
      formatLog(
        "info",
        { step: stepId, event: "end", durationMs: duration, ...data },
        `Step ${stepId} completed in ${duration}ms`,
      ),
    );
  },

  /**
   * Log step skip
   */
  stepSkip: (stepId: string, reason: string, data: LogData = {}) => {
    console.log(
      formatLog("info", { step: stepId, event: "skip", reason, ...data }, `Step ${stepId} skipped: ${reason}`),
    );
  },

  /**
   * Log workflow start
   */
  workflowStart: (data: LogData = {}) => {
    console.log(formatLog("info", { event: "workflow_start", ...data }, "Heartbeat workflow starting"));
    return Date.now();
  },

  /**
   * Log workflow end
   */
  workflowEnd: (startTime: number, status: string, data: LogData = {}) => {
    const duration = Date.now() - startTime;
    console.log(
      formatLog(
        "info",
        { event: "workflow_end", status, durationMs: duration, ...data },
        `Heartbeat workflow completed with status: ${status} (${duration}ms)`,
      ),
    );
  },

  /**
   * Log schedule trigger
   */
  scheduleTrigger: (scheduleName: string, data: LogData = {}) => {
    console.log(
      formatLog(
        "info",
        { event: "schedule_trigger", scheduleName, ...data },
        `Heartbeat triggered by schedule: ${scheduleName}`,
      ),
    );
  },
};

// Re-export as default for convenience
export default heartbeatLogger;
