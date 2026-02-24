// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gateway API Types
 *
 * Standardized types, Zod schemas, and error format for the /_gateway/v1/* endpoints.
 */

import { z } from "zod";

// ============================================================================
// Error Response
// ============================================================================

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function apiError(code: string, message: string, details?: unknown, status = 400): Response {
  const body: ApiError = { error: { code, message, ...(details !== undefined && { details }) } };
  return Response.json(body, { status });
}

// ============================================================================
// Request Schemas
// ============================================================================

export const SendMessageSchema = z.object({
  channel: z.string().min(1),
  to: z.string().min(1),
  message: z.string().min(1).max(4000),
  threadId: z.string().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageSchema>;

// ============================================================================
// Response Types
// ============================================================================

export interface ChannelStatusResponse {
  type: string;
  name: string;
  connected: boolean;
  config?: {
    respondToAll?: boolean;
    hasAllowList?: boolean;
  };
}

export interface SendMessageResponse {
  messageId: string;
  status: "sent" | "failed";
  error?: string;
}

export interface CronJobResponse {
  name: string;
  cron: string;
  enabled: boolean;
  message: string;
  timezone?: string;
  threadMode?: string;
  target: {
    channelType: string;
    channelId: string;
    threadId?: string;
  };
  nextRun: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
}
