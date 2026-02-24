// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { describe, expect, mock, test } from "bun:test";
import { GatewayServer } from "../server";

describe("GatewayServer accessors", () => {
  test("getChannelByType returns undefined when no channels", () => {
    const server = new GatewayServer();
    expect(server.getChannelByType("slack")).toBeUndefined();
  });

  test("getAdapter returns null when not started", () => {
    const server = new GatewayServer();
    expect(server.getAdapter()).toBeNull();
  });

  test("getChannelStatuses returns empty array when no channels", () => {
    const server = new GatewayServer();
    expect(server.getChannelStatuses()).toEqual([]);
  });

  test("getCronService returns null when not started", () => {
    const server = new GatewayServer();
    expect(server.getCronService()).toBeNull();
  });

  test("getConnectedChannels returns empty when not started", () => {
    const server = new GatewayServer();
    expect(server.getConnectedChannels()).toEqual([]);
  });

  test("isRunning returns false when not started", () => {
    const server = new GatewayServer();
    expect(server.isRunning()).toBe(false);
  });
});
