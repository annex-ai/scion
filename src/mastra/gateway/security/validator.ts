// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Gateway Security Validator
 *
 * Validates incoming requests against IP whitelist/blacklist rules.
 */

import { isInCidr } from "../../lib/security/cidr-utils";

export interface GatewaySecurityConfig {
  /** Default policy: allow all except blacklist, or deny all except whitelist */
  default_policy: "allow" | "deny";
  /** Whitelist of allowed IP addresses or CIDR ranges */
  whitelist_ips?: string[];
  /** Blacklist of blocked IP addresses or CIDR ranges */
  blacklist_ips?: string[];
  /** Whether to trust X-Forwarded-For header */
  trust_proxy?: boolean;
  /** List of trusted proxy IPs */
  trusted_proxies?: string[];
}

/**
 * Check if an IP matches any pattern in a list
 * Supports exact IPs or CIDR notation
 */
function matchesIpList(ip: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Check if pattern is CIDR (contains /)
    if (pattern.includes("/")) {
      if (isInCidr(ip, pattern)) {
        return true;
      }
    } else {
      // Exact match
      if (ip === pattern) {
        return true;
      }
    }
  }
  return false;
}

export class GatewaySecurityValidator {
  private config: GatewaySecurityConfig;

  constructor(config: GatewaySecurityConfig) {
    this.config = {
      whitelist_ips: [],
      blacklist_ips: [],
      trust_proxy: false,
      trusted_proxies: [],
      ...config,
    };
  }

  /**
   * Validate if a request from the given IP is allowed
   *
   * @param clientIp - The client IP address
   * @returns Object with allowed flag and optional reason
   */
  validateRequest(clientIp: string): { allowed: boolean; reason?: string } {
    // Skip validation for unknown IPs if we can't determine the client IP
    if (clientIp === "unknown") {
      // If default policy is deny, block unknown IPs
      if (this.config.default_policy === "deny") {
        return { allowed: false, reason: "Unable to determine client IP" };
      }
      // Otherwise allow (might be internal/unix socket)
      return { allowed: true };
    }

    const blacklist = this.config.blacklist_ips || [];
    const whitelist = this.config.whitelist_ips || [];

    // 1. Check blacklist first (blacklist always takes precedence)
    if (blacklist.length > 0 && matchesIpList(clientIp, blacklist)) {
      return { allowed: false, reason: `IP ${clientIp} is blacklisted` };
    }

    // 2. If default policy is deny, check whitelist
    if (this.config.default_policy === "deny") {
      if (whitelist.length === 0) {
        return { allowed: false, reason: "No whitelist configured" };
      }
      if (!matchesIpList(clientIp, whitelist)) {
        return { allowed: false, reason: `IP ${clientIp} is not in whitelist` };
      }
    }

    return { allowed: true };
  }

  /**
   * Get the current configuration
   */
  getConfig(): GatewaySecurityConfig {
    return { ...this.config };
  }

  /**
   * Check if proxy trust is enabled
   */
  trustsProxy(): boolean {
    return this.config.trust_proxy || false;
  }

  /**
   * Get list of trusted proxies
   */
  getTrustedProxies(): string[] {
    return this.config.trusted_proxies || [];
  }
}
