// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Secret Protection Utilities
 *
 * Masks sensitive secrets in text using pattern matching.
 * Secrets are loaded from process.env (populated from .env file).
 *
 * Pattern: §§secret(ALIAS) - visually distinctive, maps to process.env[ALIAS]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Common secret environment variable names to check
const COMMON_SECRET_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "GITHUB_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_USER_TOKEN",
  "SLACK_SIGNING_SECRET",
  "DISCORD_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "ANTHROPIC_API_KEY",
  "COHERE_API_KEY",
  "MISTRAL_API_KEY",
  "TOGETHER_API_KEY",
  "OPENROUTER_API_KEY",
  "AI21_API_KEY",
  "GEMINI_API_KEY",
  "VERTEX_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AZURE_OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "HUGGINGFACE_API_KEY",
  "REPLICATE_API_TOKEN",
  "STABILITY_API_KEY",
  "PINECONE_API_KEY",
  "WEAVIATE_API_KEY",
  "QDRANT_API_KEY",
  "CHROMA_API_KEY",
  "DATABASE_URL",
  "REDIS_URL",
  "MONGODB_URI",
  "JWT_SECRET",
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
  "API_KEY",
  "SECRET_KEY",
  "PRIVATE_KEY",
  "PASSWORD",
  "TOKEN",
];

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Load secrets from .env file into a map
 */
function loadSecretsFromEnv(): Map<string, string> {
  const secrets = new Map<string, string>();

  // Check common secret keys in process.env
  for (const key of COMMON_SECRET_KEYS) {
    const value = process.env[key];
    if (value && value.length > 0) {
      secrets.set(key, value);
    }
  }

  // Also scan all env vars for common secret patterns
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;

    // Skip if already added
    if (secrets.has(key)) continue;

    // Check for secret-like patterns in key names
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("key") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("token") ||
      lowerKey.includes("password") ||
      lowerKey.includes("api_key") ||
      lowerKey.includes("apikey") ||
      lowerKey.includes("private") ||
      lowerKey.includes("credential") ||
      lowerKey.includes("auth") ||
      lowerKey.includes("session") ||
      lowerKey.includes("cookie")
    ) {
      // Only include if value looks like a secret (min length, no spaces)
      if (value.length >= 8 && !value.includes(" ")) {
        secrets.set(key, value);
      }
    }
  }

  return secrets;
}

// Global secrets cache
let secretsCache: Map<string, string> | null = null;

function getSecrets(): Map<string, string> {
  if (!secretsCache) {
    secretsCache = loadSecretsFromEnv();
  }
  return secretsCache;
}

/**
 * Mask secrets in text by replacing them with placeholders
 *
 * Example: "sk-abc123..." → "§§secret(OPENAI_API_KEY)"
 */
export function maskSecrets(text: string): string {
  const secrets = getSecrets();
  let masked = text;

  // Sort secrets by length (longest first) to avoid partial matches
  const sortedSecrets = Array.from(secrets.entries()).sort((a, b) => b[1].length - a[1].length);

  for (const [key, value] of sortedSecrets) {
    // Create regex for exact match of the secret value
    const pattern = new RegExp(escapeRegExp(value), "g");
    masked = masked.replace(pattern, `§§secret(${key})`);
  }

  return masked;
}

/**
 * Scan text for potential secrets (without masking)
 *
 * Returns list of found secrets for logging/debugging
 */
export function scanForSecrets(text: string): Array<{ alias: string; count: number }> {
  const secrets = getSecrets();
  const found: Array<{ alias: string; count: number }> = [];

  for (const [key, value] of secrets.entries()) {
    const pattern = new RegExp(escapeRegExp(value), "g");
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      found.push({ alias: key, count: matches.length });
    }
  }

  return found;
}

/**
 * Unmask placeholders back to actual secret values
 *
 * Only used at tool execution time, never exposed to LLM
 */
export function unmaskSecrets(text: string): string {
  const secrets = getSecrets();
  const placeholderPattern = /§§secret\(([A-Z_][A-Z0-9_]*)\)/g;

  return text.replace(placeholderPattern, (match, alias) => {
    const secretValue = secrets.get(alias);
    return secretValue || match; // Return original if not found
  });
}

/**
 * Check if text contains any secret placeholders
 */
export function containsSecretPlaceholders(text: string): boolean {
  return /§§secret\([A-Z_][A-Z0-9_]*\)/.test(text);
}

/**
 * Reload secrets from environment (useful after .env changes)
 */
export function reloadSecrets(): void {
  secretsCache = null;
}

/**
 * Get list of configured secret keys (for debugging)
 */
export function getConfiguredSecretKeys(): string[] {
  return Array.from(getSecrets().keys());
}
