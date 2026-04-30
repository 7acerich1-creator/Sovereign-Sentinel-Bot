import { Tool, ToolDefinition } from "../../types";
import { YoutubeTranscript } from "youtube-transcript";

export class YoutubeTranscriptTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_get_transcript",
    description: "Fetch the transcript of a YouTube video by its URL. Use this to analyze daily uploads for frequency alignment briefs.",
    parameters: {
      url: { type: "string", description: "The full YouTube video URL." },
    },
    required: ["url"],
  };

  async execute(args: Record<string, unknown>, _context?: any): Promise<string> {
    const url = String(args.url || "").trim();
    if (!url) return "youtube_get_transcript: url required.";

    try {
      const transcript = await YoutubeTranscript.fetchTranscript(url);
      if (!transcript || transcript.length === 0) {
        return `⬚ No transcript found for video: ${url}`;
      }

      // Combine text segments
      const text = transcript.map(t => t.text).join(" ");
      return text.slice(0, 15000); // Caps to avoid context overflow
    } catch (err: any) {
      return `❌ YouTube Transcript error: ${err.message}`;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// YOUTUBE SEARCH — S125+ Phase 2 (2026-04-30)
//
// Closes the structural gap where Sapphire's web_search returned prose-with-
// citations when Architect asked "is there a YouTube video showing X?" — she
// had nothing that returned discrete clickable video URLs. This tool wraps
// the YouTube Data API v3 search endpoint and returns structured results she
// can hand back as concrete URLs.
//
// API: https://developers.google.com/youtube/v3/docs/search/list
// Quota: search.list = 100 units/call, 10,000 units/day on free tier.
// Env: YOUTUBE_API_KEY (preferred) or GOOGLE_API_KEY (fallback).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class YoutubeSearchTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_search",
    description:
      "Search YouTube for videos matching a query. Returns a structured list of {title, videoId, url, channelTitle, publishedAt, thumbnailUrl}. " +
      "ALWAYS prefer this over web_search when Architect asks for a video, a YouTube link, a demo, a tutorial visual, or 'show me Y on YouTube'. " +
      "When relaying results to him, apply concept_mode curation: filter for substance (documentary/conceptual) over entertainment (clickbait/listicle), surface 1-3 framed within his intent, skip the filler. " +
      "Examples:\n" +
      "• Ace asks 'is there a video showing how much cash fits in a briefcase?' → youtube_search('briefcase cash capacity million dollars visual')\n" +
      "• Ace asks 'show me a tutorial on threshold-triggered automations' → youtube_search('threshold automation alert tutorial')\n" +
      "• Ace asks 'what does Letta-style agent memory look like in practice?' → youtube_search('Letta MemGPT agent memory architecture')",
    parameters: {
      query: {
        type: "string",
        description: "Plain-English search query. Be specific. Add the year for recency-sensitive topics."
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (1-10). Default 5. Use lower (3) when you'll be curating tightly anyway."
      },
      order: {
        type: "string",
        description: "Result ordering: 'relevance' (default), 'date', 'rating', 'viewCount'. Use 'date' for current-events topics, 'relevance' otherwise.",
        enum: ["relevance", "date", "rating", "viewCount"]
      },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query || "").trim();
    if (!query) return "youtube_search: query is required.";

    const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return "youtube_search: YOUTUBE_API_KEY (or GOOGLE_API_KEY) not set on Railway.";

    const maxResultsRaw = Number(args.max_results);
    const maxResults = Number.isFinite(maxResultsRaw)
      ? Math.min(10, Math.max(1, Math.floor(maxResultsRaw)))
      : 5;
    const order = (() => {
      const o = String(args.order || "relevance");
      return ["relevance", "date", "rating", "viewCount"].includes(o) ? o : "relevance";
    })();

    const url =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet&type=video` +
      `&q=${encodeURIComponent(query)}` +
      `&maxResults=${maxResults}` +
      `&order=${order}` +
      `&key=${apiKey}`;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "<unreadable>");
        return `youtube_search: API ${resp.status} — ${errText.slice(0, 250)}`;
      }
      const data: any = await resp.json();
      const items: any[] = data?.items || [];
      if (items.length === 0) {
        return `youtube_search: no results for "${query}".`;
      }

      const results = items.map((it: any) => {
        const videoId = it?.id?.videoId || "";
        const sn = it?.snippet || {};
        return {
          title: String(sn.title || "(untitled)"),
          videoId,
          url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
          channelTitle: String(sn.channelTitle || ""),
          publishedAt: String(sn.publishedAt || ""),
          thumbnailUrl: String(sn?.thumbnails?.medium?.url || sn?.thumbnails?.default?.url || ""),
          description: String(sn.description || "").slice(0, 200),
        };
      }).filter((r) => r.videoId);

      if (results.length === 0) {
        return `youtube_search: results returned but none had video IDs (unusual).`;
      }

      // Structured pretty-print — easy for the model to read and re-frame
      const lines = results.map((r, i) =>
        `[${i + 1}] ${r.title}\n` +
        `    ${r.url}\n` +
        `    Channel: ${r.channelTitle} | Published: ${r.publishedAt.slice(0, 10)}\n` +
        `    ${r.description}${r.description.length === 200 ? "…" : ""}`
      );
      return `YouTube results for "${query}" (order=${order}):\n${lines.join("\n\n")}`;
    } catch (e: any) {
      return `youtube_search: ${e.message || String(e)}`;
    }
  }
}
