// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Playwright browser-context and page lifecycle management over CDP.
 *
 * Connects to an already-running Chrome instance via `chromium.connectOverCDP()`,
 * then exposes helpers for page discovery, creation, focus, close, and per-page
 * state tracking (console messages, network requests, role refs).
 *
 * Reference: https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
 */

import type { Browser, BrowserContext, ConsoleMessage, Page, Request, Response } from "playwright-core";
import { chromium } from "playwright-core";
import { getChromeWebSocketUrl } from "../chrome/launcher";
import { MAX_CONSOLE_MESSAGES, MAX_NETWORK_REQUESTS, MAX_PAGE_ERRORS, MAX_ROLE_REFS_CACHE } from "../constants";
import type { BrowserConsoleMessage, BrowserNetworkRequest, BrowserPageError, RoleRefMap } from "../types";
import { getHeadersWithAuth } from "./cdp-client";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type TargetInfoResponse = { targetInfo?: { targetId?: string } };

type ConnectedBrowser = { browser: Browser; cdpUrl: string };

type PageState = {
  console: BrowserConsoleMessage[];
  errors: BrowserPageError[];
  requests: BrowserNetworkRequest[];
  requestIds: WeakMap<Request, string>;
  nextRequestId: number;
  armIdUpload: number;
  armIdDialog: number;
  armIdDownload: number;
  roleRefs?: RoleRefMap;
  roleRefsMode?: "role" | "aria";
  roleRefsFrameSelector?: string;
};

type RoleRefsCacheEntry = {
  refs: RoleRefMap;
  frameSelector?: string;
  mode?: "role" | "aria";
};

type ContextState = { traceActive: boolean };

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const pageStates = new WeakMap<Page, PageState>();
const contextStates = new WeakMap<BrowserContext, ContextState>();
const observedContexts = new WeakSet<BrowserContext>();
const observedPages = new WeakSet<Page>();
const roleRefsByTarget = new Map<string, RoleRefsCacheEntry>();

let cached: ConnectedBrowser | null = null;
let connecting: Promise<ConnectedBrowser> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripTrailingSlash(url: string) {
  return url.replace(/\/$/, "");
}

