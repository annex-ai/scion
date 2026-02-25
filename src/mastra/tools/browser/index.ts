// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Browser automation tool for Mastra agents.
 *
 * Exposes a single `browserTool` that accepts an `action` discriminator and
 * dispatches to the appropriate handler — launching Chrome, managing tabs,
 * navigating, capturing snapshots/screenshots, and interacting with elements.
 *
 * Each action is self-contained: callers pass a flat input object and receive
 * a `{ success, data?, error? }` envelope.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { isChromeReachable, launchBrowserChrome, stopBrowserChrome } from "./chrome/launcher";
import { DEFAULT_AI_SNAPSHOT_MAX_CHARS, DEFAULT_BROWSER_PROFILE_NAME, DEFAULT_CDP_PORT } from "./constants";
import { appendCdpPath, fetchJson } from "./core/cdp-client";
import {
  closePageByTargetIdViaPlaywright,
  createPageViaPlaywright,
  focusPageByTargetIdViaPlaywright,
  getPageForTargetId,
  getPageState,
  listPagesViaPlaywright,
  refLocator,
  restoreRoleRefsForTarget,
  storeRoleRefsForTarget,
} from "./core/playwright-session";
import { buildRoleSnapshotFromAiSnapshot, buildRoleSnapshotFromAriaSnapshot } from "./core/snapshot-engine";
import { type BrowserToolInput, browserToolInputSchema, browserToolOutputSchema } from "./schema";
import type { BrowserTabInfo, RunningChrome } from "./types";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Running Chrome instances keyed by profile name. */
const instances = new Map<string, RunningChrome>();

function cdpUrlFor(profile: string): string {
  const inst = instances.get(profile);
  return `http://127.0.0.1:${inst?.cdpPort ?? DEFAULT_CDP_PORT}`;
}

