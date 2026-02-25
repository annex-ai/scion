// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Agent Configuration Loader
 *
 * Loads and validates agent.toml configuration file.
 * Single source of truth for agent identity, personality, and behavior settings.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

const identitySchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  purpose: z.string().optional(),
});

const archetypeSchema = z.object({
  type: z.string(),
});

const soulSchema = z.object({
  openness: z.number().min(0).max(1).optional(),
  conscientiousness: z.number().min(0).max(1).optional(),
  extraversion: z.number().min(0).max(1).optional(),
  agreeableness: z.number().min(0).max(1).optional(),
  neuroticism: z.number().min(0).max(1).optional(),
});

const loopSchema = z.object({
  pattern: z.enum(["task-based", "ralph-loop", "agent-swarm", "agent-team", "kimi-loop"]),
  max_iterations: z.number().min(-1).optional(),
  max_steps_per_turn: z.number().min(1).optional(),
  max_retries_per_step: z.number().min(0).optional(),
  /** Ralph Loop specific settings */
  ralph: z
    .object({
      auto_approve_tools: z.boolean(),
      confirm_destructive: z.boolean(),
      model: z.string().optional(),
    })
    .optional(),
  /** Agent Swarm specific settings */
  swarm: z
    .object({
      max_parallel_delegations: z.number().min(1),
      default_specialist_model: z.string().optional(),
      delegation_timeout_ms: z.number().min(1000),
      enable_caching: z.boolean(),
    })
    .optional(),
  /** Agent Team specific settings */
  team: z
    .object({
      max_team_members: z.number().min(1),
      max_revisions: z.number().min(0),
      handoff_timeout_ms: z.number().min(1000),
      default_member_model: z.string().optional(),
      compress_shared_context: z.boolean(),
    })
    .optional(),
});

const memorySchema = z.object({
  database_url: z.string(),
  last_messages: z.number(),
  semantic_recall_top_k: z.number(),
  semantic_recall_message_range: z.number(),
  semantic_recall_scope: z.enum(["resource", "thread"]),
  working_memory_enabled: z.boolean(),
  working_memory_scope: z.enum(["resource", "thread"]),
  // Observational Memory config
  om_model: z.string().optional(),
  om_scope: z.enum(["thread", "resource"]).default("resource"),
  om_observation_threshold: z.number().default(50000),
  om_reflection_threshold: z.number().default(60000),
});

const serverSchema = z.object({
  timeout: z.number(),
  host: z.string(),
  port: z.number(),
});

const featuresSchema = z.object({
  enableRalphLoop: z.boolean().optional(),
  enableMemory: z.boolean().optional(),
  enableTracing: z.boolean().optional(),
});

// Loop-specific configuration types (now nested under [loop])
const ralphLoopSchema = z
  .object({
    auto_approve_tools: z.boolean(),
    confirm_destructive: z.boolean(),
    model: z.string().optional(),
  })
  .optional();

const agentSwarmSchema = z
  .object({
    max_parallel_delegations: z.number().min(1),
    default_specialist_model: z.string().optional(),
    delegation_timeout_ms: z.number().min(1000),
    enable_caching: z.boolean(),
  })
  .optional();

const agentTeamSchema = z
  .object({
    max_team_members: z.number().min(1),
    max_revisions: z.number().min(0),
    handoff_timeout_ms: z.number().min(1000),
    default_member_model: z.string().optional(),
    compress_shared_context: z.boolean(),
  })
  .optional();

const modelsSchema = z
  .object({
    default: z.string().optional(),
    fast: z.string().optional(),
    moderation: z.string().optional(),
    reflector: z.string().optional(),
    prompt_injection: z.string().optional(),
    pii_detection: z.string().optional(),
    scorer_model: z.string().optional(),
  })
  .catchall(z.any());

