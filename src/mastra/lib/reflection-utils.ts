// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Reflection Utilities
 *
 * Pure functions and types extracted from ReflectionService and ReflectorProcessor.
 * Shared by the reflection workflow and tests.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MastraDBMessage } from "@mastra/core/agent";
import { z } from "zod";
import { resolveConfigPath } from "./config";

// ============================================================================
// Types
// ============================================================================

export interface RawPattern {
  type: "attention_signal" | "noise_pattern" | "decision_marker";
  description: string;
  evidence: string;
  confidence: number;
  sourceThread: string;
  timestamp: string;
}

export interface AggregatedPattern {
  type: "attention_signal" | "noise_pattern" | "decision_marker";
  description: string;
  evidence: string;
  confidence: number;
  occurrences: number;
  lastValidated: string;
  sourceThreads: string[];
}

export interface Heuristic {
  name: string;
  condition: string;
  action: string;
  weight: number;
  source: string;
}

export interface ReflectionState {
  lastRunAt: string | null;
  processedMessageIds: string[];
}

// ============================================================================
// Schemas
// ============================================================================

export const reflectorAnalysisSchema = z.object({
  patterns: z.array(
    z.object({
      type: z.enum(["attention_signal", "noise_pattern", "decision_marker"]),
      description: z.string(),
      evidence: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  insights: z.object({
    whatWorked: z.string(),
    whatToRemember: z.string(),
    curationSuggestions: z.array(z.string()),
  }),
});

export type ReflectorAnalysis = z.infer<typeof reflectorAnalysisSchema>;

// ============================================================================
// State Management
// ============================================================================

const MAX_PROCESSED_IDS = 1000;

function getReflectionStatePath(): string {
  return resolveConfigPath("reflection-state.json");
}

export async function loadState(statePath?: string): Promise<ReflectionState> {
  try {
    const resolved = statePath ?? getReflectionStatePath();
    if (!existsSync(resolved)) return { lastRunAt: null, processedMessageIds: [] };
    const content = await readFile(resolved, "utf-8");
    const data = JSON.parse(content);
    return {
      lastRunAt: data?.lastRunAt || null,
      processedMessageIds: Array.isArray(data?.processedMessageIds) ? data.processedMessageIds : [],
    };
  } catch {
    return { lastRunAt: null, processedMessageIds: [] };
  }
}

export async function saveState(state: ReflectionState, statePath?: string): Promise<void> {
  const resolved = statePath ?? getReflectionStatePath();
  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const pruned: ReflectionState = {
    lastRunAt: state.lastRunAt,
    processedMessageIds: state.processedMessageIds.slice(-MAX_PROCESSED_IDS),
  };
  await writeFile(resolved, JSON.stringify(pruned, null, 2), "utf-8");
}

// ============================================================================
// Pattern Processing
// ============================================================================

const MAX_PATTERNS = 50;
const MAX_HEURISTICS = 20;

/**
 * Normalize a word: lowercase, strip trailing plurals/suffixes for basic stemming.
 */
export function normalizeWord(word: string): string {
  let w = word.toLowerCase();
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("tion") && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith("sion") && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith("ment") && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith("ness") && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("ly") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && w.length > 4) w = w.slice(0, -1);
  return w;
}

/**
 * Tokenize text into a normalized word set for similarity comparison.
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .split(/\s+/)
      .map(normalizeWord)
      .filter((w) => w.length > 3),
  );
}

/**
 * Jaccard word-set similarity check with basic word normalization.
 */
export function isSimilar(a: string, b: string, threshold = 0.6): boolean {
  if (!a || !b) return false;

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower.includes(bLower) || bLower.includes(aLower)) {
    return true;
  }

  const aWords = tokenize(aLower);
  const bWords = tokenize(bLower);

  if (aWords.size === 0 || bWords.size === 0) return false;

  let intersection = 0;
  for (const word of aWords) {
    if (bWords.has(word)) intersection++;
  }

  const union = new Set([...aWords, ...bWords]).size;
  const jaccard = intersection / union;
  return jaccard >= threshold;
}

/**
 * Merge patterns by deduplication using Jaccard word-set similarity
 */
export function mergePatterns(patterns: RawPattern[]): AggregatedPattern[] {
  const merged: AggregatedPattern[] = [];

  for (const pattern of patterns) {
    let found = false;

    for (const existing of merged) {
      if (existing.type !== pattern.type) continue;

      if (isSimilar(existing.description, pattern.description)) {
        existing.confidence = Math.min(1.0, existing.confidence + pattern.confidence * 0.1);
        existing.occurrences += 1;
        existing.lastValidated = pattern.timestamp;
        if (!existing.sourceThreads.includes(pattern.sourceThread)) {
          existing.sourceThreads.push(pattern.sourceThread);
        }
        found = true;
        break;
      }
    }

    if (!found) {
      merged.push({
        type: pattern.type,
        description: pattern.description,
        evidence: pattern.evidence,
        confidence: pattern.confidence,
        occurrences: 1,
        lastValidated: pattern.timestamp,
        sourceThreads: [pattern.sourceThread],
      });
    }
  }

  return merged.sort((a, b) => b.confidence * b.occurrences - a.confidence * a.occurrences).slice(0, MAX_PATTERNS);
}

/**
 * Parse a natural-language curation suggestion into a condition + action pair
 */
export function parseSuggestion(suggestion: string): { condition: string; action: string } | null {
  const whenMatch = suggestion.match(/^(?:when|if)\s+(.+?)(?:,\s*(?:then\s+)?|\s+then\s+)(.+)$/i);
  if (whenMatch) {
    return { condition: whenMatch[1].trim(), action: whenMatch[2].trim() };
  }

  const prioritizeMatch = suggestion.match(/^prioritize\s+(.+)$/i);
  if (prioritizeMatch) {
    return {
      condition: prioritizeMatch[1].trim(),
      action: "boost relevance score",
    };
  }

  const filterMatch = suggestion.match(/^(?:filter out|remove|exclude|ignore)\s+(.+)$/i);
  if (filterMatch) {
    return {
      condition: filterMatch[1].trim(),
      action: "reduce relevance score",
    };
  }

  const keepMatch = suggestion.match(/^(?:keep|preserve|retain)\s+(.+)$/i);
  if (keepMatch) {
    return {
      condition: keepMatch[1].trim(),
      action: "preserve message",
    };
  }

  // Arrow format: "condition → action" or "condition -> action"
  const arrowMatch = suggestion.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
  if (arrowMatch) {
    return { condition: arrowMatch[1].trim(), action: arrowMatch[2].trim() };
  }

  // For/During/In format: "For debugging scenarios, propose concrete next steps"
  const forMatch = suggestion.match(/^(?:for|during|in)\s+(.+?)(?:,\s+|\s*:\s*)(.+)$/i);
  if (forMatch) {
    return { condition: forMatch[1].trim(), action: forMatch[2].trim() };
  }

  // Imperative format: "Ensure/Consider/Always/Avoid/Never ..."
  const imperativeMatch = suggestion.match(/^(ensure|consider|always|avoid|never)\s+(.+)$/i);
  if (imperativeMatch) {
    return {
      condition: "always",
      action: `${imperativeMatch[1].toLowerCase()} ${imperativeMatch[2].trim()}`,
    };
  }

  if (suggestion.length > 10 && suggestion.length < 200) {
    return {
      condition: suggestion,
      action: "apply curation suggestion",
    };
  }

  return null;
}

/**
 * Convert curation suggestions into actionable heuristic rules
 */
export function generateHeuristics(suggestions: Array<{ suggestion: string; source: string }>): Heuristic[] {
  const heuristics: Heuristic[] = [];
  const seen = new Set<string>();

  for (const { suggestion, source } of suggestions) {
    const normalized = suggestion.toLowerCase().trim();

    let isDuplicate = false;
    for (const s of seen) {
      if (isSimilar(normalized, s, 0.7)) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue;
    seen.add(normalized);

    const parsed = parseSuggestion(suggestion);
    if (!parsed) continue;

    heuristics.push({
      name: `heuristic_${heuristics.length + 1}`,
      condition: parsed.condition,
      action: parsed.action,
      weight: 0.5,
      source,
    });

    if (heuristics.length >= MAX_HEURISTICS) break;
  }

  return heuristics;
}

// ============================================================================
// REFLECTIONS.md Parser
// ============================================================================

export interface ReflectionsData {
  patterns: AggregatedPattern[];
  heuristics: Heuristic[];
}

/**
 * Parse REFLECTIONS.md content into structured patterns and heuristics.
 * Returns empty arrays for empty/missing content.
 */
export function parseReflectionsMd(content: string): ReflectionsData {
  const patterns: AggregatedPattern[] = [];
  const heuristics: Heuristic[] = [];

  if (!content) return { patterns, heuristics };

  const lines = content.split("\n");
  let currentSection: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track sections
    if (trimmed.startsWith("### Attention Signals")) {
      currentSection = "attention_signal";
      continue;
    }
    if (trimmed.startsWith("### Decision Markers")) {
      currentSection = "decision_marker";
      continue;
    }
    if (trimmed.startsWith("### Noise Patterns")) {
      currentSection = "noise_pattern";
      continue;
    }
    if (trimmed.startsWith("## Heuristics")) {
      currentSection = "heuristics";
      continue;
    }
    if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
      currentSection = null;
      continue;
    }

    // Parse pattern lines: "- description (confidence: N, occurrences: N, evidence: text)"
    if (
      (currentSection === "attention_signal" ||
        currentSection === "decision_marker" ||
        currentSection === "noise_pattern") &&
      trimmed.startsWith("- ")
    ) {
      const match = trimmed.match(/^- (.+?) \(confidence: ([\d.]+), occurrences: (\d+), evidence: (.+?)\)$/);
      if (match) {
        patterns.push({
          type: currentSection as AggregatedPattern["type"],
          description: match[1],
          evidence: match[4],
          confidence: Number.parseFloat(match[2]),
          occurrences: Number.parseInt(match[3], 10),
          lastValidated: "",
          sourceThreads: [],
        });
      }
    }

    // Parse heuristic lines: "- **name**: condition → action (weight: N)"
    if (currentSection === "heuristics" && trimmed.startsWith("- **")) {
      const match = trimmed.match(/^- \*\*(.+?)\*\*: (.+?) → (.+?) \(weight: ([\d.]+)\)$/);
      if (match) {
        heuristics.push({
          name: match[1],
          condition: match[2],
          action: match[3],
          weight: Number.parseFloat(match[4]),
          source: "reflections",
        });
      }
    }
  }

  return { patterns, heuristics };
}

