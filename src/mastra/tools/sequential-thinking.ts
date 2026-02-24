// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Represents a single thought in the sequential thinking process
 */
interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision: boolean;
  revisesThought: number | null;
  branchId: string | null;
  branchFromThought?: number;
  timestamp: string;
}

/**
 * Module-level state management for session-based thought tracking
 * Each session maintains an independent thoughtHistory and branches record
 */
const sessionThoughtHistory = new Map<string, ThoughtData[]>();
const sessionBranches = new Map<string, Record<string, ThoughtData[]>>();

/**
 * Calculate progress percentage for current thought
 */
function calculateProgress(current: number, total: number): string {
  const percentage = Math.round((current / total) * 100);
  return `${current}/${total} (${percentage}%)`;
}

/**
 * Format thinking output as markdown with metadata
 */
function formatThinkingOutput(
  thought: string,
  thoughtNumber: number,
  totalThoughts: number,
  nextThoughtNeeded: boolean,
  isRevision: boolean,
  revisesThought: number | null,
  branchId: string | null,
  historyLength: number,
  activeBranches: string[],
  sessionId: string,
  timestamp: string,
): string {
  const progress = calculateProgress(thoughtNumber, totalThoughts);
  const status = nextThoughtNeeded ? "Continuing (next thought needed)" : "Complete";
  const type = isRevision
    ? `Revision (of thought ${revisesThought})`
    : branchId
      ? `Branch (${branchId})`
      : "Sequential analysis";

  return `## Thought ${progress}

${thought}

**Metadata:**
- Progress: ${thoughtNumber} of ${totalThoughts} thoughts (${Math.round((thoughtNumber / totalThoughts) * 100)}% complete)
- Status: ${status}
- Type: ${type}
- History: ${historyLength} thoughts recorded
${activeBranches.length > 0 ? `- Active Branches: ${activeBranches.join(", ")}` : ""}
- Session: ${sessionId}
- Timestamp: ${timestamp}

---
${nextThoughtNeeded ? "*Use sequential-thinking tool for next step*" : "*Analysis complete*"}`;
}

/**
 * Initialize session state if it doesn't exist
 */
function getOrInitSession(sessionId: string): void {
  if (!sessionThoughtHistory.has(sessionId)) {
    sessionThoughtHistory.set(sessionId, []);
    sessionBranches.set(sessionId, {});
  }
}

/**
 * Append thought to session history or branch
 */
function appendThought(sessionId: string, thoughtData: ThoughtData): void {
  const { branchId } = thoughtData;

  if (branchId) {
    // Append to branch
    const branches = sessionBranches.get(sessionId)!;
    if (!branches[branchId]) {
      branches[branchId] = [];
    }
    branches[branchId].push(thoughtData);
  } else {
    // Append to main history
    const history = sessionThoughtHistory.get(sessionId)!;
    history.push(thoughtData);
  }
}

/**
 * Get list of active branch IDs for a session
 */
function getActiveBranches(sessionId: string): string[] {
  const branches = sessionBranches.get(sessionId);
  return branches ? Object.keys(branches) : [];
}

/**
 * Sequential Thinking Tool
 *
 * Enables structured, step-by-step problem analysis with support for:
 * - Sequential thought progression with dynamic planning
 * - Thought revision (correcting earlier assumptions)
 * - Branching (exploring alternative approaches)
 * - Session-based state management
 *
 * Each session maintains an independent thoughtHistory array and branches record.
 */
