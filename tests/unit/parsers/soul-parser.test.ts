// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { describe, expect, test } from "bun:test";
import { type SoulConfig, parseSoulContent, validateSoulConfig } from "../../../src/mastra/lib/parsers/soul-parser";

describe("Soul Parser", () => {
  describe("parseSoulContent", () => {
    test("parses complete soul file", () => {
      const content = `
# Core Truths
- Honesty is paramount
- Help users accomplish their goals
- Respect boundaries

# Boundaries
- Never generate harmful content
- Maintain confidentiality
- Be transparent about limitations

# Vibe
Calm, thoughtful, and supportive. Like a wise mentor who speaks carefully.

# Continuity
Remember key context across conversations. Maintain consistency in personality.
`;

      const result = parseSoulContent(content);

      expect(result.coreTruths).toEqual([
        "Honesty is paramount",
        "Help users accomplish their goals",
        "Respect boundaries",
      ]);

      expect(result.boundaries).toEqual([
        "Never generate harmful content",
        "Maintain confidentiality",
        "Be transparent about limitations",
      ]);

      expect(result.vibe).toContain("Calm, thoughtful");
      expect(result.continuity).toContain("Remember key context");
    });

    test("parses with alternative section names", () => {
      const content = `
# Truths
- Be helpful

# Limits
- No harmful content

# Tone
Professional and friendly

# Memory
Maintain context
`;

      const result = parseSoulContent(content);

      expect(result.coreTruths).toEqual(["Be helpful"]);
      expect(result.boundaries).toEqual(["No harmful content"]);
      expect(result.vibe).toContain("Professional");
      expect(result.continuity).toContain("Maintain context");
    });

    test("handles empty sections", () => {
      const content = `
# Core Truths

# Boundaries

# Vibe
`;

      const result = parseSoulContent(content);

      expect(result.coreTruths).toEqual([]);
      expect(result.boundaries).toEqual([]);
      expect(result.vibe).toBe("");
    });

    test("handles asterisk bullets", () => {
      const content = `
# Core Truths
* Truth one
* Truth two
`;

      const result = parseSoulContent(content);

      expect(result.coreTruths).toEqual(["Truth one", "Truth two"]);
    });

    test("handles nested lists", () => {
      const content = `
# Core Truths
- Main truth
  - Sub point (ignored)
- Another truth
`;

      const result = parseSoulContent(content);

      // Should capture indented items too
      expect(result.coreTruths.length).toBeGreaterThanOrEqual(2);
    });

    test("preserves raw content", () => {
      const content = "# Core Truths\n- Be good";
      const result = parseSoulContent(content);

      expect(result.raw).toBe(content);
    });

    test("handles H2 headers", () => {
      const content = `
## Core Truths
- Truth 1

## Boundaries
- Boundary 1
`;

      const result = parseSoulContent(content);

      expect(result.coreTruths).toEqual(["Truth 1"]);
      expect(result.boundaries).toEqual(["Boundary 1"]);
    });
  });

  describe("validateSoulConfig", () => {
    test("validates complete config without warnings", () => {
      const config: SoulConfig = {
        coreTruths: ["Truth 1"],
        boundaries: ["Boundary 1"],
        vibe: "Friendly",
        continuity: "Remember things",
        raw: "",
      };

      const result = validateSoulConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test("warns about missing core truths", () => {
      const config: SoulConfig = {
        coreTruths: [],
        boundaries: ["Boundary 1"],
        vibe: "Friendly",
        continuity: "",
        raw: "",
      };

      const result = validateSoulConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("core truths"))).toBe(true);
    });

    test("warns about missing boundaries", () => {
      const config: SoulConfig = {
        coreTruths: ["Truth 1"],
        boundaries: [],
        vibe: "Friendly",
        continuity: "",
        raw: "",
      };

      const result = validateSoulConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("boundaries"))).toBe(true);
    });

    test("warns about missing vibe", () => {
      const config: SoulConfig = {
        coreTruths: ["Truth 1"],
        boundaries: ["Boundary 1"],
        vibe: "",
        continuity: "",
        raw: "",
      };

      const result = validateSoulConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("vibe"))).toBe(true);
    });
  });
});
