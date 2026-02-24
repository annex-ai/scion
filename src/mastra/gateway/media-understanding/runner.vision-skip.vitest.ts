// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson
// @ts-nocheck — skipped: requires vitest (vi.importActual, vi.mock)

import { describe, expect, it, mock } from "bun:test";
import type { ScionConfig } from "../config/config.js";
import type { MediaContext } from "./context.js";
import {
  buildProviderRegistry,
  createMediaAttachmentCache,
  normalizeMediaAttachments,
  runCapability,
} from "./runner.js";

const catalog = [
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    input: ["text", "image"] as const,
  },
];

vi.mock("../agents/model-catalog.js", async () => {
  const actual = await vi.importActual<typeof import("../agents/model-catalog.js")>("../agents/model-catalog.js");
  return {
    ...actual,
    loadModelCatalog: vi.fn(async () => catalog),
  };
});

// Skipped: uses vi.importActual and vi.mock which have no bun:test equivalent
describe.skip("runCapability image skip (requires vitest)", () => {
  it("skips image understanding when the active model supports vision", async () => {
    const ctx: MediaContext = { MediaPath: "/tmp/image.png", MediaType: "image/png" };
    const media = normalizeMediaAttachments(ctx);
    const cache = createMediaAttachmentCache(media);
    const cfg = {} as ScionConfig;

    try {
      const result = await runCapability({
        capability: "image",
        cfg,
        ctx,
        attachments: cache,
        media,
        providerRegistry: buildProviderRegistry(),
        activeModel: { provider: "openai", model: "gpt-4.1" },
      });

      expect(result.outputs).toHaveLength(0);
      expect(result.decision.outcome).toBe("skipped");
      expect(result.decision.attachments).toHaveLength(1);
      expect(result.decision.attachments[0]?.attachmentIndex).toBe(0);
      expect(result.decision.attachments[0]?.attempts[0]?.outcome).toBe("skipped");
      expect(result.decision.attachments[0]?.attempts[0]?.reason).toBe("primary model supports vision natively");
    } finally {
      await cache.cleanup();
    }
  });
});
