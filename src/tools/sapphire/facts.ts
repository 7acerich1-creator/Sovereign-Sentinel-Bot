// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Standing-Facts Tools
// Session 114 — 2026-04-24
//
// Sapphire's long-term memory of Ace's standing preferences and recurring
// facts. Two tools: remember_fact, recall_facts. Stored in
// public.sapphire_known_facts.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

const VALID_CATEGORIES = ["family", "preferences", "people", "logistics", "standing_decisions", "health", "schedule"];

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(config.memory.supabaseUrl!, config.memory.supabaseKey!);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REMEMBER FACT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RememberFactTool implements Tool {
  definition: ToolDefinition = {
    name: "remember_fact",
    description:
      "Save a standing fact about Ace's life so you remember it across sessions. Examples: " +
      "'girls birthday parties = $25 gift budget', 'wife's name is Maria', 'no calls before 11am', " +
      "'pediatrician is Dr. Patel at City Health'. Use when Ace tells you something that should persist " +
      "(not for one-off task data — that goes to reminders or calendar).",
    parameters: {
      key: { type: "string", description: "Short snake_case identifier. Example: 'gift_budget_kids_parties'." },
      value: { type: "string", description: "The fact in plain English." },
      category: {
        type: "string",
        description: "One of: family, preferences, people, logistics, standing_decisions, health, schedule.",
      },
    },
    required: ["key", "value", "category"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const key = String(args.key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const value = String(args.value || "").trim();
    const category = String(args.category || "preferences").trim().toLowerCase();
    if (!key) return "remember_fact: key required.";
    if (!value) return "remember_fact: value required.";
    if (!VALID_CATEGORIES.includes(category)) {
      return `remember_fact: category must be one of ${VALID_CATEGORIES.join(", ")}.`;
    }

    const supabase = await getSupabase();
    const { error } = await supabase
      .from("sapphire_known_facts")
      .upsert({ key, value, category }, { onConflict: "key" });

    if (error) return `remember_fact: ${error.message}`;
    return `Saved: ${key} → "${value.slice(0, 100)}" (${category}).`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RECALL FACTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RecallFactsTool implements Tool {
  definition: ToolDefinition = {
    name: "recall_facts",
    description:
      "Look up Ace's standing facts. Use to answer 'what was the gift budget' or to check what you remember before responding to a question.",
    parameters: {
      category: { type: "string", description: "Filter by category. Optional." },
      key_match: { type: "string", description: "Substring match on key. Optional." },
      max: { type: "number", description: "Max results. Default 25." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const supabase = await getSupabase();
    let q = supabase.from("sapphire_known_facts").select("key, value, category").order("category", { ascending: true });

    if (args.category) {
      q = q.eq("category", String(args.category).toLowerCase());
    }
    if (args.key_match) {
      q = q.ilike("key", `%${String(args.key_match).toLowerCase()}%`);
    }
    const max = Math.min(Number(args.max) || 25, 50);
    q = q.limit(max);

    const { data, error } = await q;
    if (error) return `recall_facts: ${error.message}`;
    if (!data || data.length === 0) return "No matching facts.";

    const grouped = new Map<string, Array<{ key: string; value: string }>>();
    for (const row of data as any[]) {
      if (!grouped.has(row.category)) grouped.set(row.category, []);
      grouped.get(row.category)!.push(row);
    }

    const parts: string[] = [];
    for (const [cat, rows] of grouped) {
      parts.push(`[${cat}]`);
      for (const r of rows) parts.push(`  • ${r.key}: ${r.value}`);
    }
    return parts.join("\n");
  }
}

// Internal helper — load all facts as a context string for the morning brief
export async function loadFactsForContext(): Promise<string> {
  const supabase = await getSupabase();
  const { data } = await supabase
    .from("sapphire_known_facts")
    .select("key, value, category")
    .order("category", { ascending: true })
    .limit(50);
  if (!data || data.length === 0) return "";
  return data.map((r: any) => `${r.category}/${r.key}: ${r.value}`).join("\n");
}
