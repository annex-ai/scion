// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Detect installed Chromium-based browsers across macOS, Linux, and Windows.
 *
 * Detection strategy:
 *  1. Try the OS default browser — if it is Chromium-based, use it.
 *  2. Fall back to well-known installation paths for Chrome, Brave, Edge, and Chromium.
 *
 * Reference: standard installation paths documented by each browser vendor.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserConfig, BrowserExecutable } from "../types";

// ---------------------------------------------------------------------------
// Known Chromium identifiers
// ---------------------------------------------------------------------------

const MAC_CHROMIUM_BUNDLES = new Set([
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.canary",
  "com.google.Chrome.dev",
  "com.brave.Browser",
  "com.brave.Browser.beta",
  "com.brave.Browser.nightly",
  "com.microsoft.Edge",
  "com.microsoft.EdgeBeta",
  "com.microsoft.EdgeDev",
  "com.microsoft.EdgeCanary",
  "org.chromium.Chromium",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera",
  "com.operasoftware.OperaGX",
  "com.yandex.desktop.yandex-browser",
  "company.thebrowser.Browser",
]);

const LINUX_DESKTOP_IDS = new Set([
  "google-chrome.desktop",
  "google-chrome-beta.desktop",
  "google-chrome-unstable.desktop",
  "brave-browser.desktop",
  "microsoft-edge.desktop",
  "microsoft-edge-beta.desktop",
  "microsoft-edge-dev.desktop",
  "microsoft-edge-canary.desktop",
  "chromium.desktop",
  "chromium-browser.desktop",
  "vivaldi.desktop",
  "vivaldi-stable.desktop",
  "opera.desktop",
  "opera-gx.desktop",
  "yandex-browser.desktop",
  "org.chromium.Chromium.desktop",
]);