function refsCacheKey(cdpUrl: string, targetId: string) {
  return `${stripTrailingSlash(cdpUrl)}::${targetId}`;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

// ---------------------------------------------------------------------------
// Role-ref cache
// ---------------------------------------------------------------------------

export function rememberRoleRefsForTarget(opts: {
  cdpUrl: string;
  targetId: string;
  refs: RoleRefMap;
  frameSelector?: string;
  mode?: "role" | "aria";
}): void {
  const tid = opts.targetId.trim();
  if (!tid) return;
  roleRefsByTarget.set(refsCacheKey(opts.cdpUrl, tid), {
    refs: opts.refs,
    ...(opts.frameSelector ? { frameSelector: opts.frameSelector } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
  });
  while (roleRefsByTarget.size > MAX_ROLE_REFS_CACHE) {
    const first = roleRefsByTarget.keys().next();
    if (first.done) break;
    roleRefsByTarget.delete(first.value);
  }
}

export function storeRoleRefsForTarget(opts: {
  page: Page;
  cdpUrl: string;
  targetId?: string;
  refs: RoleRefMap;
  frameSelector?: string;
  mode: "role" | "aria";
}): void {
  const state = ensurePageState(opts.page);
  state.roleRefs = opts.refs;
  state.roleRefsFrameSelector = opts.frameSelector;
  state.roleRefsMode = opts.mode;
  if (!opts.targetId?.trim()) return;
  rememberRoleRefsForTarget({
    cdpUrl: opts.cdpUrl,
    targetId: opts.targetId,
    refs: opts.refs,
    frameSelector: opts.frameSelector,
    mode: opts.mode,
  });
}

export function restoreRoleRefsForTarget(opts: { cdpUrl: string; targetId?: string; page: Page }): void {
  const tid = opts.targetId?.trim() || "";
  if (!tid) return;
  const entry = roleRefsByTarget.get(refsCacheKey(opts.cdpUrl, tid));
  if (!entry) return;
  const state = ensurePageState(opts.page);
  if (state.roleRefs) return; // already populated
  state.roleRefs = entry.refs;
  state.roleRefsFrameSelector = entry.frameSelector;
  state.roleRefsMode = entry.mode;
}

// ---------------------------------------------------------------------------
// Page state management
// ---------------------------------------------------------------------------

export function ensurePageState(page: Page): PageState {
  const existing = pageStates.get(page);
  if (existing) return existing;

  const state: PageState = {
    console: [],
    errors: [],
    requests: [],
    requestIds: new WeakMap(),
    nextRequestId: 0,
    armIdUpload: 0,
    armIdDialog: 0,
    armIdDownload: 0,
  };
  pageStates.set(page, state);

  if (!observedPages.has(page)) {
    observedPages.add(page);

    page.on("console", (msg: ConsoleMessage) => {
      state.console.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
        location: msg.location(),
      });
      if (state.console.length > MAX_CONSOLE_MESSAGES) state.console.shift();
    });

    page.on("pageerror", (err: Error) => {
      state.errors.push({
        message: err?.message ? String(err.message) : String(err),
        name: err?.name ? String(err.name) : undefined,
        stack: err?.stack ? String(err.stack) : undefined,
        timestamp: new Date().toISOString(),
      });
      if (state.errors.length > MAX_PAGE_ERRORS) state.errors.shift();
    });

    page.on("request", (req: Request) => {
      state.nextRequestId += 1;
      const id = `r${state.nextRequestId}`;
      state.requestIds.set(req, id);
      state.requests.push({
        id,
        timestamp: new Date().toISOString(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
      });
      if (state.requests.length > MAX_NETWORK_REQUESTS) state.requests.shift();
    });

    page.on("response", (resp: Response) => {
      const id = state.requestIds.get(resp.request());
      if (!id) return;
      const rec = [...state.requests].reverse().find((r: BrowserNetworkRequest) => r.id === id);
      if (rec) {
        rec.status = resp.status();
        rec.ok = resp.ok();
      }
    });

    page.on("requestfailed", (req: Request) => {
      const id = state.requestIds.get(req);
      if (!id) return;
      const rec = [...state.requests].reverse().find((r: BrowserNetworkRequest) => r.id === id);
      if (rec) {
        rec.failureText = req.failure()?.errorText;
        rec.ok = false;
      }
    });

    page.on("close", () => {
      pageStates.delete(page);
      observedPages.delete(page);
    });
  }

  return state;
}

export function ensureContextState(ctx: BrowserContext): ContextState {
  const existing = contextStates.get(ctx);
  if (existing) return existing;
  const state: ContextState = { traceActive: false };
  contextStates.set(ctx, state);
  return state;
}

function observeContext(ctx: BrowserContext) {
  if (observedContexts.has(ctx)) return;
  observedContexts.add(ctx);
  ensureContextState(ctx);
  for (const page of ctx.pages()) ensurePageState(page);
  ctx.on("page", (p: Page) => ensurePageState(p));
}

function observeBrowser(browser: Browser) {
  for (const ctx of browser.contexts()) observeContext(ctx);
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

async function connectBrowser(cdpUrl: string): Promise<ConnectedBrowser> {
  const norm = stripTrailingSlash(cdpUrl);
  if (cached?.cdpUrl === norm) return cached;
  if (connecting) return connecting;

  const attempt = async (): Promise<ConnectedBrowser> => {
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const timeout = 5000 + i * 2000;
        const wsUrl = await getChromeWebSocketUrl(norm, timeout).catch(() => null);
        const endpoint = wsUrl ?? norm;
        const headers = getHeadersWithAuth(endpoint);
        const browser = await chromium.connectOverCDP(endpoint, { timeout, headers });
        const conn: ConnectedBrowser = { browser, cdpUrl: norm };
        cached = conn;
        observeBrowser(browser);
        browser.on("disconnected", () => {
          if (cached?.browser === browser) cached = null;
        });
        return conn;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 250 + i * 250));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(lastErr ? errMsg(lastErr) : "CDP connect failed");
  };

  connecting = attempt().finally(() => {
    connecting = null;
  });
  return connecting;
}

// ---------------------------------------------------------------------------
// Page discovery
// ---------------------------------------------------------------------------

async function allPages(browser: Browser): Promise<Page[]> {
  return browser.contexts().flatMap((c: BrowserContext) => c.pages());
}

async function targetIdOf(page: Page): Promise<string | null> {
  const session = await page.context().newCDPSession(page);
  try {
    const info = (await session.send("Target.getTargetInfo")) as TargetInfoResponse;
    return String(info?.targetInfo?.targetId ?? "").trim() || null;
  } finally {
    await session.detach().catch(() => {});
  }
}

