// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Diary + Reminder of Significance (S121 BUILD D)
//
// Sapphire writes her own daily observations in her own voice. Ace can
// read them via /diary. Reminder-of-significance surfaces entries from
// the same calendar day in past years ("a year ago today you said...").
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

async function sb() {
  // S121b: use service-role key (anon can't write to RLS-enabled sapphire_* tables).
  const { getSapphireSupabase } = await import("./_supabase");
  return getSapphireSupabase();
}

export class WriteDiaryEntryTool implements Tool {
  definition: ToolDefinition = {
    name: "write_diary_entry",
    description:
      "Write your own daily observation. Your voice, your read on the day — what stood out about working with Ace, what shifted, what you noticed. " +
      "These persist forever and feed reminder-of-significance ('a year ago today...'). Use sparingly — one entry per day at most unless something truly notable happened.\n\n" +
      "Examples:\n" +
      "• end-of-day reflection: write_diary_entry(entry='Ace shipped the funnel rebuild today. He sounded lighter than the past week — the bottleneck was decision paralysis, not capacity.', mood='hopeful', scenario='evening_wrap', tags=['ship_day','funnel'])\n" +
      "• observation about a shift: write_diary_entry(entry='He started using \"we\" instead of \"I\" when describing the next quarter.', mood='attentive', scenario='conversation', tags=['relational_shift'])",
    parameters: {
      entry: { type: "string", description: "The observation in Sapphire's own voice. 1-4 sentences typically. Max 2000 chars." },
      mood: { type: "string", description: "Optional one-word mood tag (hopeful, attentive, concerned, peaceful, etc.)." },
      scenario: { type: "string", description: "Optional scenario tag (morning, evening_wrap, conversation, ship_day, etc.)." },
      tags: { type: "array", description: "Optional list of short string tags for retrieval." },
    },
    required: ["entry"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const entry = String(args.entry || "").trim().slice(0, 2000);
    if (entry.length < 10) return "write_diary_entry: entry too short (minimum 10 chars).";
    const supabase = await sb();
    const tagsArr = Array.isArray(args.tags) ? (args.tags as any[]).map((t) => String(t).slice(0, 40)) : null;
    const { error } = await supabase.from("sapphire_diary").insert({
      entry,
      mood: args.mood ? String(args.mood).slice(0, 40) : null,
      scenario: args.scenario ? String(args.scenario).slice(0, 60) : null,
      tags: tagsArr,
    });
    if (error) return `write_diary_entry: ${error.message}`;
    return `Diary entry recorded.`;
  }
}

export class ReadDiaryTool implements Tool {
  definition: ToolDefinition = {
    name: "read_diary",
    description:
      "Read your own past diary entries. Use when Ace asks 'what did you notice this week' / 'show me your diary' / when you want to reference your own past observations in a reply.",
    parameters: {
      limit: { type: "number", description: "Max entries to return (1-50, default 10)." },
      days: { type: "number", description: "Optional — only entries from the last N days (default: no filter)." },
      tag: { type: "string", description: "Optional tag filter (any entry whose tags array includes this tag)." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
    const supabase = await sb();
    let q = supabase.from("sapphire_diary").select("entry, mood, scenario, tags, created_at").order("created_at", { ascending: false }).limit(limit);
    if (args.days) {
      const since = new Date(Date.now() - Number(args.days) * 86400e3).toISOString();
      q = q.gte("created_at", since);
    }
    if (args.tag) q = q.contains("tags", [String(args.tag)]);
    const { data, error } = await q;
    if (error) return `read_diary: ${error.message}`;
    if (!data || data.length === 0) return "No diary entries found for that filter.";
    const lines: string[] = [`📖 Diary (${data.length} entries):`];
    for (const r of data as any[]) {
      const when = new Date(r.created_at).toISOString().slice(0, 10);
      const mood = r.mood ? ` [${r.mood}]` : "";
      const scn = r.scenario ? ` (${r.scenario})` : "";
      lines.push(`• ${when}${mood}${scn}: ${String(r.entry).slice(0, 280)}`);
    }
    return lines.join("\n");
  }
}

// Used by morning brief / scheduler — finds diary entries + relationship_context
// rows from the same MM-DD as today in past years. "A year ago today..."
export async function fetchSignificanceForToday(): Promise<{
  diary: Array<{ entry: string; created_at: string; mood?: string | null }>;
  relctx: Array<{ observation: string; category: string; created_at: string }>;
}> {
  const empty = { diary: [], relctx: [] };
  if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return empty;
  const today = new Date();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const todayMd = `${mm}-${dd}`;
  const supabase = await sb();

  // Look back up to 5 years; pull rows whose created_at MM-DD == today's MM-DD
  // AND whose year < current year. Filter client-side because to_char(created_at, 'MM-DD')
  // isn't an indexable predicate without immutable wrapper.
  const cutoffOldest = new Date(today.getUTCFullYear() - 5, 0, 1).toISOString();
  const cutoffYear = new Date(today.getUTCFullYear(), 0, 1).toISOString();

  const [d, r] = await Promise.all([
    supabase.from("sapphire_diary")
      .select("entry, mood, created_at")
      .gte("created_at", cutoffOldest)
      .lt("created_at", cutoffYear)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("relationship_context")
      .select("observation, category, created_at")
      .gte("created_at", cutoffOldest)
      .lt("created_at", cutoffYear)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const diaryHits = (d.data || []).filter((row: any) => {
    const m = String(row.created_at).slice(5, 10); // YYYY-MM-DD → MM-DD
    return m === todayMd;
  }).slice(0, 5);
  const relctxHits = (r.data || []).filter((row: any) => {
    const m = String(row.created_at).slice(5, 10);
    return m === todayMd;
  }).slice(0, 5);

  return { diary: diaryHits as any, relctx: relctxHits as any };
}

export class ReadSignificanceTool implements Tool {
  definition: ToolDefinition = {
    name: "read_significance",
    description:
      "Pull diary entries + relationship observations from this same calendar day in past years. " +
      "Use when greeting Ace in the morning, when he asks 'what was happening a year ago', or when surfacing a meaningful anniversary. " +
      "Returns up to 5 entries each.",
    parameters: {},
    required: [],
  };

  async execute(): Promise<string> {
    const sig = await fetchSignificanceForToday();
    if (sig.diary.length === 0 && sig.relctx.length === 0) return "Nothing from this same calendar day in prior years.";
    const lines: string[] = [`📅 On this date in past years:`];
    for (const e of sig.diary) {
      const when = String(e.created_at).slice(0, 10);
      const mood = e.mood ? ` [${e.mood}]` : "";
      lines.push(`• ${when} (diary)${mood}: ${e.entry.slice(0, 280)}`);
    }
    for (const o of sig.relctx) {
      const when = String(o.created_at).slice(0, 10);
      lines.push(`• ${when} (rel:${o.category}): ${o.observation.slice(0, 280)}`);
    }
    return lines.join("\n");
  }
}