const KNOWN_EXE_NAMES = new Set([
  "chrome.exe",
  "msedge.exe",
  "brave.exe",
  "brave-browser.exe",
  "chromium.exe",
  "vivaldi.exe",
  "opera.exe",
  "launcher.exe",
  "yandex.exe",
  "yandexbrowser.exe",
  "google chrome",
  "google chrome canary",
  "brave browser",
  "microsoft edge",
  "chromium",
  "chrome",
  "brave",
  "msedge",
  "brave-browser",
  "google-chrome",
  "google-chrome-stable",
  "google-chrome-beta",
  "google-chrome-unstable",
  "microsoft-edge",
  "microsoft-edge-beta",
  "microsoft-edge-dev",
  "microsoft-edge-canary",
  "chromium-browser",
  "vivaldi",
  "vivaldi-stable",
  "opera",
  "opera-stable",
  "opera-gx",
  "yandex-browser",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function runSync(cmd: string, args: string[], timeout = 1200, maxBuf = 1024 * 1024): string | null {
  try {
    const out = execFileSync(cmd, args, {
      timeout,
      encoding: "utf8",
      maxBuffer: maxBuf,
    });
    return String(out ?? "").trim() || null;
  } catch {
    return null;
  }
}

function kindFromName(name: string): BrowserExecutable["kind"] {
  const n = name.toLowerCase();
  if (n.includes("brave")) return "brave";
  if (n.includes("edge") || n.includes("msedge")) return "edge";
  if (n.includes("chromium")) return "chromium";
  if (n.includes("canary") || n.includes("sxs")) return "canary";
  if (n.includes("opera") || n.includes("vivaldi") || n.includes("yandex")) return "chromium";
  return "chrome";
}

function firstExisting(list: BrowserExecutable[]): BrowserExecutable | null {
  for (const item of list) {
    if (fileExists(item.path)) return item;
  }
  return null;
}

// ---------------------------------------------------------------------------
// macOS detection
// ---------------------------------------------------------------------------

function defaultBundleIdMac(): string | null {
  const plist = path.join(
    os.homedir(),
    "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
  );
  if (!fileExists(plist)) return null;

  const raw = runSync(
    "/usr/bin/plutil",
    ["-extract", "LSHandlers", "json", "-o", "-", "--", plist],
    2000,
    5 * 1024 * 1024,
  );
  if (!raw) return null;

  let handlers: unknown;
  try {
    handlers = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(handlers)) return null;

  const find = (scheme: string): string | null => {
    let last: string | null = null;
    for (const entry of handlers) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (rec.LSHandlerURLScheme !== scheme) continue;
      const role =
        (typeof rec.LSHandlerRoleAll === "string" && rec.LSHandlerRoleAll) ||
        (typeof rec.LSHandlerRoleViewer === "string" && rec.LSHandlerRoleViewer) ||
        null;
      if (role) last = role;
    }
    return last;
  };

  return find("http") ?? find("https");
}

function defaultChromeMac(): BrowserExecutable | null {
  const bundleId = defaultBundleIdMac();
  if (!bundleId || !MAC_CHROMIUM_BUNDLES.has(bundleId)) return null;

  const appPath = runSync("/usr/bin/osascript", ["-e", `POSIX path of (path to application id "${bundleId}")`]);
  if (!appPath) return null;

  const clean = appPath.trim().replace(/\/$/, "");
  const exeName = runSync("/usr/bin/defaults", ["read", path.join(clean, "Contents", "Info"), "CFBundleExecutable"]);
  if (!exeName) return null;

  const exePath = path.join(clean, "Contents", "MacOS", exeName.trim());
  if (!fileExists(exePath)) return null;
  return { kind: kindFromName(bundleId), path: exePath };
}

export function findChromeExecutableMac(): BrowserExecutable | null {
  const home = os.homedir();
  return firstExisting([
    { kind: "chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
    { kind: "chrome", path: path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome") },
    { kind: "brave", path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
    { kind: "brave", path: path.join(home, "Applications/Brave Browser.app/Contents/MacOS/Brave Browser") },
    { kind: "edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
    { kind: "edge", path: path.join(home, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge") },
    { kind: "chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" },
    { kind: "chromium", path: path.join(home, "Applications/Chromium.app/Contents/MacOS/Chromium") },
    { kind: "canary", path: "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" },
    {
      kind: "canary",
      path: path.join(home, "Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"),
    },
  ]);
}

// ---------------------------------------------------------------------------
// Linux detection
// ---------------------------------------------------------------------------

function desktopFilePath(id: string): string | null {
  const dirs = [
    path.join(os.homedir(), ".local", "share", "applications", id),
    path.join("/usr/local/share/applications", id),
    path.join("/usr/share/applications", id),
    path.join("/var/lib/snapd/desktop/applications", id),
  ];
  for (const d of dirs) {
    if (fileExists(d)) return d;
  }
  return null;
}

function execLineFromDesktop(fp: string): string | null {
  try {
    const raw = fs.readFileSync(fp, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("Exec=")) return line.slice(5).trim();
    }
  } catch {
    // ignore
  }
  return null;
}

function tokenizeExec(line: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inQ = false;
  let qChar = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && (!inQ || ch === qChar)) {
      inQ = !inQ;
      qChar = inQ ? ch : "";
      continue;
    }
    if (!inQ && /\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function commandFromExecLine(line: string): string | null {
  for (const token of tokenizeExec(line)) {
    if (!token) continue;
    if (token === "env") continue;
    if (token.includes("=") && !token.startsWith("/") && !token.includes("\\")) continue;
    return token.replace(/^["']|["']$/g, "");
  }
  return null;
}

function resolveLinuxCommand(cmd: string): string | null {
  const cleaned = cmd.trim().replace(/%[a-zA-Z]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("/")) return cleaned;
  return runSync("which", [cleaned], 800)?.trim() ?? null;
}

function defaultChromeLinux(): BrowserExecutable | null {
  const desktopId =
    runSync("xdg-settings", ["get", "default-web-browser"]) ||
    runSync("xdg-mime", ["query", "default", "x-scheme-handler/http"]);
  if (!desktopId) return null;
  const id = desktopId.trim();
  if (!LINUX_DESKTOP_IDS.has(id)) return null;

  const fp = desktopFilePath(id);
  if (!fp) return null;
  const execLine = execLineFromDesktop(fp);
  if (!execLine) return null;
  const cmd = commandFromExecLine(execLine);
  if (!cmd) return null;
  const resolved = resolveLinuxCommand(cmd);
  if (!resolved) return null;

  const base = path.posix.basename(resolved).toLowerCase();
  if (!KNOWN_EXE_NAMES.has(base)) return null;
  return { kind: kindFromName(base), path: resolved };
}

export function findChromeExecutableLinux(): BrowserExecutable | null {
  return firstExisting([
    { kind: "chrome", path: "/usr/bin/google-chrome" },
    { kind: "chrome", path: "/usr/bin/google-chrome-stable" },
    { kind: "chrome", path: "/usr/bin/chrome" },
    { kind: "brave", path: "/usr/bin/brave-browser" },
    { kind: "brave", path: "/usr/bin/brave-browser-stable" },
    { kind: "brave", path: "/usr/bin/brave" },
    { kind: "brave", path: "/snap/bin/brave" },
    { kind: "edge", path: "/usr/bin/microsoft-edge" },
    { kind: "edge", path: "/usr/bin/microsoft-edge-stable" },
    { kind: "chromium", path: "/usr/bin/chromium" },
    { kind: "chromium", path: "/usr/bin/chromium-browser" },
    { kind: "chromium", path: "/snap/bin/chromium" },
  ]);
}

// ---------------------------------------------------------------------------
// Windows detection
// ---------------------------------------------------------------------------

function windowsProgId(): string | null {
  const raw = runSync("reg", [
    "query",
    "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice",
    "/v",
    "ProgId",
  ]);
  return raw?.match(/ProgId\s+REG_\w+\s+(.+)$/im)?.[1]?.trim() ?? null;
}

function windowsCommandForProgId(progId: string): string | null {
  const key = progId === "http" ? "HKCR\\http\\shell\\open\\command" : `HKCR\\${progId}\\shell\\open\\command`;
  const raw = runSync("reg", ["query", key, "/ve"]);
  return raw?.match(/REG_\w+\s+(.+)$/im)?.[1]?.trim() ?? null;
}

function expandEnvVars(s: string): string {
  return s.replace(/%([^%]+)%/g, (_, name) => {
    const k = String(name ?? "").trim();
    return k ? (process.env[k] ?? `%${k}%`) : _;
  });
}

function extractExePath(command: string): string | null {
  return command.match(/"([^"]+\.exe)"/i)?.[1] ?? command.match(/([^\s]+\.exe)/i)?.[1] ?? null;
}

function defaultChromeWindows(): BrowserExecutable | null {
  const progId = windowsProgId();
  const cmd = (progId ? windowsCommandForProgId(progId) : null) ?? windowsCommandForProgId("http");
  if (!cmd) return null;

  const exePath = extractExePath(expandEnvVars(cmd));
  if (!exePath || !fileExists(exePath)) return null;

  const base = path.win32.basename(exePath).toLowerCase();
  if (!KNOWN_EXE_NAMES.has(base)) return null;
  return { kind: kindFromName(base), path: exePath };
}

export function findChromeExecutableWindows(): BrowserExecutable | null {
  const local = process.env.LOCALAPPDATA ?? "";
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const j = path.win32.join;

  const list: BrowserExecutable[] = [];
  if (local) {
    list.push(
      { kind: "chrome", path: j(local, "Google", "Chrome", "Application", "chrome.exe") },
      { kind: "brave", path: j(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") },
      { kind: "edge", path: j(local, "Microsoft", "Edge", "Application", "msedge.exe") },
      { kind: "chromium", path: j(local, "Chromium", "Application", "chrome.exe") },
      { kind: "canary", path: j(local, "Google", "Chrome SxS", "Application", "chrome.exe") },
    );
  }
  list.push(
    { kind: "chrome", path: j(pf, "Google", "Chrome", "Application", "chrome.exe") },
    { kind: "chrome", path: j(pf86, "Google", "Chrome", "Application", "chrome.exe") },
    { kind: "brave", path: j(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") },
    { kind: "brave", path: j(pf86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") },
    { kind: "edge", path: j(pf, "Microsoft", "Edge", "Application", "msedge.exe") },
    { kind: "edge", path: j(pf86, "Microsoft", "Edge", "Application", "msedge.exe") },
  );
  return firstExisting(list);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a browser executable for the current platform.
 *
 * Priority:
 *  1. Explicit `config.executablePath` if provided.
 *  2. OS default browser (if Chromium-based).
 *  3. Well-known installation paths.
 */
export function resolveBrowserExecutableForPlatform(
  config: BrowserConfig,
  platform: NodeJS.Platform,
): BrowserExecutable | null {
  if (config.executablePath) {
    if (!fileExists(config.executablePath)) {
      throw new Error(`browser.executablePath not found: ${config.executablePath}`);
    }
    return { kind: "custom", path: config.executablePath };
  }

  // Try OS default first
  const defaultExe =
    platform === "darwin"
      ? defaultChromeMac()
      : platform === "linux"
        ? defaultChromeLinux()
        : platform === "win32"
          ? defaultChromeWindows()
          : null;
  if (defaultExe) return defaultExe;

  // Fall back to known paths
  if (platform === "darwin") return findChromeExecutableMac();
  if (platform === "linux") return findChromeExecutableLinux();
  if (platform === "win32") return findChromeExecutableWindows();
  return null;
}
