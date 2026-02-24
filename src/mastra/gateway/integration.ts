// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gateway integration module for Mastra server
 *
 * This module provides startup/shutdown hooks for integrating the gateway
 * with Mastra's HTTP server. This ensures MCP tools are loaded once
 * instead of being spawned by separate processes.
 */

import { loadConfig, validateConfig } from "./config";
import { logger } from "./logger";
import { GatewayServer } from "./server";

let gatewayInstance: GatewayServer | null = null;

/**
 * Start the gateway server
 *
 * Called by Mastra's server initialization. Initializes all channel
 * adapters (Slack Socket Mode, Telegram polling, etc.) and the cron service.
 */
export async function startGateway(): Promise<void> {
  try {
    logger.info({}, "Initializing gateway integration");

    // Load and validate configuration
    const config = await loadConfig();
    const hasChannels = validateConfig(config);

    if (!hasChannels) {
      logger.warn({}, "Gateway running with no channels configured");
    }

    // Create and start gateway server
    gatewayInstance = new GatewayServer();
    await gatewayInstance.start(config);

    logger.info({}, "Gateway started successfully");
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to start gateway");
    throw error;
  }
}

/**
 * Stop the gateway server
 *
 * Called during graceful shutdown. Disconnects all channels and stops
 * the cron service.
 */
export async function stopGateway(): Promise<void> {
  if (gatewayInstance) {
    logger.info({}, "Stopping gateway");
    try {
      await gatewayInstance.stop();
      gatewayInstance = null;
      logger.info({}, "Gateway stopped");
    } catch (error) {
      logger.error({ error: String(error) }, "Error stopping gateway");
    }
  }
}

/**
 * Get gateway status for health checks
 *
 * Returns the current state of the gateway and connected channels.
 */
export function getGatewayStatus(): {
  running: boolean;
  channels: string[];
} {
  if (!gatewayInstance) {
    return {
      running: false,
      channels: [],
    };
  }

  return {
    running: gatewayInstance.isRunning(),
    channels: gatewayInstance.getConnectedChannels(),
  };
}

/**
 * Get the gateway instance (for advanced use cases)
 */
export function getGatewayInstance(): GatewayServer | null {
  return gatewayInstance;
}

/**
 * Get a webhook handler for a specific channel type (e.g., 'googlechat')
 * Returns the adapter's handleWebhook method if the channel is connected
 */
export function getGatewayWebhookAdapter(channelType: string): any | undefined {
  return gatewayInstance?.getWebhookAdapter(channelType);
}
