// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Research Brief Tool (Gap 3)
// Session 114 — 2026-04-25
//
// Web search + page fetch + Gemini Flash summarization → 1-pager research brief.
// "Research this company before my Tuesday meeting." "Background-check this contractor."
// "What's the going rate for X?"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";

const GEMINI_MODEL = "gemini-2.5-flash";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// Use DuckDuckGo HTML scrape (no API key needed) — lightweight, free.
// Falls back to graceful error if blocked.
async function webSearch(query: string, max = 5): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    // Parse DDG results — anchor with class "result__a" + snippet "result__snippet"
    const results: SearchResult[] = [];
    const blockRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = blockRegex.exec(html)) !== null && results.length < max) {
      const rawUrl = m[1];
      const title = m[2].replace(/<[^>]+>/g, "").trim();
      const snippet = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      // DDG wraps URL in /l/?uddg=... — extract the real one
      let realUrl = rawUrl;
      const uddg = rawUrl.match(/uddg=([^&]+)/);
      if (uddg) realUrl = decodeURIComponent(uddg[1]);
      results.push({ title, url: realUrl, snippet });
    }
    return results;
  } catch {
    return [];
  }
}

async function fetchPageText(url: string, maxChars = 4000): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Sapphire-PA/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return "";
    const html = await resp.text();
    // Strip scripts/styles, then tags
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.slice(0, maxChars);
  } catch {
    return "";
  }
}

async function geminiSummarize(prompt: string, maxOutput = 1024): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "[Gemini API key not set, can't summarize]";

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: maxOutput },
        }),
      },
    );
    if (!resp.ok) return "[Gemini summarization failed]";
    const data = (await resp.json()) as any;
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "[Empty response]";
  } catch (e: any) {
    return `[Summarization error: ${e.message}]`;
  }
}

export class ResearchBriefTool implements Tool {
  definition: ToolDefinition = {
    name: "research_brief",
    description:
      "Research a topic, person, or company on the web and return a 1-pager brief. Use for 'research X before my meeting', 'background check this person', 'what's the going rate for X', 'who is this company'. Returns structured findings with sources.",
    parameters: {
      query: { type: "string", description: "What to research. Be specific. Examples: 'John Smith CEO Acme Corp recent news', 'best pediatrician downtown Houston', 'going rate for Telegram bot developers'." },
      depth: { type: "string", description: "'quick' (top 3 results) or 'thorough' (top 5 results, fetched and summarized). Default 'quick'." },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query || "").trim();
    const depth = String(args.depth || "quick").toLowerCase();
    if (!query) return "research_brief: query required.";

    const max = depth === "thorough" ? 5 : 3;
    const results = await webSearch(query, max);
    if (results.length === 0) {
      return `research_brief: no web results for "${query}". Try a different phrasing.`;
    }

    // Quick mode: just summarize snippets. Thorough: fetch top pages too.
    let evidence: string;
    if (depth === "thorough") {
      const fetchedPages: string[] = [];
      for (const r of results.slice(0, 5)) {
        const text = await fetchPageText(r.url, 2500);
        if (text) fetchedPages.push(`[${r.title}]\nURL: ${r.url}\n${text}`);
      }
      evidence = fetchedPages.join("\n\n---\n\n");
    } else {
      evidence = results.map((r) => `• ${r.title}\n  ${r.url}\n  ${r.snippet}`).join("\n\n");
    }

    const prompt = `Ace asked you to research: "${query}"\n\nHere's what was found on the web:\n\n${evidence}\n\nWrite a clean 1-pager brief for Ace. Plain English. Structure:\n1. The headline (1 sentence: who/what is this)\n2. Key facts (3-5 bullets)\n3. What matters for Ace specifically (1-2 sentences)\n4. Sources (URL list)\n\nIf evidence is thin, say so — don't fabricate.`;

    const brief = await geminiSummarize(prompt, 1024);
    return brief;
  }
}
