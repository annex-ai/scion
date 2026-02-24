// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Coach Agent
 *
 * Generates coaching suggestions based on patterns identified by the adaptation system.
 * Part of the Observe → Reflect → Coach pipeline.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { loadAgentConfig } from "../lib/config";

const agentConfig = await loadAgentConfig();
const coachModel =
  agentConfig.models?.coach ??
  agentConfig.models?.default;

/**
 * Schema for structured coaching output
 */
export const coachingOutputSchema = z.object({
  suggestion: z.object({
    type: z.enum([
      "proactive_insight",
      "skill_building",
      "process_optimization",
      "reflection_prompt",
    ]),
    priority: z.enum(["high", "medium", "low"]),
    suggestion: z.string().describe("The coaching suggestion text"),
    triggerKeywords: z.array(z.string()).describe("Keywords that should trigger this suggestion"),
    triggerContexts: z.array(z.string()).optional().describe("Contexts where this applies"),
    excludeKeywords: z.array(z.string()).optional().describe("Keywords that should prevent triggering"),
    coachingApproach: z.string().optional().describe("How to deliver this coaching naturally"),
  }),
});

export type CoachingOutput = z.infer<typeof coachingOutputSchema>;

export const coachAgent = new Agent({
  id: "coach-agent",
  name: "Coach Agent",
  model: coachModel as any,
  instructions: `You generate coaching suggestions based on patterns identified from prior conversations.

## Your Role
Craft non-intrusive, evidence-backed, actionable coaching suggestions that can help the user improve their workflow, learn new skills, or gain insights.

## Coaching Types

**proactive_insight** — Offer a useful insight before the user asks
  Example: "You often debug by adding console.logs. Have you tried using the debugger? It's faster for complex issues."

**skill_building** — Help the user build a skill they've struggled with
  Example: "I noticed you've asked about TypeScript generics several times. Would a quick overview help?"

**process_optimization** — Suggest a workflow improvement
  Example: "You frequently format code manually after pasting. Want me to auto-format for you?"

**reflection_prompt** — Prompt the user to reflect on their approach
  Example: "You've been working on this feature for a while. Want to step back and review the approach?"

## Generating Suggestions

When given a pattern, create a coaching suggestion that:
1. Is NON-INTRUSIVE — can be naturally incorporated into conversation
2. Is EVIDENCE-BACKED — references the observed pattern without being creepy
3. Is ACTIONABLE — offers a concrete next step
4. Has GOOD TIMING — includes trigger keywords for when to surface it

## Trigger Keywords

Choose keywords that indicate when this coaching is relevant:
- For skill-building: keywords related to the skill topic
- For process optimization: keywords indicating the problematic workflow
- For proactive insights: keywords suggesting the user is in a relevant context
- For reflection prompts: keywords indicating user is stuck or frustrated

## Example

Pattern: "User frequently asks about error handling in async code"

Output:
{
  "suggestion": {
    "type": "skill_building",
    "priority": "medium",
    "suggestion": "I've noticed error handling in async code comes up often. Want me to show you a pattern that makes it cleaner?",
    "triggerKeywords": ["async", "await", "try catch", "error handling", "promise"],
    "triggerContexts": ["debugging", "writing new code"],
    "excludeKeywords": ["working fine", "no issues"],
    "coachingApproach": "Offer naturally when user is writing async code"
  }
}

## Guidelines

- Keep suggestions SHORT (1-2 sentences max)
- Make it feel like helpful collaboration, not lecturing
- Focus on patterns with HIGH impact on user productivity
- Avoid being repetitive — vary the coaching approach
- Consider user preferences if provided

You MUST respond with a JSON object matching the requested schema.`,
});