// ============================================================================
// Merge Functions (for incremental REFLECTIONS.md updates)
// ============================================================================

/**
 * Merge incoming aggregated patterns with existing ones.
 * Matches by same type AND isSimilar(description). On match: sums occurrences,
 * takes max confidence, updates lastValidated if newer, unions sourceThreads.
 * Sorts by confidence * occurrences descending. Caps at MAX_PATTERNS.
 */
export function mergeAggregatedPatterns(
  existing: AggregatedPattern[],
  incoming: AggregatedPattern[],
): AggregatedPattern[] {
  const merged = existing.map((p) => ({
    ...p,
    sourceThreads: [...p.sourceThreads],
  }));

  for (const inc of incoming) {
    let found = false;

    for (const ex of merged) {
      if (ex.type !== inc.type) continue;

      if (isSimilar(ex.description, inc.description)) {
        ex.occurrences += inc.occurrences;
        ex.confidence = Math.max(ex.confidence, inc.confidence);
        if (inc.lastValidated && inc.lastValidated > (ex.lastValidated || "")) {
          ex.lastValidated = inc.lastValidated;
        }
        for (const thread of inc.sourceThreads) {
          if (!ex.sourceThreads.includes(thread)) {
            ex.sourceThreads.push(thread);
          }
        }
        found = true;
        break;
      }
    }

    if (!found) {
      merged.push({
        ...inc,
        sourceThreads: [...inc.sourceThreads],
      });
    }
  }

  return merged.sort((a, b) => b.confidence * b.occurrences - a.confidence * a.occurrences).slice(0, MAX_PATTERNS);
}

