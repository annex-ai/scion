// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * IP Extraction Utility
 *
 * Extracts client IP from request headers, handling X-Forwarded-For and proxy chains.
 */

/**
 * Extract client IP from request context
 *
 * Handles X-Forwarded-For and X-Real-IP headers when behind a reverse proxy.
 *
 * @param headers - Request headers (from context.req.raw.headers or a Headers object)
 * @param trustProxy - Whether to trust X-Forwarded-For header
 * @param trustedProxies - List of proxy IPs to skip in X-Forwarded-For chain
 * @returns Client IP address or "unknown"
 */
export function extractClientIp(headers: Headers, trustProxy: boolean, trustedProxies?: string[]): string {
  const directIp = headers.get("x-real-ip") || "unknown";

  if (!trustProxy) {
    return directIp;
  }

  // Check X-Forwarded-For header
  const forwarded = headers.get("x-forwarded-for");

  if (forwarded) {
    // X-Forwarded-For format: client, proxy1, proxy2, ...
    // Walk backwards from the last proxy to find the client
    const ips = forwarded.split(",").map((ip) => ip.trim());

    for (let i = ips.length - 1; i >= 0; i--) {
      const ip = ips[i];
      if (!trustedProxies?.includes(ip)) {
        return ip;
      }
    }

    // All IPs were trusted proxies, return the first one (client)
    return ips[0];
  }

  // Fallback to X-Real-IP or direct IP
  return directIp;
}
