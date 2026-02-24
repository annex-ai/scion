// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Tests for reflection utility functions (extracted from ReflectionService)
 *
 * Tests pure functions: mergePatterns, generateHeuristics, isSimilar,
 * loadState, saveState, writeReflections, and message helpers.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearConfigCache, loadAgentConfig } from "../../src/mastra/lib/config";
import {
  type AggregatedPattern,
  type Heuristic,
  type RawPattern,
  type ReflectionState,
  buildBatchPrompt,
  chunkArray,
  extractReasoningContent,
  extractTextContent,
  generateHeuristics,
  isSimilar,
  isToolCallOnly,
  loadState,
  mergeAggregatedPatterns,
  mergeHeuristics,
  mergePatterns,
  parseReflectionsMd,
  parseSuggestion,
  saveState,
  writeReflections,
} from "../../src/mastra/lib/reflection-utils";

// ============================================================================
// isSimilar
// ============================================================================

describe("isSimilar", () => {
  test("identical strings → true", () => {
    expect(isSimilar("hello world", "hello world")).toBe(true);
  });

  test("substring containment → true", () => {
    expect(isSimilar("deployment config", "deployment configuration details")).toBe(true);
  });

  test("empty strings → false", () => {
    expect(isSimilar("", "hello")).toBe(false);
    expect(isSimilar("hello", "")).toBe(false);
  });

  test("completely different → false", () => {
    expect(isSimilar("cats and dogs", "quantum physics research")).toBe(false);
  });

  test("similar with word normalization → true", () => {
    expect(isSimilar("user references deployment configuration", "user referencing deployment configurations")).toBe(
      true,
    );
  });

  test("custom threshold", () => {
    expect(isSimilar("some words here", "some words there", 0.9)).toBe(false);
    expect(isSimilar("some words here", "some words there", 0.3)).toBe(true);
  });
});

// ============================================================================
// mergePatterns
// ============================================================================

describe("mergePatterns", () => {
  test("empty input → empty output", () => {
    expect(mergePatterns([])).toEqual([]);
  });

  test("single pattern → single aggregated", () => {
    const raw: RawPattern[] = [
      {
        type: "attention_signal",
        description: "test pattern",
        evidence: "some evidence",
        confidence: 0.8,
        sourceThread: "thread-1",
        timestamp: "2026-01-01T00:00:00Z",
      },
    ];
    const result = mergePatterns(raw);
    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toBe(1);
    expect(result[0].sourceThreads).toEqual(["thread-1"]);
  });

  test("similar patterns merge → occurrences increment", () => {
    const raw: RawPattern[] = [
      {
        type: "attention_signal",
        description: "user references deployment config",
        evidence: "evidence 1",
        confidence: 0.8,
        sourceThread: "thread-1",
        timestamp: "2026-01-01T00:00:00Z",
      },
      {
        type: "attention_signal",
        description: "user references deployment configuration",
        evidence: "evidence 2",
        confidence: 0.7,
        sourceThread: "thread-2",
        timestamp: "2026-01-02T00:00:00Z",
      },
    ];
    const result = mergePatterns(raw);
    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toBe(2);
    expect(result[0].sourceThreads).toContain("thread-1");
    expect(result[0].sourceThreads).toContain("thread-2");
  });

  test("different types do NOT merge", () => {
    const raw: RawPattern[] = [
      {
        type: "attention_signal",
        description: "deployment config",
        evidence: "ev1",
        confidence: 0.8,
        sourceThread: "thread-1",
        timestamp: "2026-01-01T00:00:00Z",
      },
      {
        type: "noise_pattern",
        description: "deployment config",
        evidence: "ev2",
        confidence: 0.6,
        sourceThread: "thread-1",
        timestamp: "2026-01-01T00:00:00Z",
      },
    ];
    const result = mergePatterns(raw);
    expect(result).toHaveLength(2);
  });

  test("sorted by confidence * occurrences descending", () => {
    const raw: RawPattern[] = [
      {
        type: "attention_signal",
        description: "low conf",
        evidence: "e",
        confidence: 0.3,
        sourceThread: "t",
        timestamp: "t",
      },
      {
        type: "attention_signal",
        description: "high conf",
        evidence: "e",
        confidence: 0.9,
        sourceThread: "t",
        timestamp: "t",
      },
    ];
    const result = mergePatterns(raw);
    expect(result[0].description).toBe("high conf");
  });
});

