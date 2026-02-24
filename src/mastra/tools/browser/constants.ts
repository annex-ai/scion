// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Constants for browser automation tools.
 */

/** Whether browser tools are enabled by default. */
export const DEFAULT_BROWSER_ENABLED = true;

/** Whether the evaluate action is allowed by default. */
export const DEFAULT_BROWSER_EVALUATE_ENABLED = true;

/** Default profile accent color (hex). */
export const DEFAULT_BROWSER_COLOR = "#FF4500";

/** Default profile name used when none is specified. */
export const DEFAULT_BROWSER_PROFILE_NAME = "mastra";

/** Fallback profile name for unmanaged Chrome installations. */
export const DEFAULT_BROWSER_DEFAULT_PROFILE_NAME = "chrome";

/** Maximum character count for AI-format snapshots. */
export const DEFAULT_AI_SNAPSHOT_MAX_CHARS = 80_000;

/** Maximum character count in efficient snapshot mode. */
export const DEFAULT_AI_SNAPSHOT_EFFICIENT_MAX_CHARS = 10_000;

/** Default tree depth in efficient snapshot mode. */
export const DEFAULT_AI_SNAPSHOT_EFFICIENT_DEPTH = 6;

/** Timeout for individual CDP operations (ms). */
export const DEFAULT_CDP_TIMEOUT_MS = 5000;

/** Maximum time to wait for Chrome to launch (ms). */
export const DEFAULT_BROWSER_LAUNCH_TIMEOUT_MS = 15_000;

/** Default Chrome DevTools Protocol debugging port. */
export const DEFAULT_CDP_PORT = 9222;

/** Maximum buffered console messages per page. */
export const MAX_CONSOLE_MESSAGES = 500;

/** Maximum buffered page errors per page. */
export const MAX_PAGE_ERRORS = 200;

/** Maximum buffered network requests per page. */
export const MAX_NETWORK_REQUESTS = 500;

/** Maximum entries in the role-refs LRU cache. */
export const MAX_ROLE_REFS_CACHE = 50;
