// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Bootstrap Check
 *
 * Utilities for detecting when soul configuration needs to be set up
 * and validating the bootstrap state.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Required soul configuration files
 */
export const REQUIRED_SOUL_FILES = ["SOUL.md", "IDENTITY.md", "USER.md"];

/**
 * Optional soul configuration files
 */
export const OPTIONAL_SOUL_FILES = ["HEARTBEAT.md"];

/**
 * Bootstrap status
 */
export interface BootstrapStatus {
  needsBootstrap: boolean;
  existingFiles: string[];
  missingFiles: string[];
  configPath: string;
  isPartialSetup: boolean;
}

/**
 * Check if bootstrap is needed
 *
 * Bootstrap is needed when:
 * - No soul files exist at all (fresh setup)
 *
 * Bootstrap is NOT needed when:
 * - All required files exist (complete setup)
 * - Some files exist (partial setup - user may be manually configuring)
 */
export function needsBootstrap(configPath: string): boolean {
  const status = getBootstrapStatus(configPath);
  return status.needsBootstrap;
}

/**
 * Get detailed bootstrap status
 */
export function getBootstrapStatus(configPath: string): BootstrapStatus {
  const existingFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const file of REQUIRED_SOUL_FILES) {
    const filePath = join(configPath, file);
    if (existsSync(filePath)) {
      existingFiles.push(file);
    } else {
      missingFiles.push(file);
    }
  }

  // Bootstrap only if NO files exist
  // If some files exist, assume user is manually setting up
  const needsBootstrap = existingFiles.length === 0;
  const isPartialSetup = existingFiles.length > 0 && missingFiles.length > 0;

  return {
    needsBootstrap,
    existingFiles,
    missingFiles,
    configPath,
    isPartialSetup,
  };
}

/**
 * Check if setup is complete (all required files exist)
 */
export function isSetupComplete(configPath: string): boolean {
  return REQUIRED_SOUL_FILES.every((file) => existsSync(join(configPath, file)));
}

/**
 * Get a message describing the current bootstrap state
 */
export function getBootstrapMessage(status: BootstrapStatus): string {
  if (!status.needsBootstrap && status.missingFiles.length === 0) {
    return "Soul configuration is complete.";
  }

  if (status.isPartialSetup) {
    return `Partial setup detected. Missing files: ${status.missingFiles.join(", ")}`;
  }

  if (status.needsBootstrap) {
    return "No soul configuration found. Bootstrap required.";
  }

  return "Soul configuration status unknown.";
}

/**
 * Bootstrap state for workflow
 */
export interface BootstrapState {
  step: "identity" | "user" | "soul" | "complete";
  identity: {
    name?: string;
    creature?: string;
    emoji?: string;
    vibe?: string;
    description?: string;
    voice?: string;
  };
  user: {
    name?: string;
    timezone?: string;
    pronouns?: string;
    preferences?: string[];
    context?: string;
    goals?: string[];
  };
  soul: {
    coreTruths?: string[];
    boundaries?: string[];
    vibe?: string;
    continuity?: string;
  };
}

/**
 * Initial bootstrap state
 */
export const INITIAL_BOOTSTRAP_STATE: BootstrapState = {
  step: "identity",
  identity: {},
  user: {},
  soul: {},
};
