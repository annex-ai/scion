// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Snapshot engine for building AI-friendly accessibility snapshots.
 *
 * Takes raw ARIA tree output from Playwright's `ariaSnapshot()` and transforms
 * it into a compact representation with stable element references (e1, e2, …)
 * that an LLM can use for element identification and interaction.
 *
 * Two entry points:
 *  - `buildRoleSnapshotFromAriaSnapshot` — assigns new sequential refs to
 *    elements parsed from Playwright's plain ARIA snapshot text.
 *  - `buildRoleSnapshotFromAiSnapshot` — preserves existing `[ref=eN]` tags
 *    already present in Playwright's AI-mode snapshot output.
 *
 * Reference: Playwright ariaSnapshot API —
 *   https://playwright.dev/docs/api/class-locator#locator-aria-snapshot
 */

import type { RoleRef, RoleRefMap, RoleSnapshotOptions, RoleSnapshotStats } from "../types";

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

/** Roles that represent user-actionable elements. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

/** Roles that carry meaningful content worth labelling. */
const CONTENT_ROLES = new Set([
  "heading",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "listitem",
  "article",
  "region",
  "main",
  "navigation",
]);

/** Container / layout roles that can be pruned when empty. */
const STRUCTURAL_ROLES = new Set([
  "generic",
  "group",
  "list",
  "table",
  "row",
  "rowgroup",
  "grid",
  "treegrid",
  "menu",
  "menubar",
  "toolbar",
  "tablist",
  "tree",
  "directory",
  "document",
  "application",
  "presentation",
  "none",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the indentation depth from leading whitespace (2-space units). */
function indentDepth(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? Math.floor(m[1].length / 2) : 0;
}

/**
 * Tracks how many times a given role+name pair has been seen so we can assign
 * `nth` indices for disambiguation.
 */
type DuplicateTracker = {
  record(role: string, name: string | undefined, ref: string): void;
  indexOf(role: string, name: string | undefined): number;
  removeSingletons(refs: RoleRefMap): void;
};

function createDuplicateTracker(): DuplicateTracker {
  const counts = new Map<string, number>();
  const refsByKey = new Map<string, string[]>();

  function key(role: string, name: string | undefined) {
    return `${role}\0${name ?? ""}`;
  }

  return {
    indexOf(role, name) {
      const k = key(role, name);
      const cur = counts.get(k) ?? 0;
      counts.set(k, cur + 1);
      return cur;
    },
    record(role, name, ref) {
      const k = key(role, name);
      const list = refsByKey.get(k) ?? [];
      list.push(ref);
      refsByKey.set(k, list);
    },
    removeSingletons(refs) {
      const dupes = new Set<string>();
      for (const [k, list] of refsByKey) {
        if (list.length > 1) dupes.add(k);
      }
      for (const [ref, data] of Object.entries(refs)) {
        if (!dupes.has(key(data.role, data.name)) && refs[ref]) {
          refs[ref].nth = undefined;
        }
      }
    },
  };
}

/**
 * Compact mode: strip tree nodes that have no descendant with a `[ref=` tag.
 * Keeps the tree small for LLM consumption.
 */
function pruneTree(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    // Always keep lines that contain a ref tag
    if (ln.includes("[ref=")) {
      kept.push(ln);
      continue;
    }

    // Keep lines that have non-structural content (role "name" pattern)
    if (ln.includes(":") && !ln.trimEnd().endsWith(":")) {
      kept.push(ln);
      continue;
    }

    // Otherwise keep only if a descendant has a ref
    const myDepth = indentDepth(ln);
    let hasRefChild = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (indentDepth(lines[j]) <= myDepth) break;
      if (lines[j]?.includes("[ref=")) {
        hasRefChild = true;
        break;
      }
    }
    if (hasRefChild) kept.push(ln);
  }

  return kept.join("\n");
}

// Regex matching a single ARIA snapshot line:  "  - role \"name\" [attrs]"
const LINE_RE = /^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Compute basic statistics about a finished snapshot. */
export function getRoleSnapshotStats(snapshot: string, refs: RoleRefMap): RoleSnapshotStats {
  const interactiveCount = Object.values(refs).filter((r) => INTERACTIVE_ROLES.has(r.role)).length;
  return {
    lines: snapshot.split("\n").length,
    chars: snapshot.length,
    refs: Object.keys(refs).length,
    interactive: interactiveCount,
  };
}

/**
 * Normalise a raw ref string (`"@e3"`, `"ref=e3"`, `"e3"`) into canonical
 * form (`"e3"`) or `null` if invalid.
 */
export function parseRoleRef(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const norm = s.startsWith("@") ? s.slice(1) : s.startsWith("ref=") ? s.slice(4) : s;
  return /^e\d+$/.test(norm) ? norm : null;
}

/**
 * Build a role snapshot from Playwright's plain `ariaSnapshot()` output.
 *
 * Assigns sequential element refs (e1, e2, …) to interactive elements and
 * named content elements.  Tracks nth indices for disambiguation when
 * multiple elements share the same role+name.
 */
