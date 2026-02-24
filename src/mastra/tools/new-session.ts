// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * New Session Tool
 *
 * Saves the current conversation as an interaction file and starts a new thread.
 * This is different from the scheduler's session management - this is for
 * user-triggered session switching via /new command.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  type InteractionMetadata,
  calculateDuration,
  formatInteractionDate,
  formatMessagesAsMarkdown,
  generateInteractionFilename,
  slugify,
} from "../lib/utils/interaction-formatter";

/**
 * Input schema for new session tool
 */
const NewSessionInputSchema = z.object({
  customSlug: z
    .string()
    .optional()
    .describe("Optional custom name for the saved interaction (otherwise auto-generated)"),

  saveInteraction: z
    .boolean()
    .default(true)
    .describe("Whether to save the current conversation before starting new session"),

  summary: z.string().optional().describe("Optional summary of what was accomplished in this session"),
});

type NewSessionInput = z.infer<typeof NewSessionInputSchema>;

/**
 * New Session Tool
 *
 * Use this tool when the user wants to:
 * - Start a fresh conversation (/new command)
 * - Archive the current conversation
 * - Switch context to a different topic
 */
export const newSessionTool = createTool({
  id: "new-session",
  description: `Start a new conversation session.

This tool:
1. Saves the current conversation to interactions/ directory (optional)
2. Creates a new thread for future messages
3. Returns the new thread ID

Use when:
- User says "/new" or "start fresh"
- User wants to switch to a different topic
- Conversation has reached a natural conclusion

The saved interaction file can be referenced later for context.`,

  inputSchema: NewSessionInputSchema,

  outputSchema: z.object({
    success: z.boolean(),
    newThreadId: z.string().optional(),
    savedInteraction: z
      .object({
        filePath: z.string(),
        messageCount: z.number(),
      })
      .optional(),
    message: z.string(),
  }),

  execute: async (input) => {
    const interactionsDir = process.env.INTERACTIONS_DIR || "./interactions";

    // For simplified version, we don't have access to context in tools
    // These would be populated from a higher-level orchestration
    const threadId = "unknown";
    const resourceId = "unknown";

    // For now, we'll create a placeholder interaction file
    // In a full implementation, this would access memory to get messages

    const timestamp = Date.now();
    const slug = input.customSlug ? slugify(input.customSlug) : `session-${timestamp}`;

    let savedInteraction = undefined;

    if (input.saveInteraction) {
      try {
        // Ensure directory exists
        if (!existsSync(interactionsDir)) {
          await mkdir(interactionsDir, { recursive: true });
        }

        // Create metadata
        const date = new Date();
        const filename = generateInteractionFilename(date, slug);
        const filePath = join(interactionsDir, filename);

        const metadata: InteractionMetadata = {
          date: formatInteractionDate(date),
          slug,
          threadId,
          resourceId,
          messageCount: 0, // Would be populated from memory
          summary: input.summary,
        };

        // Create a placeholder file
        // In full implementation, this would format actual messages
        const content = `---
date: "${metadata.date}"
slug: "${metadata.slug}"
thread_id: "${metadata.threadId}"
resource_id: "${metadata.resourceId}"
message_count: ${metadata.messageCount}
${metadata.summary ? `summary: "${metadata.summary}"` : ""}
---

# Interaction: ${metadata.slug}

**Date**: ${metadata.date}
${metadata.summary ? `\n> ${metadata.summary}\n` : ""}

---

*Interaction saved. Messages not included in this placeholder.*
`;

        await writeFile(filePath, content, "utf-8");

        savedInteraction = {
          filePath,
          messageCount: metadata.messageCount,
        };

        console.log(`[NewSession] Saved interaction to ${filePath}`);
      } catch (error) {
        console.error("[NewSession] Failed to save interaction:", error);
        // Continue even if save fails
      }
    }

    // Generate new thread ID
    const newThreadId = `thread-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      success: true,
      newThreadId,
      savedInteraction,
      message: savedInteraction
        ? `Started new session. Previous conversation saved to ${savedInteraction.filePath}`
        : "Started new session.",
    };
  },
});