/**
 * Merge incoming heuristics with existing ones.
 * Deduplicates by isSimilar(condition, 0.7). Appends new heuristics with
 * renumbered names. Caps at MAX_HEURISTICS.
 */
export function mergeHeuristics(existing: Heuristic[], incoming: Heuristic[]): Heuristic[] {
  const merged = existing.map((h) => ({ ...h }));

  for (const inc of incoming) {
    const isDuplicate = merged.some((ex) => isSimilar(ex.condition, inc.condition, 0.7));
    if (!isDuplicate) {
      merged.push({
        ...inc,
        name: `heuristic_${merged.length + 1}`,
      });
    }

    if (merged.length >= MAX_HEURISTICS) break;
  }

  return merged.slice(0, MAX_HEURISTICS);
}

// ============================================================================
// REFLECTIONS.md Writer
// ============================================================================

export async function writeReflections(
  aggregatedPatterns: AggregatedPattern[],
  heuristics: Heuristic[],
  totalPatternsGenerated: number,
  messagesScanned: number,
  threadsScanned: number,
  filePath?: string,
): Promise<{
  status: "written" | "skipped";
  patternsCount: number;
  heuristicsCount: number;
  summary: string;
}> {
  if (aggregatedPatterns.length === 0 && heuristics.length === 0) {
    return {
      status: "skipped",
      patternsCount: 0,
      heuristicsCount: 0,
      summary: "No patterns to aggregate",
    };
  }

  const resolvedPath = filePath ?? resolveConfigPath("REFLECTIONS.md");
  const timestamp = new Date().toISOString();

  const attentionSignals = aggregatedPatterns.filter((p) => p.type === "attention_signal");
  const decisionMarkers = aggregatedPatterns.filter((p) => p.type === "decision_marker");
  const noisePatterns = aggregatedPatterns.filter((p) => p.type === "noise_pattern");

  const lines: string[] = [
    "# Reflections",
    "",
    `> Auto-generated by reflection workflow. Last updated: ${timestamp}`,
    `> Scanned: ${threadsScanned} threads, ${messagesScanned} messages, ${totalPatternsGenerated} raw patterns`,
    "",
    "## Patterns",
    "",
  ];

  if (attentionSignals.length > 0) {
    lines.push("### Attention Signals");
    lines.push("");
    for (const p of attentionSignals) {
      lines.push(
        `- ${p.description} (confidence: ${p.confidence.toFixed(2)}, occurrences: ${p.occurrences}, evidence: ${p.evidence.slice(0, 200)})`,
      );
    }
    lines.push("");
  }

  if (decisionMarkers.length > 0) {
    lines.push("### Decision Markers");
    lines.push("");
    for (const p of decisionMarkers) {
      lines.push(
        `- ${p.description} (confidence: ${p.confidence.toFixed(2)}, occurrences: ${p.occurrences}, evidence: ${p.evidence.slice(0, 200)})`,
      );
    }
    lines.push("");
  }

  if (noisePatterns.length > 0) {
    lines.push("### Noise Patterns");
    lines.push("");
    for (const p of noisePatterns) {
      lines.push(
        `- ${p.description} (confidence: ${p.confidence.toFixed(2)}, occurrences: ${p.occurrences}, evidence: ${p.evidence.slice(0, 200)})`,
      );
    }
    lines.push("");
  }

  if (heuristics.length > 0) {
    lines.push("## Heuristics");
    lines.push("");
    for (const h of heuristics) {
      lines.push(`- **${h.name}**: ${h.condition} → ${h.action} (weight: ${h.weight})`);
    }
    lines.push("");
  }

  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(resolvedPath, lines.join("\n"));

  const summary = `Wrote ${aggregatedPatterns.length} patterns and ${heuristics.length} heuristics to REFLECTIONS.md`;
  console.log(`[Reflection] ${summary}`);

  return {
    status: "written",
    patternsCount: aggregatedPatterns.length,
    heuristicsCount: heuristics.length,
    summary,
  };
}

