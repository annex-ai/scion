// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gateway Security Module
 *
 * IP-based access control for incoming gateway requests.
 */

export { extractClientIp } from "./ip-extractor";
export { type GatewaySecurityConfig, GatewaySecurityValidator } from "./validator";
