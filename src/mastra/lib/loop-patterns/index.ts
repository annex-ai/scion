// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Loop Pattern Registry
 *
 * Provides switchable orchestration patterns for the agent loop.
 * The pattern is selected via [loop] pattern in agent.toml.
 */

import { getAgentSwarmInstructions } from "./agent-swarm";
import { getAgentTeamInstructions } from "./agent-team";
import { getKimiLoopInstructions } from "./kimi-loop";
import { getRalphLoopInstructions } from "./ralph-loop";
import { getTaskBasedInstructions } from "./task-based";

export function getPatternInstructions(pattern: string): string {
  switch (pattern) {
    case "task-based":
      return getTaskBasedInstructions();
    case "ralph-loop":
      return getRalphLoopInstructions();
    case "agent-swarm":
      return getAgentSwarmInstructions();
    case "agent-team":
      return getAgentTeamInstructions();
    case "kimi-loop":
      return getKimiLoopInstructions();
    default:
      return getKimiLoopInstructions();
  }
}
