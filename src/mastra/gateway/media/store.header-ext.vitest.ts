// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson
// @ts-nocheck — skipped: requires vitest (vi.importActual, vi.mock)

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

const realOs = await vi.importActual<typeof import("node:os")>("node:os");
const HOME = path.join(realOs.tmpdir(), "scion-home-header-ext-test");

vi.mock("node:os", () => ({
  default: { homedir: () => HOME, tmpdir: () => realOs.tmpdir() },
  homedir: () => HOME,
  tmpdir: () => realOs.tmpdir(),
}));

vi.mock("./mime.js", async () => {
  const actual = await vi.importActual<typeof import("./mime.js")>("./mime.js");
  return {
    ...actual,
    detectMime: vi.fn(async () => "audio/opus"),
  };
});

const store = await import("./store.js");

// Skipped: uses vi.importActual and vi.mock which have no bun:test equivalent
describe.skip("media store header extensions (requires vitest)", () => {
  beforeAll(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
  });

  it("prefers header mime extension when sniffed mime lacks mapping", async () => {
    const buf = Buffer.from("fake-audio");
    const saved = await store.saveMediaBuffer(buf, "audio/ogg; codecs=opus");
    expect(path.extname(saved.path)).toBe(".ogg");
  });
});