export function buildRoleSnapshotFromAriaSnapshot(
  ariaSnapshot: string,
  options: RoleSnapshotOptions = {},
): { snapshot: string; refs: RoleRefMap } {
  const lines = ariaSnapshot.split("\n");
  const refs: RoleRefMap = {};
  const tracker = createDuplicateTracker();

  let seq = 0;
  const nextRef = () => `e${++seq}`;

  // ---- Interactive-only mode (flat list, no hierarchy) ----
  if (options.interactive) {
    const out: string[] = [];
    for (const line of lines) {
      const depth = indentDepth(line);
      if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

      const m = line.match(LINE_RE);
      if (!m) continue;
      const [, , roleRaw, name, suffix] = m;
      if (roleRaw.startsWith("/")) continue;

      const role = roleRaw.toLowerCase();
      if (!INTERACTIVE_ROLES.has(role)) continue;

      const ref = nextRef();
      const nth = tracker.indexOf(role, name);
      tracker.record(role, name, ref);
      refs[ref] = { role, name, nth };

      let entry = `- ${roleRaw}`;
      if (name) entry += ` "${name}"`;
      entry += ` [ref=${ref}]`;
      if (nth > 0) entry += ` [nth=${nth}]`;
      if (suffix.includes("[")) entry += suffix;
      out.push(entry);
    }

    tracker.removeSingletons(refs);
    return { snapshot: out.join("\n") || "(no interactive elements)", refs };
  }

  // ---- Full tree mode ----
  const out: string[] = [];
  for (const line of lines) {
    const depth = indentDepth(line);
    if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

    const m = line.match(LINE_RE);
    if (!m) {
      out.push(line);
      continue;
    }

    const [, prefix, roleRaw, name, suffix] = m;
    if (roleRaw.startsWith("/")) {
      out.push(line);
      continue;
    }

    const role = roleRaw.toLowerCase();
    const isInteractive = INTERACTIVE_ROLES.has(role);
    const isContent = CONTENT_ROLES.has(role);
    const isStructural = STRUCTURAL_ROLES.has(role);

    if (options.compact && isStructural && !name) continue;

    const needsRef = isInteractive || (isContent && !!name);
    if (!needsRef) {
      out.push(line);
      continue;
    }

    const ref = nextRef();
    const nth = tracker.indexOf(role, name);
    tracker.record(role, name, ref);
    refs[ref] = { role, name, nth };

    let enhanced = `${prefix}${roleRaw}`;
    if (name) enhanced += ` "${name}"`;
    enhanced += ` [ref=${ref}]`;
    if (nth > 0) enhanced += ` [nth=${nth}]`;
    if (suffix) enhanced += suffix;
    out.push(enhanced);
  }

  tracker.removeSingletons(refs);
  const tree = out.join("\n") || "(empty)";
  return {
    snapshot: options.compact ? pruneTree(tree) : tree,
    refs,
  };
}

/**
 * Build a role snapshot from Playwright's AI snapshot output that already
 * contains `[ref=eN]` tags.  Preserves the existing refs so they stay stable
 * across successive calls.
 */
export function buildRoleSnapshotFromAiSnapshot(
  aiSnapshot: string,
  options: RoleSnapshotOptions = {},
): { snapshot: string; refs: RoleRefMap } {
  const lines = String(aiSnapshot ?? "").split("\n");
  const refs: RoleRefMap = {};

  const extractRef = (suffix: string): string | null => {
    const m = suffix.match(/\[ref=(e\d+)\]/i);
    return m ? m[1] : null;
  };

  // ---- Interactive-only mode ----
  if (options.interactive) {
    const out: string[] = [];
    for (const line of lines) {
      const depth = indentDepth(line);
      if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

      const m = line.match(LINE_RE);
      if (!m) continue;
      const [, , roleRaw, name, suffix] = m;
      if (roleRaw.startsWith("/")) continue;

      const role = roleRaw.toLowerCase();
      if (!INTERACTIVE_ROLES.has(role)) continue;

      const ref = extractRef(suffix);
      if (!ref) continue;

      refs[ref] = { role, ...(name ? { name } : {}) };
      out.push(`- ${roleRaw}${name ? ` "${name}"` : ""}${suffix}`);
    }
    return { snapshot: out.join("\n") || "(no interactive elements)", refs };
  }

  // ---- Full tree mode ----
  const out: string[] = [];
  for (const line of lines) {
    const depth = indentDepth(line);
    if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

    const m = line.match(LINE_RE);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, , roleRaw, name, suffix] = m;
    if (roleRaw.startsWith("/")) {
      out.push(line);
      continue;
    }

    const role = roleRaw.toLowerCase();
    if (options.compact && STRUCTURAL_ROLES.has(role) && !name) continue;

    const ref = extractRef(suffix);
    if (ref) refs[ref] = { role, ...(name ? { name } : {}) };

    out.push(line);
  }

  const tree = out.join("\n") || "(empty)";
  return {
    snapshot: options.compact ? pruneTree(tree) : tree,
    refs,
  };
}
