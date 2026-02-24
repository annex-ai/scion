// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Inngest Client Configuration
 *
 * Configures the Inngest client for durable workflow execution.
 * Workflows registered with this client run asynchronously in the background.
 *
 * Development: Uses local Inngest dev server (http://localhost:8288)
 * Production: Uses Inngest cloud (configure via environment variables)
 */

import { realtimeMiddleware } from "@inngest/realtime/middleware";
import { Inngest } from "inngest";

/**
 * Determine if we're in development mode
 */
const isDev = process.env.NODE_ENV !== "production";

/**
 * Inngest client instance
 *
 * In development:
 * - Connects to local Inngest dev server at http://localhost:8288
 * - Start dev server with: npx inngest-cli@latest dev -u http://localhost:4111/api/inngest
 *
 * In production:
 * - Connects to Inngest cloud
 * - Requires INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY environment variables
 */
export const inngest = new Inngest({
  id: "mastra",
  baseUrl: "http://localhost:8288",
  isDev: true,
  middleware: [realtimeMiddleware()],
});
