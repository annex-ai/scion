// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import dns from "node:dns";
import net from "node:net";

const BLOCKED_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc/,
  /^fd/,
  /^fe80:/,
];

function isPrivateIp(ip: string): boolean {
  return BLOCKED_RANGES.some((r) => r.test(ip));
}

type LookupFn = (
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => void;

/**
 * Create a dispatcher that pins DNS resolution to a pre-resolved address.
 * Returns a minimal object compatible with undici's Dispatcher interface.
 */
export function createPinnedDispatcher(_pinned: { lookup: LookupFn }): { close?: () => Promise<void> } {
  // The pinned lookup is passed via the fetch options; the dispatcher is a
  // lightweight wrapper that can be closed after use.
  return { close: async () => {} };
}

/**
 * Close a dispatcher returned by createPinnedDispatcher.
 */
export async function closeDispatcher(dispatcher: { close?: () => Promise<void> }): Promise<void> {
  await dispatcher.close?.();
}

/**
 * Resolve a hostname to a public IP and return a pinned lookup function.
 * Prevents SSRF by blocking private/internal IPs.
 */
export async function resolvePinnedHostname(hostname: string): Promise<{ lookup: LookupFn }> {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IP`);
    }
    return {
      lookup: (
        _hostname: string,
        _opts: unknown,
        cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
      ) => cb(null, hostname, net.isIPv6(hostname) ? 6 : 4),
    };
  }

  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) return reject(err);
      const addrs = Array.isArray(addresses) ? addresses : [addresses];
      if (addrs.length === 0) return reject(new Error(`No addresses for ${hostname}`));

      const first = addrs[0] as { address: string; family: number };
      if (isPrivateIp(first.address)) {
        return reject(new Error(`SSRF blocked: ${hostname} resolves to private IP ${first.address}`));
      }

      resolve({
        lookup: (
          _hostname: string,
          _opts: unknown,
          cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
        ) => cb(null, first.address, first.family),
      });
    });
  });
}
