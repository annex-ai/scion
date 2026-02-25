// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Harness HTTP Routes
 *
 * HTTP endpoints for gateway communication with the Harness.
 * The gateway sends messages here instead of directly to agents,
 * allowing the harness to manage:
 * - Mode-based model selection
 * - Tool permission system (yolo, per-category, per-tool)
 * - Observational Memory with dynamic config
 * - Event streaming for tool approvals
 *
 * All routes are under /_harness prefix.
 */

import { z } from "zod";
import { apiError } from "./gateway/api/types";
import {
  emitThreadEvent,
  generateHarnessThreadId,
  getHarness,
  isHarnessInitialized,
  subscribeToThread,
  type HarnessEvent,
} from "./harness-manager";

/**
 * Schema for sendMessage endpoint
 */
const SendMessageSchema = z.object({
  content: z.string().min(1),
  channelType: z.string().min(1),
  channelId: z.string().min(1),
  threadId: z.string().optional(),
  images: z
    .array(
      z.object({
        data: z.string(),
        mimeType: z.string(),
      }),
    )
    .optional(),
});

/**
 * Schema for state updates
 * Note: permissionRules requires both categories and tools when provided
 */
const UpdateStateSchema = z.object({
  yolo: z.boolean().optional(),
  observerModelId: z.string().optional(),
  reflectorModelId: z.string().optional(),
  observationThreshold: z.number().optional(),
  reflectionThreshold: z.number().optional(),
  permissionRules: z
    .object({
      categories: z.record(z.string(), z.enum(["allow", "ask", "deny"])),
      tools: z.record(z.string(), z.enum(["allow", "ask", "deny"])),
    })
    .optional(),
});

/**
 * Schema for tool approval response
 */
const ToolApprovalSchema = z.object({
  decision: z.enum(["approve", "decline", "always_allow_category"]),
  threadId: z.string(),
});

/**
 * Schema for mode switch
 */
const SwitchModeSchema = z.object({
  modeId: z.string(),
});

/**
 * Schema for model switch
 */
const SwitchModelSchema = z.object({
  modelId: z.string(),
  scope: z.enum(["global", "thread"]).optional(),
});

/**
 * Create harness API routes for the Mastra server
 */