// ============================================================================
// Message Helpers (from ReflectorProcessor)
// ============================================================================

/**
 * Extract text content from a MastraDBMessage
 */
export function extractTextContent(message: MastraDBMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (message.content && typeof message.content === "object") {
    const content = message.content as any;

    if (typeof content.content === "string") {
      return content.content;
    }

    if (Array.isArray(content.parts)) {
      return content.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n");
    }
  }

  return "";
}

/**
 * Check if message is tool-call-only (no substantive text content)
 */
export function isToolCallOnly(message: MastraDBMessage): boolean {
  if (typeof message.content === "object" && message.content !== null) {
    const content = message.content as any;
    if (Array.isArray(content.parts)) {
      const hasTextParts = content.parts.some((p: any) => p.type === "text" && p.text?.trim().length > 0);
      const hasToolParts = content.parts.some((p: any) => p.type === "tool-invocation" || p.type === "tool-result");
      return !hasTextParts && hasToolParts;
    }
  }
  return false;
}

/**
 * Extract reasoning/thinking content from assistant message
 */
export function extractReasoningContent(message: MastraDBMessage): string {
  if (typeof message.content === "object" && message.content !== null) {
    const content = message.content as any;
    if (Array.isArray(content.parts)) {
      return content.parts
        .filter((p: any) => p.type === "thinking" || p.type === "reasoning")
        .map((p: any) => p.text || p.content || "")
        .join("\n");
    }
  }
  return "";
}