export const sequentialThinkingTool = createTool({
  id: "sequential-thinking",
  inputSchema: z.object({
    thought: z.string().describe("Current thinking step content"),
    thoughtNumber: z.number().min(1).describe("Current step number (1-indexed)"),
    totalThoughts: z.number().min(1).describe("Estimated total steps needed (can be adjusted dynamically)"),
    nextThoughtNeeded: z.boolean().describe("Whether another thought step is required"),
    isRevision: z.boolean().optional().default(false).describe("Whether this thought revises a previous one"),
    revisesThought: z
      .number()
      .optional()
      .describe("Which thought number is being reconsidered (required if isRevision is true)"),
    branchFromThought: z.number().optional().describe("Thought number to branch from (for exploring alternatives)"),
    branchId: z.string().optional().describe("Branch identifier for alternative reasoning path"),
    sessionId: z.string().optional().default("default").describe("Session identifier for multi-session tracking"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether the operation succeeded"),
    message: z.string().describe("Human-readable summary message"),
    formattedThinking: z.string().describe("Markdown-formatted thought output with metadata"),
    metadata: z.object({
      thoughtNumber: z.number().describe("Current thought number"),
      totalThoughts: z.number().describe("Total thoughts estimated"),
      progress: z.string().describe('Progress indicator (e.g., "3/5 (60%)")'),
      nextThoughtNeeded: z.boolean().describe("Whether more thoughts are needed"),
      isRevision: z.boolean().describe("Whether this was a revision"),
      revisesThought: z.number().nullable().describe("Which thought was revised (null if not a revision)"),
      branchId: z.string().nullable().describe("Branch identifier (null if main sequence)"),
      timestamp: z.string().describe("ISO timestamp of thought creation"),
      historyLength: z.number().describe("Number of thoughts in main history"),
      activeBranches: z.array(z.string()).describe("List of active branch identifiers"),
    }),
  }),
  description: `Structured step-by-step problem analysis with session-based thought history.

Use this tool for complex analysis requiring sequential reasoning:
- Break down problems into manageable thinking steps
- Dynamically adjust the total number of steps as understanding deepens
- Revise earlier thoughts when new insights emerge
- Explore alternative approaches through branching

The tool maintains session state:
- thoughtHistory: Array of all sequential thoughts in main reasoning path
- branches: Record of branched thoughts for alternative explorations
- Each session is isolated by sessionId (default: "default")

Parameters:
- thought: The current thinking step content
- thoughtNumber: Current step (1-indexed)
- totalThoughts: Estimated total (can change between calls)
- nextThoughtNeeded: Whether to continue thinking
- isRevision: Set true when correcting a previous thought
- revisesThought: Which thought number is being revised (required if isRevision)
- branchFromThought: Divergence point for alternative reasoning
- branchId: Identifier for the branch (required if branching)
- sessionId: Session identifier (optional, defaults to "default")

Returns formatted markdown output with progress indicators and metadata.`,
  execute: async ({
    thought,
    thoughtNumber,
    totalThoughts,
    nextThoughtNeeded,
    isRevision = false,
    revisesThought = null,
    branchFromThought,
    branchId = null,
    sessionId = "default",
  }) => {
    try {
      // Validate parameters
      if (thoughtNumber > totalThoughts) {
        return {
          success: false,
          message: `Invalid parameters: thoughtNumber (${thoughtNumber}) cannot exceed totalThoughts (${totalThoughts})`,
          formattedThinking: "",
          metadata: {
            thoughtNumber,
            totalThoughts,
            progress: calculateProgress(thoughtNumber, totalThoughts),
            nextThoughtNeeded,
            isRevision,
            revisesThought,
            branchId,
            timestamp: new Date().toISOString(),
            historyLength: 0,
            activeBranches: [],
          },
        };
      }

      if (isRevision && !revisesThought) {
        return {
          success: false,
          message: "Invalid parameters: revisesThought is required when isRevision is true",
          formattedThinking: "",
          metadata: {
            thoughtNumber,
            totalThoughts,
            progress: calculateProgress(thoughtNumber, totalThoughts),
            nextThoughtNeeded,
            isRevision,
            revisesThought,
            branchId,
            timestamp: new Date().toISOString(),
            historyLength: 0,
            activeBranches: [],
          },
        };
      }

      if (isRevision && revisesThought && revisesThought >= thoughtNumber) {
        return {
          success: false,
          message: `Invalid parameters: revisesThought (${revisesThought}) must be less than thoughtNumber (${thoughtNumber})`,
          formattedThinking: "",
          metadata: {
            thoughtNumber,
            totalThoughts,
            progress: calculateProgress(thoughtNumber, totalThoughts),
            nextThoughtNeeded,
            isRevision,
            revisesThought,
            branchId,
            timestamp: new Date().toISOString(),
            historyLength: 0,
            activeBranches: [],
          },
        };
      }

      if (branchFromThought && branchFromThought >= thoughtNumber) {
        return {
          success: false,
          message: `Invalid parameters: branchFromThought (${branchFromThought}) must be less than thoughtNumber (${thoughtNumber})`,
          formattedThinking: "",
          metadata: {
            thoughtNumber,
            totalThoughts,
            progress: calculateProgress(thoughtNumber, totalThoughts),
            nextThoughtNeeded,
            isRevision,
            revisesThought,
            branchId,
            timestamp: new Date().toISOString(),
            historyLength: 0,
            activeBranches: [],
          },
        };
      }

      // Initialize or retrieve session state
      getOrInitSession(sessionId);

      // Create thought data
      const timestamp = new Date().toISOString();
      const thoughtData: ThoughtData = {
        thought,
        thoughtNumber,
        totalThoughts,
        isRevision,
        revisesThought,
        branchId,
        branchFromThought,
        timestamp,
      };

      // Append to history or branch
      appendThought(sessionId, thoughtData);

      // Get state metadata
      const historyLength = sessionThoughtHistory.get(sessionId)!.length;
      const activeBranches = getActiveBranches(sessionId);

      // Format output
      const formattedThinking = formatThinkingOutput(
        thought,
        thoughtNumber,
        totalThoughts,
        nextThoughtNeeded,
        isRevision,
        revisesThought,
        branchId,
        historyLength,
        activeBranches,
        sessionId,
        timestamp,
      );

      const progress = calculateProgress(thoughtNumber, totalThoughts);
      const message = nextThoughtNeeded
        ? `Recorded thought ${thoughtNumber}/${totalThoughts}. Continue thinking.`
        : `Recorded thought ${thoughtNumber}/${totalThoughts}. Analysis complete.`;

      return {
        success: true,
        message,
        formattedThinking,
        metadata: {
          thoughtNumber,
          totalThoughts,
          progress,
          nextThoughtNeeded,
          isRevision,
          revisesThought,
          branchId,
          timestamp,
          historyLength,
          activeBranches,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Error processing thought: ${error.message}`,
        formattedThinking: "",
        metadata: {
          thoughtNumber,
          totalThoughts,
          progress: calculateProgress(thoughtNumber, totalThoughts),
          nextThoughtNeeded,
          isRevision,
          revisesThought,
          branchId,
          timestamp: new Date().toISOString(),
          historyLength: 0,
          activeBranches: [],
        },
      };
    }
  },
});

/**
 * Utility: Retrieve thought history for a session
 * @param sessionId Session identifier (default: "default")
 * @returns Array of ThoughtData objects in main history (excludes branches)
 */
export function getThoughtHistory(sessionId = "default"): ThoughtData[] {
  return sessionThoughtHistory.get(sessionId) || [];
}

/**
 * Utility: Retrieve branches for a session
 * @param sessionId Session identifier (default: "default")
 * @returns Record of branch IDs to ThoughtData arrays
 */
export function getBranches(sessionId = "default"): Record<string, ThoughtData[]> {
  return sessionBranches.get(sessionId) || {};
}

/**
 * Utility: Clear session state
 * @param sessionId Session identifier (default: "default")
 */
export function clearSession(sessionId = "default"): void {
  sessionThoughtHistory.delete(sessionId);
  sessionBranches.delete(sessionId);
}

/**
 * Utility: Get all active session IDs
 * @returns Array of session identifiers
 */
export function getActiveSessions(): string[] {
  return Array.from(sessionThoughtHistory.keys());
}

/**
 * Options for mermaid diagram generation
 */
interface GenerateMermaidDiagramOptions {
  includeMetadata?: boolean; // Add session info as comments
  includeTimestamps?: boolean; // Add timestamps to labels
  styling?: "minimal" | "detailed"; // Color/no-color (default: 'detailed')
}

/**
 * Format thought label with special character escaping
 */
function formatThoughtLabel(thought: ThoughtData, options: GenerateMermaidDiagramOptions): string {
  const { includeTimestamps = false } = options;

  // Use full thought content (no truncation)
  let content = thought.thought.trim();

  // Escape special mermaid characters
  content = content.replace(/"/g, "&quot;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/\n/g, "<br/>"); // Preserve line breaks with <br/>

  // Build label
  let label = `${thought.thoughtNumber}: ${content}`;

  if (includeTimestamps) {
    const time = new Date(thought.timestamp).toLocaleTimeString();
    label = `${label}<br/><small>${time}</small>`;
  }

  return label;
}

/**
 * Generate mermaid flowchart diagram from sequential thinking session
 *
 * Creates visual representation of:
 * - Sequential thoughts (solid edges)
 * - Revisions (dashed edges with "revises N" labels)
 * - Branches (subgraphs with divergence edges)
 *
 * @param sessionId Session identifier (default: "default")
 * @param options Diagram generation options
 * @returns Mermaid diagram string (flowchart TD format)
 */
export function generateMermaidDiagram(sessionId = "default", options: GenerateMermaidDiagramOptions = {}): string {
  const { includeMetadata = true, includeTimestamps = false, styling = "detailed" } = options;

  // Get session data
  const history = sessionThoughtHistory.get(sessionId) || [];
  const branches = sessionBranches.get(sessionId) || {};

  // Initialize graph components
  const nodes: string[] = [];
  const edges: string[] = [];
  const subgraphs: string[] = [];
  const styles: string[] = [];

  // Metadata header
  let diagram = "flowchart TD\n\n";

  if (includeMetadata) {
    const branchCount = Object.keys(branches).length;
    diagram += `%% Session: ${sessionId}\n`;
    diagram += `%% Generated: ${new Date().toISOString()}\n`;
    diagram += `%% Thoughts: ${history.length}\n`;
    diagram += `%% Branches: ${branchCount}\n\n`;
  }

  // Process main sequence thoughts
  const mainNodes: string[] = [];
  const revisions: Map<number, ThoughtData[]> = new Map();

  for (const thought of history) {
    if (thought.isRevision) {
      // Group revisions by target thought
      const targetThought = thought.revisesThought!;
      if (!revisions.has(targetThought)) {
        revisions.set(targetThought, []);
      }
      revisions.get(targetThought)!.push(thought);
    } else {
      const nodeId = `T${thought.thoughtNumber}`;
      const label = formatThoughtLabel(thought, { includeTimestamps });
      mainNodes.push(`${nodeId}[["${label}"]]`);
    }
  }

  // Create main sequence subgraph
  if (mainNodes.length > 0) {
    subgraphs.push('subgraph Main["Main Sequence"]');
    subgraphs.push(...mainNodes.map((n) => `    ${n}`));
    subgraphs.push("end");
    if (styling === "detailed") {
      styles.push("style Main fill:#e1f5fe,stroke:#01579b,stroke-width:2px");
    }
  }

  // Add sequential edges (T1 --> T2 --> T3)
  const sortedMainThoughts = history.filter((t) => !t.isRevision).sort((a, b) => a.thoughtNumber - b.thoughtNumber);

  for (let i = 0; i < sortedMainThoughts.length - 1; i++) {
    const current = sortedMainThoughts[i].thoughtNumber;
    const next = sortedMainThoughts[i + 1].thoughtNumber;
    edges.push(`T${current} --> T${next}`);
  }

  // Process revisions (create revision nodes with dashed edges)
  for (const [targetThoughtNum, revisionThoughts] of revisions.entries()) {
    for (const revThought of revisionThoughts) {
      const revNodeId = `R${revThought.thoughtNumber}`;
      const label = formatThoughtLabel(revThought, { includeTimestamps });
      nodes.push(`${revNodeId}{{"${label}"}}`);

      // Dashed edge from revision to target: R3 -.->|"revises 2"| T2
      edges.push(`${revNodeId} -.->|"revises ${targetThoughtNum}"| T${targetThoughtNum}`);

      // Edge from main sequence to revision (find thought before revision)
      const prevMainThought = sortedMainThoughts.find((t) => t.thoughtNumber < revThought.thoughtNumber);
      if (prevMainThought) {
        edges.push(`T${prevMainThought.thoughtNumber} --> ${revNodeId}`);
      }

      if (styling === "detailed") {
        styles.push(`style ${revNodeId} fill:#ffe0b2,stroke:#e65100,stroke-width:2px`);
      }
    }
  }

  // Process branches (create subgraphs for each branch)
  for (const [branchId, branchThoughts] of Object.entries(branches)) {
    const sanitizedBranchId = branchId.replace(/[^a-zA-Z0-9]/g, "_");
    const branchNodes: string[] = [];

    for (const thought of branchThoughts) {
      const nodeId = `B${thought.thoughtNumber}_${sanitizedBranchId}`;
      const label = formatThoughtLabel(thought, { includeTimestamps });
      branchNodes.push(`${nodeId}[["${label}"]]`);

      // Sequential edges within branch
      const thoughtIndex = branchThoughts.indexOf(thought);
      if (thoughtIndex > 0) {
        const prevThought = branchThoughts[thoughtIndex - 1];
        const prevNodeId = `B${prevThought.thoughtNumber}_${sanitizedBranchId}`;
        edges.push(`${prevNodeId} --> ${nodeId}`);
      }
    }

    // Create branch subgraph
    subgraphs.push(`subgraph Branch_${sanitizedBranchId}["Branch: ${branchId}"]`);
    subgraphs.push(...branchNodes.map((n) => `    ${n}`));
    subgraphs.push("end");

    if (styling === "detailed") {
      styles.push(`style Branch_${sanitizedBranchId} fill:#f3e5f5,stroke:#4a148c,stroke-width:2px`);
    }

    // Create branch divergence edge from main sequence
    if (branchThoughts.length > 0) {
      const firstBranchThought = branchThoughts[0];
      const firstBranchNodeId = `B${firstBranchThought.thoughtNumber}_${sanitizedBranchId}`;

      if (firstBranchThought.branchFromThought) {
        const fromNodeId = `T${firstBranchThought.branchFromThought}`;
        edges.push(`${fromNodeId} ==>"branch: ${branchId}"==> ${firstBranchNodeId}`);
      }
    }
  }

  // Assemble final diagram
  diagram += `${subgraphs.join("\n")}\n\n`;
  diagram += `${edges.join("\n")}\n`;

  if (nodes.length > 0) {
    diagram += `\n${nodes.join("\n")}\n`;
  }

  if (styling === "detailed" && styles.length > 0) {
    diagram += `\n${styles.join("\n")}\n`;
  }

  return diagram;
}
