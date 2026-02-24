// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Configuration utilities
 */

export {
  AGENT_DIR,
  loadAgentConfig,
  getAttentionSteeringConfig,
  getCompactionConfig,
  getServicesConfig,
  getHeartbeatConfig,
  getLoopConfig,
  getMemoryConfig,
  getModelsConfig,
  getServerConfig,
  getSecurityConfig,
  getWorkspaceConfig,
  getReflectionConfig,
  getCronConfig,
  getFlowsConfig,
  getGatewaySecurityConfig,
  getConfigPath,
  clearConfigCache,
  resolveConfigPath,
  type AgentConfig,
  type AttentionSteeringSection,
  type CompactionSection,
  type ServicesSection,
  type LoopSection,
  type HeartbeatSection,
  type HeartbeatTarget,
  type ModelsSection,
  type ReflectionSection, // deprecated alias for AttentionSteeringSection
  type SecuritySection,
  type MemorySection,
  type ServerSection,
  type CronSection,
  type WorkspaceSection,
  type FlowsSection,
  type GatewaySection,
  type GatewaySecuritySection,
} from "./agent-config";
