// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { Mastra } from "@mastra/core/mastra";
import { SimpleAuth } from "@mastra/core/server";
import type { Workflow } from "@mastra/core/workflows";
import { serve } from "@mastra/inngest";
import { PinoLogger } from "@mastra/loggers";
import { CloudExporter, DefaultExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { coachAgent } from "./agents/coach";
// REMOVED: compactionAgent - replaced by Observational Memory
import { interactiveAgent } from "./agents/interactive";
import { observerAgent } from "./agents/observer";
import { taskAgent } from "./agents/task";
// Gateway API types and helpers
import { apiError, SendMessageSchema } from "./gateway/api/types";
import { handleHeartbeatAlert } from "./gateway/handlers/alert-handler";
// Import gateway integration
import {
  getGatewayInstance,
  getGatewayStatus,
  getGatewayWebhookAdapter,
  startGateway,
  stopGateway,
} from "./gateway/integration";
import { getLogCollector } from "./gateway/log-collector";
import { extractClientIp, GatewaySecurityValidator } from "./gateway/security";
// Harness for TUI and advanced orchestration
import { createAgentHarness } from "./harness";
import { inngest } from "./inngest";
// Legacy workflow - kept for backwards compatibility during migration
import { reflectionWorkflow } from "./legacy/reflection-workflow";
// Legacy agent - kept for backwards compatibility during migration
import { reflectorAgent } from "./legacy/reflector";
import { getGatewaySecurityConfig, getSecurityConfig, getServerConfig } from "./lib/config";
import { storage } from "./storage";
import { adaptationMasterWorkflow } from "./workflows/adaptation-master";
import { coachWorkflow } from "./workflows/coach-workflow";
import { dynamicFlowRouterWorkflow } from "./workflows/dynamic-flow-router";
import { nativeFlowExecutionWorkflow } from "./workflows/native-flow-execution-workflow";
import { observeWorkflow } from "./workflows/observe-workflow";
import { reflectWorkflow } from "./workflows/reflect-workflow";
import { loadSkillWorkflows, toWorkflowsRecord } from "./workflows/skill-workflow-loader";

// Load skill workflows at module initialization (build-time compilation)
// This happens once when the server imports this module
const skillLoadResult = await loadSkillWorkflows(process.cwd());

// Convert to record for Mastra registration
const skillWorkflowsRecord = toWorkflowsRecord(skillLoadResult.workflows);

// Log compilation summary
if (skillLoadResult.workflows.size > 0) {
  console.log(`[mastra-client] Registered ${skillLoadResult.workflows.size} pre-compiled skill workflows`);
}
if (skillLoadResult.errors.length > 0) {
  console.warn(`[mastra-client] ${skillLoadResult.errors.length} skills failed compilation - will use Dynamic Router`);
}

// Load server configuration from agent.toml
const serverConfig = await getServerConfig();
console.log(
  `[mastra-client] Server config: host=${serverConfig.host}, port=${serverConfig.port}, timeout=${serverConfig.timeout}ms`,
);

// Configure gateway security (IP-based access control)
const gatewaySecurityConfig = await getGatewaySecurityConfig();
const gatewayValidator =
  gatewaySecurityConfig.blacklist_ips.length > 0 ||
  gatewaySecurityConfig.whitelist_ips.length > 0 ||
  gatewaySecurityConfig.default_policy === "deny"
    ? new GatewaySecurityValidator(gatewaySecurityConfig)
    : null;

if (gatewayValidator) {
  console.log(
    `[mastra-client] Gateway security enabled: policy=${gatewaySecurityConfig.default_policy}, whitelist=${gatewaySecurityConfig.whitelist_ips.length}, blacklist=${gatewaySecurityConfig.blacklist_ips.length}`,
  );
}

// Configure gateway authentication
const gatewayApiKey = process.env.GATEWAY_API_KEY;
if (!gatewayApiKey) {
  console.warn("[mastra-client] WARNING: GATEWAY_API_KEY not set — Mastra API endpoints are unauthenticated");
}

const authConfig = gatewayApiKey
  ? new SimpleAuth({
      tokens: {
        [gatewayApiKey]: {
          id: "gateway-service",
          name: "Gateway Service Account",
        },
      },
      public: [
        "/_gateway/health",
        "/_gateway/startup",
        "/_gateway/webhook/googlechat",
        "/_skills/status",
        "/api/inngest",
      ],
    })
  : undefined;

export const mastra = new Mastra({
  workflows: {
    // Existing workflows
    nativeFlowExecutionWorkflow,
    dynamicFlowRouterWorkflow,
    reflectionWorkflow, // Legacy - kept for backwards compatibility

    // Adaptation workflows
    observeWorkflow,
    reflectWorkflow,
    coachWorkflow,
    adaptationMasterWorkflow,

    // Pre-compiled skill workflows (build-time)
    ...skillWorkflowsRecord,
  },
  agents: { interactiveAgent, taskAgent, reflectorAgent, observerAgent, coachAgent },
  scorers: {},
  storage,
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  server: {
    host: serverConfig.host,
    port: serverConfig.port,
    timeout: serverConfig.timeout,
    ...(authConfig && { auth: authConfig }),
    middleware: [
      // Gateway security: IP-based access control (runs before all other middleware)
      async (context, next) => {
        if (gatewayValidator) {
          const clientIp = extractClientIp(
            context.req.raw.headers,
            gatewayValidator.trustsProxy(),
            gatewayValidator.getTrustedProxies(),
          );
          const result = gatewayValidator.validateRequest(clientIp);
          if (!result.allowed) {
            console.warn(`[gateway-security] Blocked ${clientIp}: ${result.reason}`);
            return context.json({ error: "Forbidden" }, 403);
          }
        }
        await next();
      },
      async (context, next) => {
        // Extract requestContext from request body for agent calls
        // This allows the adapter to pass channel context (channelType, channelId, etc.)
        // which can then be accessed in agent instructions via requestContext.get()
        const path = context.req.path;
        const method = context.req.method;

        if (method === "POST" && path.includes("/agents/")) {
          console.log(`[middleware] Processing ${method} ${path}`);
          try {
            // Clone the request to read body without consuming it
            const clonedReq = context.req.raw.clone();
            const body = await clonedReq.json();
            const requestContext = context.get("requestContext");

            console.log(`[middleware] requestContext available: ${!!requestContext}`);
            console.log(`[middleware] body.requestContext: ${JSON.stringify(body.requestContext)}`);

            // Pass through channel context from adapter
            if (body.requestContext && requestContext) {
              for (const [key, value] of Object.entries(body.requestContext)) {
                if (value !== undefined) {
                  requestContext.set(key, value);
                  console.log(`[middleware] Set ${key} = ${value}`);
                }
              }
            }
          } catch (e) {
            console.log(`[middleware] Error reading body: ${e}`);
          }
        }
        await next();
      },
    ],
    apiRoutes: [
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => {
          return serve({
            mastra,
            inngest,
          });
        },
      },
      {
        path: "/_gateway/startup",
        method: "GET",
        createHandler: async () => {
          await startGateway();
          return async () => {
            return new Response("Gateway initialized", { status: 200 });
          };
        },
      },
      {
        path: "/_gateway/health",
        method: "GET",
        createHandler: async () => {
          const security = await getSecurityConfig().catch(() => null);
          return async () => {
            return Response.json({
              ...getGatewayStatus(),
              resourceId: security?.resource_id ?? null,
            });
          };
        },
      },
      {
        path: "/_skills/status",
        method: "GET",
        createHandler: async () => {
          return async () => {
            // Return status of compiled skill workflows
            const compiled = Array.from(skillLoadResult.workflows.entries()).map(([folder, loaded]) => ({
              folder,
              id: loaded.id,
              name: loaded.name,
              skillPath: loaded.skillPath,
            }));

            const failed = skillLoadResult.errors.map((e) => ({
              folder: e.folder,
              skillPath: e.skillPath,
              error: e.error,
            }));

            return Response.json({
              compiled,
              failed,
              summary: {
                compiledCount: compiled.length,
                failedCount: failed.length,
              },
            });
          };
        },
      },
      {
        path: "/_gateway/webhook/googlechat",
        method: "POST",
        createHandler: async () => {
          return async (c) => {
            try {
              const adapter = getGatewayWebhookAdapter("googlechat");
              if (!adapter || !("handleWebhook" in adapter)) {
                return c.json({ error: "Google Chat channel not configured" }, 503);
              }
              const event = await c.req.json();
              await (adapter as any).handleWebhook(event);
              return c.json({});
            } catch (error) {
              return c.json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
            }
          };
        },
      },
      {
        path: "/api/memory/working-memory",
        method: "GET",
        createHandler: async () => {
          return async (c) => {
            const resourceId = c.req.query("resourceId");
            console.log(`[working-memory-api] GET request, resourceId=${resourceId ?? "(missing)"}`);
            if (!resourceId) {
              console.log("[working-memory-api] 400 — resourceId param missing");
              return c.json({ error: "resourceId required" }, 400);
            }
            const store = await storage.getStore("memory");
            if (!store) {
              console.log("[working-memory-api] 500 — memory store not available");
              return c.json({ error: "Memory store not available" }, 500);
            }
            const resource = await store.getResourceById({ resourceId });
            const wm = resource?.workingMemory ?? null;
            console.log(
              `[working-memory-api] resourceId=${resourceId}, resource found=${!!resource}, workingMemory length=${wm?.length ?? 0}`,
            );
            if (wm) {
              console.log(`[working-memory-api] workingMemory preview (first 500 chars):\n${wm.slice(0, 500)}`);
            }
            return c.json({ workingMemory: wm });
          };
        },
      },
      {
        path: "/api/alerts/heartbeat",
        method: "POST",
        createHandler: async () => {
          return async (c) => {
            try {
              const payload = await c.req.json();
              const result = await handleHeartbeatAlert(payload);
              return c.json({ success: result.status === "delivered", ...result });
            } catch (error) {
              return c.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 400);
            }
          };
        },
      },

      // ====================================================================
      // Gateway API v1 — Channels
      // ====================================================================
      {
        path: "/_gateway/v1/channels",
        method: "GET",
        createHandler: async () => {
          return async () => {
            const gw = getGatewayInstance();
            if (!gw) {
              return apiError("GATEWAY_NOT_RUNNING", "Gateway is not running", undefined, 503);
            }
            const channels = gw.getChannelStatuses();
            return Response.json({ items: channels });
          };
        },
      },
      {
        path: "/_gateway/v1/channels/:type/status",
        method: "GET",
        createHandler: async () => {
          return async (c: any) => {
            const gw = getGatewayInstance();
            if (!gw) {
              return apiError("GATEWAY_NOT_RUNNING", "Gateway is not running", undefined, 503);
            }
            const type = decodeURIComponent(c.req.param("type"));
            const channel = gw.getChannelByType(type);
            if (!channel) {
              return apiError("CHANNEL_NOT_FOUND", `Channel "${type}" not found`, undefined, 404);
            }
            return Response.json({
              type: channel.type,
              name: channel.name,
              connected: channel.isConnected,
            });
          };
        },
      },

      // ====================================================================
      // Gateway API v1 — Messages
      // ====================================================================
      {
        path: "/_gateway/v1/messages/send",
        method: "POST",
        createHandler: async () => {
          return async (c: any) => {
            const gw = getGatewayInstance();
            if (!gw) {
              return apiError("GATEWAY_NOT_RUNNING", "Gateway is not running", undefined, 503);
            }
            let body: unknown;
            try {
              body = await c.req.json();
            } catch {
              return apiError("INVALID_JSON", "Request body must be valid JSON");
            }
            const parsed = SendMessageSchema.safeParse(body);
            if (!parsed.success) {
              return apiError("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
            }
            const { channel, to, message, threadId } = parsed.data;
            const adapter = gw.getChannelByType(channel);
            if (!adapter) {
              return apiError("CHANNEL_NOT_FOUND", `Channel "${channel}" not found or not connected`, undefined, 404);
            }
            const messageId = crypto.randomUUID();
            try {
              await adapter.sendMessage({ text: message, channelId: to, threadId });
              return Response.json({ messageId, status: "sent" });
            } catch (err) {
              return Response.json({
                messageId,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              });
            }
          };
        },
      },

      // ====================================================================
      // Gateway API v1 — Memory (custom operations only)
      // Thread CRUD is handled by Mastra built-in routes at /api/memory/threads/*
      // ====================================================================
      {
        path: "/_gateway/v1/memory/reset",
        method: "POST",
        createHandler: async () => {
          return async (c: any) => {
            const gw = getGatewayInstance();
            const adapter = gw?.getAdapter();
            if (!adapter) {
              return apiError("GATEWAY_NOT_RUNNING", "Gateway adapter not available", undefined, 503);
            }
            const security = await getSecurityConfig();
            let resourceId: string;
            try {
              const body = await c.req.json().catch(() => ({}));
              resourceId = body.resourceId || security.resource_id;
            } catch {
              resourceId = security.resource_id;
            }
            try {
              const threads = await adapter.listThreads(resourceId);
              let deleted = 0;
              for (const thread of threads) {
                try {
                  await adapter.deleteThread(thread.id);
                  deleted++;
                } catch {
                  // continue on individual failures
                }
              }
              return Response.json({ resourceId, deleted });
            } catch (err) {
              return apiError("MEMORY_RESET_FAILED", err instanceof Error ? err.message : String(err), undefined, 500);
            }
          };
        },
      },

      // ====================================================================
      // Gateway API v1 — Cron Jobs
      // ====================================================================
      {
        path: "/_gateway/v1/cron/jobs",
        method: "GET",
        createHandler: async () => {
          return async () => {
            const gw = getGatewayInstance();
            const cron = gw?.getCronService();
            if (!cron) {
              return apiError("CRON_NOT_AVAILABLE", "Cron service is not running", undefined, 503);
            }
            const schedulesWithRun = cron.getSchedulesWithNextRun();
            const items = schedulesWithRun.map(({ schedule, nextRun }) => ({
              name: schedule.name,
              cron: schedule.cron,
              enabled: schedule.enabled,
              message: schedule.message ?? "",
              timezone: schedule.timezone,
              threadMode: schedule.threadMode,
              target: schedule.target,
              workflow: schedule.workflow,
              nextRun: nextRun?.toISOString() ?? null,
            }));
            return Response.json({ items });
          };
        },
      },
      {
        path: "/_gateway/v1/cron/jobs/:name/trigger",
        method: "POST",
        createHandler: async () => {
          return async (c: any) => {
            const gw = getGatewayInstance();
            const cron = gw?.getCronService();
            if (!cron) {
              return apiError("CRON_NOT_AVAILABLE", "Cron service is not running", undefined, 503);
            }
            const name = decodeURIComponent(c.req.param("name"));
            try {
              const result = await cron.triggerNow(name);
              return Response.json({ name, status: "triggered", result });
            } catch (err) {
              return apiError("CRON_TRIGGER_FAILED", err instanceof Error ? err.message : String(err), undefined, 400);
            }
          };
        },
      },
      {
        path: "/_gateway/v1/cron/jobs/:name/reset",
        method: "POST",
        createHandler: async () => {
          return async (c: any) => {
            const gw = getGatewayInstance();
            const cron = gw?.getCronService();
            if (!cron) {
              return apiError("CRON_NOT_AVAILABLE", "Cron service is not running", undefined, 503);
            }
            const name = decodeURIComponent(c.req.param("name"));
            try {
              const result = await cron.resetScheduleThreads(name);
              return Response.json(result);
            } catch (err) {
              return apiError("CRON_RESET_FAILED", err instanceof Error ? err.message : String(err), undefined, 500);
            }
          };
        },
      },
      {
        path: "/_gateway/v1/cron/reload",
        method: "POST",
        createHandler: async () => {
          return async () => {
            const gw = getGatewayInstance();
            const cron = gw?.getCronService();
            if (!cron) {
              return apiError("CRON_NOT_AVAILABLE", "Cron service is not running", undefined, 503);
            }
            try {
              await cron.forceReload();
              const schedules = cron.getActiveSchedules();
              return Response.json({ reloaded: true, scheduleCount: schedules.length });
            } catch (err) {
              return apiError("CRON_RELOAD_FAILED", err instanceof Error ? err.message : String(err), undefined, 500);
            }
          };
        },
      },

      // ====================================================================
      // Gateway API v1 — Logs (real-time stream only)
      // Batch log queries use Mastra built-in /api/logs
      // ====================================================================
      {
        path: "/_gateway/v1/logs/stream",
        method: "GET",
        createHandler: async () => {
          return async () => {
            const collector = getLogCollector();
            let cleanup: (() => void) | null = null;
            const stream = new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                let alive = true;
                const unsubscribe = collector.subscribe((entry) => {
                  if (!alive) return;
                  try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
                  } catch {
                    alive = false;
                    unsubscribe();
                    clearInterval(keepalive);
                  }
                });
                controller.enqueue(encoder.encode(": connected\n\n"));
                const keepalive = setInterval(() => {
                  if (!alive) {
                    clearInterval(keepalive);
                    return;
                  }
                  try {
                    controller.enqueue(encoder.encode(": keepalive\n\n"));
                  } catch {
                    alive = false;
                    unsubscribe();
                    clearInterval(keepalive);
                  }
                }, 30_000);
                cleanup = () => {
                  alive = false;
                  unsubscribe();
                  clearInterval(keepalive);
                };
              },
              cancel() {
                cleanup?.();
              },
            });
            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              },
            });
          };
        },
      },

      // ====================================================================
      // Gateway API v1 — Gateway Control
      // ====================================================================
      {
        path: "/_gateway/v1/gateway/stop",
        method: "POST",
        createHandler: async () => {
          return async () => {
            const gracePeriodMs = 2000;
            setTimeout(async () => {
              try {
                await stopGateway();
              } catch (err) {
                console.error("[gateway/stop] Error during shutdown:", err);
              }
            }, gracePeriodMs);
            return Response.json({ status: "stopping", gracePeriodMs });
          };
        },
      },
      {
        path: "/_gateway/v1/gateway/restart",
        method: "POST",
        createHandler: async () => {
          return async () => {
            const gracePeriodMs = 2000;
            setTimeout(async () => {
              try {
                await stopGateway();
                await startGateway();
              } catch (err) {
                console.error("[gateway/restart] Error during restart:", err);
              }
            }, gracePeriodMs);
            return Response.json({ status: "restarting", gracePeriodMs });
          };
        },
      },

      // ====================================================================
      // Gateway API v1 — Skills
      // ====================================================================
      {
        path: "/_gateway/v1/skills",
        method: "GET",
        createHandler: async () => {
          return async () => {
            const compiled = Array.from(skillLoadResult.workflows.entries()).map(([folder, loaded]) => ({
              folder,
              id: loaded.id,
              name: loaded.name,
              skillPath: loaded.skillPath,
            }));
            const failed = skillLoadResult.errors.map((e) => ({
              folder: e.folder,
              skillPath: e.skillPath,
              error: e.error,
            }));
            return Response.json({
              items: compiled,
              failed,
              summary: { compiledCount: compiled.length, failedCount: failed.length },
            });
          };
        },
      },
      {
        path: "/_gateway/v1/skills/:name",
        method: "GET",
        createHandler: async () => {
          return async (c: any) => {
            const name = decodeURIComponent(c.req.param("name"));
            const entry = Array.from(skillLoadResult.workflows.entries()).find(
              ([folder, loaded]) => loaded.id === name || loaded.name === name || folder === name,
            );
            if (!entry) {
              return apiError("SKILL_NOT_FOUND", `Skill "${name}" not found`, undefined, 404);
            }
            const [folder, loaded] = entry;
            return Response.json({ folder, id: loaded.id, name: loaded.name, skillPath: loaded.skillPath });
          };
        },
      },
    ],
  },
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra",
        exporters: [
          new DefaultExporter(), // Persists traces to storage for Mastra Studio
          new CloudExporter(), // Sends traces to Mastra Cloud (if MASTRA_CLOUD_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});

// Export the skill load result for introspection
export { skillLoadResult };
