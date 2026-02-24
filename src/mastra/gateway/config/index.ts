// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export { loadConfig, validateConfig } from "./loader";
export {
  gatewayConfigSchema,
  type GatewayConfig,
  type SlackConfig,
  type TelegramConfig,
  type PersonalityConfig,
  type FlowsConfig,
} from "./schema";
