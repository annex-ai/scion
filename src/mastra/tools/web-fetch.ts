// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { safeFetch } from "../lib/security/safe-fetch";

// Truncation constants
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10MB for web content

/**
 * Format bytes as human-readable size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Simple HTML to markdown conversion
 */
function htmlToMarkdown(html: string): string {
  let text = html;

  // Remove script and style tags with content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

  // Convert headers
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Convert links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Convert bold and italic
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");

  // Convert code
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

  // Convert lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  text = text.replace(/<ul[^>]*>/gi, "\n");
  text = text.replace(/<\/ul>/gi, "\n");
  text = text.replace(/<ol[^>]*>/gi, "\n");
  text = text.replace(/<\/ol>/gi, "\n");

  // Convert paragraphs and line breaks
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&mdash;/g, "—");
  text = text.replace(/&ndash;/g, "–");

  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

export const webFetchTool = createTool({
  id: "web-fetch",
  inputSchema: z.object({
    url: z.string().url().describe("URL to fetch"),
    prompt: z.string().optional().describe("Optional prompt to focus extraction on specific content"),
    timeout: z.number().optional().default(30).describe("Timeout in seconds (default: 30)"),
  }),
  outputSchema: z.object({
    content: z.string().describe("Fetched content converted to markdown"),
    url: z.string().describe("Final URL after redirects"),
    statusCode: z.number().describe("HTTP status code"),
    contentType: z.string().describe("Content-Type header"),
    truncated: z.boolean().describe("Whether content was truncated"),
    error: z.string().optional().describe("Error message if fetch failed"),
  }),
  description: `Fetches content from a URL and converts HTML to markdown. Accepts a URL and optional prompt to focus extraction. Returns the page content as markdown, final URL after redirects, and status code. Use this tool when you need to read web pages, fetch documentation, retrieve API responses, or access any HTTP resource. Automatically upgrades HTTP to HTTPS. Content truncated to ${formatSize(DEFAULT_MAX_BYTES)}.`,
  execute: async ({ url, prompt, timeout }) => {
    try {
      // Ensure URL uses HTTPS
      let fetchUrl = url;
      if (fetchUrl.startsWith("http://")) {
        fetchUrl = fetchUrl.replace("http://", "https://");
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), (timeout || 30) * 1000);

      const response = await safeFetch(fetchUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MastraBot/1.0)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") || "unknown";
      const finalUrl = response.url;

      if (!response.ok) {
        return {
          content: `HTTP Error: ${response.status} ${response.statusText}`,
          url: finalUrl,
          statusCode: response.status,
          contentType,
          truncated: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const text = await response.text();
      let content: string;

      // Convert HTML to markdown if it's HTML content
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        content = htmlToMarkdown(text);
      } else {
        content = text;
      }

      // Add prompt context if provided
      if (prompt) {
        content = `[Extraction focus: ${prompt}]\n\n${content}`;
      }

      // Truncate if necessary
      const contentBytes = Buffer.byteLength(content, "utf-8");
      let truncated = false;

      if (contentBytes > DEFAULT_MAX_BYTES) {
        // Truncate by bytes, keeping complete lines
        const lines = content.split("\n");
        const outputLines: string[] = [];
        let bytesUsed = 0;

        for (const line of lines) {
          const lineBytes = Buffer.byteLength(`${line}\n`, "utf-8");
          if (bytesUsed + lineBytes > DEFAULT_MAX_BYTES) {
            truncated = true;
            break;
          }
          outputLines.push(line);
          bytesUsed += lineBytes;
        }

        content = outputLines.join("\n");
        content += `\n\n[Content truncated at ${formatSize(DEFAULT_MAX_BYTES)}. Original size: ${formatSize(contentBytes)}]`;
      }

      return {
        content,
        url: finalUrl,
        statusCode: response.status,
        contentType,
        truncated,
      };
    } catch (error: any) {
      const errorMessage =
        error.name === "SecurityError"
          ? `SSRF blocked: ${error.message}`
          : error.name === "AbortError"
            ? `Request timed out after ${timeout} seconds`
            : error.message;

      return {
        content: `Error fetching URL: ${errorMessage}`,
        url,
        statusCode: 0,
        contentType: "unknown",
        truncated: false,
        error: errorMessage,
      };
    }
  },
});
