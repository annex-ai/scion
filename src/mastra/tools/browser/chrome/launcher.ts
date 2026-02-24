// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Launch and manage a Chrome/Chromium process with CDP (Chrome DevTools Protocol)
 * remote debugging enabled.
 *
 * Lifecycle:
 *  1. Resolve the browser executable (see `detection.ts`).
 *  2. Spawn Chrome with `--remote-debugging-port`.
 *  3. Wait for the CDP HTTP endpoint to become reachable.
 *  4. Return a handle the caller can use to stop the process later.
 *
 * Reference: Chromium command-line flags — https://peter.sh/experiments/chromium-command-line-switches/
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { DEFAULT_BROWSER_COLOR, DEFAULT_BROWSER_PROFILE_NAME, DEFAULT_CDP_PORT } from "../constants";
import { appendCdpPath, getHeadersWithAuth, normalizeCdpWsUrl } from "../core/cdp-client";
import type { BrowserConfig, BrowserExecutable, BrowserProfile, RunningChrome } from "../types";
import { resolveBrowserExecutableForPlatform } from "./detection";
import { decorateBrowserProfile, ensureProfileCleanExit, isProfileDecorated } from "./profile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "mastra", "browser");
  if (process.platform === "win32")
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "mastra", "browser");
  return path.join(home, ".config", "mastra", "browser");
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveExecutable(config: BrowserConfig): BrowserExecutable | null {
  return resolveBrowserExecutableForPlatform(config, process.platform);
}

export function resolveBrowserUserDataDir(profileName = DEFAULT_BROWSER_PROFILE_NAME): string {
  return path.join(defaultDataDir(), profileName, "user-data");
}

function cdpBaseUrl(port: number) {
  return `http://127.0.0.1:${port}`;
}

// ---------------------------------------------------------------------------
// CDP readiness checks
// ---------------------------------------------------------------------------

type VersionPayload = {
  webSocketDebuggerUrl?: string;
  Browser?: string;
  "User-Agent"?: string;
};

async function fetchVersion(cdpUrl: string, timeoutMs = 500): Promise<VersionPayload | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = appendCdpPath(cdpUrl, "/json/version");
    const res = await fetch(url, { signal: ctrl.signal, headers: getHeadersWithAuth(url) });
    if (!res.ok) return null;
    const data = (await res.json()) as VersionPayload;
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function isChromeReachable(cdpUrl: string, timeoutMs = 500): Promise<boolean> {
  return Boolean(await fetchVersion(cdpUrl, timeoutMs));
}

export async function getChromeWebSocketUrl(cdpUrl: string, timeoutMs = 500): Promise<string | null> {
  const ver = await fetchVersion(cdpUrl, timeoutMs);
  const raw = String(ver?.webSocketDebuggerUrl ?? "").trim();
  if (!raw) return null;
  return normalizeCdpWsUrl(raw, cdpUrl);
}

async function canHandshake(wsUrl: string, timeoutMs = 800): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const headers = getHeadersWithAuth(wsUrl);
    const ws = new WebSocket(wsUrl, {
      handshakeTimeout: timeoutMs,
      ...(Object.keys(headers).length ? { headers } : {}),
    });
    const timer = setTimeout(
      () => {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        resolve(false);
      },
      Math.max(50, timeoutMs + 25),
    );
    ws.once("open", () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(true);
    });
    ws.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function isChromeCdpReady(cdpUrl: string, timeoutMs = 500, handshakeTimeout = 800): Promise<boolean> {
  const wsUrl = await getChromeWebSocketUrl(cdpUrl, timeoutMs);
  if (!wsUrl) return false;
  return canHandshake(wsUrl, handshakeTimeout);
}

// ---------------------------------------------------------------------------
// Port availability
// ---------------------------------------------------------------------------

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export interface LaunchOptions {
  config?: BrowserConfig;
  profile?: Partial<BrowserProfile>;
}

export async function launchBrowserChrome(opts: LaunchOptions = {}): Promise<RunningChrome> {
  const config = opts.config ?? {};
  const profileName = opts.profile?.name ?? DEFAULT_BROWSER_PROFILE_NAME;
  const cdpPort = opts.profile?.cdpPort ?? DEFAULT_CDP_PORT;
  const profileColor = opts.profile?.color ?? DEFAULT_BROWSER_COLOR;
  const cdpUrl = cdpBaseUrl(cdpPort);

  // Verify port is free
  if (!(await portFree(cdpPort))) {
    if (await isChromeReachable(cdpUrl, 500)) {
      throw new Error(
        `CDP port ${cdpPort} is already in use by another Chrome instance. Stop that instance or use a different port.`,
      );
    }
    throw new Error(`Port ${cdpPort} is not available.`);
  }

  const exe = resolveExecutable(config);
  if (!exe) {
    throw new Error("No supported browser found (Chrome/Brave/Edge/Chromium on macOS, Linux, or Windows).");
  }

  const userDataDir = resolveBrowserUserDataDir(profileName);
  fs.mkdirSync(userDataDir, { recursive: true });

  const localStatePath = path.join(userDataDir, "Local State");
  const preferencesPath = path.join(userDataDir, "Default", "Preferences");
  const needsBootstrap = !fileExists(localStatePath) || !fileExists(preferencesPath);
  const needsDecorate = !isProfileDecorated(userDataDir, profileName, profileColor.toUpperCase());

  const buildArgs = (): string[] => {
    const args = [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-features=Translate,MediaRouter",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--password-store=basic",
    ];
    if (config.headless) {
      args.push("--headless=new", "--disable-gpu");
    }
    if (config.noSandbox) {
      args.push("--no-sandbox", "--disable-setuid-sandbox");
    }
    if (process.platform === "linux") {
      args.push("--disable-dev-shm-usage");
    }
    args.push("about:blank");
    return args;
  };

  const spawnChrome = () =>
    spawn(exe.path, buildArgs(), {
      stdio: "pipe",
      env: { ...process.env, HOME: os.homedir() },
    });

  const startedAt = Date.now();

  // Bootstrap: launch once so Chrome creates its profile files, then kill
  if (needsBootstrap) {
    const bootstrap = spawnChrome();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (fileExists(localStatePath) && fileExists(preferencesPath)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      bootstrap.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    const exitDeadline = Date.now() + 5000;
    while (Date.now() < exitDeadline) {
      if (bootstrap.exitCode != null) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // Decorate profile (name + color)
  if (needsDecorate) {
    try {
      decorateBrowserProfile(userDataDir, { name: profileName, color: profileColor });
    } catch {
      /* best-effort */
    }
  }
  try {
    ensureProfileCleanExit(userDataDir);
  } catch {
    /* best-effort */
  }

  // Launch for real
  const proc = spawnChrome();

  // Wait for CDP to become reachable
  const readyDeadline = Date.now() + 15_000;
  while (Date.now() < readyDeadline) {
    if (await isChromeReachable(cdpUrl, 500)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!(await isChromeReachable(cdpUrl, 500))) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    throw new Error(`Failed to start Chrome CDP on port ${cdpPort} for profile "${profileName}".`);
  }

  return {
    pid: proc.pid ?? -1,
    exe,
    userDataDir,
    cdpPort,
    startedAt,
    proc,
  };
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

export async function stopBrowserChrome(running: RunningChrome, timeoutMs = 2500) {
  const { proc } = running;
  if (proc.killed) return;

  try {
    proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!proc.exitCode && proc.killed) break;
    if (!(await isChromeReachable(cdpBaseUrl(running.cdpPort), 200))) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  try {
    proc.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

// Re-export
export type { BrowserExecutable };