export function createHarnessRoutes() {
  return [
    // ====================================================================
    // Harness Status & Initialization
    // ====================================================================
    {
      path: "/_harness/status",
      method: "GET" as const,
      createHandler: async () => {
        return async () => {
          const initialized = isHarnessInitialized();
          if (!initialized) {
            return Response.json({
              initialized: false,
              message: "Harness not initialized. Call /_harness/init first.",
            });
          }
          const harness = await getHarness();
          return Response.json({
            initialized: true,
            currentModeId: harness.getCurrentModeId(),
            currentModelId: harness.getCurrentModelId(),
            currentThreadId: harness.getCurrentThreadId(),
            resourceId: harness.getResourceId(),
            tokenUsage: harness.getTokenUsage(),
            isRunning: harness.isRunning(),
          });
        };
      },
    },
    {
      path: "/_harness/init",
      method: "POST" as const,
      createHandler: async () => {
        return async () => {
          try {
            const harness = await getHarness();
            return Response.json({
              success: true,
              currentModeId: harness.getCurrentModeId(),
              currentModelId: harness.getCurrentModelId(),
              resourceId: harness.getResourceId(),
            });
          } catch (error) {
            return apiError(
              "HARNESS_INIT_FAILED",
              error instanceof Error ? error.message : "Failed to initialize harness",
              undefined,
              500,
            );
          }
        };
      },
    },

    // ====================================================================
    // Message Handling
    // ====================================================================
    {
      path: "/_harness/sendMessage",
      method: "POST" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();

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

          const { content, channelType, channelId, threadId, images } = parsed.data;
          const harnessThreadId = generateHarnessThreadId(channelType, channelId, threadId);

          console.log(`[harness-routes] sendMessage: thread=${harnessThreadId}, contentLength=${content.length}`);

          // Switch to the channel's thread
          const currentThreadId = harness.getCurrentThreadId();
          if (currentThreadId !== harnessThreadId) {
            try {
              await harness.switchThread({ threadId: harnessThreadId });
            } catch {
              // Thread doesn't exist, create it
              await harness.createThread({ title: `${channelType}/${channelId}` });
              // The new thread will have a different ID, but switchThread should handle it
            }
          }

          // Set channel context in harness state
          await harness.setState({
            channelType,
            channelId,
          });

          // Subscribe to harness events and collect response
          let finalMessage: string | null = null;
          let responseComplete = false;
          let responseError: string | null = null;

          const unsubscribe = harness.subscribe((event) => {
            // Emit events for SSE subscribers
            emitThreadEvent({
              type: event.type as HarnessEvent["type"],
              threadId: harnessThreadId,
              data: event,
            });

            // Track message updates
            if (event.type === "message_update" || event.type === "message_end") {
              // Extract text content from the message
              const msg = event.message;
              if (msg.content) {
                if (typeof msg.content === "string") {
                  finalMessage = msg.content;
                } else if (Array.isArray(msg.content)) {
                  // Handle content array (text parts)
                  const textParts = msg.content
                    .filter((part: any) => part.type === "text")
                    .map((part: any) => part.text);
                  finalMessage = textParts.join("");
                }
              }
            }

            if (event.type === "agent_end") {
              responseComplete = true;
            } else if (event.type === "error") {
              responseError = event.error?.message || "Unknown error";
            }
          });

          try {
            // Send message through harness
            await harness.sendMessage({ content, images });

            // Wait for completion (with timeout)
            const startTime = Date.now();
            const timeout = 120_000; // 2 minutes
            while (!responseComplete && !responseError && Date.now() - startTime < timeout) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }

            unsubscribe();

            if (responseError) {
              return apiError("AGENT_ERROR", responseError, undefined, 500);
            }

            if (!responseComplete) {
              return apiError("TIMEOUT", "Message processing timed out", undefined, 504);
            }

            return Response.json({
              text: finalMessage || "",
              threadId: harnessThreadId,
            });
          } catch (error) {
            unsubscribe();
            return apiError(
              "MESSAGE_FAILED",
              error instanceof Error ? error.message : "Failed to process message",
              undefined,
              500,
            );
          }
        };
      },
    },

    // ====================================================================
    // SSE Event Stream
    // ====================================================================
    {
      path: "/_harness/events/:threadId",
      method: "GET" as const,
      createHandler: async () => {
        return async (c: any) => {
          const threadId = decodeURIComponent(c.req.param("threadId"));
          let cleanup: (() => void) | null = null;

          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              let alive = true;

              const unsubscribe = subscribeToThread(threadId, (event) => {
                if (!alive) return;
                try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch {
                  alive = false;
                  unsubscribe();
                }
              });

              controller.enqueue(encoder.encode(`: connected to thread ${threadId}\n\n`));

              // Keepalive
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
    // State Management
    // ====================================================================
    {
      path: "/_harness/state",
      method: "GET" as const,
      createHandler: async () => {
        return async () => {
          const harness = await getHarness();
          return Response.json(harness.getState());
        };
      },
    },
    {
      path: "/_harness/state",
      method: "PATCH" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();

          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return apiError("INVALID_JSON", "Request body must be valid JSON");
          }

          const parsed = UpdateStateSchema.safeParse(body);
          if (!parsed.success) {
            return apiError("VALIDATION_ERROR", "Invalid state update", parsed.error.flatten());
          }

          await harness.setState(parsed.data);
          return Response.json(harness.getState());
        };
      },
    },

    // ====================================================================
    // Tool Approval
    // ====================================================================
    {
      path: "/_harness/toolApproval",
      method: "POST" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();

          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return apiError("INVALID_JSON", "Request body must be valid JSON");
          }

          const parsed = ToolApprovalSchema.safeParse(body);
          if (!parsed.success) {
            return apiError("VALIDATION_ERROR", "Invalid approval request", parsed.error.flatten());
          }

          harness.respondToToolApproval({ decision: parsed.data.decision });
          return Response.json({ success: true });
        };
      },
    },

    // ====================================================================
    // Mode & Model Management
    // ====================================================================
    {
      path: "/_harness/modes",
      method: "GET" as const,
      createHandler: async () => {
        return async () => {
          const harness = await getHarness();
          const modes = harness.listModes();
          return Response.json({
            currentModeId: harness.getCurrentModeId(),
            modes: modes.map((m) => ({
              id: m.id,
              name: m.name,
              default: m.default,
              defaultModelId: m.defaultModelId,
            })),
          });
        };
      },
    },
    {
      path: "/_harness/modes/switch",
      method: "POST" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();

          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return apiError("INVALID_JSON", "Request body must be valid JSON");
          }

          const parsed = SwitchModeSchema.safeParse(body);
          if (!parsed.success) {
            return apiError("VALIDATION_ERROR", "Invalid mode switch request", parsed.error.flatten());
          }

          await harness.switchMode({ modeId: parsed.data.modeId });
          return Response.json({
            currentModeId: harness.getCurrentModeId(),
            currentModelId: harness.getCurrentModelId(),
          });
        };
      },
    },
    {
      path: "/_harness/models/switch",
      method: "POST" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();

          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return apiError("INVALID_JSON", "Request body must be valid JSON");
          }

          const parsed = SwitchModelSchema.safeParse(body);
          if (!parsed.success) {
            return apiError("VALIDATION_ERROR", "Invalid model switch request", parsed.error.flatten());
          }

          await harness.switchModel({
            modelId: parsed.data.modelId,
            scope: parsed.data.scope,
          });
          return Response.json({
            currentModelId: harness.getCurrentModelId(),
          });
        };
      },
    },
    {
      path: "/_harness/models",
      method: "GET" as const,
      createHandler: async () => {
        return async () => {
          const harness = await getHarness();
          const models = await harness.listAvailableModels();
          return Response.json({
            currentModelId: harness.getCurrentModelId(),
            models,
          });
        };
      },
    },

    // ====================================================================
    // Thread Management
    // ====================================================================
    {
      path: "/_harness/threads",
      method: "GET" as const,
      createHandler: async () => {
        return async () => {
          const harness = await getHarness();
          const threads = await harness.listThreads();
          return Response.json({
            currentThreadId: harness.getCurrentThreadId(),
            threads,
          });
        };
      },
    },
    {
      path: "/_harness/threads/switch",
      method: "POST" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();

          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return apiError("INVALID_JSON", "Request body must be valid JSON");
          }

          const { threadId } = body as { threadId?: string };
          if (!threadId) {
            return apiError("VALIDATION_ERROR", "threadId is required");
          }

          await harness.switchThread({ threadId });
          return Response.json({
            currentThreadId: harness.getCurrentThreadId(),
          });
        };
      },
    },
    {
      path: "/_harness/threads/create",
      method: "POST" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();

          let body: { title?: string } = {};
          try {
            body = await c.req.json();
          } catch {
            // Empty body is OK
          }

          const thread = await harness.createThread({ title: body.title });
          return Response.json(thread);
        };
      },
    },
    {
      path: "/_harness/threads/messages",
      method: "GET" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();
          const limit = parseInt(c.req.query("limit") || "50", 10);
          const messages = await harness.listMessages({ limit });
          return Response.json({ messages });
        };
      },
    },

    // ====================================================================
    // Control Operations
    // ====================================================================
    {
      path: "/_harness/abort",
      method: "POST" as const,
      createHandler: async () => {
        return async () => {
          const harness = await getHarness();
          harness.abort();
          return Response.json({ success: true });
        };
      },
    },
    {
      path: "/_harness/steer",
      method: "POST" as const,
      createHandler: async () => {
        return async (c: any) => {
          const harness = await getHarness();

          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return apiError("INVALID_JSON", "Request body must be valid JSON");
          }

          const { content } = body as { content?: string };
          if (!content) {
            return apiError("VALIDATION_ERROR", "content is required");
          }

          await harness.steer({ content });
          return Response.json({ success: true });
        };
      },
    },
  ];
}
