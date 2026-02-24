// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Bootstrap Workflow
 *
 * Simple workflow for setting up soul configuration files when none exist.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { getBootstrapStatus } from "../lib/bootstrap/check";
import { AGENT_DIR } from "../lib/config";

// ============================================================================
// Schemas
// ============================================================================

const inputSchema = z.object({
  configPath: z.string().default(AGENT_DIR),
  identity: z
    .object({
      name: z.string().optional(),
      creature: z.string().optional(),
      emoji: z.string().optional(),
      vibe: z.string().optional(),
    })
    .optional(),
  user: z
    .object({
      name: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});

const outputSchema = z.object({
  success: z.boolean(),
  filesCreated: z.array(z.string()),
  skipped: z.boolean().optional(),
  error: z.string().optional(),
});

// ============================================================================
// Main Step
// ============================================================================

const bootstrapStep = createStep({
  id: "bootstrap-step",
  description: "Create soul configuration files",
  inputSchema,
  outputSchema,

  execute: async ({ inputData }) => {
    const { configPath, identity, user } = inputData;

    // Check if bootstrap is needed
    const status = getBootstrapStatus(configPath);
    if (!status.needsBootstrap) {
      return {
        success: true,
        filesCreated: [],
        skipped: true,
      };
    }

    try {
      // Ensure config directory exists
      if (!existsSync(configPath)) {
        await mkdir(configPath, { recursive: true });
      }

      const filesCreated: string[] = [];

      // Write IDENTITY.md
      const identityContent = `# Identity

**Name**: ${identity?.name || "Agent"}
**Creature**: ${identity?.creature || "AI Assistant"}
**Emoji**: ${identity?.emoji || "🤖"}
**Vibe**: ${identity?.vibe || "Helpful and friendly"}

# Description

${identity?.name || "Agent"} is a ${identity?.creature || "helpful assistant"}.

# Voice

Speaks clearly and helpfully, adapting to the context of the conversation.
`;

      await writeFile(join(configPath, "IDENTITY.md"), identityContent);
      filesCreated.push("IDENTITY.md");

      // Write USER.md
      const userContent = `# User

**Name**: ${user?.name || "User"}
**Timezone**: ${user?.timezone || "UTC"}

# Preferences

- Clear, helpful responses

# Context

A user working with AI assistants.

# Goals

- Get things done efficiently
`;

      await writeFile(join(configPath, "USER.md"), userContent);
      filesCreated.push("USER.md");

      // Write SOUL.md
      const soulContent = `# Core Truths

- Clarity enables understanding; understanding enables progress
- Every question deserves a thoughtful response
- Mistakes are learning opportunities, not failures

# Boundaries

- Be honest about limitations and uncertainties
- Respect user autonomy in making decisions
- Avoid over-engineering or unnecessary complexity

# Vibe

A helpful presence that balances professionalism with warmth.

# Continuity

Maintain awareness of ongoing work across conversations.
`;

      await writeFile(join(configPath, "SOUL.md"), soulContent);
      filesCreated.push("SOUL.md");

      console.log(`[Bootstrap] Created ${filesCreated.length} files in ${configPath}`);

      return {
        success: true,
        filesCreated,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[Bootstrap] Failed:", errorMsg);

      return {
        success: false,
        filesCreated: [],
        error: errorMsg,
      };
    }
  },
});

// ============================================================================
// Workflow
// ============================================================================

export const bootstrapWorkflow = createWorkflow({
  id: "bootstrap",
  description: "Interactive setup for soul configuration files",
  inputSchema,
  outputSchema,
})
  .then(bootstrapStep)
  .commit();

// ============================================================================
// Exports
// ============================================================================

export type BootstrapInput = z.infer<typeof inputSchema>;
export type BootstrapOutput = z.infer<typeof outputSchema>;
