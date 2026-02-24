// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * CIDR Utilities
 *
 * Shared IP address parsing and CIDR range matching used by both
 * SSRF validation and gateway security.
 */

/**
 * Parse CIDR notation to get IP range
 */
export function parseCidr(cidr: string): { network: bigint; mask: number; version: 4 | 6 } {
  const [ipStr, maskStr] = cidr.split("/");
  const mask = Number.parseInt(maskStr, 10);

  if (ipStr.includes(":")) {
    return { network: ipv6ToBigInt(ipStr), mask, version: 6 };
  }
  return { network: ipv4ToBigInt(ipStr), mask, version: 4 };
}

/**
 * Convert IPv4 string to bigint
 */
export function ipv4ToBigInt(ip: string): bigint {
  const parts = ip.split(".").map(Number);
  return (BigInt(parts[0]) << 24n) | (BigInt(parts[1]) << 16n) | (BigInt(parts[2]) << 8n) | BigInt(parts[3]);
}

/**
 * Convert IPv6 string to bigint
 */
export function ipv6ToBigInt(ip: string): bigint {
  let fullIp = ip;
  if (ip.includes("::")) {
    const parts = ip.split("::");
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    const zeros = Array(missing).fill("0");
    fullIp = [...left, ...zeros, ...right].join(":");
  }

  const parts = fullIp.split(":");
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result = (result << 16n) | BigInt(Number.parseInt(parts[i] || "0", 16));
  }
  return result;
}

/**
 * Check if IP is in CIDR range
 */
export function isInCidr(ip: string, cidr: string): boolean {
  const { network, mask, version } = parseCidr(cidr);
  const ipVersion = ip.includes(":") ? 6 : 4;
  if (ipVersion !== version) return false;

  const ipInt = ipVersion === 4 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip);
  const maskBits = version === 4 ? 32n - BigInt(mask) : 128n - BigInt(mask);
  const maskValue = (1n << maskBits) - 1n;
  const invertedMask = ~maskValue;

  return (ipInt & invertedMask) === (network & invertedMask);
}
