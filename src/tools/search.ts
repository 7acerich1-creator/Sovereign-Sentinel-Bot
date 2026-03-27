// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Web Search Tool
// Search via DuckDuckGo (default), Google, or Bing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolContext, ToolDefinition } from "../types";
import { config } from "../config";

export class WebSearchTool implements Tool {
  definition: ToolDefinition = {
    name: "web_search",
    description: "Search the web and return top results with titles, snippets, and URLs.",
    parameters: {
      query: { type: "string", description: "Search query" },
      numResults: { type: "number", description: "Number of results (default: 5, max: 10)" },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query);
    const numResults = Math.min(Number(args.numResults) || 5, 10);

    try {
      switch (config.tools.searchProvider) {
        case "duckduckgo":
          return await this.searchDuckDuckGo(query, numResults);
        case "google":
          return await this.searchGoogle(query, numResults);
        case "bing":
          return await this.searchBing(query, numResults);
        default:
          return await this.searchDuckDuckGo(query, numResults);
      }
    } catch (err: any) {
      return `Search failed: ${err.message}`;
    }
  }

  private async searchDuckDuckGo(query: string, limit: number): Promise<string> {
    // DuckDuckGo HTML search (no API key needed)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GravityClaw/3.0)" },
    });

    if (!resp.ok) throw new Error(`DuckDuckGo HTTP ${resp.status}`);
    const html = await resp.text();

    // Parse results from HTML
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) && results.length < limit) {
      results.push({
        url: match[1],
        title: match[2].replace(/<[^>]+>/g, "").trim(),
        snippet: match[3].replace(/<[^>]+>/g, "").trim(),
      });
    }

    if (results.length === 0) {
      // Fallback: simpler parsing
      const linkRegex = /<a[^>]*class="result__url"[^>]*href="([^"]*)"[^>]*>[\s\S]*?<\/a>/g;
      while ((match = linkRegex.exec(html)) && results.length < limit) {
        results.push({ url: match[1], title: "(result)", snippet: "" });
      }
    }

    if (results.length === 0) return `No results found for: ${query}`;

    return results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
    ).join("\n\n");
  }

  private async searchGoogle(query: string, limit: number): Promise<string> {
    if (!config.tools.searchApiKey) return "Google search API key not configured.";

    const url = `https://www.googleapis.com/customsearch/v1?key=${config.tools.searchApiKey}&cx=default&q=${encodeURIComponent(query)}&num=${limit}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Google API HTTP ${resp.status}`);

    const data: any = await resp.json();
    const items = data.items || [];

    return items.map((item: any, i: number) =>
      `${i + 1}. ${item.title}\n   ${item.link}\n   ${item.snippet || ""}`
    ).join("\n\n") || `No results for: ${query}`;
  }

  private async searchBing(query: string, limit: number): Promise<string> {
    if (!config.tools.searchApiKey) return "Bing search API key not configured.";

    const resp = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`,
      { headers: { "Ocp-Apim-Subscription-Key": config.tools.searchApiKey } }
    );
    if (!resp.ok) throw new Error(`Bing API HTTP ${resp.status}`);

    const data: any = await resp.json();
    const results = data.webPages?.value || [];

    return results.map((r: any, i: number) =>
      `${i + 1}. ${r.name}\n   ${r.url}\n   ${r.snippet}`
    ).join("\n\n") || `No results for: ${query}`;
  }
}

// ── Web Fetch Tool ──
export class WebFetchTool implements Tool {
  definition: ToolDefinition = {
    name: "fetch_url",
    description: "Fetch the content of a web page and return its text (HTML stripped).",
    parameters: {
      url: { type: "string", description: "URL to fetch" },
      maxLength: { type: "number", description: "Max characters to return (default: 5000)" },
    },
    required: ["url"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url);
    const maxLength = Number(args.maxLength) || 5000;

    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; GravityClaw/3.0)" },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) return `HTTP ${resp.status} — ${resp.statusText}`;

      const html = await resp.text();
      // Strip HTML tags and excess whitespace
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return text.slice(0, maxLength);
    } catch (err: any) {
      return `Fetch failed: ${err.message}`;
    }
  }
}
