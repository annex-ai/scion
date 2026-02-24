// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Ask User Question Tool
 *
 * This tool allows agents to ask clarifying questions to users during execution.
 * In Mastra Studio, this creates a human-in-the-loop (HITL) interaction where
 * the workflow pauses until the user provides input.
 *
 * Note: True interactivity requires the Mastra UI or a custom frontend that
 * handles tool approval flows. In headless mode, this tool will timeout.
 */

const questionOptionSchema = z.object({
  label: z.string().describe("Display text for this option"),
  description: z.string().optional().describe("Optional description explaining the option"),
});

export const askUserTool = createTool({
  id: "ask-user",
  inputSchema: z.object({
    question: z.string().describe("The question to ask the user"),
    options: z
      .array(questionOptionSchema)
      .optional()
      .describe("Optional list of predefined options for the user to choose from"),
    multiSelect: z.boolean().optional().default(false).describe("Allow selecting multiple options (default: false)"),
    context: z.string().optional().describe("Additional context to help the user understand the question"),
  }),
  outputSchema: z.object({
    response: z.string().describe("User response text"),
    selectedOptions: z.array(z.string()).optional().describe("Selected option labels (if options were provided)"),
    answered: z.boolean().describe("Whether the user provided an answer"),
    skipped: z.boolean().describe("Whether the user skipped the question"),
  }),
  description:
    "Asks the user a clarifying question and waits for their response. Accepts a question string, optional predefined options, and context. Returns the user response text and selected options. Use this tool when you need human input to make a decision, clarify ambiguous requirements, or get confirmation before proceeding with an action. Creates a human-in-the-loop interaction point.",
  // Mark this tool as requiring human approval (HITL)
  execute: async ({ question, options, multiSelect, context }) => {
    // In Mastra, HITL tools work by:
    // 1. The tool execution returns a "pending" state
    // 2. The UI shows the question to the user
    // 3. User provides input via addToolResult()
    // 4. The tool execution continues with the user's response

    // For now, this is a placeholder that demonstrates the expected interface.
    // In production, this would integrate with Mastra's HITL flow.

    // Format the question for display
    let formattedQuestion = question;

    if (context) {
      formattedQuestion = `${context}\n\n${question}`;
    }

    if (options && options.length > 0) {
      formattedQuestion += "\n\nOptions:\n";
      options.forEach((opt, i) => {
        formattedQuestion += `${i + 1}. ${opt.label}`;
        if (opt.description) {
          formattedQuestion += ` - ${opt.description}`;
        }
        formattedQuestion += "\n";
      });

      if (multiSelect) {
        formattedQuestion += "\n(Select multiple options by separating numbers with commas)";
      }
    }

    // Log the question (for debugging/visibility)
    console.log("\n[ASK USER TOOL]");
    console.log("================");
    console.log(formattedQuestion);
    console.log("================\n");

    // In a real HITL implementation, this would suspend and wait for user input.
    // For now, return a response indicating the tool needs user interaction.
    return {
      response: `[Awaiting user response to: "${question}"]`,
      selectedOptions: [],
      answered: false,
      skipped: false,
    };
  },
});