const heartbeatHoursSchema = z.object({
  start: z.number().min(0).max(23),
  end: z.number().min(0).max(23),
  timezone: z.string(),
  interval_minutes: z.number().min(1),
});

const heartbeatChecksSchema = z.object({
  task_state: z.boolean(),
  reminders: z.boolean(),
  context_continuity: z.boolean(),
  background_tasks: z.boolean(),
  message_history: z.boolean(),
});

const heartbeatTargetSchema = z.object({
  type: z.enum(["slack", "telegram", "discord"]),
  target: z.string(),
});

const heartbeatSchema = z.object({
  quiet_mode: z.boolean(),
  alert_threshold: z.number(),
  hours: heartbeatHoursSchema,
  checks: heartbeatChecksSchema,
  targets: z.array(heartbeatTargetSchema).min(1, "At least one heartbeat target is required"),
});

// REMOVED: attentionSteeringSchema - replaced by Observational Memory in memory.ts

const cronSchema = z.object({
  cron_md_path: z.string(),
  poll_interval_seconds: z.number(),
  thread_ttl_days: z.number(),
  cleanup_interval_ms: z.number(),
});

const securitySchema = z.object({
  enablePiiDetection: z.boolean(),
  enablePromptInjectionDetection: z.boolean(),
  enableAdversarialPatternDetection: z.boolean(),
  enableUnicodeNormalization: z.boolean(),
  enableBatchPartsProcessor: z.boolean(),
  enableSecretProtection: z.boolean(),
  resource_id: z.string(),
});

const workspaceSchema = z.object({
  name: z.string().optional(),
  /** Path to the workspace directory */
  workspace_dir: z.string(),
  /** Path to the sandbox directory (for isolated operations) */
  sandbox_dir: z.string().optional(),
  skills_path: z.array(z.string()).optional(),
  auto_sync: z.boolean().optional(),
  operation_timeout: z.number().optional(),
});

const compactionSchema = z.object({
  enable_compaction: z.boolean(),
  mode: z.enum(["none", "token_limiter", "token_compaction", "time_based"]),
  // Token budget
  max_context_tokens: z.number(),
  trigger_threshold: z.number(),
  // Time-based settings
  preserve_duration_minutes: z.number(),
  // Compaction/summary settings
  preserve_recent_messages: z.number(),
  strategy: z.enum(["summarize", "truncate"]),
  model: z.string().optional(),
  max_summary_length: z.number(),
  preserve_decisions: z.boolean(),
  preserve_errors: z.boolean(),
  preserve_user_preferences: z.boolean(),
});

// Flows Configuration
const flowsSchema = z.object({
  /** Directories to scan for flows */
  paths: z.array(z.string()),
  /** Auto-compile flows on startup */
  auto_compile: z.boolean(),
});

// Gateway Security Configuration
const gatewaySecuritySchema = z.object({
  default_policy: z.enum(["allow", "deny"]).default("allow"),
  whitelist_ips: z.array(z.string()).default([]),
  blacklist_ips: z.array(z.string()).default([]),
  trust_proxy: z.boolean().default(false),
  trusted_proxies: z.array(z.string()).default([]),
});

const gatewaySchema = z.object({
  security: gatewaySecuritySchema,
});

const servicesSchema = z.object({
  cron: z.boolean(),
  heartbeat: z.boolean(),
  reflection: z.boolean(),
});

// Adaptation System Configuration (Observe → Reflect → Coach)
const adaptationSchema = z.object({
  enabled: z.boolean(),
  max_messages_per_run: z.number().int().min(1),
  max_instruction_patterns: z.number().int().min(1),
  observer_batch_size: z.number().int().min(1),
  coaching_enabled: z.boolean(),
  coaching_max_pending: z.number().int().min(1),
  coaching_dedup_window_days: z.number().int().min(1),
});

