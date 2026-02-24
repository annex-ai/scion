// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Get the current machine's Tailscale hostname for use in public URLs.
 * Falls back to empty string if Tailscale is not available.
 */
export async function getTailnetHostname(): Promise<string> {
  try {
    const { stdout } = await execAsync("tailscale status --json", { timeout: 5_000 });
    const status = JSON.parse(stdout);
    const self = status.Self;
    if (self?.DNSName) {
      return self.DNSName.replace(/\.$/, "");
    }
    return self?.HostName ?? "";
  } catch {
    return "";
  }
}
