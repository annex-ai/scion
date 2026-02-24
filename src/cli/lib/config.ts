// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Configuration Management
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".agent");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const STATE_FILE = join(CONFIG_DIR, "state.json");

export interface AgentConfig {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
  bindings?: string[];
}

export interface ChannelConfig {
  enabled: boolean;
  credentials?: Record<string, string>;
  allowFrom?: string[];
}

export interface Config {
  version: number;
  agent: {
    model?: string;
    thinking?: "off" | "minimal" | "low" | "medium" | "high";
    verbose?: "on" | "off" | "full";
  };
  agents?: {
    defaults?: {
      model?: string;
      thinking?: string;
      verbose?: string;
      workspace?: string;
    };
    items?: AgentConfig[];
  };
  gateway: {
    host: string;
    port: number;
    apiKey?: string;
    bind?: "loopback" | "all";
    verbose?: boolean;
  };
  channels?: {
    whatsapp?: ChannelConfig;
    telegram?: ChannelConfig;
    slack?: ChannelConfig;
    discord?: ChannelConfig;
    googlechat?: ChannelConfig;
    signal?: ChannelConfig;
    imessage?: ChannelConfig;
  };
  browser?: {
    enabled?: boolean;
    color?: string;
  };
}

const defaultConfig: Config = {
  version: 1,
  agent: {
    model: "anthropic/claude-opus-4-6",
    thinking: "medium",
    verbose: "off",
  },
  gateway: {
    host: "localhost",
    port: 4111,
    bind: "loopback",
    verbose: false,
  },
  channels: {},
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return defaultConfig;
  }
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return { ...defaultConfig, ...JSON.parse(content) };
  } catch {
    return defaultConfig;
  }
}

export function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

// State management (for sessions, etc.)
interface State {
  sessions?: Record<string, any>;
  lastUpdated?: number;
}

export function loadState(): State {
  if (!existsSync(STATE_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveState(state: State): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  state.lastUpdated = Date.now();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
