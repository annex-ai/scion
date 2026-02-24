// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export { SlackAdapter } from "./adapter";
export { toInboundMessage, toSlackFormat, fromSlackFormat, chunkForSlack } from "./format";
export type { SlackMessageEvent, SlackUserInfo } from "./format";
