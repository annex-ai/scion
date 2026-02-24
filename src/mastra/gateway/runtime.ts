// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export type RuntimeEnv = {
  error(msg: string): void;
  warn?(msg: string): void;
  info?(msg: string): void;
};

export const defaultRuntime: RuntimeEnv = {
  error: (msg) => console.error(`[scion] ${msg}`),
  warn: (msg) => console.warn(`[scion] ${msg}`),
  info: (msg) => console.info(`[scion] ${msg}`),
};