// ============================================================================
// parseSuggestion
// ============================================================================

describe("parseSuggestion", () => {
  test("when/then format", () => {
    const result = parseSuggestion("when deployment is mentioned, then boost score");
    expect(result).toEqual({ condition: "deployment is mentioned", action: "boost score" });
  });

  test("prioritize format", () => {
    const result = parseSuggestion("prioritize deployment context");
    expect(result).toEqual({ condition: "deployment context", action: "boost relevance score" });
  });

  test("filter out format", () => {
    const result = parseSuggestion("filter out lunch discussions");
    expect(result).toEqual({ condition: "lunch discussions", action: "reduce relevance score" });
  });

  test("arrow format with →", () => {
    const result = parseSuggestion("summarizing → ensure features section doesn't repeat");
    expect(result).toEqual({ condition: "summarizing", action: "ensure features section doesn't repeat" });
  });

  test("arrow format with ->", () => {
    const result = parseSuggestion("code review requested -> check for security issues first");
    expect(result).toEqual({ condition: "code review requested", action: "check for security issues first" });
  });

  test("for/during/in format with comma", () => {
    const result = parseSuggestion("For debugging scenarios, propose concrete next steps");
    expect(result).toEqual({ condition: "debugging scenarios", action: "propose concrete next steps" });
  });

  test("for/during/in format with colon", () => {
    const result = parseSuggestion("during code review: highlight potential security issues");
    expect(result).toEqual({ condition: "code review", action: "highlight potential security issues" });
  });

  test("imperative format — ensure", () => {
    const result = parseSuggestion("Ensure all code blocks are complete");
    expect(result).toEqual({ condition: "always", action: "ensure all code blocks are complete" });
  });

  test("imperative format — avoid", () => {
    const result = parseSuggestion("Avoid repeating information already provided");
    expect(result).toEqual({ condition: "always", action: "avoid repeating information already provided" });
  });

  test("imperative format — always", () => {
    const result = parseSuggestion("Always validate tool parameters before invocation");
    expect(result).toEqual({ condition: "always", action: "always validate tool parameters before invocation" });
  });

  test("too short → null", () => {
    expect(parseSuggestion("short")).toBeNull();
  });
});

// ============================================================================
// generateHeuristics
// ============================================================================

