// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Browser tool types
 * TypeScript interfaces for the browser control system
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";

// Browser executable detection
export type BrowserKind = "brave" | "canary" | "chromium" | "chrome" | "custom" | "edge";

export type BrowserExecutable = {
  kind: BrowserKind;
  path: string;
};

// Chrome profile configuration
export type BrowserProfile = {
  name: string;
  cdpPort: number;
  cdpUrl: string;
  cdpIsLoopback: boolean;
  color?: string;
};

export type BrowserConfig = {
  enabled?: boolean;
  executablePath?: string;
  headless?: boolean;
  noSandbox?: boolean;
  profiles?: Record<string, Partial<BrowserProfile>>;
  snapshotDefaults?: {
    mode?: "efficient";
  };
};

// Running Chrome instance
export type RunningChrome = {
  pid: number;
  exe: BrowserExecutable;
  userDataDir: string;
  cdpPort: number;
  startedAt: number;
  proc: ChildProcessWithoutNullStreams;
};

// CDP types
export type CdpSendFn = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export type CdpRemoteObject = {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
  preview?: unknown;
};

export type CdpExceptionDetails = {
  text?: string;
  lineNumber?: number;
  columnNumber?: number;
  exception?: CdpRemoteObject;
  stackTrace?: unknown;
};

// ARIA snapshot types
export type AriaSnapshotNode = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  backendDOMNodeId?: number;
  depth: number;
};

export type RawAXNode = {
  nodeId?: string;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  description?: { value?: string };
  childIds?: string[];
  backendDOMNodeId?: number;
};

// DOM snapshot types
export type DomSnapshotNode = {
  ref: string;
  parentRef: string | null;
  depth: number;
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  name?: string;
  text?: string;
  href?: string;
  type?: string;
  value?: string;
};

// Query match types
export type QueryMatch = {
  index: number;
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  value?: string;
  href?: string;
  outerHTML?: string;
};

// Role snapshot types (Playwright-based)
export type RoleRef = {
  role: string;
  name?: string;
  nth?: number;
};

export type RoleRefMap = Record<string, RoleRef>;

export type RoleSnapshotStats = {
  lines: number;
  chars: number;
  refs: number;
  interactive: number;
};

export type RoleSnapshotOptions = {
  interactive?: boolean;
  maxDepth?: number;
  compact?: boolean;
};

// Console/network monitoring
export type BrowserConsoleMessage = {
  type: string;
  text: string;
  timestamp: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
};

export type BrowserPageError = {
  message: string;
  name?: string;
  stack?: string;
  timestamp: string;
};

export type BrowserNetworkRequest = {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  ok?: boolean;
  failureText?: string;
};

// Browser tool action types
export type BrowserAction =
  | "status"
  | "start"
  | "stop"
  | "profiles"
  | "tabs"
  | "open"
  | "focus"
  | "close"
  | "snapshot"
  | "screenshot"
  | "navigate"
  | "console"
  | "pdf"
  | "upload"
  | "dialog"
  | "act";

export type BrowserActKind =
  | "click"
  | "type"
  | "press"
  | "hover"
  | "drag"
  | "select"
  | "fill"
  | "resize"
  | "wait"
  | "evaluate"
  | "close";

export type BrowserSnapshotFormat = "aria" | "ai";
export type BrowserSnapshotMode = "efficient";
export type BrowserSnapshotRefs = "role" | "aria";
export type BrowserImageType = "png" | "jpeg";

// Browser tool result types
export type BrowserStatusResult = {
  status: "running" | "stopped";
  profile: string;
  cdpUrl?: string;
  pid?: number;
};

export type BrowserTabInfo = {
  targetId: string;
  title: string;
  url: string;
  type: string;
};

export type BrowserSnapshotResult = {
  format: BrowserSnapshotFormat;
  snapshot: string;
  targetId: string;
  url: string;
  title: string;
  imagePath?: string;
};

export type BrowserScreenshotResult = {
  path: string;
  width: number;
  height: number;
  format: BrowserImageType;
};

// Browser act request types
export type BrowserActRequest = {
  kind: BrowserActKind;
  targetId?: string;
  ref?: string;
  // click
  doubleClick?: boolean;
  button?: string;
  modifiers?: string[];
  // type
  text?: string;
  submit?: boolean;
  slowly?: boolean;
  // press
  key?: string;
  // drag
  startRef?: string;
  endRef?: string;
  // select
  values?: string[];
  // fill
  fields?: Array<Record<string, unknown>>;
  // resize
  width?: number;
  height?: number;
  // wait
  timeMs?: number;
  textGone?: string;
  // evaluate
  fn?: string;
};
