// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { resolve } from "node:path";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { AGENT_DIR, getWorkspaceConfig } from "./lib/config";

const wsConfig = await getWorkspaceConfig();

// Workspace paths resolve relative to the project root (parent of .agent/)
const projectRoot = resolve(AGENT_DIR, "..");

console.log("[workspace] Loading workspace configuration...");
console.log(`[workspace] workspace_dir: ${wsConfig.workspace_dir}`);
console.log(`[workspace] sandbox_dir: ${wsConfig.sandbox_dir}`);
console.log(`[workspace] skills_path: ${JSON.stringify(wsConfig.skills_path)}`);
console.log(`[workspace] name: ${wsConfig.name}`);

const resolvedWorkspacePath = resolve(projectRoot, wsConfig.workspace_dir);
const resolvedSandboxPath = wsConfig.sandbox_dir
  ? resolve(projectRoot, wsConfig.sandbox_dir)
  : resolve(resolvedWorkspacePath, "sandbox");

console.log(`[workspace] Resolved workspace_dir: ${resolvedWorkspacePath}`);
console.log(`[workspace] Resolved sandbox_dir: ${resolvedSandboxPath}`);

export const workspace = new Workspace({
  name: wsConfig.name,
  filesystem: new LocalFilesystem({
    basePath: resolvedWorkspacePath,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: resolvedSandboxPath,
  }),

  skills: wsConfig.skills_path,
  bm25: true,
  autoSync: wsConfig.auto_sync,
  operationTimeout: wsConfig.operation_timeout,
});

console.log("[workspace] Workspace initialized successfully");
