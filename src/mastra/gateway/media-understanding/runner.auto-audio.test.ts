// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScionConfig } from "../config/config.js";
import type { MediaContext } from "./context.js";
import {
  buildProviderRegistry,
  createMediaAttachmentCache,
  normalizeMediaAttachments,
  runCapability,
} from "./runner.js";

describe("runCapability auto audio entries", () => {
  it("uses provider keys to auto-enable audio transcription", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    const tmpPath = path.join(os.tmpdir(), `scion-auto-audio-${Date.now()}.wav`);
    await fs.writeFile(tmpPath, Buffer.from("RIFF"));
    const ctx: MediaContext = { MediaPath: tmpPath, MediaType: "audio/wav" };
    const media = normalizeMediaAttachments(ctx);
    const cache = createMediaAttachmentCache(media);

    let seenModel: string | undefined;
    const providerRegistry = buildProviderRegistry({
      openai: {
        id: "openai",
        capabilities: ["audio"],
        transcribeAudio: async (req) => {
          seenModel = req.model;
          return { text: "ok", model: req.model };
        },
      },
    });

    const cfg = {
      models: {
        providers: {
          openai: {
            apiKey: "test-key",
            models: [],
          },
        },
      },
    } as unknown as ScionConfig;

    try {
      const result = await runCapability({
        capability: "audio",
        cfg,
        ctx,
        attachments: cache,
        media,
        providerRegistry,
      });
      expect(result.outputs[0]?.text).toBe("ok");
      expect(seenModel).toBe("gpt-4o-mini-transcribe");
      expect(result.decision.outcome).toBe("success");
    } finally {
      process.env.PATH = originalPath;
      await cache.cleanup();
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  it("skips auto audio when disabled", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    const tmpPath = path.join(os.tmpdir(), `scion-auto-audio-${Date.now()}.wav`);
    await fs.writeFile(tmpPath, Buffer.from("RIFF"));
    const ctx: MediaContext = { MediaPath: tmpPath, MediaType: "audio/wav" };
    const media = normalizeMediaAttachments(ctx);
    const cache = createMediaAttachmentCache(media);

    const providerRegistry = buildProviderRegistry({
      openai: {
        id: "openai",
        capabilities: ["audio"],
        transcribeAudio: async () => ({ text: "ok", model: "whisper-1" }),
      },
    });

    const cfg = {
      models: {
        providers: {
          openai: {
            apiKey: "test-key",
            models: [],
          },
        },
      },
      tools: {
        media: {
          audio: {
            enabled: false,
          },
        },
      },
    } as unknown as ScionConfig;

    try {
      const result = await runCapability({
        capability: "audio",
        cfg,
        ctx,
        attachments: cache,
        media,
        providerRegistry,
      });
      expect(result.outputs).toHaveLength(0);
      expect(result.decision.outcome).toBe("disabled");
    } finally {
      process.env.PATH = originalPath;
      await cache.cleanup();
      await fs.unlink(tmpPath).catch(() => {});
    }
  });
});
