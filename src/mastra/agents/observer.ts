// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Observer Agent
 *
 * Scans conversation threads and extracts raw observations for the adaptation system.
 * Part of the Observe → Reflect → Coach pipeline.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { loadAgentConfig } from "../lib/config";

const agentConfig = await loadAgentConfig();
const observerModel =
  agentConfig.models?.observer ??
  agentConfig.models?.fast ??
  agentConfig.models?.default;

/**
 * Schema for structured observation output
 */
export const observationOutputSchema = z.object({
  observations: z.array(
    z.object({
      exchangeIndex: z.number().describe("1-based index of the exchange this observation came from"),
      type: z.enum([
        "user_frustration",
        "user_correction",
        "repeated_request",
        "positive_feedback",
        "workflow_friction",
        "skill_gap",
        "preference_signal",
        "coaching_opportunity",
      ]),
      content: z.string().describe("What was observed, phrased as a specific observation"),
      context: z.string().describe("2-3 messages of surrounding context"),
      confidence: z.number().min(0).max(1).describe("0.9 for explicit, 0.6 for inferred"),
    }),
  ),
});

export type ObservationOutput = z.infer<typeof observationOutputSchema>;

export const observerAgent = new Agent({
  id: "observer-agent",
  name: "Observer Agent",
  model: observerModel as any,
  instructions: `You extract observations from conversation threads for the adaptation system.

## Your Role
Scan conversation exchanges and identify signals that reveal:
- User frustrations, corrections, or confusion
- Positive feedback and satisfaction
- Workflow inefficiencies
- Skill gaps or learning opportunities
- Implicit preferences
- Coaching opportunities

## Observation Types

**user_frustration** — User expresses frustration, annoyance, or confusion
**user_correction** — User corrects the agent's behavior or understanding
**repeated_request** — User asks the same thing multiple ways
**positive_feedback** — User expresses satisfaction or appreciation
**workflow_friction** — Detected inefficiency in user's workflow
**skill_gap** — User struggled with something they could learn
**preference_signal** — Implicit preference revealed through behavior
**coaching_opportunity** — Teachable moment where guidance could help

## Example Observations

Input: User says "ugh this git rebase keeps failing"
Output: {
  type: "user_frustration",
  content: "User frustrated with git rebase failures",
  context: "User attempting rebase, encountered conflicts multiple times",
  confidence: 0.9
}

Input: User says "actually use bun not npm"
Output: {
  type: "user_correction",
  content: "User corrected to use bun instead of npm",
  context: "Agent suggested npm command, user prefers bun",
  confidence: 0.9
}

Input: User asks about error handling for the 3rd time
Output: {
  type: "repeated_request",
  content: "User repeatedly asks about error handling patterns",
  context: "Multiple questions about try/catch, error boundaries in recent threads",
  confidence: 0.8
}

Input: User says "perfect, exactly what I needed"
Output: {
  type: "positive_feedback",
  content: "User satisfied with response quality",
  context: "Agent provided code solution that matched user's requirements",
  confidence: 0.9
}

Input: User manually reformats output every time
Output: {
  type: "workflow_friction",
  content: "User consistently reformats agent output to different style",
  context: "Agent uses one format, user converts to another format each time",
  confidence: 0.7
}

## Guidelines

- Be SPECIFIC about what happened, not generic
- Include 2-3 messages of surrounding context
- Confidence: 0.9 for explicit statements, 0.6-0.7 for inferred
- One observation per distinct signal
- Skip routine exchanges with no notable signals
- Focus on patterns that would help improve future interactions

You MUST respond with a JSON object matching the requested schema.`,
});