function screenshotsDir(): string {
  const dir = path.join(os.tmpdir(), "mastra", "browser", "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function persistScreenshot(buf: Uint8Array, fmt: "png" | "jpeg"): Promise<string> {
  const fp = path.join(screenshotsDir(), `screenshot-${Date.now()}.${fmt}`);
  fs.writeFileSync(fp, buf);
  return fp;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function doStatus(profile: string) {
  const inst = instances.get(profile);
  if (inst) {
    const url = `http://127.0.0.1:${inst.cdpPort}`;
    if (await isChromeReachable(url, 500)) {
      return { status: "running" as const, profile, cdpUrl: url, pid: inst.pid };
    }
    instances.delete(profile);
  }
  return { status: "stopped" as const, profile };
}

async function doStart(profile: string) {
  const existing = instances.get(profile);
  if (existing) {
    const url = `http://127.0.0.1:${existing.cdpPort}`;
    if (await isChromeReachable(url, 500)) {
      return { status: "running" as const, profile, cdpUrl: url, pid: existing.pid };
    }
    instances.delete(profile);
  }
  const inst = await launchBrowserChrome({ profile: { name: profile } });
  instances.set(profile, inst);
  return {
    status: "running" as const,
    profile,
    cdpUrl: `http://127.0.0.1:${inst.cdpPort}`,
    pid: inst.pid,
  };
}

async function doStop(profile: string) {
  const inst = instances.get(profile);
  if (inst) {
    await stopBrowserChrome(inst);
    instances.delete(profile);
  }
  return { status: "stopped" as const, profile };
}

async function doTabs(profile: string): Promise<{ tabs: BrowserTabInfo[] }> {
  const cdpUrl = cdpUrlFor(profile);
  try {
    const listUrl = appendCdpPath(cdpUrl, "/json/list");
    const targets = await fetchJson<
      Array<{
        id: string;
        title: string;
        url: string;
        type: string;
      }>
    >(listUrl, 2000);
    return {
      tabs: targets
        .filter((t) => t.type === "page")
        .map((t) => ({ targetId: t.id, title: t.title, url: t.url, type: t.type })),
    };
  } catch {
    return { tabs: await listPagesViaPlaywright({ cdpUrl }) };
  }
}

async function doOpen(profile: string, url: string): Promise<BrowserTabInfo> {
  return createPageViaPlaywright({ cdpUrl: cdpUrlFor(profile), url });
}

async function doFocus(profile: string, targetId: string) {
  await focusPageByTargetIdViaPlaywright({ cdpUrl: cdpUrlFor(profile), targetId });
  return { ok: true as const };
}

async function doClose(profile: string, targetId?: string) {
  if (targetId) {
    await closePageByTargetIdViaPlaywright({ cdpUrl: cdpUrlFor(profile), targetId });
  }
  return { ok: true as const };
}

async function doNavigate(profile: string, url: string, targetId?: string) {
  const cdpUrl = cdpUrlFor(profile);
  const page = await getPageForTargetId({ cdpUrl, targetId });
  await page.goto(url, { timeout: 30_000 }).catch(() => {});
  return { url: page.url(), title: await page.title().catch(() => "") };
}

async function doConsole(profile: string, level?: string, targetId?: string) {
  const cdpUrl = cdpUrlFor(profile);
  const page = await getPageForTargetId({ cdpUrl, targetId });
  const state = getPageState(page);
  let msgs = state?.console ?? [];
  if (level) msgs = msgs.filter((m) => m.type === level);
  return { messages: msgs };
}

async function doSnapshot(profile: string, input: BrowserToolInput) {
  const cdpUrl = cdpUrlFor(profile);
  const page = await getPageForTargetId({ cdpUrl, targetId: input.targetId });

  if (input.targetId) {
    restoreRoleRefsForTarget({ cdpUrl, targetId: input.targetId, page });
  }

  const format = input.snapshotFormat === "aria" ? ("aria" as const) : ("ai" as const);
  const interactive = input.interactive ?? false;
  const compact = input.compact ?? false;
  const maxDepth = input.depth;
  const refsMode = input.refs ?? "role";

  // Resolve target ID
  const targetId =
    input.targetId ||
    (await page
      .context()
      .newCDPSession(page)
      .then(async (s) => {
        const info = (await s.send("Target.getTargetInfo")) as {
          targetInfo?: { targetId?: string };
        };
        await s.detach().catch(() => {});
        return info?.targetInfo?.targetId ?? "";
      })
      .catch(() => ""));

  const url = page.url();
  const title = await page.title().catch(() => "");

  // Scope to frame if requested
  const scope = input.frame ? page.frameLocator(input.frame) : page;

  // Capture raw accessibility snapshot
  let raw: string;
  if ("ariaSnapshot" in scope && typeof scope.ariaSnapshot === "function") {
    raw = await (scope as any).ariaSnapshot({
      ...(maxDepth !== undefined ? { maxDepth } : {}),
      ...(input.selector ? { selector: input.selector } : {}),
    });
  } else {
    const loc = input.selector ? page.locator(input.selector) : page.locator("body");
    raw = (await (loc as any).ariaSnapshot?.()) ?? "(snapshot unavailable)";
  }

  // Transform into role snapshot with element refs
  const maxChars =
    format === "ai" && input.maxChars === undefined && input.mode !== "efficient"
      ? DEFAULT_AI_SNAPSHOT_MAX_CHARS
      : input.maxChars;

  const { snapshot, refs } =
    refsMode === "aria"
      ? buildRoleSnapshotFromAiSnapshot(raw, { interactive, compact, maxDepth })
      : buildRoleSnapshotFromAriaSnapshot(raw, { interactive, compact, maxDepth });

  storeRoleRefsForTarget({
    page,
    cdpUrl,
    targetId,
    refs,
    frameSelector: input.frame,
    mode: refsMode,
  });

  let finalSnapshot = snapshot;
  if (maxChars && finalSnapshot.length > maxChars) {
    finalSnapshot = `${finalSnapshot.slice(0, maxChars)}\n... (truncated)`;
  }

  return { format, snapshot: finalSnapshot, targetId, url, title };
}

async function doScreenshot(profile: string, input: BrowserToolInput) {
  const cdpUrl = cdpUrlFor(profile);
  const page = await getPageForTargetId({ cdpUrl, targetId: input.targetId });

  const fmt = input.type === "jpeg" ? ("jpeg" as const) : ("png" as const);
  const fullPage = input.fullPage ?? false;

  let buf: Uint8Array;
  if (input.ref || input.element) {
    const loc = input.ref ? refLocator(page, input.ref) : page.locator(input.element!);
    buf = await loc.screenshot({ type: fmt });
  } else {
    buf = await page.screenshot({ type: fmt, fullPage });
  }

  const filepath = await persistScreenshot(buf, fmt);
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  return { path: filepath, width: vp.width, height: vp.height, format: fmt };
}

async function doAct(profile: string, input: BrowserToolInput) {
  const cdpUrl = cdpUrlFor(profile);
  const req = input.request;
  if (!req) throw new Error("request is required for act action");

  const page = await getPageForTargetId({
    cdpUrl,
    targetId: req.targetId ?? input.targetId,
  });

  if (input.targetId) {
    restoreRoleRefsForTarget({ cdpUrl, targetId: input.targetId, page });
  }

  switch (req.kind) {
    case "click": {
      const loc = req.ref ? refLocator(page, req.ref) : page.locator("body");
      await loc.click({
        button: (req.button as "left" | "right" | "middle") ?? "left",
        clickCount: req.doubleClick ? 2 : 1,
        modifiers: req.modifiers as Array<"Alt" | "Control" | "Meta" | "Shift">,
      });
      break;
    }
    case "type": {
      const loc = req.ref ? refLocator(page, req.ref) : page.locator("body");
      await loc.fill(req.text ?? "");
      if (req.submit) await loc.press("Enter");
      break;
    }
    case "press": {
      const loc = req.ref ? refLocator(page, req.ref) : page.locator("body");
      await loc.press(req.key ?? "Enter");
      break;
    }
    case "hover": {
      const loc = req.ref ? refLocator(page, req.ref) : page.locator("body");
      await loc.hover();
      break;
    }
    case "select": {
      const loc = req.ref ? refLocator(page, req.ref) : page.locator("select");
      await loc.selectOption(req.values ?? []);
      break;
    }
    case "wait": {
      if (req.timeMs) {
        await page.waitForTimeout(req.timeMs);
      } else if (req.textGone) {
        await page.waitForFunction((text: string) => !document.body.textContent?.includes(text), req.textGone, {
          timeout: 30_000,
        });
      }
      break;
    }
    case "resize": {
      await page.setViewportSize({
        width: req.width ?? 1280,
        height: req.height ?? 720,
      });
      break;
    }
    case "evaluate": {
      const result = await page.evaluate(req.fn ?? "1 + 1");
      return { ok: true as const, result };
    }
    case "close": {
      await page.close();
      break;
    }
    default:
      throw new Error(`Unknown act kind: ${req.kind}`);
  }

  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const browserTool = createTool({
  id: "browser",
  inputSchema: browserToolInputSchema,
  outputSchema: browserToolOutputSchema,
  description:
    "Control a Chrome browser for web automation. Supports launching/stopping browser, " +
    "opening tabs, navigating URLs, taking snapshots and screenshots, and interacting " +
    "with page elements (click, type, hover, etc.). Use action parameter to specify the operation.",

  execute: async (input: BrowserToolInput) => {
    const profile = input.profile ?? DEFAULT_BROWSER_PROFILE_NAME;

    try {
      switch (input.action) {
        case "status":
          return { success: true, data: await doStatus(profile) };
        case "start":
          return { success: true, data: await doStart(profile) };
        case "stop":
          return { success: true, data: await doStop(profile) };
        case "profiles":
          return { success: true, data: { profiles: Array.from(instances.keys()) } };
        case "tabs":
          return { success: true, data: await doTabs(profile) };
        case "open":
          if (!input.targetUrl) return { success: false, error: "targetUrl is required for open action" };
          return { success: true, data: await doOpen(profile, input.targetUrl) };
        case "focus":
          if (!input.targetId) return { success: false, error: "targetId is required for focus action" };
          return { success: true, data: await doFocus(profile, input.targetId) };
        case "close":
          return { success: true, data: await doClose(profile, input.targetId) };
        case "snapshot":
          return { success: true, data: await doSnapshot(profile, input) };
        case "screenshot":
          return { success: true, data: await doScreenshot(profile, input) };
        case "navigate":
          if (!input.targetUrl) return { success: false, error: "targetUrl is required for navigate action" };
          return { success: true, data: await doNavigate(profile, input.targetUrl, input.targetId) };
        case "console":
          return { success: true, data: await doConsole(profile, input.level, input.targetId) };
        case "pdf":
          return { success: false, error: "pdf action not yet implemented" };
        case "upload":
          return { success: false, error: "upload action not yet implemented" };
        case "dialog":
          return { success: false, error: "dialog action not yet implemented" };
        case "act":
          return { success: true, data: await doAct(profile, input) };
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  isChromeReachable,
  launchBrowserChrome,
  stopBrowserChrome,
} from "./chrome/launcher";
export * from "./constants";
export {
  getPageForTargetId,
  refLocator,
} from "./core/playwright-session";
export {
  buildRoleSnapshotFromAiSnapshot,
  buildRoleSnapshotFromAriaSnapshot,
} from "./core/snapshot-engine";
export * from "./schema";
export * from "./types";