const agentConfigSchema = z.object({
  identity: identitySchema.optional(),
  archetype: archetypeSchema.optional(),
  soul: soulSchema.optional(),
  loop: loopSchema,
  features: featuresSchema.optional(),
  models: modelsSchema.optional(),
  services: servicesSchema,
  heartbeat: heartbeatSchema.optional(),
  // REMOVED: attention_steering - replaced by Observational Memory
  adaptation: adaptationSchema,
  security: securitySchema.optional(),
  memory: memorySchema.optional(),
  server: serverSchema.optional(),
  cron: cronSchema.optional(),
  workspace: workspaceSchema.optional(),
  // DEPRECATED: compaction section - replaced by Observational Memory in [memory]
  compaction: compactionSchema.optional(),
  flows: flowsSchema,
  gateway: gatewaySchema.optional(),
  // Note: skills configuration moved to [workspace].skills_path
  // skills: skillsSchema,
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export type LoopSection = z.infer<typeof loopSchema>;
export type HeartbeatSection = z.infer<typeof heartbeatSchema>;
export type HeartbeatTarget = z.infer<typeof heartbeatTargetSchema>;
// REMOVED: AttentionSteeringSection and ReflectionSection - replaced by Observational Memory
export type SecuritySection = z.infer<typeof securitySchema>;
export type MemorySection = z.infer<typeof memorySchema>;
export type ServerSection = z.infer<typeof serverSchema>;
export type CronSection = z.infer<typeof cronSchema>;
export type WorkspaceSection = z.infer<typeof workspaceSchema>;
export type CompactionSection = z.infer<typeof compactionSchema>;
export type ServicesSection = z.infer<typeof servicesSchema>;
export type RalphLoopSection = z.infer<typeof ralphLoopSchema>;
export type AgentSwarmSection = z.infer<typeof agentSwarmSchema>;
export type AgentTeamSection = z.infer<typeof agentTeamSchema>;
export type ModelsSection = z.infer<typeof modelsSchema>;
export type FlowsSection = z.infer<typeof flowsSchema>;
export type GatewaySection = z.infer<typeof gatewaySchema>;
export type GatewaySecuritySection = z.infer<typeof gatewaySecuritySchema>;
export type AdaptationSection = z.infer<typeof adaptationSchema>;

// ============================================================================
// Agent Directory
// ============================================================================

/**
 * Walk up from this module's directory to find the project root containing
 * `.agent/agent.toml`. Anchored to the file location (not CWD) so it works
 * regardless of which directory Mastra launches from.
 */
function findAgentDir(): string {
  let dir = resolve(import.meta.dirname);
  const root = resolve("/");
  while (true) {
    const candidate = join(dir, ".agent", "agent.toml");
    if (existsSync(candidate)) {
      return join(dir, ".agent");
    }
    if (dir === root) break;
    dir = dirname(dir);
  }
  throw new Error(`[AgentConfig] Could not find .agent/agent.toml in any parent of ${import.meta.dirname}`);
}

/** Root of the agent workspace — config, identity, and state files live here */
export const AGENT_DIR = resolve(process.env.AGENT_DIR || findAgentDir());

// ============================================================================
// Config Paths
// ============================================================================

const CONFIG_PATHS = [
  join(AGENT_DIR, "agent.toml"), // .agent/agent.toml (primary)
];

// ============================================================================
// Loader
// ============================================================================

let cachedConfig: AgentConfig | null = null;
let cachedPath: string | null = null;

/**
 * Load agent configuration from agent.toml
 *
 * Searches for config in standard locations:
 * 1. .agent/agent.toml (primary — AGENT_DIR)
 * 2. ./agent.toml (root config fallback)
 *
 * @param forceReload - Force reload even if cached
 * @returns Parsed and validated agent configuration
 */
export async function loadAgentConfig(forceReload = false): Promise<AgentConfig> {
  if (cachedConfig && !forceReload) {
    if (!cachedPath) {
      throw new Error("[AgentConfig] Config cache is invalid (no file path). This should not happen.");
    }
    return cachedConfig;
  }

  const errors: string[] = [];

  for (const configPath of CONFIG_PATHS) {
    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, "utf-8");
        const raw = parse(content);
        console.log(`[AgentConfig] cwd=${process.cwd()}, loading from ${configPath}`);
        cachedConfig = agentConfigSchema.parse(raw);
        cachedPath = configPath;
        console.log(`[AgentConfig] Loaded from ${configPath}`);
        return cachedConfig;
      } catch (error) {
        const msg = `Failed to parse ${configPath}: ${error}`;
        console.error(`[AgentConfig] ${msg}`);
        errors.push(msg);
      }
    }
  }

  // No config file found - this is a fatal error
  const searchedPaths = CONFIG_PATHS.join(", ");
  const errorDetails = errors.length > 0 ? `\nParse errors:\n${errors.join("\n")}` : "";
  throw new Error(
    `[AgentConfig] No valid agent.toml found. Searched: ${searchedPaths}. cwd=${process.cwd()}${errorDetails}`,
  );
}

