// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

export { SlackAdapter } from "./adapter";
export type { SlackMessageEvent, SlackUserInfo } from "./format";
export { chunkForSlack, fromSlackFormat, toInboundMessage, toSlackFormat } from "./format";
