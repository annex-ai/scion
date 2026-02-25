// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Configuration utilities
 */

export {
  type AdaptationSection,
  AGENT_DIR,
  type AgentConfig,
  // REMOVED: AttentionSteeringSection - replaced by Observational Memory
  type CompactionSection,
  type CronSection,
  clearConfigCache,
  type FlowsSection,
  type GatewaySection,
  type GatewaySecuritySection,
  getAdaptationConfig,
  // REMOVED: getAttentionSteeringConfig - replaced by Observational Memory
  getCompactionConfig,
  getConfigPath,
  getCronConfig,
  getFlowsConfig,
  getGatewaySecurityConfig,
  getHeartbeatConfig,
  getLoopConfig,
  getMemoryConfig,
  getModelsConfig,
  getReflectionConfig, // Legacy stub - returns disabled defaults
  getSecurityConfig,
  getServerConfig,
  getServicesConfig,
  getWorkspaceConfig,
  type HeartbeatSection,
  type HeartbeatTarget,
  type LoopSection,
  loadAgentConfig,
  type MemorySection,
  type ModelsSection,
  resolveConfigPath,
  // REMOVED: ReflectionSection - replaced by Observational Memory
  type SecuritySection,
  type ServerSection,
  type ServicesSection,
  type WorkspaceSection,
} from "./agent-config";
