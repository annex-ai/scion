// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * MCP Client Configuration
 *
 * Single MCPClient instance that manages all configured MCP servers.
 *
 * ## Usage in Agents
 *
 * ```typescript
 * import { mcpClient, disconnectMcp } from '../mcp_client';
 *
 * const tools = await mcpClient.listTools();
 * ```
 *
 * ## Cleanup
 *
 * Call `disconnectMcp()` when shutting down to close all
 * MCP server connections and prevent process leaks.
 */

import { existsSync, readFileSync } from "node:fs";
import { MCPClient } from "@mastra/mcp";
import { resolveConfigPath } from "./lib/config";
import { createSafeFetch } from "./lib/security/safe-fetch";

/**
 * MCP server configuration from mcp.json
 */
interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  requestInit?: RequestInit;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Substitute environment variables in config values
 * Replaces ${VAR_NAME} with process.env[VAR_NAME]
 */
function substituteEnvVars(obj: any): any {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        console.warn(`[mcp-client] Environment variable ${varName} not set`);
      }
      return value || match;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }

  if (typeof obj === "object" && obj !== null) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, substituteEnvVars(v)]));
  }

  return obj;
}

/**
 * Parse MCP server configs from .agent/mcp.json
 */
function loadMcpServerConfigs(): Record<string, any> {
  const mcpConfigPath = resolveConfigPath("mcp.json");

  if (!existsSync(mcpConfigPath)) {
    console.warn(`[mcp-client] No mcp.json found at ${mcpConfigPath}, MCP tools will not be available`);
    return {};
  }

  try {
    const content = readFileSync(mcpConfigPath, "utf-8");
    const rawConfig: McpConfig = JSON.parse(content);
    const config = substituteEnvVars(rawConfig) as McpConfig;

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      console.warn("[mcp-client] No mcpServers defined in mcp.json");
      return {};
    }

    const servers: Record<string, any> = {};

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      if (serverConfig.url) {
        servers[name] = {
          url: new URL(serverConfig.url),
          requestInit: serverConfig.requestInit,
          fetch: createSafeFetch(),
        };
      } else if (serverConfig.command) {
        servers[name] = {
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
        };
      } else {
        console.warn(`[mcp-client] Server "${name}" has no command or url, skipping`);
      }
    }

    console.log(`[mcp-client] Loaded ${Object.keys(servers).length} MCP server(s): ${Object.keys(servers).join(", ")}`);

    return servers;
  } catch (error) {
    console.error("[mcp-client] Failed to load mcp.json:", error);
    return {};
  }
}

/** Single MCPClient instance managing all configured servers */
export const mcpClient = new MCPClient({
  id: "mastra-scion-mcp-client",
  servers: loadMcpServerConfigs(),
  timeout: 30000,
});

/**
 * Disconnect the MCP client and close all server connections.
 */
export async function disconnectMcp(): Promise<void> {
  await mcpClient.disconnect();
  console.log("[mcp-client] Disconnected");
}
