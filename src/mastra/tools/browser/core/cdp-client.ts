// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Low-level Chrome DevTools Protocol (CDP) client.
 *
 * Communicates with Chrome over a WebSocket connection using the JSON-based
 * CDP message protocol.  Every exported function is stateless — the caller
 * provides the WebSocket URL and receives the result.
 *
 * Reference: https://chromedevtools.github.io/devtools-protocol/
 */

import { Buffer } from "node:buffer";
import WebSocket from "ws";
import type {
  AriaSnapshotNode,
  CdpExceptionDetails,
  CdpRemoteObject,
  CdpSendFn,
  DomSnapshotNode,
  QueryMatch,
  RawAXNode,
} from "../types";

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

function rawToString(data: WebSocket.RawData, enc: BufferEncoding = "utf8"): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString(enc);
  if (Array.isArray(data)) return Buffer.concat(data).toString(enc);
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString(enc);
  return Buffer.from(String(data)).toString(enc);
}

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h === "::1" ||
    h === "[::]" ||
    h === "::"
  );
}

export function getHeadersWithAuth(url: string, extra: Record<string, string> = {}): Record<string, string> {
  const merged = { ...extra };
  try {
    const u = new URL(url);
    if (Object.keys(merged).some((k) => k.toLowerCase() === "authorization")) return merged;
    if (u.username || u.password) {
      merged.Authorization = `Basic ${Buffer.from(`${u.username}:${u.password}`).toString("base64")}`;
    }
  } catch {
    /* ignore */
  }
  return merged;
}

