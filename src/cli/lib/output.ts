// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Output Formatting Utilities
 */

import { inspect } from "node:util";

export interface OutputOptions {
  json?: boolean;
  compact?: boolean;
  verbose?: boolean;
}

export function formatOutput(data: any, opts: OutputOptions = {}): void {
  if (opts.json) {
    console.log(JSON.stringify(data, null, opts.compact ? undefined : 2));
    return;
  }

  // Pretty print for human consumption
  if (typeof data === "string") {
    console.log(data);
    return;
  }

  console.log(inspect(data, { depth: null, colors: true }));
}

export function formatError(error: Error | string): string {
  const message = error instanceof Error ? error.message : error;
  return `[agent] Error: ${message}`;
}

export function formatSuccess(message: string): void {
  console.log(`✓ ${message}`);
}

export function formatWarning(message: string): void {
  console.log(`⚠ ${message}`);
}

export function formatInfo(message: string): void {
  console.log(`ℹ ${message}`);
}

export function formatTable(rows: string[][], headers?: string[]): void {
  if (headers) {
    console.log(headers.join("\t"));
    console.log(headers.map(() => "---").join("\t"));
  }
  for (const row of rows) {
    console.log(row.join("\t"));
  }
}

export function formatAgentResponse(response: any): string {
  if (response.text) {
    return response.text;
  }
  if (response.object) {
    return JSON.stringify(response.object, null, 2);
  }
  return String(response);
}
