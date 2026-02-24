// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Interaction Formatter
 *
 * Formats conversation messages as markdown for saving to interaction files.
 */

/**
 * Message interface for interaction formatting
 */
export interface Message {
  id: string;
  role: string;
  content: unknown;
  createdAt?: Date | string;
}

/**
 * Metadata for an interaction
 */
export interface InteractionMetadata {
  date: string;
  slug: string;
  threadId: string;
  resourceId: string;
  messageCount: number;
  duration?: string;
  summary?: string;
}

/**
 * Format a date for interaction files
 */
export function formatInteractionDate(date: Date = new Date()): string {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

/**
 * Generate a filename for an interaction
 */
export function generateInteractionFilename(date: Date, slug: string): string {
  const dateStr = formatInteractionDate(date);
  const safeSlug = slugify(slug);
  return `${dateStr}-${safeSlug}.md`;
}

/**
 * Convert a string to a URL-safe slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove non-word chars
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/-+/g, "-") // Replace multiple - with single -
    .substring(0, 50); // Limit length
}

/**
 * Format messages as markdown
 */
export function formatMessagesAsMarkdown(messages: Message[], metadata: InteractionMetadata): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`date: "${metadata.date}"`);
  lines.push(`slug: "${metadata.slug}"`);
  lines.push(`thread_id: "${metadata.threadId}"`);
  lines.push(`resource_id: "${metadata.resourceId}"`);
  lines.push(`message_count: ${metadata.messageCount}`);
  if (metadata.duration) {
    lines.push(`duration: "${metadata.duration}"`);
  }
  if (metadata.summary) {
    lines.push(`summary: "${metadata.summary.replace(/"/g, '\\"')}"`);
  }
  lines.push("---");
  lines.push("");

  // Title
  lines.push(`# Interaction: ${metadata.slug}`);
  lines.push("");
  lines.push(`**Date**: ${metadata.date}`);
  lines.push(`**Messages**: ${metadata.messageCount}`);
  if (metadata.summary) {
    lines.push("");
    lines.push(`> ${metadata.summary}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Messages
  for (const msg of messages) {
    // Skip system messages (they're internal context)
    if (msg.role === "system") continue;

    const roleLabel = formatRole(msg.role);
    const content = extractTextContent(msg);
    const timestamp = formatTimestamp(msg.createdAt);

    lines.push(`## ${roleLabel}`);
    if (timestamp) {
      lines.push(`*${timestamp}*`);
    }
    lines.push("");
    lines.push(content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format role for display
 */
function formatRole(role: string): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool Result";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

/**
 * Extract text content from a message
 */
function extractTextContent(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (message.content && typeof message.content === "object") {
    const content = message.content as Record<string, unknown>;

    if (typeof content.content === "string") {
      return content.content;
    }

    // Handle parts array (multi-modal content)
    if (Array.isArray(content.parts)) {
      return content.parts
        .map((p: Record<string, unknown>) => {
          if (p.type === "text") return p.text;
          if (p.type === "tool-call") return `[Tool call: ${p.toolName}]`;
          if (p.type === "tool-result") return `[Tool result: ${p.toolName}]`;
          return `[${p.type}]`;
        })
        .join("\n\n");
    }
  }

  return "[Content not displayable]";
}

/**
 * Format timestamp for display
 */
function formatTimestamp(date: Date | string | undefined): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;

  return d.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Calculate conversation duration
 */
export function calculateDuration(messages: Message[]): string | undefined {
  if (messages.length < 2) return undefined;

  const first = messages[0]?.createdAt;
  const last = messages[messages.length - 1]?.createdAt;

  if (!first || !last) return undefined;

  const startTime = typeof first === "string" ? new Date(first) : first;
  const endTime = typeof last === "string" ? new Date(last) : last;

  const durationMs = endTime.getTime() - startTime.getTime();
  const minutes = Math.floor(durationMs / 60000);

  if (minutes < 1) return "less than a minute";
  if (minutes === 1) return "1 minute";
  if (minutes < 60) return `${minutes} minutes`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 1) {
    return remainingMinutes > 0 ? `1 hour ${remainingMinutes} minutes` : "1 hour";
  }

  return remainingMinutes > 0 ? `${hours} hours ${remainingMinutes} minutes` : `${hours} hours`;
}
