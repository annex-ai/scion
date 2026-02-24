// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * SSRF (Server-Side Request Forgery) Protection
 *
 * Validates URLs against a whitelist to prevent unauthorized access
 * to internal services or cloud metadata endpoints.
 *
 * Default behavior: Allow all URLs (permissive mode)
 * Strict mode: Only allow whitelisted URLs
 */

import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import { isInCidr } from "./cidr-utils";

// Dangerous ranges that should never be accessed unless explicitly whitelisted
const DANGEROUS_RANGES: string[] = [
  "169.254.169.254/32", // Cloud metadata (AWS, GCP, Azure)
  "100.100.100.200/32", // Alibaba metadata
];

// Blocked hostnames (metadata endpoints)
const BLOCKED_HOSTS: string[] = ["metadata.google.internal", "metadata.google.internal.", "metadata.oraclecloud.com"];

interface SSRFConfig {
  /** Whitelist of allowed URL patterns (strings or regexes) */
  whitelist?: (string | RegExp)[];
  /** Enable strict mode (only allow whitelisted URLs) */
  strict?: boolean;
  /** Additional blocked hostnames */
  blockedHosts?: string[];
  /** Block cloud metadata endpoints (default: true) */
  blockMetadata?: boolean;
}

interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if URL matches whitelist pattern
 */
function matchesWhitelist(url: string, patterns: (string | RegExp)[]): boolean {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      // Simple string match (domain or URL prefix)
      if (url.includes(pattern)) return true;
    } else if (pattern instanceof RegExp) {
      if (pattern.test(url)) return true;
    }
  }
  return false;
}

export class SSRFValidator {
  private config: SSRFConfig;
  private blockedHosts: Set<string>;

  constructor(config: SSRFConfig = {}) {
    this.config = {
      strict: false,
      blockMetadata: true,
      blockedHosts: [],
      whitelist: [],
      ...config,
    };
    this.blockedHosts = new Set([...BLOCKED_HOSTS, ...(this.config.blockedHosts || [])]);
  }

  /**
   * Validate a URL for SSRF protection
   *
   * Default (strict=false): Allow all URLs except cloud metadata
   * Strict (strict=true): Only allow whitelisted URLs
   */
  async validateUrl(urlString: string): Promise<ValidationResult> {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      return { allowed: false, reason: "Invalid URL format" };
    }

    // Only allow http/https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { allowed: false, reason: `Disallowed protocol: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Always block cloud metadata endpoints (security critical)
    if (this.config.blockMetadata !== false) {
      if (this.blockedHosts.has(hostname)) {
        return { allowed: false, reason: `Blocked metadata endpoint: ${hostname}` };
      }

      // Check if IP is a metadata endpoint
      const ipType = isIP(hostname);
      if (ipType) {
        for (const range of DANGEROUS_RANGES) {
          if (isInCidr(hostname, range)) {
            return { allowed: false, reason: `Blocked metadata IP: ${hostname}` };
          }
        }
      }
    }

    // In strict mode, only allow whitelisted URLs
    if (this.config.strict) {
      const whitelist = this.config.whitelist || [];
      if (whitelist.length === 0) {
        return { allowed: false, reason: "Strict mode enabled but no whitelist configured" };
      }

      // Check if URL matches whitelist
      if (!matchesWhitelist(urlString, whitelist)) {
        // For non-IP hostnames, resolve and check resolved IPs
        const ipType = isIP(hostname);
        if (!ipType) {
          try {
            const ips4 = await resolve4(hostname).catch(() => []);
            const ips6 = await resolve6(hostname).catch(() => []);

            for (const ip of [...ips4, ...ips6]) {
              const ipUrl = urlString.replace(hostname, ip);
              if (matchesWhitelist(ipUrl, whitelist)) {
                return { allowed: true };
              }
            }
          } catch {
            // DNS resolution failed
          }
        }

        return {
          allowed: false,
          reason: `URL not in whitelist. Allowed patterns: ${whitelist.map((p) => (typeof p === "string" ? p : p.source)).join(", ")}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<SSRFConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.blockedHosts) {
      this.blockedHosts = new Set([...BLOCKED_HOSTS, ...config.blockedHosts]);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SSRFConfig {
    return { ...this.config };
  }
}

/**
 * Security error for SSRF violations
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

// Global validator instance (permissive by default)
let globalValidator: SSRFValidator | null = null;

export function getSSRFValidator(): SSRFValidator {
  if (!globalValidator) {
    globalValidator = new SSRFValidator();
  }
  return globalValidator;
}

export function setSSRFValidator(validator: SSRFValidator): void {
  globalValidator = validator;
}

export type { SSRFConfig, ValidationResult };
