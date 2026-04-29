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
  return m.createClient(config.memory.supabaseUrl!, (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REMEMBER FACT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RememberFactTool implements Tool {
  definition: ToolDefinition = {
    name: "remember_fact",
    description:
      "Save a standing fact about Ace's life. Use for ANY personal info that should persist (NOT for one-off task data). " +
      "write_knowledge will REFUSE personal content — this is the only way to save personal stuff.\n\n" +
      "Examples:\n" +
      "• 'gift budget for kids' parties is $25' → remember_fact(key='kids_party_gift_budget', value='$25 per gift', category='preferences')\n" +
      "• 'no calls before 11am' → remember_fact(key='no_calls_before_11am', value='Do not schedule calls before 11am CDT', category='schedule')\n" +
      "• 'pediatrician is Dr Patel at City Health' → remember_fact(key='pediatrician', value='Dr. Patel at City Health', category='health')\n\n" +
      "For family member structured data (name+DOB+school+allergies) use save_family_member instead.",
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

    // ── DUAL-WRITE TO PINECONE ──
    // Supabase = fast structured lookup (key/value/category, exact match).
    // Pinecone = semantic recall (Ace says "what's our gift budget" and the
    // fact "girls_birthday_parties: $25 budget" surfaces even with different
    // wording). Best-effort — failure here doesn't block the Supabase save.
    try {
      const { upsertSapphireFact } = await import("./_pinecone");
      await upsertSapphireFact(key, value, category);
    } catch (e: any) {
      console.warn(`[remember_fact] Pinecone upsert skipped: ${e.message}`);
    }

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
      "Look up Ace's standing facts. ONLY call when (a) Ace asked a specific question that requires a remembered fact and (b) the answer isn't already in the context prefix block. Do NOT call speculatively or 'just in case' — every call costs latency. The auto-recall in the context block already surfaces semantically relevant facts; rely on that first.",
    parameters: {
      category: { type: "string", description: "Filter by category. Optional." },
      key_match: { type: "string", description: "Substring match on key. Optional." },
      query: { type: "string", description: "Semantic search query. Best for finding facts by meaning." },
      max: { type: "number", description: "Max results. Default 25." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = args.query ? String(args.query).trim() : null;
    
    // ── SEMANTIC PATH ──
    if (query) {
      try {
        const { recallSapphireFacts } = await import("./_pinecone");
        const results = await recallSapphireFacts(query, Number(args.max) || 10);
        if (!results || results.length === 0) return `No semantically relevant facts found for "${query}".`;
        return results.map((r: any) => `[${r.category}] ${r.key}: ${r.value}`).join("\n");
      } catch (e: any) {
        return `recall_facts semantic error: ${e.message}`;
      }
    }

    // ── STRUCTURED PATH (Fallback/Direct) ──
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
