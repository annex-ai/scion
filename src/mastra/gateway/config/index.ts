// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export { loadConfig, validateConfig } from "./loader";
export {
  type FlowsConfig,
  type GatewayConfig,
  gatewayConfigSchema,
  type PersonalityConfig,
  type SlackConfig,
  type TelegramConfig,
} from "./schema";
