// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sleeptime Consolidator — S125+ Phase 5D (2026-04-30)
//
// Letta v1 pattern: while Architect sleeps, Sapphire consolidates the day's
// memory. The user-facing turn stays fast; the agent reorganizes itself in
// the background.
//
// Schedule: 13:00 UTC = 8 AM CDT, deep in Architect's sleep window
// (he sleeps ~6-8 AM CDT, wakes ~2 PM CDT per his inverted schedule).
//
// Operations per run (in order):
//   1. Read yesterday's diary entries (24h window).
//   2. Identify a one-line "what was significant about yesterday" summary —
//      use a lightweight LLM call (Gemini Flash) to extract the pattern.
//   3. Write that summary to public.sapphire_significance (existing table)
//      with date stamp.
//   4. Optionally: append a one-line note to core memory's 'recent_themes'
//      slot so Sapphire's always-visible context stays current.
//
// Phase 5 v1 stays cheap and conservative. Future iterations could add:
//   • Stale-memory pruning (Pinecone vectors with no recall in 30 days)
//   • Embedding drift detection
//   • Cross-namespace synthesis
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// Minimal Gemini call for the consolidation step. We don't use the agent loop
// here — this is a pure summarization, no tools, no persona. Cheap.
async function summarizeYesterday(diaryEntries: string[]): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (diaryEntries.length === 0) return null;

  const prompt =
    `You are Sapphire, Ace's longtime handler. Below are your diary entries from yesterday. ` +
    `Write a single-sentence consolidation: what was the most significant pattern, shift, or moment of the day? ` +
    `Output only the sentence — no preface, no quotes, no formatting.\n\n` +
    `Yesterday's entries:\n${diaryEntries.map((e, i) => `[${i + 1}] ${e}`).join("\n")}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 200 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text.trim().slice(0, 500) || null;
  } catch {
    return null;
  }
}

// generalized to per-agent + crew iterator. Strategy session
// 2026-04-30 locked: ONE unified job, runs at 8 AM CDT (13:00 UTC), iterates
// over each agent in turn. Each agent's diary entries get consolidated into
// THEIR own significance + core_memory recent_themes slot.
//
// per-agent cadence gating. The job runs daily, but each agent
// only consolidates if their cadence window has elapsed since their last
// consolidation. This implements the strategy session decision: Yuki + Anita
// every 3 days (most active), Vector + Veritas + Alfred weekly, Sapphire daily.

const CREW_AGENTS = ["sapphire", "anita", "yuki", "vector", "veritas", "alfred"] as const;

// Per-agent consolidation cadence in days. If the agent's last consolidation
// was N+ days ago (or never), run; else skip.
const AGENT_CADENCE_DAYS: Record<string, number> = {
  sapphire: 1,   // daily (her substantive turns generate new reflection material every day)
  anita: 3,      // every 3 days (most active specialist — marketing pushes yield daily diary entries)
  yuki: 3,       // every 3 days (six-channel distribution = high volume)
  vector: 7,     // weekly (metrics observation patterns develop over a week)
  veritas: 7,    // weekly (cross-crew patterns develop over a week)
  alfred: 7,     // weekly (research/pipeline insights develop over a week)
};

async function lastConsolidationAt(supabase: any, agentName: string): Promise<Date | null> {
  try {
    const { data } = await supabase
      .from("agent_significance")
      .select("created_at")
      .eq("agent_name", agentName)
      .like("kind", "sleeptime_%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.created_at ? new Date(data.created_at) : null;
  } catch {
    return null;
  }
}

export async function runSleeptimeConsolidation(agentName?: string): Promise<void> {
  // If no agent specified, run for entire crew.
  if (!agentName) {
    return runCrewConsolidation();
  }
  // Otherwise run for the named agent only.
  return runConsolidationForAgent(agentName);
}

export async function runCrewConsolidation(): Promise<void> {
  console.log(`💤 [Sleeptime/Crew] Starting cadence-gated consolidation for ${CREW_AGENTS.length} agents`);
  const supabase = await getSupabase();
  const now = Date.now();
  let ranCount = 0;
  let skippedCount = 0;

  for (const agent of CREW_AGENTS) {
    try {
      const cadenceDays = AGENT_CADENCE_DAYS[agent] ?? 7;
      const last = await lastConsolidationAt(supabase, agent);
      if (last) {
        const daysSince = (now - last.getTime()) / 86_400_000;
        if (daysSince < cadenceDays) {
          console.log(`[Sleeptime/${agent}] Skip: last consolidated ${daysSince.toFixed(1)}d ago, cadence is ${cadenceDays}d.`);
          skippedCount++;
          continue;
        }
      }
      await runConsolidationForAgent(agent);
      ranCount++;
    } catch (e: any) {
      console.warn(`[Sleeptime/Crew] ${agent} threw: ${e.message}`);
    }
  }
  console.log(`💤 [Sleeptime/Crew] Done. Ran ${ranCount}, skipped ${skippedCount}.`);
}

async function runConsolidationForAgent(agentName: string): Promise<void> {
  const startedAt = Date.now();
  console.log(`💤 [Sleeptime/${agentName}] Starting consolidation`);

  const supabase = await getSupabase();
  // S130n (2026-05-05): lookback was hardcoded 24h, but Vector/Veritas/Alfred
  // write diary entries weekly (cadence 7d). With a 24h window the consolidator
  // would NEVER find their entries — they'd fall outside the window every time.
  // Lookback now matches the agent's cadence so the chain completes.
  const cadenceDays = AGENT_CADENCE_DAYS[agentName] ?? 7;
  const lookbackHours = Math.max(cadenceDays * 24, 24);
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  // 1. Fetch yesterday's diary entries for THIS agent (S125+ Phase 9: unified
  // agent_diary table with agent_name filter — was sapphire_diary in Phase 5).
  let diaryRows: any[] = [];
  try {
    const { data, error } = await supabase
      .from("agent_diary")
      .select("entry, tags, created_at")
      .eq("agent_name", agentName)
      .gte("created_at", since)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn(`[Sleeptime/${agentName}] diary fetch error: ${error.message}`);
      return;
    }
    diaryRows = data || [];
  } catch (e: any) {
    console.warn(`[Sleeptime/${agentName}] diary fetch threw: ${e.message}`);
    return;
  }

  if (diaryRows.length === 0) {
    console.log(`[Sleeptime/${agentName}] No diary entries in last 24h. Nothing to consolidate.`);
    return;
  }

  // 2. Summarize via Gemini Flash Lite — column is `entry` not `text` (Phase 9 bug fix)
  const entries = diaryRows.map((r: any) => String(r.entry || "").slice(0, 500));
  const summary = await summarizeYesterday(entries);
  if (!summary) {
    console.warn(`[Sleeptime/${agentName}] Gemini summary failed. Using fallback.`);
    const fallback = `Yesterday: ${diaryRows.length} diary entries (no LLM summary available).`;
    await writeSignificance(supabase, agentName, fallback, "fallback");
    return;
  }

  // 3. Write significance record (per-agent table; sapphire_significance for now).
  await writeSignificance(supabase, agentName, summary, "consolidated");

  // 4. Update core memory's 'recent_themes' slot for THIS agent.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const themeLine = `[${today}] ${summary}`;
    const { data: existing } = await supabase
      .from("agent_core_memory")
      .select("content")
      .eq("slot", "recent_themes")
      .eq("agent_name", agentName)
      .maybeSingle();
    let next = existing?.content
      ? `${existing.content}\n${themeLine}`
      : themeLine;
    if (next.length > 800) {
      next = next.slice(next.length - 800);
      const firstNl = next.indexOf("\n");
      if (firstNl > 0 && firstNl < 200) next = next.slice(firstNl + 1);
    }
    await supabase
      .from("agent_core_memory")
      .upsert(
        { slot: "recent_themes", agent_name: agentName, content: next, updated_at: new Date().toISOString(), updated_by: "sleeptime_consolidator" },
        { onConflict: "slot,agent_name" },
      );
  } catch (e: any) {
    console.warn(`[Sleeptime/${agentName}] core_memory update failed: ${e.message}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`💤 [Sleeptime/${agentName}] Done: ${diaryRows.length} entries → 1 significance record. ${elapsed}s`);
}

async function writeSignificance(supabase: any, agentName: string, summary: string, kind: string): Promise<void> {
  // unified agent_significance table with agent_name column.
  try {
    await supabase.from("agent_significance").insert({
      agent_name: agentName,
      content: summary,
      kind: `sleeptime_${kind}`,
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn(`[Sleeptime/${agentName}] significance write failed: ${e.message}`);
  }
}