// ============================================================================
// Array Utilities
// ============================================================================

/**
 * Split an array into chunks of the given size
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Build analysis prompt for a batch of exchanges.
 * Optionally includes existing patterns/heuristics so the LLM can skip known observations.
 */
export function buildBatchPrompt(
  pairs: Array<{
    query: string;
    response: string;
    reasoning?: string;
    sourceThread: string;
  }>,
  existingPatterns?: AggregatedPattern[],
  existingHeuristics?: Heuristic[],
): string {
  const sections: string[] = [];

  // Existing context sections (if any)
  if (existingPatterns && existingPatterns.length > 0) {
    const patternLines = existingPatterns.map(
      (p) => `- [${p.type}] ${p.description} (confidence: ${p.confidence.toFixed(2)}, seen ${p.occurrences}x)`,
    );
    sections.push(`## Already Known Patterns (${existingPatterns.length})\n\n${patternLines.join("\n")}`);
  }

  if (existingHeuristics && existingHeuristics.length > 0) {
    const heuristicLines = existingHeuristics.map((h) => `- ${h.condition} → ${h.action}`);
    sections.push(`## Already Known Heuristics (${existingHeuristics.length})\n\n${heuristicLines.join("\n")}`);
  }

  // Exchanges
  const exchanges = pairs
    .map((p, i) => {
      let section = `--- Exchange ${i + 1} (thread: ${p.sourceThread}) ---\n`;
      section += `User Query: "${p.query}"\n\n`;
      section += `Assistant Response:\n${p.response}\n`;
      if (p.reasoning) {
        section += `\nReasoning/Thinking:\n${p.reasoning}\n`;
      }
      return section;
    })
    .join("\n\n");

  let prompt = `Analyze these ${pairs.length} conversation exchanges and extract generalizable behavioral patterns that will improve future interactions. Do NOT describe specific exchanges — instead identify reusable observations about user preferences, effective strategies, and context relevance.`;

  if (sections.length > 0) {
    prompt += `\n\n${sections.join("\n\n")}`;
    prompt +=
      "\n\nFocus on genuinely NEW observations not already covered above. Skip patterns that are substantially the same as ones already documented.";
  }

  prompt += `\n\n${exchanges}`;
  prompt += `\n\nPhrase each pattern as a reusable observation (e.g. "User prefers X", "When Y, strategy Z works"). Do NOT narrate what happened in individual exchanges.`;

  return prompt;
}