/**
 * Get the path to the loaded config file
 */
export function getConfigPath(): string | null {
  return cachedPath;
}

/**
 * Clear the config cache (for testing or hot reload)
 */
export function clearConfigCache(): void {
  console.log(`[AgentConfig] Clearing config cache (was: ${cachedPath})`);
  cachedConfig = null;
  cachedPath = null;
}

/**
 * Resolve a relative path from the config file's directory.
 * Absolute paths are returned as-is.
 */
export function resolveConfigPath(relativePath: string): string {
  if (isAbsolute(relativePath)) return relativePath;
  const configFile = getConfigPath();
  if (!configFile) {
    throw new Error("[AgentConfig] Cannot resolve path — config not loaded yet");
  }
  return resolve(dirname(configFile), relativePath);
}

/**
 * Get security settings from agent config
 * Throws if [security] section is missing
 */
export async function getSecurityConfig(): Promise<SecuritySection> {
  const config = await loadAgentConfig();
  if (!config.security) {
    throw new Error("[AgentConfig] Missing [security] section in agent.toml");
  }
  return config.security;
}

/**
 * Get the heartbeat section from agent config
 * Throws if heartbeat section is not configured
 */
export async function getHeartbeatConfig(): Promise<HeartbeatSection> {
  const config = await loadAgentConfig();
  if (!config.heartbeat) {
    throw new Error("[AgentConfig] Missing [heartbeat] section in agent.toml");
  }
  return config.heartbeat;
}

/**
 * Get loop settings from agent config
 * Throws if [loop] section is missing
 */
export async function getLoopConfig(): Promise<LoopSection> {
  const config = await loadAgentConfig();
  return config.loop;
}

/**
 * Get Ralph Loop specific settings from agent config
 * Throws if [loop.ralph] section is missing
 */
export async function getRalphLoopConfig(): Promise<NonNullable<RalphLoopSection>> {
  const config = await loadAgentConfig();
  if (!config.loop?.ralph) {
    throw new Error("[AgentConfig] Missing [loop.ralph] section in agent.toml");
  }
  return config.loop.ralph;
}

/**
 * Get Agent Swarm specific settings from agent config
 * Throws if [loop.swarm] section is missing
 */
export async function getAgentSwarmConfig(): Promise<NonNullable<AgentSwarmSection>> {
  const config = await loadAgentConfig();
  if (!config.loop?.swarm) {
    throw new Error("[AgentConfig] Missing [loop.swarm] section in agent.toml");
  }
  return config.loop.swarm;
}

/**
 * Get Agent Team specific settings from agent config
 * Throws if [loop.team] section is missing
 */
export async function getAgentTeamConfig(): Promise<NonNullable<AgentTeamSection>> {
  const config = await loadAgentConfig();
  if (!config.loop?.team) {
    throw new Error("[AgentConfig] Missing [loop.team] section in agent.toml");
  }
  return config.loop.team;
}