async function findByTargetId(browser: Browser, targetId: string, cdpUrl?: string): Promise<Page | null> {
  const pages = await allPages(browser);
  for (const p of pages) {
    const tid = await targetIdOf(p).catch(() => null);
    if (tid === targetId) return p;
  }
  // Fallback: URL-based matching via /json/list
  if (cdpUrl) {
    try {
      const base = cdpUrl
        .replace(/\/+$/, "")
        .replace(/^ws:/, "http:")
        .replace(/\/cdp$/, "");
      const resp = await fetch(`${base}/json/list`, { headers: getHeadersWithAuth(`${base}/json/list`) });
      if (resp.ok) {
        const targets = (await resp.json()) as Array<{ id: string; url: string; title?: string }>;
        const target = targets.find((t) => t.id === targetId);
        if (target) {
          const matches = pages.filter((p) => p.url() === target.url);
          if (matches.length === 1) return matches[0];
          if (matches.length > 1) {
            const sameUrl = targets.filter((t) => t.url === target.url);
            if (sameUrl.length === matches.length) {
              const idx = sameUrl.findIndex((t) => t.id === targetId);
              if (idx >= 0 && idx < matches.length) return matches[idx];
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: page operations
// ---------------------------------------------------------------------------

export async function getPageForTargetId(opts: { cdpUrl: string; targetId?: string }): Promise<Page> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const pages = await allPages(browser);
  if (!pages.length) throw new Error("No pages available in the connected browser.");
  if (!opts.targetId) return pages[0];

  const found = await findByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!found) {
    if (pages.length === 1) return pages[0];
    throw new Error("tab not found");
  }
  return found;
}

export function refLocator(page: Page, ref: string) {
  const norm = ref.startsWith("@") ? ref.slice(1) : ref.startsWith("ref=") ? ref.slice(4) : ref;

  if (/^e\d+$/.test(norm)) {
    const state = pageStates.get(page);
    if (state?.roleRefsMode === "aria") {
      const scope = state.roleRefsFrameSelector ? page.frameLocator(state.roleRefsFrameSelector) : page;
      return scope.locator(`aria-ref=${norm}`);
    }
    const info = state?.roleRefs?.[norm];
    if (!info) {
      throw new Error(`Unknown ref "${norm}". Run a new snapshot and use a ref from that snapshot.`);
    }
    const scope = state?.roleRefsFrameSelector ? page.frameLocator(state.roleRefsFrameSelector) : page;
    const any = scope as unknown as {
      getByRole: (role: never, opts?: { name?: string; exact?: boolean }) => ReturnType<Page["getByRole"]>;
    };
    const loc = info.name
      ? any.getByRole(info.role as never, { name: info.name, exact: true })
      : any.getByRole(info.role as never);
    return info.nth !== undefined ? loc.nth(info.nth) : loc;
  }

  return page.locator(`aria-ref=${norm}`);
}

export async function closePlaywrightBrowserConnection(): Promise<void> {
  const cur = cached;
  cached = null;
  if (cur) await cur.browser.close().catch(() => {});
}

export async function listPagesViaPlaywright(opts: {
  cdpUrl: string;
}): Promise<Array<{ targetId: string; title: string; url: string; type: string }>> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const results: Array<{ targetId: string; title: string; url: string; type: string }> = [];
  for (const page of await allPages(browser)) {
    const tid = await targetIdOf(page).catch(() => null);
    if (tid) {
      results.push({
        targetId: tid,
        title: await page.title().catch(() => ""),
        url: page.url(),
        type: "page",
      });
    }
  }
  return results;
}

export async function createPageViaPlaywright(opts: {
  cdpUrl: string;
  url: string;
}): Promise<{ targetId: string; title: string; url: string; type: string }> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  ensureContextState(ctx);

  const page = await ctx.newPage();
  ensurePageState(page);

  const target = opts.url.trim() || "about:blank";
  if (target !== "about:blank") {
    await page.goto(target, { timeout: 30_000 }).catch(() => {});
  }

  const tid = await targetIdOf(page).catch(() => null);
  if (!tid) throw new Error("Failed to get targetId for new page");

  return {
    targetId: tid,
    title: await page.title().catch(() => ""),
    url: page.url(),
    type: "page",
  };
}

export async function closePageByTargetIdViaPlaywright(opts: { cdpUrl: string; targetId: string }): Promise<void> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const page = await findByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!page) throw new Error("tab not found");
  await page.close();
}

export async function focusPageByTargetIdViaPlaywright(opts: { cdpUrl: string; targetId: string }): Promise<void> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const page = await findByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!page) throw new Error("tab not found");
  try {
    await page.bringToFront();
  } catch (err) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Page.bringToFront");
    } catch {
      throw err;
    } finally {
      await session.detach().catch(() => {});
    }
  }
}

export function getPageState(page: Page): PageState | undefined {
  return pageStates.get(page);
}
