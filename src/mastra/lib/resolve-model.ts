// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Model Resolver
 *
 * Resolves model ID strings to LanguageModel instances.
 * Handles both registered Mastra providers and custom OpenAI-compatible providers.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "@mastra/core/llm";

/**
 * Custom provider configurations for OpenAI-compatible APIs
 */
const CUSTOM_PROVIDERS: Record<string, { baseURL: string; apiKeyEnv: string }> = {
  "zai-coding-plan": {
    baseURL: process.env.ZAI_BASE_URL ?? "https://api.zai.example/v1",
    apiKeyEnv: "ZAI_API_KEY",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  google: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GOOGLE_API_KEY",
  },
};

/**
 * Resolve a model ID string to a language model instance.
 *
 * Model ID format: "provider/model-name"
 * Examples:
 *   - "zai-coding-plan/glm-5"
 *   - "openrouter/anthropic/claude-3-opus"
 *   - "google/gemini-2.5-flash"
 *
 * @param modelId - The model identifier in "provider/model" format
 * @returns A language model instance compatible with Mastra
 */
export function resolveModel(modelId: string): LanguageModel {
  const [provider, ...rest] = modelId.split("/");
  const model = rest.join("/");

  // Custom providers first
  if (CUSTOM_PROVIDERS[provider]) {
    const config = CUSTOM_PROVIDERS[provider];
    const apiKey = process.env[config.apiKeyEnv];

    if (!apiKey) {
      console.warn(`[resolve-model] Missing API key for provider ${provider} (env: ${config.apiKeyEnv})`);
    }

    const client = createOpenAICompatible({
      name: provider,
      baseURL: config.baseURL,
      apiKey: apiKey ?? "",
    });

    // Cast through unknown due to LanguageModelV3 vs MastraLanguageModel type mismatch
    return client(model) as unknown as LanguageModel;
  }

  // For unknown providers, try creating an OpenAI-compatible client
  // This allows dynamic provider addition via environment variables
  const envBaseUrl = process.env[`${provider.toUpperCase().replace(/-/g, "_")}_BASE_URL`];
  const envApiKey = process.env[`${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`];

  if (envBaseUrl) {
    const client = createOpenAICompatible({
      name: provider,
      baseURL: envBaseUrl,
      apiKey: envApiKey ?? "",
    });

    // Cast through unknown due to LanguageModelV3 vs MastraLanguageModel type mismatch
    return client(model) as unknown as LanguageModel;
  }

  // Fallback: throw error for unknown provider
  throw new Error(
    `[resolve-model] Unknown provider "${provider}" for model "${modelId}". ` +
      `Set ${provider.toUpperCase().replace(/-/g, "_")}_BASE_URL and ${provider.toUpperCase().replace(/-/g, "_")}_API_KEY environment variables.`,
  );
}

/**
 * Check if a model ID uses a known provider
 */
export function isKnownProvider(modelId: string): boolean {
  const [provider] = modelId.split("/");
  return provider in CUSTOM_PROVIDERS;
}

/**
 * Get the API key environment variable name for a provider
 */
export function getProviderApiKeyEnvVar(modelId: string): string {
  const [provider] = modelId.split("/");
  if (CUSTOM_PROVIDERS[provider]) {
    return CUSTOM_PROVIDERS[provider].apiKeyEnv;
  }
  return `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}
