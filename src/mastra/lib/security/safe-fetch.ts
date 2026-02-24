// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Safe Fetch Wrapper with SSRF Protection
 *
 * Validates URLs before fetching and validates redirect locations.
 */

import { type SSRFConfig, SSRFValidator, SecurityError } from "./ssrf-validator";

export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
  ssrfConfig?: SSRFConfig;
}

/**
 * Fetch with SSRF protection
 *
 * Validates the initial URL and any redirect locations.
 * Throws SecurityError if a blocked URL is detected.
 *
 * Default behavior: Allow all URLs except cloud metadata endpoints
 * Use ssrfConfig.strict = true with whitelist to restrict access
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
  validator?: SSRFValidator,
): Promise<Response> {
  const { maxRedirects = 10, ssrfConfig, ...fetchOptions } = options;
  const ssrfValidator = validator || new SSRFValidator(ssrfConfig);

  // Validate initial URL
  const validation = await ssrfValidator.validateUrl(url);
  if (!validation.allowed) {
    throw new SecurityError(`SSRF blocked: ${validation.reason}`);
  }

  return fetchWithRedirect(url, fetchOptions, ssrfValidator, maxRedirects, 0);
}

/**
 * Internal fetch with redirect handling
 */
async function fetchWithRedirect(
  url: string,
  options: RequestInit,
  validator: SSRFValidator,
  maxRedirects: number,
  redirectCount: number,
): Promise<Response> {
  if (redirectCount > maxRedirects) {
    throw new SecurityError(`Too many redirects (max: ${maxRedirects})`);
  }

  const response = await fetch(url, {
    ...options,
    redirect: "manual", // Handle redirects manually to validate each location
  });

  // Handle redirects
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      // Resolve relative URLs
      const redirectUrl = new URL(location, url).toString();

      // Validate redirect location
      const validation = await validator.validateUrl(redirectUrl);
      if (!validation.allowed) {
        throw new SecurityError(`SSRF blocked on redirect: ${validation.reason}`);
      }

      // Follow redirect
      return fetchWithRedirect(redirectUrl, options, validator, maxRedirects, redirectCount + 1);
    }
  }

  return response;
}

/**
 * Create a fetch function with SSRF protection for MCPClient
 *
 * Usage:
 * ```typescript
 * const mcpClient = new MCPClient({
 *   servers: {
 *     myServer: {
 *       url: new URL("https://api.example.com/mcp"),
 *       fetch: createSafeFetch(),
 *     },
 *   },
 * });
 * ```
 */
export function createSafeFetch(
  validator?: SSRFValidator,
): (url: URL | string, init?: RequestInit) => Promise<Response> {
  const ssrfValidator = validator || new SSRFValidator();

  return async (url: URL | string, init?: RequestInit): Promise<Response> => {
    const urlString = url.toString();

    // Validate URL before fetching
    const validation = await ssrfValidator.validateUrl(urlString);
    if (!validation.allowed) {
      throw new SecurityError(`SSRF blocked: ${validation.reason}`);
    }

    // Use native fetch (redirects handled by MCPClient or safeFetch wrapper)
    return fetch(url, init);
  };
}
