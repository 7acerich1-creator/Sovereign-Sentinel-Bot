// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Web Search Tool (S125g, 2026-04-29)
//
// Lightweight grounded-answer fetch for knowledge questions Sapphire would
// otherwise hallucinate. Uses Gemini 2.5 Flash with the built-in google_search
// grounding so the LLM searches + answers in one round-trip — much faster
// than DuckDuckGo scrape + summarize (which is what research_brief does for
// heavier "background-check" tasks).
//
// Reason for existence: S125e Jay Kelly diagnostic. Sapphire confidently said
// "Paul Blart: Mall Cop" when asked about a 2025 movie because (a) her LLM has
// pre-2024 cutoff and (b) she had no quick search path. With this tool, she
// can resolve "what's that movie called", "who plays X", "is Y still CEO of Z",
// "when did the new <product> launch", etc., with citations.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";

const GEMINI_MODEL = "gemini-2.5-flash";


export class WebSearchTool implements Tool {
  definition: ToolDefinition = {
    name: "web_search",
    description:
      "Search the web for FACTS you don't have confident knowledge of. Returns a grounded answer plus the source URLs Gemini used. " +
      "ALWAYS call this BEFORE stating: movie titles, actor/cast info, song/album credits, current dates, recent news, current job titles of public figures, sports scores/results, product launch dates, anything that happened after early 2024, or any specific factual claim where being wrong would embarrass you. " +
      "Do NOT call for questions Ace can answer himself, opinions, personal context about Ace, or things in your memory/Pinecone. " +
      "Do NOT call for math, code, or general reasoning. Returns the answer + up to 5 source URLs.\n\n" +
      "Examples:\n" +
      "• Ace asks 'what was that 2025 Clooney movie?' → web_search('George Clooney 2025 movie')\n" +
      "• Ace asks 'who's the current CEO of OpenAI?' → web_search('OpenAI CEO 2026')\n" +
      "• Ace asks about a recent news event → web_search('<the event> latest')\n" +
      "• Ace asks 'what's 2+2' → DO NOT search, answer directly.\n" +
      "• Ace asks 'what's my daughter's name' → DO NOT search, call get_family.",
    parameters: {
      query: {
        type: "string",
        description: "Plain-English search query. Be specific. Include the year if recency matters.",
      },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query || "").trim();
    if (!query) return "web_search: query is required.";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "web_search: GEMINI_API_KEY not set on Railway.";

    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: query }] }],
            tools: [{ google_search: {} }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1024,
            },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );

      if (!resp.ok) {
        const errText = await resp.text();
        return `web_search: Gemini API error ${resp.status} — ${errText.slice(0, 200)}`;
      }

      const data: any = await resp.json();
      const cand = data?.candidates?.[0];
      if (!cand) return "web_search: no candidate returned.";

      const parts = cand?.content?.parts || [];
      const text = parts.map((p: any) => p.text).filter(Boolean).join("\n").trim();
      if (!text) return "web_search: empty response (Gemini may have blocked the query).";

      // Extract source URLs from groundingMetadata.
      // Gemini's grounding format: groundingChunks[].web.uri / web.title
      const groundingChunks = cand?.groundingMetadata?.groundingChunks || [];
      const sources: Array<{ title: string; url: string }> = [];
      for (const chunk of groundingChunks.slice(0, 5)) {
        const web = chunk?.web;
        if (web?.uri) {
          sources.push({ title: web.title || web.uri, url: web.uri });
        }
      }

      let result = text;
      if (sources.length > 0) {
        result += "\n\nSources:\n" + sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n");
      } else {
        result += "\n\n(no source URLs returned — answer derived from search but Gemini didn't surface citations)";
      }
      return result;
    } catch (e: any) {
      return `web_search: ${e.message || String(e)}`;
    }
  }
}
