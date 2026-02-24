// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Save Interaction Workflow
 *
 * Workflow that saves the current conversation as an interaction file
 * and starts a new thread. Used by the /new command.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  type InteractionMetadata,
  calculateDuration,
  formatInteractionDate,
  formatMessagesAsMarkdown,
  generateInteractionFilename,
  slugify,
} from "../lib/utils/interaction-formatter";

// ============================================================================
// Schemas
// ============================================================================

const inputSchema = z.object({
  threadId: z.string().describe("Current thread ID"),
  resourceId: z.string().describe("User resource ID"),
  messageCount: z.number().default(50).describe("Number of messages to save"),
  interactionsDir: z.string().default("./interactions").describe("Directory to save interactions"),
  customSlug: z.string().optional().describe("Optional custom slug (otherwise LLM-generated)"),
});

const outputSchema = z.object({
  success: z.boolean(),
  interactionFile: z.string().optional().describe("Path to saved interaction file"),
  newThreadId: z.string().optional().describe("ID of the new thread"),
  messagesSaved: z.number().describe("Number of messages saved"),
  error: z.string().optional(),
});

// ============================================================================
// Main Step
// ============================================================================

const saveInteractionStep = createStep({
  id: "save-interaction-step",
  description: "Save interaction to file and create new thread",
  inputSchema,
  outputSchema,

  execute: async ({ inputData }) => {
    const { threadId, resourceId, interactionsDir, customSlug } = inputData;

    try {
      // Ensure directory exists
      if (!existsSync(interactionsDir)) {
        await mkdir(interactionsDir, { recursive: true });
      }

      // Generate slug
      const timestamp = Date.now();
      const slug = customSlug ? slugify(customSlug) : `session-${timestamp}`;

      // Generate filename
      const date = new Date();
      const filename = generateInteractionFilename(date, slug);
      const filePath = join(interactionsDir, filename);

      // Build metadata
      const metadata: InteractionMetadata = {
        date: formatInteractionDate(date),
        slug,
        threadId,
        resourceId,
        messageCount: 0, // Placeholder - would be populated from memory
        summary: "Session saved",
      };

      // Create placeholder content
      const content = `---
date: "${metadata.date}"
slug: "${metadata.slug}"
thread_id: "${metadata.threadId}"
resource_id: "${metadata.resourceId}"
message_count: ${metadata.messageCount}
---

# Interaction: ${metadata.slug}

**Date**: ${metadata.date}

---

*Interaction saved.*
`;

      await writeFile(filePath, content, "utf-8");

      // Generate new thread ID
      const newThreadId = `thread-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;

      console.log(`[SaveInteraction] Saved to ${filePath}, new thread: ${newThreadId}`);

      return {
        success: true,
        interactionFile: filePath,
        newThreadId,
        messagesSaved: metadata.messageCount,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[SaveInteraction] Failed:", errorMsg);

      return {
        success: false,
        messagesSaved: 0,
        error: errorMsg,
      };
    }
  },
});

// ============================================================================
// Workflow
// ============================================================================

export const saveInteractionWorkflow = createWorkflow({
  id: "save-interaction",
  description: "Save current conversation to file and start new thread",
  inputSchema,
  outputSchema,
})
  .then(saveInteractionStep)
  .commit();

// ============================================================================
// Exports
// ============================================================================

export type SaveInteractionInput = z.infer<typeof inputSchema>;
export type SaveInteractionOutput = z.infer<typeof outputSchema>;
