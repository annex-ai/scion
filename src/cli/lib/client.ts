// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Mastra CLI Client
 *
 * Single HTTP client — all routes go through the same fetch() path,
 * consistent with the gateway adapter's approach.
 */

import { loadConfig } from "./config.js";

export interface GenerateOptions {
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
  verbose?: "on" | "off" | "full";
  timeout?: number;
  stream?: boolean;
}

export interface GatewayStatus {
  status: "running" | "stopped" | "error";
  resourceId?: string;
  port?: number;
  channels?: Array<{
    type: string;
    status: string;
    account?: string;
  }>;
}

/** Default agent ID matching the Mastra registration in client.ts */
const DEFAULT_AGENT_ID = "interactiveAgent";

export class MastraClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor() {
    const config = loadConfig();
    this.baseUrl = `http://${config.gateway.host}:${config.gateway.port}`;
    this.apiKey = config.gateway.apiKey;
  }

  /** Build auth + content-type headers used by all requests. */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      ...extra,
    };
  }

  /** Raw fetch with friendly connection-refused errors. */
  private async rawFetch(url: string, options?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, options);
    } catch (err: any) {
      if (
        err?.code === "ECONNREFUSED" ||
        err?.message?.includes("ECONNREFUSED") ||
        err?.message?.includes("fetch failed")
      ) {
        throw new Error(`Cannot connect to gateway at ${this.baseUrl} — is it running? (use "gateway start")`);
      }
      throw err;
    }
  }

  /**
   * Authenticated fetch for all server routes.
   * Throws on non-2xx responses.
   */
  private async apiFetch(path: string, options?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.buildHeaders(options?.headers as Record<string, string>);

    const res = await this.rawFetch(url, { ...options, headers });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    return res;
  }

  // =========================================================================
  // Agent API
  // =========================================================================

  async generate(agentId: string, message: string, opts?: GenerateOptions): Promise<any> {
    const res = await this.apiFetch(`/api/agents/${agentId}/generate`, {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: message }],
        ...opts,
      }),
    });
    return res.json();
  }

  async streamGenerate(agentId: string, message: string, opts?: GenerateOptions): Promise<ReadableStream> {
    const res = await this.apiFetch(`/api/agents/${agentId}/stream`, {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: message }],
        ...opts,
      }),
    });
    return res.body!;
  }

  // =========================================================================
  // Gateway Status
  // =========================================================================

  async getGatewayStatus(): Promise<GatewayStatus> {
    try {
      const res = await this.apiFetch("/_gateway/health");
      const data = await res.json();
      // Server returns { running: boolean, channels: string[], resourceId?: string }
      // Normalize to GatewayStatus shape
      return {
        status: data.running ? "running" : "stopped",
        resourceId: data.resourceId ?? undefined,
        channels: Array.isArray(data.channels)
          ? data.channels.map((ch: any) =>
              typeof ch === "string" ? { type: ch, status: "connected", account: undefined } : ch,
            )
          : undefined,
      };
    } catch {
      return { status: "stopped" };
    }
  }

  async startGateway(): Promise<void> {
    await this.apiFetch("/_gateway/startup");
  }

  async stopGateway(): Promise<{ status: string; gracePeriodMs: number }> {
    const res = await this.apiFetch("/_gateway/v1/gateway/stop", { method: "POST" });
    return res.json();
  }

  async restartGateway(): Promise<{ status: string; gracePeriodMs: number }> {
    const res = await this.apiFetch("/_gateway/v1/gateway/restart", { method: "POST" });
    return res.json();
  }

  // =========================================================================
  // Channels API (/_gateway/v1/)
  // =========================================================================

  async listChannels(): Promise<Array<{ type: string; name: string; connected: boolean }>> {
    const res = await this.apiFetch("/_gateway/v1/channels");
    const data = await res.json();
    return data.items || [];
  }

  async getChannelStatus(type: string): Promise<{ type: string; name: string; connected: boolean }> {
    const res = await this.apiFetch(`/_gateway/v1/channels/${encodeURIComponent(type)}/status`);
    return res.json();
  }

  // =========================================================================
  // Messages API (/_gateway/v1/)
  // =========================================================================

  async sendMessage(req: { channel: string; to: string; message: string; threadId?: string }): Promise<{
    messageId: string;
    status: "sent" | "failed";
    error?: string;
  }> {
    const res = await this.apiFetch("/_gateway/v1/messages/send", {
      method: "POST",
      body: JSON.stringify(req),
    });
    return res.json();
  }

  // =========================================================================
  // Threads API (Mastra built-in /api/memory/)
  // =========================================================================

  async listThreads(opts?: { resourceId?: string; page?: number; perPage?: number }): Promise<{
    threads: any[];
    page: number;
    perPage: number;
    total: number;
    hasMore: boolean;
  }> {
    const params = new URLSearchParams();
    params.set("agentId", DEFAULT_AGENT_ID);
    if (opts?.resourceId) params.set("resourceId", opts.resourceId);
    if (opts?.page !== undefined) params.set("page", String(opts.page));
    if (opts?.perPage !== undefined) params.set("perPage", String(opts.perPage));

    const res = await this.apiFetch(`/api/memory/threads?${params}`);
    return res.json();
  }

  async getThread(id: string): Promise<any | null> {
    const url = `${this.baseUrl}/api/memory/threads/${encodeURIComponent(id)}?agentId=${DEFAULT_AGENT_ID}`;
    const res = await this.rawFetch(url, { headers: this.buildHeaders() });

    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  async getThreadMessages(
    id: string,
    opts?: {
      page?: number;
      perPage?: number;
    },
  ): Promise<{ messages: any[] }> {
    const params = new URLSearchParams();
    params.set("agentId", DEFAULT_AGENT_ID);
    if (opts?.page !== undefined) params.set("page", String(opts.page));
    if (opts?.perPage !== undefined) params.set("perPage", String(opts.perPage));

    const res = await this.apiFetch(`/api/memory/threads/${encodeURIComponent(id)}/messages?${params}`);
    return res.json();
  }

  async deleteThread(id: string): Promise<{ result: string }> {
    const url = `${this.baseUrl}/api/memory/threads/${encodeURIComponent(id)}?agentId=${DEFAULT_AGENT_ID}`;
    const res = await this.rawFetch(url, { method: "DELETE", headers: this.buildHeaders() });

    // 404 is acceptable — thread may already be deleted
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    if (res.status === 404) {
      return { result: "not_found" };
    }

    return res.json();
  }

  // =========================================================================
  // Memory API (composite: Mastra built-in + custom routes)
  // =========================================================================

  async getMemoryStatus(resourceId?: string): Promise<{
    resourceId: string;
    threadCount: number;
    workingMemory: { exists: boolean; length: number };
  }> {
    // Resolve resourceId: explicit > health endpoint > fallback
    let resolvedResourceId = resourceId;
    if (!resolvedResourceId) {
      const health = await this.getGatewayStatus();
      resolvedResourceId = health.resourceId || "interactive-agent";
    }

    // 1. Thread count via Mastra built-in
    const threadsResult = await this.listThreads({
      resourceId: resolvedResourceId,
      perPage: 1, // We only need the total count
    });

    // 2. Working memory via custom route
    let workingMemory = { exists: false, length: 0 };
    try {
      const wmRes = await this.apiFetch(
        `/api/memory/working-memory?resourceId=${encodeURIComponent(resolvedResourceId)}`,
      );
      const wmData = await wmRes.json();
      const wm = wmData.workingMemory;
      workingMemory = {
        exists: wm !== null && wm !== undefined,
        length: typeof wm === "string" ? wm.length : 0,
      };
    } catch {
      // Working memory route may not be available
    }

    return {
      resourceId: resolvedResourceId,
      threadCount: threadsResult.total ?? 0,
      workingMemory,
    };
  }

  async resetMemory(resourceId?: string): Promise<{ resourceId: string; deleted: number }> {
    const res = await this.apiFetch("/_gateway/v1/memory/reset", {
      method: "POST",
      body: JSON.stringify(resourceId ? { resourceId } : {}),
    });
    return res.json();
  }

  // =========================================================================
  // Cron API (/_gateway/v1/)
  // =========================================================================

  async listCronJobs(): Promise<{ items: any[] }> {
    const res = await this.apiFetch("/_gateway/v1/cron/jobs");
    return res.json();
  }

  async triggerCronJob(name: string): Promise<{ name: string; status: string; result: string }> {
    const res = await this.apiFetch(`/_gateway/v1/cron/jobs/${encodeURIComponent(name)}/trigger`, { method: "POST" });
    return res.json();
  }

  async resetCronJob(name: string): Promise<{ success: boolean; message: string; threadsDeleted: number }> {
    const res = await this.apiFetch(`/_gateway/v1/cron/jobs/${encodeURIComponent(name)}/reset`, { method: "POST" });
    return res.json();
  }

  async reloadCron(): Promise<{ reloaded: boolean; scheduleCount: number }> {
    const res = await this.apiFetch("/_gateway/v1/cron/reload", { method: "POST" });
    return res.json();
  }

  // =========================================================================
  // Logs API (Mastra built-in for batch, /_gateway/v1/ for stream)
  // =========================================================================

  async getLogs(opts?: {
    transportId?: string;
    limit?: number;
    level?: string;
    since?: string;
    until?: string;
  }): Promise<{
    logs: any[];
    total: number;
    page: number;
    perPage: number;
    hasMore: boolean;
  }> {
    // Discover transport if not specified
    let transportId = opts?.transportId;
    if (!transportId) {
      try {
        const tRes = await this.apiFetch("/api/logs/transports");
        const tData = await tRes.json();
        transportId = tData.transports?.[0];
      } catch {
        // Fall back to empty
      }
    }

    if (!transportId) {
      return { logs: [], total: 0, page: 0, perPage: opts?.limit ?? 100, hasMore: false };
    }

    const params = new URLSearchParams();
    params.set("transportId", transportId);
    if (opts?.limit) params.set("perPage", String(opts.limit));
    if (opts?.level) params.set("logLevel", opts.level);
    if (opts?.since) {
      const d = new Date(opts.since);
      if (Number.isNaN(d.getTime())) throw new Error(`Invalid --since date: "${opts.since}"`);
      params.set("fromDate", d.toISOString());
    }
    if (opts?.until) {
      const d = new Date(opts.until);
      if (Number.isNaN(d.getTime())) throw new Error(`Invalid --until date: "${opts.until}"`);
      params.set("toDate", d.toISOString());
    }

    const res = await this.apiFetch(`/api/logs?${params}`);
    return res.json();
  }

  async streamLogs(): Promise<Response> {
    return this.apiFetch("/_gateway/v1/logs/stream");
  }

  // =========================================================================
  // Skills API (/_gateway/v1/)
  // =========================================================================

  async listSkills(): Promise<any[]> {
    const res = await this.apiFetch("/_gateway/v1/skills");
    const data = await res.json();
    return data.items || [];
  }

  async getSkill(name: string): Promise<any> {
    const res = await this.apiFetch(`/_gateway/v1/skills/${encodeURIComponent(name)}`);
    return res.json();
  }
}
