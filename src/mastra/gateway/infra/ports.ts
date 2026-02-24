// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import net from "node:net";

export class PortInUseError extends Error {
  port: number;
  process: string;
  constructor(port: number, process: string) {
    super(`Port ${port} is already in use by ${process}`);
    this.name = "PortInUseError";
    this.port = port;
    this.process = process;
  }
}

/**
 * Check if a TCP port is available. Throws PortInUseError if occupied.
 */
export async function ensurePortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new PortInUseError(port, "unknown"));
      } else {
        reject(err);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve());
    });
  });
}