export function appendCdpPath(cdpUrl: string, suffix: string): string {
  const u = new URL(cdpUrl);
  const base = u.pathname.replace(/\/$/, "");
  u.pathname = `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
  return u.toString();
}

export function normalizeCdpWsUrl(wsUrl: string, cdpUrl: string): string {
  const ws = new URL(wsUrl);
  const cdp = new URL(cdpUrl);

  if (isLoopbackHost(ws.hostname) && !isLoopbackHost(cdp.hostname)) {
    ws.hostname = cdp.hostname;
    const port = cdp.port || (cdp.protocol === "https:" ? "443" : "80");
    if (port) ws.port = port;
    ws.protocol = cdp.protocol === "https:" ? "wss:" : "ws:";
  }
  if (cdp.protocol === "https:" && ws.protocol === "ws:") ws.protocol = "wss:";
  if (!ws.username && !ws.password && (cdp.username || cdp.password)) {
    ws.username = cdp.username;
    ws.password = cdp.password;
  }
  for (const [k, v] of cdp.searchParams.entries()) {
    if (!ws.searchParams.has(k)) ws.searchParams.append(k, v);
  }
  return ws.toString();
}

// ---------------------------------------------------------------------------
// CDP message transport
// ---------------------------------------------------------------------------

type CdpMsg = { id: number; result?: unknown; error?: { message?: string } };
type Waiter = { resolve: (v: unknown) => void; reject: (e: Error) => void };

function makeTransport(ws: WebSocket) {
  let seq = 1;
  const waiters = new Map<number, Waiter>();

  const send: CdpSendFn = (method, params) => {
    const id = seq++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      waiters.set(id, { resolve, reject });
    });
  };

  const abort = (err: Error) => {
    for (const w of waiters.values()) w.reject(err);
    waiters.clear();
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(rawToString(raw)) as CdpMsg;
      if (typeof msg.id !== "number") return;
      const w = waiters.get(msg.id);
      if (!w) return;
      waiters.delete(msg.id);
      if (msg.error?.message) w.reject(new Error(msg.error.message));
      else w.resolve(msg.result);
    } catch {
      /* ignore */
    }
  });

  ws.on("close", () => abort(new Error("CDP socket closed")));

  return { send, abort };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export async function fetchJson<T>(url: string, timeoutMs = 1500, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = getHeadersWithAuth(url, (init?.headers as Record<string, string>) || {});
    const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchOk(url: string, timeoutMs = 1500, init?: RequestInit): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = getHeadersWithAuth(url, (init?.headers as Record<string, string>) || {});
    const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// CDP session wrapper
// ---------------------------------------------------------------------------

export async function withCdpSocket<T>(
  wsUrl: string,
  fn: (send: CdpSendFn) => Promise<T>,
  opts?: { headers?: Record<string, string> },
): Promise<T> {
  const headers = getHeadersWithAuth(wsUrl, opts?.headers ?? {});
  const ws = new WebSocket(wsUrl, {
    handshakeTimeout: 5000,
    ...(Object.keys(headers).length ? { headers } : {}),
  });
  const { send, abort } = makeTransport(ws);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err: Error) => reject(err));
  });

  try {
    return await fn(send);
  } catch (err) {
    abort(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Screenshot capture via CDP
// ---------------------------------------------------------------------------

export async function captureScreenshot(opts: {
  wsUrl: string;
  fullPage?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
}): Promise<Buffer> {
  return withCdpSocket(opts.wsUrl, async (send) => {
    await send("Page.enable");

    let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
    if (opts.fullPage) {
      const metrics = (await send("Page.getLayoutMetrics")) as {
        cssContentSize?: { width?: number; height?: number };
        contentSize?: { width?: number; height?: number };
      };
      const size = metrics?.cssContentSize ?? metrics?.contentSize;
      const w = Number(size?.width ?? 0);
      const h = Number(size?.height ?? 0);
      if (w > 0 && h > 0) clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
    }

    const fmt = opts.format ?? "png";
    const quality = fmt === "jpeg" ? Math.max(0, Math.min(100, Math.round(opts.quality ?? 85))) : undefined;

    const result = (await send("Page.captureScreenshot", {
      format: fmt,
      ...(quality !== undefined ? { quality } : {}),
      fromSurface: true,
      captureBeyondViewport: true,
      ...(clip ? { clip } : {}),
    })) as { data?: string };

    if (!result?.data) throw new Error("Screenshot failed: missing data");
    return Buffer.from(result.data, "base64");
  });
}

export async function captureScreenshotPng(opts: {
  wsUrl: string;
  fullPage?: boolean;
}): Promise<Buffer> {
  return captureScreenshot({ wsUrl: opts.wsUrl, fullPage: opts.fullPage, format: "png" });
}

// ---------------------------------------------------------------------------
// Target creation
// ---------------------------------------------------------------------------

export async function createTargetViaCdp(opts: {
  cdpUrl: string;
  url: string;
}): Promise<{ targetId: string }> {
  const ver = await fetchJson<{ webSocketDebuggerUrl?: string }>(appendCdpPath(opts.cdpUrl, "/json/version"), 1500);
  const raw = String(ver?.webSocketDebuggerUrl ?? "").trim();
  const wsUrl = raw ? normalizeCdpWsUrl(raw, opts.cdpUrl) : "";
  if (!wsUrl) throw new Error("CDP /json/version missing webSocketDebuggerUrl");

  return withCdpSocket(wsUrl, async (send) => {
    const res = (await send("Target.createTarget", { url: opts.url })) as { targetId?: string };
    const tid = String(res?.targetId ?? "").trim();
    if (!tid) throw new Error("CDP Target.createTarget returned no targetId");
    return { targetId: tid };
  });
}

// ---------------------------------------------------------------------------
// JavaScript evaluation
// ---------------------------------------------------------------------------

export async function evaluateJavaScript(opts: {
  wsUrl: string;
  expression: string;
  awaitPromise?: boolean;
  returnByValue?: boolean;
}): Promise<{ result: CdpRemoteObject; exceptionDetails?: CdpExceptionDetails }> {
  return withCdpSocket(opts.wsUrl, async (send) => {
    await send("Runtime.enable").catch(() => {});
    const res = (await send("Runtime.evaluate", {
      expression: opts.expression,
      awaitPromise: Boolean(opts.awaitPromise),
      returnByValue: opts.returnByValue ?? true,
      userGesture: true,
      includeCommandLineAPI: true,
    })) as { result?: CdpRemoteObject; exceptionDetails?: CdpExceptionDetails };

    if (!res?.result) throw new Error("CDP Runtime.evaluate returned no result");
    return { result: res.result, exceptionDetails: res.exceptionDetails };
  });
}

// ---------------------------------------------------------------------------
// ARIA snapshot (via Accessibility domain)
// ---------------------------------------------------------------------------

function axVal(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const val = (v as { value?: unknown }).value;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return "";
}

export function formatAriaSnapshot(nodes: RawAXNode[], limit: number): AriaSnapshotNode[] {
  const byId = new Map<string, RawAXNode>();
  for (const n of nodes) {
    if (n.nodeId) byId.set(n.nodeId, n);
  }

  const referenced = new Set<string>();
  for (const n of nodes) {
    for (const c of n.childIds ?? []) referenced.add(c);
  }
  const root = nodes.find((n) => n.nodeId && !referenced.has(n.nodeId)) ?? nodes[0];
  if (!root?.nodeId) return [];

  const out: AriaSnapshotNode[] = [];
  const stack: Array<{ id: string; depth: number }> = [{ id: root.nodeId, depth: 0 }];
  while (stack.length && out.length < limit) {
    const top = stack.pop();
    if (!top) break;
    const n = byId.get(top.id);
    if (!n) continue;

    out.push({
      ref: `ax${out.length + 1}`,
      role: axVal(n.role) || "unknown",
      name: axVal(n.name) || "",
      ...(axVal(n.value) ? { value: axVal(n.value) } : {}),
      ...(axVal(n.description) ? { description: axVal(n.description) } : {}),
      ...(typeof n.backendDOMNodeId === "number" ? { backendDOMNodeId: n.backendDOMNodeId } : {}),
      depth: top.depth,
    });

    const kids = (n.childIds ?? []).filter((c) => byId.has(c));
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      if (kid) stack.push({ id: kid, depth: top.depth + 1 });
    }
  }
  return out;
}

export async function snapshotAria(opts: {
  wsUrl: string;
  limit?: number;
}): Promise<{ nodes: AriaSnapshotNode[] }> {
  const cap = Math.max(1, Math.min(2000, Math.floor(opts.limit ?? 500)));
  return withCdpSocket(opts.wsUrl, async (send) => {
    await send("Accessibility.enable").catch(() => {});
    const res = (await send("Accessibility.getFullAXTree")) as { nodes?: RawAXNode[] };
    return { nodes: formatAriaSnapshot(Array.isArray(res?.nodes) ? res.nodes : [], cap) };
  });
}

// ---------------------------------------------------------------------------
// DOM snapshot via Runtime.evaluate
// ---------------------------------------------------------------------------

export async function snapshotDom(opts: {
  wsUrl: string;
  limit?: number;
  maxTextChars?: number;
}): Promise<{ nodes: DomSnapshotNode[] }> {
  const limit = Math.max(1, Math.min(5000, Math.floor(opts.limit ?? 800)));
  const maxText = Math.max(0, Math.min(5000, Math.floor(opts.maxTextChars ?? 220)));

  const js = `(() => {
    const maxN = ${JSON.stringify(limit)};
    const maxT = ${JSON.stringify(maxText)};
    const nodes = [];
    const root = document.documentElement;
    if (!root) return { nodes };
    const stack = [{ el: root, depth: 0, parentRef: null }];
    while (stack.length && nodes.length < maxN) {
      const cur = stack.pop();
      const el = cur.el;
      if (!el || el.nodeType !== 1) continue;
      const ref = "n" + String(nodes.length + 1);
      const tag = (el.tagName || "").toLowerCase();
      const id = el.id ? String(el.id) : undefined;
      const className = el.className ? String(el.className).slice(0, 300) : undefined;
      const role = el.getAttribute && el.getAttribute("role") ? String(el.getAttribute("role")) : undefined;
      const name = el.getAttribute && el.getAttribute("aria-label") ? String(el.getAttribute("aria-label")) : undefined;
      let text = "";
      try { text = String(el.innerText || "").trim(); } catch {}
      if (maxT && text.length > maxT) text = text.slice(0, maxT) + "\\u2026";
      const href = (el.href !== undefined && el.href !== null) ? String(el.href) : undefined;
      const type = (el.type !== undefined && el.type !== null) ? String(el.type) : undefined;
      const value = (el.value !== undefined && el.value !== null) ? String(el.value).slice(0, 500) : undefined;
      nodes.push({
        ref, parentRef: cur.parentRef, depth: cur.depth, tag,
        ...(id ? { id } : {}),
        ...(className ? { className } : {}),
        ...(role ? { role } : {}),
        ...(name ? { name } : {}),
        ...(text ? { text } : {}),
        ...(href ? { href } : {}),
        ...(type ? { type } : {}),
        ...(value ? { value } : {}),
      });
      const children = el.children ? Array.from(el.children) : [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ el: children[i], depth: cur.depth + 1, parentRef: ref });
      }
    }
    return { nodes };
  })()`;

  const { result } = await evaluateJavaScript({
    wsUrl: opts.wsUrl,
    expression: js,
    awaitPromise: true,
    returnByValue: true,
  });
  const val = result?.value;
  if (!val || typeof val !== "object") return { nodes: [] };
  const ns = (val as { nodes?: unknown }).nodes;
  return { nodes: Array.isArray(ns) ? (ns as DomSnapshotNode[]) : [] };
}

// ---------------------------------------------------------------------------
// DOM text extraction
// ---------------------------------------------------------------------------

export async function getDomText(opts: {
  wsUrl: string;
  format: "html" | "text";
  maxChars?: number;
  selector?: string;
}): Promise<{ text: string }> {
  const max = Math.max(0, Math.min(5_000_000, Math.floor(opts.maxChars ?? 200_000)));
  const selExpr = opts.selector ? JSON.stringify(opts.selector) : "null";

  const js = `(() => {
    const fmt = ${JSON.stringify(opts.format)};
    const max = ${JSON.stringify(max)};
    const sel = ${selExpr};
    const pick = sel ? document.querySelector(sel) : null;
    let out = "";
    if (fmt === "text") {
      const el = pick || document.body || document.documentElement;
      try { out = String(el && el.innerText ? el.innerText : ""); } catch { out = ""; }
    } else {
      const el = pick || document.documentElement;
      try { out = String(el && el.outerHTML ? el.outerHTML : ""); } catch { out = ""; }
    }
    if (max && out.length > max) out = out.slice(0, max) + "\\n<!-- \\u2026truncated\\u2026 -->";
    return out;
  })()`;

  const { result } = await evaluateJavaScript({
    wsUrl: opts.wsUrl,
    expression: js,
    awaitPromise: true,
    returnByValue: true,
  });
  const v = result?.value ?? "";
  return { text: typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "" };
}

// ---------------------------------------------------------------------------
// querySelector
// ---------------------------------------------------------------------------

export async function querySelector(opts: {
  wsUrl: string;
  selector: string;
  limit?: number;
  maxTextChars?: number;
  maxHtmlChars?: number;
}): Promise<{ matches: QueryMatch[] }> {
  const lim = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 20)));
  const maxT = Math.max(0, Math.min(5000, Math.floor(opts.maxTextChars ?? 500)));
  const maxH = Math.max(0, Math.min(20000, Math.floor(opts.maxHtmlChars ?? 1500)));

  const js = `(() => {
    const sel = ${JSON.stringify(opts.selector)};
    const lim = ${JSON.stringify(lim)};
    const maxT = ${JSON.stringify(maxT)};
    const maxH = ${JSON.stringify(maxH)};
    const els = Array.from(document.querySelectorAll(sel)).slice(0, lim);
    return els.map((el, i) => {
      const tag = (el.tagName || "").toLowerCase();
      const id = el.id ? String(el.id) : undefined;
      const className = el.className ? String(el.className).slice(0, 300) : undefined;
      let text = "";
      try { text = String(el.innerText || "").trim(); } catch {}
      if (maxT && text.length > maxT) text = text.slice(0, maxT) + "\\u2026";
      const value = (el.value !== undefined && el.value !== null) ? String(el.value).slice(0, 500) : undefined;
      const href = (el.href !== undefined && el.href !== null) ? String(el.href) : undefined;
      let html = "";
      try { html = String(el.outerHTML || ""); } catch {}
      if (maxH && html.length > maxH) html = html.slice(0, maxH) + "\\u2026";
      return {
        index: i + 1, tag,
        ...(id ? { id } : {}),
        ...(className ? { className } : {}),
        ...(text ? { text } : {}),
        ...(value ? { value } : {}),
        ...(href ? { href } : {}),
        ...(html ? { outerHTML: html } : {}),
      };
    });
  })()`;

  const { result } = await evaluateJavaScript({
    wsUrl: opts.wsUrl,
    expression: js,
    awaitPromise: true,
    returnByValue: true,
  });
  const matches = result?.value;
  return { matches: Array.isArray(matches) ? (matches as QueryMatch[]) : [] };
}

export type { CdpSendFn };
