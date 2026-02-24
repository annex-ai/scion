// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { describe, expect, test } from "bun:test";
import {
  type IdentityConfig,
  parseIdentityContent,
  validateIdentityConfig,
} from "../../../src/mastra/lib/parsers/identity-parser";

describe("Identity Parser", () => {
  describe("parseIdentityContent", () => {
    test("parses complete identity file with bold keys", () => {
      const content = `
# Identity

**Name**: Scion
**Creature**: Cosmic Crab
**Emoji**: 🦀
**Vibe**: Curious, helpful, slightly mischievous

# Description
A wise cosmic crab who helps developers navigate the universe of code.

# Voice
Speaks with clarity and wit, occasionally making crab-related puns.
`;

      const result = parseIdentityContent(content);

      expect(result.name).toBe("Scion");
      expect(result.creature).toBe("Cosmic Crab");
      expect(result.emoji).toBe("🦀");
      expect(result.vibe).toBe("Curious, helpful, slightly mischievous");
      expect(result.description).toContain("wise cosmic crab");
      expect(result.voice).toContain("clarity and wit");
    });

    test("parses simple key: value format", () => {
      const content = `
Name: Agent Smith
Creature: AI Assistant
Vibe: Professional
`;

      const result = parseIdentityContent(content);

      expect(result.name).toBe("Agent Smith");
      expect(result.creature).toBe("AI Assistant");
      expect(result.vibe).toBe("Professional");
    });

    test("extracts emoji from content", () => {
      const content = `
# Identity
Meet the amazing 🤖 robot assistant!
`;

      const result = parseIdentityContent(content);

      expect(result.emoji).toBe("🤖");
    });

    test("extracts various emoji types", () => {
      const testCases = [
        { content: "Emoji: 🦀", expected: "🦀" },
        { content: "Emoji: ⭐", expected: "⭐" },
        { content: "Emoji: 🚀", expected: "🚀" },
        { content: "Emoji: 😊", expected: "😊" },
      ];

      for (const { content, expected } of testCases) {
        const result = parseIdentityContent(content);
        expect(result.emoji).toBe(expected);
      }
    });

    test("uses defaults for missing fields", () => {
      const content = "# Empty Identity";

      const result = parseIdentityContent(content);

      expect(result.name).toBe("Agent");
      expect(result.creature).toBe("");
      expect(result.vibe).toBe("");
      expect(result.emoji).toBe("");
    });

    test("preserves raw content", () => {
      const content = "**Name**: Test";
      const result = parseIdentityContent(content);

      expect(result.raw).toBe(content);
    });

    test("handles case-insensitive keys", () => {
      const content = `
**NAME**: UpperCase
`;

      const result = parseIdentityContent(content);

      // Keys are normalized to lowercase, so NAME becomes name
      expect(result.name).toBe("UpperCase");
    });
  });

  describe("validateIdentityConfig", () => {
    test("validates complete config", () => {
      const config: IdentityConfig = {
        name: "Scion",
        creature: "Cosmic Crab",
        vibe: "Helpful",
        emoji: "🦀",
        description: "A crab",
        voice: "Friendly",
        raw: "",
      };

      const result = validateIdentityConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test("warns about default name", () => {
      const config: IdentityConfig = {
        name: "Agent",
        creature: "Crab",
        vibe: "Helpful",
        emoji: "🦀",
        description: "",
        voice: "",
        raw: "",
      };

      const result = validateIdentityConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("name"))).toBe(true);
    });

    test("warns about missing creature", () => {
      const config: IdentityConfig = {
        name: "Scion",
        creature: "",
        vibe: "Helpful",
        emoji: "🦀",
        description: "",
        voice: "",
        raw: "",
      };

      const result = validateIdentityConfig(config);

      expect(result.warnings.some((w) => w.includes("creature"))).toBe(true);
    });

    test("warns about missing emoji", () => {
      const config: IdentityConfig = {
        name: "Scion",
        creature: "Crab",
        vibe: "Helpful",
        emoji: "",
        description: "",
        voice: "",
        raw: "",
      };

      const result = validateIdentityConfig(config);

      expect(result.warnings.some((w) => w.includes("emoji"))).toBe(true);
    });

    test("invalid without name", () => {
      const config: IdentityConfig = {
        name: "",
        creature: "Crab",
        vibe: "Helpful",
        emoji: "🦀",
        description: "",
        voice: "",
        raw: "",
      };

      const result = validateIdentityConfig(config);

      expect(result.valid).toBe(false);
    });
  });
});
