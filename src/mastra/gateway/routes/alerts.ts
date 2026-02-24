// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Alerts Routes
 *
 * HTTP endpoints for receiving heartbeat and entropy alerts.
 */

import { Router } from "express";
import { z } from "zod";
import { handleHeartbeatAlert } from "../handlers/alert-handler";
import { getGatewayInstance } from "../integration";

const alertRouter = Router();

const alertPayloadSchema = z.object({
  resourceId: z.string(),
  threadId: z.string().optional(),
  alertType: z.enum(["heartbeat", "entropy"]),
  items: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
      priority: z.enum(["low", "medium", "high"]),
      source: z.string().optional(),
    }),
  ),
  summary: z.string(),
  suggestedActions: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * POST /api/alerts/heartbeat
 *
 * Receive heartbeat alert and forward to the target agent.
 */
alertRouter.post("/heartbeat", async (req, res) => {
  try {
    const payload = alertPayloadSchema.parse(req.body);

    console.log(`[AlertsRoute] Received heartbeat alert for: ${payload.resourceId}`);

    const result = await handleHeartbeatAlert(payload);

    res.json({
      success: result.status === "delivered",
      ...result,
    });
  } catch (error) {
    console.error("[AlertsRoute] Error handling alert:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /api/alerts/entropy
 *
 * Receive entropy-specific alert and forward to the target agent.
 */
alertRouter.post("/entropy", async (req, res) => {
  try {
    const payload = alertPayloadSchema.parse(req.body);

    console.log(`[AlertsRoute] Received entropy alert for: ${payload.resourceId}`);

    const result = await handleHeartbeatAlert(payload);

    res.json({
      success: result.status === "delivered",
      ...result,
    });
  } catch (error) {
    console.error("[AlertsRoute] Error handling entropy alert:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /api/alerts/trigger
 *
 * Manually trigger a heartbeat check.
 */
alertRouter.post("/trigger", async (req, res) => {
  try {
    const schema = z.object({
      resourceId: z.string().optional(),
      force: z.boolean().optional(),
    });

    const { resourceId, force } = schema.parse(req.body);

    console.log("[AlertsRoute] Manual heartbeat trigger received");

    // Get gateway instance to access heartbeat service
    const gateway = getGatewayInstance();
    if (!gateway) {
      return res.status(503).json({
        success: false,
        error: "Gateway not initialized",
      });
    }

    const heartbeatService = gateway.getHeartbeatService();
    if (!heartbeatService) {
      return res.status(503).json({
        success: false,
        error: "Heartbeat service not available",
      });
    }

    const result = await heartbeatService.runCheck({
      resourceId: resourceId || "default",
      force: force ?? true,
    });

    res.json({
      success: result.status !== "HEARTBEAT_ERROR",
      ...result,
    });
  } catch (error) {
    console.error("[AlertsRoute] Error triggering heartbeat:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export { alertRouter };
