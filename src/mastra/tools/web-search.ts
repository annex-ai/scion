// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Web Search Tool
 *
 * Searches the web using DuckDuckGo's HTML interface (no API key required).
 * Returns search results with titles, URLs, and snippets.
 */

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parse DuckDuckGo HTML search results
 */
function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks - DuckDuckGo uses class="result__body"
  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;

  for (let match = resultRegex.exec(html); match !== null; match = resultRegex.exec(html)) {
    const url = match[1];
    const title = match[2].trim();
    const snippet = match[3].trim();

    if (url && title) {
      results.push({
        title: decodeHTMLEntities(title),
        url: url.startsWith("//") ? `https:${url}` : url,
        snippet: decodeHTMLEntities(snippet),
      });
    }
  }

  // Alternative parsing for different DuckDuckGo HTML structure
  if (results.length === 0) {
    const altRegex =
      /<h2[^>]*class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    for (let match = altRegex.exec(html); match !== null; match = altRegex.exec(html)) {
      const url = match[1];
      const title = match[2].trim();
      const snippet = match[3].replace(/<[^>]+>/g, "").trim();

      if (url && title) {
        results.push({
          title: decodeHTMLEntities(title),
          url: url.startsWith("//") ? `https:${url}` : url,
          snippet: decodeHTMLEntities(snippet),
        });
      }
    }
  }

  return results;
}

/**
 * Decode HTML entities
 */
function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

export const webSearchTool = createTool({
  id: "web-search",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query"),
    maxResults: z.number().optional().default(10).describe("Maximum number of results to return (default: 10)"),
    timeout: z.number().optional().default(30).describe("Timeout in seconds (default: 30)"),
  }),
  outputSchema: z.object({
    results: z
      .array(
        z.object({
          title: z.string().describe("Result title"),
          url: z.string().describe("Result URL"),
          snippet: z.string().describe("Result snippet/description"),
        }),
      )
      .describe("Search results"),
    query: z.string().describe("The search query used"),
    totalResults: z.number().describe("Number of results returned"),
    error: z.string().optional().describe("Error message if search failed"),
  }),
  description:
    "Searches the web using DuckDuckGo. Accepts a search query string and optional maxResults limit. Returns an array of results with titles, URLs, and snippets. Use this tool when you need to find information on the web, look up documentation, research topics, or find relevant resources. No API key required.",
  execute: async ({ query, maxResults, timeout }) => {
    try {
      const encodedQuery = encodeURIComponent(query);
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), (timeout || 30) * 1000);

      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          results: [],
          query,
          totalResults: 0,
          error: `Search failed with status ${response.status}: ${response.statusText}`,
        };
      }

      const html = await response.text();
      const allResults = parseDuckDuckGoResults(html);
      const limitedResults = allResults.slice(0, maxResults || 10);

      return {
        results: limitedResults,
        query,
        totalResults: limitedResults.length,
      };
    } catch (error: any) {
      const errorMessage = error.name === "AbortError" ? `Search timed out after ${timeout} seconds` : error.message;

      return {
        results: [],
        query,
        totalResults: 0,
        error: errorMessage,
      };
    }
  },
});