describe("generateHeuristics", () => {
  test("empty input → empty", () => {
    expect(generateHeuristics([])).toEqual([]);
  });

  test("valid suggestions → heuristics", () => {
    const result = generateHeuristics([
      { suggestion: "when deployment mentioned, then boost score", source: "thread-1" },
      { suggestion: "filter out lunch discussions", source: "thread-2" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("heuristic_1");
    expect(result[1].name).toBe("heuristic_2");
  });

  test("deduplicates similar suggestions", () => {
    const result = generateHeuristics([
      { suggestion: "when deployment config mentioned, then boost", source: "thread-1" },
      { suggestion: "when deployment configuration mentioned, then boost", source: "thread-2" },
    ]);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// State persistence
// ============================================================================

describe("ReflectionState persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "reflection-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("loadState returns defaults for missing file", async () => {
    const state = await loadState(join(tmpDir, "nonexistent.json"));
    expect(state.lastRunAt).toBeNull();
    expect(state.processedMessageIds).toEqual([]);
  });

  test("saveState + loadState round-trip", async () => {
    const path = join(tmpDir, "state.json");
    const state: ReflectionState = {
      lastRunAt: "2026-01-01T00:00:00Z",
      processedMessageIds: ["id-1", "id-2", "id-3"],
    };

    await saveState(state, path);
    const loaded = await loadState(path);

    expect(loaded.lastRunAt).toBe("2026-01-01T00:00:00Z");
    expect(loaded.processedMessageIds).toEqual(["id-1", "id-2", "id-3"]);
  });

  test("saveState prunes to 1000 max IDs", async () => {
    const path = join(tmpDir, "state.json");
    const ids = Array.from({ length: 1200 }, (_, i) => `id-${i}`);
    const state: ReflectionState = {
      lastRunAt: new Date().toISOString(),
      processedMessageIds: ids,
    };

    await saveState(state, path);
    const loaded = await loadState(path);

    expect(loaded.processedMessageIds).toHaveLength(1000);
    expect(loaded.processedMessageIds[0]).toBe("id-200");
    expect(loaded.processedMessageIds[999]).toBe("id-1199");
  });

  test("loadState handles old format (no processedMessageIds)", async () => {
    const path = join(tmpDir, "state.json");
    await writeFile(path, JSON.stringify({ lastRunAt: "2026-01-01T00:00:00Z" }));

    const loaded = await loadState(path);
    expect(loaded.lastRunAt).toBe("2026-01-01T00:00:00Z");
    expect(loaded.processedMessageIds).toEqual([]);
  });
});

// ============================================================================
// writeReflections
// ============================================================================

describe("writeReflections", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "reflection-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("writes REFLECTIONS.md with patterns and heuristics", async () => {
    const patterns: AggregatedPattern[] = [
      {
        type: "attention_signal",
        description: "test pattern",
        evidence: "test evidence",
        confidence: 0.85,
        occurrences: 2,
        lastValidated: "",
        sourceThreads: ["t1"],
      },
    ];
    const heuristics = [
      { name: "h1", condition: "test condition", action: "test action", weight: 0.5, source: "test" },
    ];

    const filePath = join(tmpDir, "REFLECTIONS.md");
    const result = await writeReflections(patterns, heuristics, 5, 10, 2, filePath);

    expect(result.status).toBe("written");
    expect(result.patternsCount).toBe(1);
    expect(result.heuristicsCount).toBe(1);

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# Reflections");
    expect(content).toContain("### Attention Signals");
    expect(content).toContain("test pattern");
    expect(content).toContain("## Heuristics");
    expect(content).toContain("test condition");
  });

  test("returns skipped for empty patterns", async () => {
    const filePath = join(tmpDir, "REFLECTIONS.md");
    const result = await writeReflections([], [], 0, 0, 0, filePath);
    expect(result.status).toBe("skipped");
  });
});

// ============================================================================
// Message helpers
// ============================================================================

describe("extractTextContent", () => {
  test("string content", () => {
    expect(extractTextContent({ id: "1", role: "user", content: "hello", createdAt: new Date() } as any)).toBe("hello");
  });

  test("object content with content field", () => {
    expect(
      extractTextContent({ id: "1", role: "user", content: { content: "nested" }, createdAt: new Date() } as any),
    ).toBe("nested");
  });

  test("object content with parts array", () => {
    const msg = {
      id: "1",
      role: "user",
      content: {
        parts: [
          { type: "text", text: "part1" },
          { type: "image", url: "x" },
          { type: "text", text: "part2" },
        ],
      },
      createdAt: new Date(),
    } as any;
    expect(extractTextContent(msg)).toBe("part1\npart2");
  });
});

describe("isToolCallOnly", () => {
  test("tool-only message → true", () => {
    const msg = {
      id: "1",
      role: "assistant",
      content: { parts: [{ type: "tool-invocation", toolName: "test" }] },
      createdAt: new Date(),
    } as any;
    expect(isToolCallOnly(msg)).toBe(true);
  });

  test("message with text → false", () => {
    const msg = {
      id: "1",
      role: "assistant",
      content: {
        parts: [
          { type: "text", text: "hello" },
          { type: "tool-invocation", toolName: "test" },
        ],
      },
      createdAt: new Date(),
    } as any;
    expect(isToolCallOnly(msg)).toBe(false);
  });

  test("string content → false", () => {
    expect(isToolCallOnly({ id: "1", role: "assistant", content: "hello", createdAt: new Date() } as any)).toBe(false);
  });
});

describe("extractReasoningContent", () => {
  test("extracts thinking parts", () => {
    const msg = {
      id: "1",
      role: "assistant",
      content: {
        parts: [
          { type: "thinking", text: "I think..." },
          { type: "text", text: "Result" },
        ],
      },
      createdAt: new Date(),
    } as any;
    expect(extractReasoningContent(msg)).toBe("I think...");
  });

  test("no reasoning → empty string", () => {
    const msg = {
      id: "1",
      role: "assistant",
      content: { parts: [{ type: "text", text: "Result" }] },
      createdAt: new Date(),
    } as any;
    expect(extractReasoningContent(msg)).toBe("");
  });
});

// ============================================================================
// chunkArray
// ============================================================================

describe("chunkArray", () => {
  test("splits evenly", () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("handles remainder", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("empty array", () => {
    expect(chunkArray([], 5)).toEqual([]);
  });

  test("chunk size larger than array", () => {
    expect(chunkArray([1, 2], 5)).toEqual([[1, 2]]);
  });
});

// ============================================================================
// parseReflectionsMd (shared utility)
// ============================================================================

describe("parseReflectionsMd", () => {
  test("empty content → empty arrays", () => {
    const result = parseReflectionsMd("");
    expect(result.patterns).toEqual([]);
    expect(result.heuristics).toEqual([]);
  });

  test("parses attention signals", () => {
    const md = `# Reflections

## Patterns

### Attention Signals

- User asks about deployment (confidence: 0.85, occurrences: 3, evidence: repeated deploy questions)
`;
    const result = parseReflectionsMd(md);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].type).toBe("attention_signal");
    expect(result.patterns[0].description).toBe("User asks about deployment");
    expect(result.patterns[0].confidence).toBeCloseTo(0.85);
    expect(result.patterns[0].occurrences).toBe(3);
    expect(result.patterns[0].evidence).toBe("repeated deploy questions");
  });

  test("parses decision markers and noise patterns", () => {
    const md = `# Reflections

## Patterns

### Decision Markers

- Chose env vars (confidence: 0.90, occurrences: 2, evidence: team decision)

### Noise Patterns

- Off-topic chat (confidence: 0.95, occurrences: 5, evidence: lunch discussions)
`;
    const result = parseReflectionsMd(md);
    expect(result.patterns).toHaveLength(2);
    expect(result.patterns[0].type).toBe("decision_marker");
    expect(result.patterns[1].type).toBe("noise_pattern");
  });

  test("parses heuristics", () => {
    const md = `# Reflections

## Heuristics

- **heuristic_1**: deployment mentioned → boost relevance score (weight: 0.5)
- **heuristic_2**: lunch discussion → reduce relevance score (weight: 0.3)
`;
    const result = parseReflectionsMd(md);
    expect(result.heuristics).toHaveLength(2);
    expect(result.heuristics[0].name).toBe("heuristic_1");
    expect(result.heuristics[0].condition).toBe("deployment mentioned");
    expect(result.heuristics[0].action).toBe("boost relevance score");
    expect(result.heuristics[0].weight).toBe(0.5);
    expect(result.heuristics[1].name).toBe("heuristic_2");
  });

  test("skips malformed pattern lines", () => {
    const md = `# Reflections

## Patterns

### Attention Signals

- This line has no parentheses
- Good line (confidence: 0.80, occurrences: 2, evidence: some evidence)
`;
    const result = parseReflectionsMd(md);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].description).toBe("Good line");
  });

  test("## heading resets section", () => {
    const md = `### Attention Signals

- Signal (confidence: 0.80, occurrences: 1, evidence: ev)

## Other Section

- Not a pattern (confidence: 0.90, occurrences: 1, evidence: ev2)
`;
    const result = parseReflectionsMd(md);
    expect(result.patterns).toHaveLength(1);
  });
});

// ============================================================================
// mergeAggregatedPatterns
// ============================================================================

describe("mergeAggregatedPatterns", () => {
  const mkPattern = (overrides: Partial<AggregatedPattern> = {}): AggregatedPattern => ({
    type: "attention_signal",
    description: "test pattern",
    evidence: "test evidence",
    confidence: 0.8,
    occurrences: 1,
    lastValidated: "2026-01-01T00:00:00Z",
    sourceThreads: ["t1"],
    ...overrides,
  });

  test("empty existing + empty incoming → empty", () => {
    expect(mergeAggregatedPatterns([], [])).toEqual([]);
  });

  test("empty existing + incoming → returns incoming", () => {
    const incoming = [mkPattern({ description: "new pattern" })];
    const result = mergeAggregatedPatterns([], incoming);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("new pattern");
  });

  test("existing + empty incoming → returns existing", () => {
    const existing = [mkPattern({ description: "old pattern" })];
    const result = mergeAggregatedPatterns(existing, []);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("old pattern");
  });

  test("similar patterns merge: occurrences sum, confidence max, sourceThreads union", () => {
    const existing = [
      mkPattern({
        description: "user references deployment config",
        confidence: 0.8,
        occurrences: 3,
        sourceThreads: ["t1", "t2"],
        lastValidated: "2026-01-01T00:00:00Z",
      }),
    ];
    const incoming = [
      mkPattern({
        description: "user references deployment configuration",
        confidence: 0.9,
        occurrences: 2,
        sourceThreads: ["t2", "t3"],
        lastValidated: "2026-02-01T00:00:00Z",
      }),
    ];

    const result = mergeAggregatedPatterns(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toBe(5);
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].lastValidated).toBe("2026-02-01T00:00:00Z");
    expect(result[0].sourceThreads).toContain("t1");
    expect(result[0].sourceThreads).toContain("t2");
    expect(result[0].sourceThreads).toContain("t3");
  });

  test("different types do NOT merge even with similar descriptions", () => {
    const existing = [
      mkPattern({
        type: "attention_signal",
        description: "deployment config",
      }),
    ];
    const incoming = [
      mkPattern({
        type: "noise_pattern",
        description: "deployment config",
      }),
    ];

    const result = mergeAggregatedPatterns(existing, incoming);
    expect(result).toHaveLength(2);
  });

  test("dissimilar descriptions append as new", () => {
    const existing = [mkPattern({ description: "deployment config" })];
    const incoming = [mkPattern({ description: "quantum physics research" })];

    const result = mergeAggregatedPatterns(existing, incoming);
    expect(result).toHaveLength(2);
  });

  test("sorted by confidence * occurrences descending", () => {
    const existing = [mkPattern({ description: "low score", confidence: 0.3, occurrences: 1 })];
    const incoming = [mkPattern({ description: "high score", confidence: 0.9, occurrences: 5 })];

    const result = mergeAggregatedPatterns(existing, incoming);
    expect(result[0].description).toBe("high score");
    expect(result[1].description).toBe("low score");
  });

  test("caps at 50 patterns", () => {
    const existing = Array.from({ length: 30 }, (_, i) =>
      mkPattern({ description: `existing pattern number ${i}`, occurrences: 1 }),
    );
    const incoming = Array.from({ length: 30 }, (_, i) =>
      mkPattern({ description: `incoming pattern number ${i}`, occurrences: 1 }),
    );

    const result = mergeAggregatedPatterns(existing, incoming);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  test("does not mutate input arrays", () => {
    const existing = [mkPattern({ description: "original", occurrences: 1, sourceThreads: ["t1"] })];
    const incoming = [mkPattern({ description: "original pattern", occurrences: 2, sourceThreads: ["t2"] })];
    const existingCopy = JSON.parse(JSON.stringify(existing));

    mergeAggregatedPatterns(existing, incoming);

    expect(existing[0].occurrences).toBe(existingCopy[0].occurrences);
    expect(existing[0].sourceThreads).toEqual(existingCopy[0].sourceThreads);
  });
});

// ============================================================================
// mergeHeuristics
// ============================================================================

describe("mergeHeuristics", () => {
  const mkHeuristic = (overrides: Partial<Heuristic> = {}): Heuristic => ({
    name: "heuristic_1",
    condition: "test condition",
    action: "test action",
    weight: 0.5,
    source: "test",
    ...overrides,
  });

  test("empty existing + empty incoming → empty", () => {
    expect(mergeHeuristics([], [])).toEqual([]);
  });

  test("empty existing + incoming → returns incoming (renumbered)", () => {
    const incoming = [mkHeuristic({ name: "h_old", condition: "new condition" })];
    const result = mergeHeuristics([], incoming);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("heuristic_1");
    expect(result[0].condition).toBe("new condition");
  });

  test("deduplicates by condition similarity", () => {
    const existing = [mkHeuristic({ condition: "user mentions deployment config" })];
    // Substring match: "user mentions deployment config" is contained in the incoming string
    const incoming = [mkHeuristic({ condition: "user mentions deployment config details" })];

    const result = mergeHeuristics(existing, incoming);
    expect(result).toHaveLength(1);
  });

  test("appends new heuristics with renumbered names", () => {
    const existing = [mkHeuristic({ name: "heuristic_1", condition: "deployment mentioned" })];
    const incoming = [mkHeuristic({ name: "h_x", condition: "quantum physics discussed" })];

    const result = mergeHeuristics(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[1].name).toBe("heuristic_2");
    expect(result[1].condition).toBe("quantum physics discussed");
  });

  test("caps at 20 heuristics", () => {
    const existing = Array.from({ length: 15 }, (_, i) =>
      mkHeuristic({ name: `h_${i}`, condition: `unique condition number ${i}` }),
    );
    const incoming = Array.from({ length: 10 }, (_, i) =>
      mkHeuristic({ name: `h_new_${i}`, condition: `brand new condition number ${i}` }),
    );

    const result = mergeHeuristics(existing, incoming);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  test("does not mutate input arrays", () => {
    const existing = [mkHeuristic({ condition: "original" })];
    const incoming = [mkHeuristic({ condition: "different topic entirely" })];
    const existingCopy = JSON.parse(JSON.stringify(existing));

    mergeHeuristics(existing, incoming);

    expect(existing).toEqual(existingCopy);
  });
});

// ============================================================================
// buildBatchPrompt
// ============================================================================

describe("buildBatchPrompt", () => {
  const mkPair = (
    overrides: Partial<{ query: string; response: string; reasoning: string; sourceThread: string }> = {},
  ) => ({
    query: "How do I deploy?",
    response: "Run bun build then push to production.",
    sourceThread: "thread-1",
    ...overrides,
  });

  const mkPattern = (overrides: Partial<AggregatedPattern> = {}): AggregatedPattern => ({
    type: "attention_signal",
    description: "test pattern",
    evidence: "test evidence",
    confidence: 0.8,
    occurrences: 2,
    lastValidated: "",
    sourceThreads: ["t1"],
    ...overrides,
  });

  const mkHeuristic = (overrides: Partial<Heuristic> = {}): Heuristic => ({
    name: "heuristic_1",
    condition: "deployment mentioned",
    action: "boost relevance",
    weight: 0.5,
    source: "test",
    ...overrides,
  });

  test('without existing patterns — basic prompt with exchanges, no "Already Known" sections', () => {
    const result = buildBatchPrompt([mkPair()]);

    expect(result).toContain("Exchange 1");
    expect(result).toContain("How do I deploy?");
    expect(result).toContain("Run bun build");
    expect(result).not.toContain("Already Known Patterns");
    expect(result).not.toContain("Already Known Heuristics");
    expect(result).not.toContain("Focus on genuinely NEW");
  });

  test("with existing patterns + heuristics — includes both sections and focus instruction", () => {
    const patterns = [
      mkPattern({
        type: "attention_signal",
        description: "User asks about deployment",
        confidence: 0.85,
        occurrences: 3,
      }),
      mkPattern({ type: "noise_pattern", description: "Off-topic chat", confidence: 0.7, occurrences: 1 }),
    ];
    const heuristics = [mkHeuristic({ condition: "deployment mentioned", action: "boost relevance" })];

    const result = buildBatchPrompt([mkPair()], patterns, heuristics);

    expect(result).toContain("Already Known Patterns (2)");
    expect(result).toContain("[attention_signal] User asks about deployment");
    expect(result).toContain("seen 3x");
    expect(result).toContain("[noise_pattern] Off-topic chat");
    expect(result).toContain("Already Known Heuristics (1)");
    expect(result).toContain("deployment mentioned → boost relevance");
    expect(result).toContain("Focus on genuinely NEW observations");
    // Evidence should NOT be included in the context
    expect(result).not.toContain("test evidence");
  });

  test("with empty arrays — same as no existing patterns", () => {
    const result = buildBatchPrompt([mkPair()], [], []);

    expect(result).not.toContain("Already Known Patterns");
    expect(result).not.toContain("Already Known Heuristics");
    expect(result).not.toContain("Focus on genuinely NEW");
  });

  test("with patterns only, no heuristics — patterns section present, heuristics absent", () => {
    const patterns = [mkPattern({ description: "User references config files", confidence: 0.9, occurrences: 5 })];

    const result = buildBatchPrompt([mkPair()], patterns);

    expect(result).toContain("Already Known Patterns (1)");
    expect(result).toContain("User references config files");
    expect(result).toContain("confidence: 0.90, seen 5x");
    expect(result).not.toContain("Already Known Heuristics");
    expect(result).toContain("Focus on genuinely NEW observations");
  });
});
