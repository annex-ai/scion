// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Alert Handler
 *
 * Handles heartbeat alerts by forwarding to the target agent via HTTP API.
 * Follows the same pattern as channel message processing.
 */

import { getSecurityConfig } from "../../lib/config";
import { sharedMemory } from "../../memory";

export interface HeartbeatAlertPayload {
  resourceId: string;
  threadId?: string;
  alertType: "heartbeat" | "entropy";
  items: AlertItem[];
  summary: string;
  suggestedActions?: string[];
  metadata?: Record<string, any>;
}

export interface AlertItem {
  type: string;
  description: string;
  priority: "low" | "medium" | "high";
  source?: string;
}

export interface AlertResponse {
  status: "delivered" | "error";
  threadId: string;
  agentResponse?: string;
  error?: string;
}

/**
 * Handle heartbeat alert by forwarding to the target agent via HTTP
 */
export async function handleHeartbeatAlert(payload: HeartbeatAlertPayload): Promise<AlertResponse> {
  const { resourceId, threadId, items, summary, suggestedActions, metadata } = payload;

  console.log(`[AlertHandler] Received alert for agent: ${resourceId}`);

  // Get or create thread for this agent
  const targetThreadId = threadId || (await getOrCreateThread());

  // Format alert message for agent
  const alertMessage = formatAlertForAgent(payload);

  try {
    // Call agent via HTTP (same pattern as gateway adapter)
    const response = await callAgentViaHttp(alertMessage, resourceId, targetThreadId);

    console.log(`[AlertHandler] Agent responded: ${response.text?.slice(0, 100)}...`);

    return {
      status: "delivered",
      threadId: targetThreadId,
      agentResponse: response.text,
    };
  } catch (error) {
    console.error("[AlertHandler] Agent error:", error);
    return {
      status: "error",
      threadId: targetThreadId,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Call the agent via HTTP API (same pattern as GatewayToMastraAdapter)
 */
async function callAgentViaHttp(message: string, agentId: string, threadId: string): Promise<{ text?: string }> {
  const mastraUrl = process.env.MASTRA_URL || "http://localhost:4111";
  const url = `${mastraUrl}/api/agents/interactiveAgent/generate`;

  console.log(`[AlertHandler] Calling agent via HTTP: ${url}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add auth header if GATEWAY_API_KEY is configured
  if (process.env.GATEWAY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.GATEWAY_API_KEY}`;
  }

  // Get resource_id from security config (same as adapter)
  const securityConfig = await getSecurityConfig();
  const resourceId = securityConfig.resource_id;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [{ role: "user", content: message }],
      memory: {
        resource: resourceId,
        thread: threadId,
      },
      // No channel context for heartbeat alerts (internal notification)
      requestContext: {
        alertType: "heartbeat",
        source: "heartbeat-workflow",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agent HTTP call failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Get or create thread for heartbeat alerts
 */
async function getOrCreateThread(): Promise<string> {
  const securityConfig = await getSecurityConfig();
  const resourceId = securityConfig.resource_id;

  try {
    const thread = await sharedMemory.getThreadById({ threadId: resourceId });
    if (thread) {
      return resourceId;
    }
  } catch {
    // Thread doesn't exist, create it
  }

  await sharedMemory.createThread({
    threadId: resourceId,
    resourceId,
    title: resourceId,
    metadata: {},
  });

  console.log(`[AlertHandler] Created heartbeat thread: ${resourceId}`);
  return resourceId;
}

/**
 * Format alert for agent consumption
 */
function formatAlertForAgent(payload: HeartbeatAlertPayload): string {
  const lines: string[] = [
    "## Heartbeat Alert",
    "",
    `**Summary:** ${payload.summary}`,
    "",
    "**Items requiring attention:**",
  ];

  for (const item of payload.items) {
    const priorityEmoji = item.priority === "high" ? "🔴" : item.priority === "medium" ? "🟡" : "🟢";
    lines.push(`${priorityEmoji} [${item.priority}] ${item.description}`);
  }

  if (payload.suggestedActions?.length) {
    lines.push("", "**Suggested actions:**");
    for (const action of payload.suggestedActions) {
      lines.push(`- ${action}`);
    }
  }

  if (payload.metadata) {
    lines.push("", "**Metadata:**");
    if (payload.metadata.entropyMetrics) {
      const m = payload.metadata.entropyMetrics;
      lines.push(`- Chaos Score: ${(m.chaosScore * 100).toFixed(0)}%`);
      lines.push(`- Pending Tasks: ${m.pendingCount || 0}`);
      lines.push(`- Blocked Tasks: ${m.blockedCount || 0}`);
    }
  }

  lines.push(
    "",
    "Please review these items and take appropriate action. You can:",
    "- Send a message to the user",
    "- Create tasks for follow-up",
    "- Take automated action if appropriate",
    "- Ignore if not critical",
  );

  return lines.join("\n");
}
