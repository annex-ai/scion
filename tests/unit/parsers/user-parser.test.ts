// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { describe, expect, test } from "bun:test";
import {
  getTimeBasedGreeting,
  parseUserContent,
  type UserConfig,
  validateUserConfig,
} from "../../../src/mastra/lib/parsers/user-parser";

describe("User Parser", () => {
  describe("parseUserContent", () => {
    test("parses complete user file", () => {
      const content = `
# User

**Name**: Sacha
**Timezone**: Europe/Berlin
**Pronouns**: they/them

# Preferences
- Concise responses
- Code examples in TypeScript
- Dark mode friendly formatting

# Context
A software developer working on AI agents.

# Goals
- Build a personal assistant
- Learn about LLM orchestration
`;

      const result = parseUserContent(content);

      expect(result.name).toBe("Sacha");
      expect(result.timezone).toBe("Europe/Berlin");
      expect(result.pronouns).toBe("they/them");
      expect(result.preferences).toEqual([
        "Concise responses",
        "Code examples in TypeScript",
        "Dark mode friendly formatting",
      ]);
      expect(result.context).toContain("software developer");
      expect(result.goals).toEqual(["Build a personal assistant", "Learn about LLM orchestration"]);
    });

    test("parses simple key: value format", () => {
      const content = `
Name: Alice
Timezone: America/New_York
`;

      const result = parseUserContent(content);

      expect(result.name).toBe("Alice");
      expect(result.timezone).toBe("America/New_York");
    });

    test("uses defaults for missing fields", () => {
      const content = "# Empty User";

      const result = parseUserContent(content);

      expect(result.name).toBe("User");
      expect(result.timezone).toBe("UTC");
      expect(result.pronouns).toBe("");
      expect(result.preferences).toEqual([]);
      expect(result.goals).toEqual([]);
    });

    test("handles alternative section names", () => {
      const content = `
Name: Bob

# Prefs
- Short answers

# About
Developer

# Objectives
- Ship code
`;

      const result = parseUserContent(content);

      expect(result.preferences).toEqual(["Short answers"]);
      expect(result.context).toContain("Developer");
      expect(result.goals).toEqual(["Ship code"]);
    });

    test("preserves raw content", () => {
      const content = "**Name**: Test";
      const result = parseUserContent(content);

      expect(result.raw).toBe(content);
    });

    test("handles asterisk bullets", () => {
      const content = `
# Preferences
* Preference one
* Preference two
`;

      const result = parseUserContent(content);

      expect(result.preferences).toEqual(["Preference one", "Preference two"]);
    });
  });

  describe("validateUserConfig", () => {
    test("validates complete config", () => {
      const config: UserConfig = {
        name: "Sacha",
        timezone: "Europe/Berlin",
        pronouns: "they/them",
        preferences: ["Short answers"],
        context: "Developer",
        goals: ["Ship code"],
        raw: "",
      };

      const result = validateUserConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test("warns about default name", () => {
      const config: UserConfig = {
        name: "User",
        timezone: "Europe/Berlin",
        pronouns: "",
        preferences: ["Pref"],
        context: "",
        goals: [],
        raw: "",
      };

      const result = validateUserConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("name"))).toBe(true);
    });

    test("warns about UTC timezone", () => {
      const config: UserConfig = {
        name: "Sacha",
        timezone: "UTC",
        pronouns: "",
        preferences: ["Pref"],
        context: "",
        goals: [],
        raw: "",
      };

      const result = validateUserConfig(config);

      expect(result.warnings.some((w) => w.includes("timezone"))).toBe(true);
    });

    test("warns about empty preferences", () => {
      const config: UserConfig = {
        name: "Sacha",
        timezone: "Europe/Berlin",
        pronouns: "",
        preferences: [],
        context: "",
        goals: [],
        raw: "",
      };

      const result = validateUserConfig(config);

      expect(result.warnings.some((w) => w.includes("preferences"))).toBe(true);
    });
  });

  describe("getTimeBasedGreeting", () => {
    test("uses user name in greeting", () => {
      const config: UserConfig = {
        name: "Sacha",
        timezone: "UTC",
        pronouns: "",
        preferences: [],
        context: "",
        goals: [],
        raw: "",
      };

      const greeting = getTimeBasedGreeting(config);

      expect(greeting).toContain("Sacha");
    });

    test("handles invalid timezone gracefully", () => {
      const config: UserConfig = {
        name: "Test",
        timezone: "Invalid/Timezone",
        pronouns: "",
        preferences: [],
        context: "",
        goals: [],
        raw: "",
      };

      // Should not throw
      const greeting = getTimeBasedGreeting(config);

      expect(greeting).toContain("Test");
    });

    test("returns appropriate greeting format", () => {
      const config: UserConfig = {
        name: "Alice",
        timezone: "UTC",
        pronouns: "",
        preferences: [],
        context: "",
        goals: [],
        raw: "",
      };

      const greeting = getTimeBasedGreeting(config);

      // Should be one of the greeting formats
      const validGreetings = ["Good morning", "Good afternoon", "Good evening", "Hello"];
      const hasValidGreeting = validGreetings.some((g) => greeting.startsWith(g));

      expect(hasValidGreeting).toBe(true);
    });
  });
});
