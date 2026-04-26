// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Anticipatory Follow-Ups (S121 BUILD D)
//
// Records "promises" Ace makes ("I'll circle back to X tomorrow").
// A scheduled sweep DMs Ace when due_at hits + Sapphire can list/complete
// any time. Distinct from set_reminder — reminders are calendar-style
// time-based pings, follow-ups are ANTICIPATORY questions ("you said
// you'd circle back to X — still want that?").
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

async function sb() {
  // S121b: use service-role key (anon can't write to RLS-enabled sapphire_* tables).
  const { getSapphireSupabase } = await import("./_supabase");
  return getSapphireSupabase();
}

function parseDueAt(input: string): Date | null {
  const s = String(input || "").trim();
  if (!s) return null;
  // Try ISO direct
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;
  // Try shorthand: "+2h", "+3d", "+1w", "tomorrow", "in 2 hours"
  const now = Date.now();
  const m = s.match(/^\+?(\d+)\s*([hdw])$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const ms = unit === "h" ? n * 3600e3 : unit === "d" ? n * 86400e3 : n * 7 * 86400e3;
    return new Date(now + ms);
  }
  if (/^tomorrow$/i.test(s)) return new Date(now + 86400e3);
  const inMatch = s.match(/^in\s+(\d+)\s*(hour|hr|day|week|month)s?$/i);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const u = inMatch[2].toLowerCase();
    const ms = /hour|hr/.test(u) ? n * 3600e3
      : u === "day" ? n * 86400e3
      : u === "week" ? n * 7 * 86400e3
      : n * 30 * 86400e3;
    return new Date(now + ms);
  }
  return null;
}

export class RecordFollowupTool implements Tool {
  definition: ToolDefinition = {
    name: "record_followup",
    description:
      "Record a promise Ace just made or a thread he wants you to anticipate (e.g. 'remind me about X next week'). When due_at hits, you'll surface it to him. " +
      "Distinct from set_reminder — use record_followup for OPEN-ENDED threads ('still want this?'); use set_reminder for fixed time-based pings.\n\n" +
      "Examples:\n" +
      "• 'I'll circle back to the funnel rebuild on Tuesday' → record_followup(topic='funnel rebuild', due_at='+5d')\n" +
      "• 'remind me in two weeks if I haven't started Tier 2' → record_followup(topic='Tier 2 launch readiness', due_at='+2w', detail='check if any progress; ask if intent has changed')",
    parameters: {
      topic: { type: "string", description: "Short title (≤140 chars). What is this thread about." },
      due_at: { type: "string", description: "When to surface. ISO timestamp OR shorthand: '+2h', '+3d', '+1w', 'tomorrow', 'in 2 weeks'." },
      detail: { type: "string", description: "Optional — extra nuance Sapphire should remember when she surfaces this." },
      source_excerpt: { type: "string", description: "Optional — verbatim excerpt of what Ace said that triggered this followup." },
    },
    required: ["topic", "due_at"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const topic = String(args.topic || "").trim().slice(0, 140);
    if (!topic) return "record_followup: topic is required.";
    const due = parseDueAt(String(args.due_at || ""));
    if (!due) return "record_followup: due_at unparseable. Use ISO ('2026-05-01T15:00Z') or shorthand ('+3d', 'in 2 weeks').";

    const supabase = await sb();
    const { data, error } = await supabase
      .from("sapphire_followups")
      .insert({
        topic,
        detail: args.detail ? String(args.detail).slice(0, 1000) : null,
        due_at: due.toISOString(),
        source_excerpt: args.source_excerpt ? String(args.source_excerpt).slice(0, 500) : null,
      })
      .select("id")
      .single();

    if (error) return `record_followup: ${error.message}`;
    return `Followup logged. Will surface ${due.toISOString()} — id ${(data as any)?.id?.slice(0, 8) ?? "?"}.`;
  }
}

export class ListFollowupsTool implements Tool {
  definition: ToolDefinition = {
    name: "list_followups",
    description:
      "List your pending follow-ups. Use to recall what threads you're holding for Ace. Filter by status; default returns 'pending' only.",
    parameters: {
      status: { type: "string", description: "One of: pending, done, cancelled, snoozed, all. Default: pending." },
      limit: { type: "number", description: "Max rows (1-50, default 20)." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const status = String(args.status || "pending").toLowerCase();
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const supabase = await sb();
    let q = supabase.from("sapphire_followups").select("id, topic, detail, due_at, status, surfaced_at, created_at").order("due_at", { ascending: true }).limit(limit);
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return `list_followups: ${error.message}`;
    if (!data || data.length === 0) return `No follow-ups with status='${status}'.`;
    const lines: string[] = [`📋 Follow-ups (${status}): ${data.length}`];
    for (const f of data as any[]) {
      const when = new Date(f.due_at).toISOString().slice(0, 16).replace("T", " ");
      const srf = f.surfaced_at ? " 🔔" : "";
      const det = f.detail ? ` — ${String(f.detail).slice(0, 80)}` : "";
      lines.push(`• ${f.id.slice(0, 8)} due ${when}${srf}: ${f.topic}${det}`);
    }
    return lines.join("\n");
  }
}

export class CompleteFollowupTool implements Tool {
  definition: ToolDefinition = {
    name: "complete_followup",
    description: "Mark a follow-up done after Ace confirms the thread is closed.",
    parameters: { id: { type: "string", description: "Followup id (full UUID or first 8 chars)." } },
    required: ["id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idArg = String(args.id || "").trim();
    if (!idArg) return "complete_followup: id is required.";
    const supabase = await sb();
    let q = supabase.from("sapphire_followups").update({ status: "done" });
    if (idArg.length < 36) q = q.like("id", `${idArg}%`);
    else q = q.eq("id", idArg);
    const { data, error } = await q.select("id, topic");
    if (error) return `complete_followup: ${error.message}`;
    if (!data || data.length === 0) return `No followup matched id starting with ${idArg}.`;
    return `Marked done: ${(data[0] as any).topic}`;
  }
}

export class CancelFollowupTool implements Tool {
  definition: ToolDefinition = {
    name: "cancel_followup",
    description: "Cancel a follow-up Ace decides isn't worth surfacing anymore.",
    parameters: { id: { type: "string", description: "Followup id (full UUID or first 8 chars)." } },
    required: ["id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idArg = String(args.id || "").trim();
    if (!idArg) return "cancel_followup: id is required.";
    const supabase = await sb();
    let q = supabase.from("sapphire_followups").update({ status: "cancelled" });
    if (idArg.length < 36) q = q.like("id", `${idArg}%`);
    else q = q.eq("id", idArg);
    const { data, error } = await q.select("id, topic");
    if (error) return `cancel_followup: ${error.message}`;
    if (!data || data.length === 0) return `No followup matched id starting with ${idArg}.`;
    return `Cancelled: ${(data[0] as any).topic}`;
  }
}

// Used by the scheduler — reads pending follow-ups due now, marks them surfaced,
// and returns the list so the caller can DM them. Idempotent.
export async function fetchAndSurfaceDueFollowups(): Promise<Array<{ id: string; topic: string; detail?: string | null; source_excerpt?: string | null; due_at: string }>> {
  if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return [];
  const supabase = await sb();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("sapphire_followups")
    .select("id, topic, detail, source_excerpt, due_at")
    .eq("status", "pending")
    .is("surfaced_at", null)
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(10);
  if (error || !data || data.length === 0) return [];
  const ids = (data as any[]).map((r) => r.id);
  await supabase.from("sapphire_followups").update({ surfaced_at: nowIso }).in("id", ids);
  return data as any[];
}
