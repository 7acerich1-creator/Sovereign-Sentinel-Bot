// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — News Brief Tools (Gap 7)
// Session 114 — 2026-04-25
//
// Pulls RSS from sources Ace configures, Gemini Flash filters for relevance
// based on standing facts, returns top 5 items. Used in morning brief.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

interface NewsItem {
  source: string;
  title: string;
  link: string;
  snippet: string;
  published?: string;
}

// Lightweight RSS parser — handles RSS 2.0 + Atom basics
function parseRss(xml: string, sourceName: string, max = 8): NewsItem[] {
  const items: NewsItem[] = [];
  // RSS 2.0
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks.slice(0, max)) {
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim() || "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || "";
    const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1]?.replace(/<[^>]+>/g, "").trim() || "";
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim();
    if (title) items.push({ source: sourceName, title, link, snippet: desc.slice(0, 250), published: pub });
  }
  // Atom fallback
  if (items.length === 0) {
    const entryBlocks = xml.match(/<entry[\s\S]*?<\/entry>/g) || [];
    for (const block of entryBlocks.slice(0, max)) {
      const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim() || "";
      const link = (block.match(/<link[^>]+href="([^"]+)"/) || [])[1]?.trim() || "";
      const summary = (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/<[^>]+>/g, "").trim() || "";
      if (title) items.push({ source: sourceName, title, link, snippet: summary.slice(0, 250) });
    }
  }
  return items;
}

async function fetchAllNews(maxPerSource = 6): Promise<NewsItem[]> {
  const supabase = await getSupabase();
  const { data: sources } = await supabase
    .from("sapphire_news_sources")
    .select("name, rss_url")
    .eq("enabled", true);
  if (!sources || sources.length === 0) return [];

  const all: NewsItem[] = [];
  for (const src of sources as any[]) {
    try {
      const resp = await fetch(src.rss_url, {
        headers: { "User-Agent": "Sapphire-PA/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const items = parseRss(xml, src.name, maxPerSource);
      all.push(...items);
      // Update last_fetched_at
      await supabase.from("sapphire_news_sources").update({ last_fetched_at: new Date().toISOString() }).eq("name", src.name);
    } catch {
      // skip silently
    }
  }
  return all;
}

async function geminiPickRelevant(items: NewsItem[], factsContext: string, max = 5): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return items.slice(0, max).map((i) => `• ${i.source}: ${i.title}\n  ${i.link}`).join("\n");

  const itemsText = items.map((i, idx) => `[${idx + 1}] ${i.source}: ${i.title}\n   ${i.snippet}`).join("\n\n");

  const prompt = `Ace gets a daily news brief. Here are ${items.length} recent items pulled from his subscribed sources.\n\nWhat we know about Ace's interests:\n${factsContext || "(no standing facts yet — pick by general interest of a busy founder/operator)"}\n\nItems:\n${itemsText}\n\nPick the ${max} most relevant for Ace. For each: 1-line summary + why it matters to him. Plain text. No preamble. Format:\n\n• [TITLE] — [why this matters in 1 sentence]\n  [URL]`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        }),
      },
    );
    if (!resp.ok) return items.slice(0, max).map((i) => `• ${i.source}: ${i.title}\n  ${i.link}`).join("\n");
    const data = (await resp.json()) as any;
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || items.slice(0, max).map((i) => `• ${i.source}: ${i.title}\n  ${i.link}`).join("\n");
  } catch {
    return items.slice(0, max).map((i) => `• ${i.source}: ${i.title}\n  ${i.link}`).join("\n");
  }
}

// ── Internal helper for morning brief integration ──────────────────────────
export async function getNewsForBrief(): Promise<string> {
  const { loadFactsForContext } = await import("./facts");
  const items = await fetchAllNews(6);
  if (items.length === 0) return "";
  const facts = await loadFactsForContext().catch(() => "");
  return await geminiPickRelevant(items, facts, 5);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MANAGEMENT TOOLS for Sapphire to add/remove sources
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class AddNewsSourceTool implements Tool {
  definition: ToolDefinition = {
    name: "add_news_source",
    description: "Add an RSS feed to Ace's morning news brief. Use when he says 'add this news source' or shares an RSS URL.",
    parameters: {
      name: { type: "string", description: "Short name for the source." },
      rss_url: { type: "string", description: "RSS or Atom feed URL." },
      category: { type: "string", description: "Optional category like 'tech', 'business', 'health'." },
    },
    required: ["name", "rss_url"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || "").trim();
    const rssUrl = String(args.rss_url || "").trim();
    if (!name || !rssUrl) return "add_news_source: name and rss_url required.";
    const category = String(args.category || "general").toLowerCase();

    const supabase = await getSupabase();
    const { error } = await supabase
      .from("sapphire_news_sources")
      .upsert({ name, rss_url: rssUrl, category, enabled: true }, { onConflict: "name" });
    if (error) return `add_news_source: ${error.message}`;
    return `Added news source "${name}" (${category}).`;
  }
}

export class RemoveNewsSourceTool implements Tool {
  definition: ToolDefinition = {
    name: "remove_news_source",
    description: "Disable a news source from morning brief.",
    parameters: { name: { type: "string", description: "Source name to disable." } },
    required: ["name"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || "").trim();
    if (!name) return "remove_news_source: name required.";
    const supabase = await getSupabase();
    const { error } = await supabase.from("sapphire_news_sources").update({ enabled: false }).eq("name", name);
    if (error) return `remove_news_source: ${error.message}`;
    return `Disabled news source "${name}".`;
  }
}

export class ListNewsSourcesTool implements Tool {
  definition: ToolDefinition = {
    name: "list_news_sources",
    description: "Show Ace's configured news sources.",
    parameters: {},
    required: [],
  };

  async execute(): Promise<string> {
    const supabase = await getSupabase();
    const { data } = await supabase.from("sapphire_news_sources").select("name, category, enabled").order("category");
    if (!data || data.length === 0) return "No news sources configured.";
    return (data as any[]).map((s) => `• [${s.category}] ${s.name}${s.enabled ? "" : " (disabled)"}`).join("\n");
  }
}
