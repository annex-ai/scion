// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import type { ScionConfig } from "../config/config.js";

export type ModelCatalogEntry = {
  id: string;
  name?: string;
  provider: string;
  input?: readonly string[];
  [key: string]: unknown;
};

export async function loadModelCatalog(_params: {
  config: ScionConfig;
}): Promise<ModelCatalogEntry[]> {
  return [];
}

export function findModelInCatalog(
  catalog: ModelCatalogEntry[],
  provider: string,
  modelId: string,
): ModelCatalogEntry | undefined {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = modelId.trim().toLowerCase();
  return catalog.find(
    (entry) => entry.provider.toLowerCase() === normalizedProvider && entry.id.toLowerCase() === normalizedModel,
  );
}

export function modelSupportsVision(entry: ModelCatalogEntry | undefined): boolean {
  if (!entry?.input) {
    return false;
  }
  return entry.input.includes("image");
}