/**
 * Get models settings from agent config
 * Throws if [models] section is missing
 */
export async function getModelsConfig(): Promise<ModelsSection> {
  const config = await loadAgentConfig();
  if (!config.models) {
    throw new Error("[AgentConfig] Missing [models] section in agent.toml");
  }
  return config.models;
}

/**
 * Get memory settings from agent config
 * Throws if [memory] section is missing
 */
export async function getMemoryConfig(): Promise<MemorySection> {
  const config = await loadAgentConfig();
  if (!config.memory) {
    throw new Error("[AgentConfig] Missing [memory] section in agent.toml");
  }
  return config.memory;
}

/**
 * Get server settings from agent config
 * Throws if [server] section is missing
 */
export async function getServerConfig(): Promise<ServerSection> {
  const config = await loadAgentConfig();
  if (!config.server) {
    throw new Error("[AgentConfig] Missing [server] section in agent.toml");
  }
  // Allow env var overrides for containerized deployments
  return {
    ...config.server,
    host: process.env.MASTRA_SERVER_HOST ?? config.server.host,
    port: process.env.MASTRA_SERVER_PORT ? Number.parseInt(process.env.MASTRA_SERVER_PORT, 10) : config.server.port,
  };
}

/**
 * Get workspace settings from agent config
 * Throws if [workspace] section is missing
 */
export async function getWorkspaceConfig(): Promise<WorkspaceSection> {
  const config = await loadAgentConfig();
  if (!config.workspace) {
    throw new Error("[AgentConfig] Missing [workspace] section in agent.toml");
  }
  return config.workspace;
}

/**
 * Get reflection settings from agent config
 * @deprecated Legacy - returns stub values. Reflection is now handled by Observational Memory.
 */
export async function getReflectionConfig() {
  return {
    enable_reflections: false, // Disabled - OM replaces this
    cron_schedule: "*/5 * * * *",
    min_batch_size: 10,
    max_pending_minutes: 30,
    max_messages_per_run: 100,
    reflections_md_path: "REFLECTIONS.md",
    reflection_state_path: "reflection-state.json",
  };
}

/**
 * Get cron settings from agent config
 * Throws if [cron] section is missing
 */
export async function getCronConfig(): Promise<CronSection> {
  const config = await loadAgentConfig();
  if (!config.cron) {
    throw new Error("[AgentConfig] Missing [cron] section in agent.toml");
  }
  return config.cron;
}

// REMOVED: getAttentionSteeringConfig - replaced by Observational Memory

/**
 * Get services settings from agent config
 */
export async function getServicesConfig(): Promise<ServicesSection> {
  const config = await loadAgentConfig();
  return config.services;
}

/**
 * Get compaction settings from agent config
 * @deprecated Compaction is replaced by Observational Memory in [memory] section
 */
export async function getCompactionConfig(): Promise<CompactionSection | undefined> {
  const config = await loadAgentConfig();
  return config.compaction;
}

/**
 * Get flows configuration from agent config
 */
export async function getFlowsConfig(): Promise<FlowsSection> {
  const config = await loadAgentConfig();
  return config.flows;
}

/**
 * Get gateway security configuration from agent config
 * Returns defaults if [gateway.security] section is missing
 */
export async function getGatewaySecurityConfig(): Promise<GatewaySecuritySection> {
  const config = await loadAgentConfig();
  return (
    config.gateway?.security ?? {
      default_policy: "allow",
      whitelist_ips: [],
      blacklist_ips: [],
      trust_proxy: false,
      trusted_proxies: [],
    }
  );
}

/**
 * Get adaptation configuration from agent config
 * Throws if [adaptation] section is missing
 */
export async function getAdaptationConfig(): Promise<AdaptationSection> {
  const config = await loadAgentConfig();
  return config.adaptation;
}
