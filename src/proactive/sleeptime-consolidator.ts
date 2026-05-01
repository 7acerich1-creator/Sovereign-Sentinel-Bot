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

export async function runSleeptimeConsolidation(): Promise<void> {
  const startedAt = Date.now();
  console.log(`💤 [Sleeptime] Starting consolidation for ${new Date().toISOString().slice(0, 10)}`);

  const supabase = await getSupabase();

  // Window: 24h ending now (Architect's "yesterday" because we run during his sleep)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1. Fetch yesterday's diary entries
  let diaryRows: any[] = [];
  try {
    const { data, error } = await supabase
      .from("sapphire_diary")
      .select("text, tags, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn(`[Sleeptime] diary fetch error: ${error.message}`);
      return;
    }
    diaryRows = data || [];
  } catch (e: any) {
    console.warn(`[Sleeptime] diary fetch threw: ${e.message}`);
    return;
  }

  if (diaryRows.length === 0) {
    console.log(`[Sleeptime] No diary entries in last 24h. Nothing to consolidate.`);
    return;
  }

  // 2. Summarize via Gemini Flash Lite
  const entries = diaryRows.map((r: any) => String(r.text || "").slice(0, 500));
  const summary = await summarizeYesterday(entries);
  if (!summary) {
    console.warn(`[Sleeptime] Gemini summary failed or returned empty. Using fallback.`);
    // Fallback: just count entries
    const fallback = `Yesterday: ${diaryRows.length} diary entries (no LLM summary available).`;
    await writeSignificance(supabase, fallback, "fallback");
    return;
  }

  // 3. Write significance record (table already exists from prior diary work)
  await writeSignificance(supabase, summary, "consolidated");

  // 4. Update core memory's 'recent_themes' slot with the consolidation
  try {
    const today = new Date().toISOString().slice(0, 10);
    const themeLine = `[${today}] ${summary}`;
    // Read current 'recent_themes' content
    const { data: existing } = await supabase
      .from("sapphire_core_memory")
      .select("content")
      .eq("slot", "recent_themes")
      .maybeSingle();
    let next = existing?.content
      ? `${existing.content}\n${themeLine}`
      : themeLine;
    // Cap at 800 chars; keep most recent
    if (next.length > 800) {
      next = next.slice(next.length - 800);
      const firstNl = next.indexOf("\n");
      if (firstNl > 0 && firstNl < 200) next = next.slice(firstNl + 1);
    }
    await supabase
      .from("sapphire_core_memory")
      .upsert(
        { slot: "recent_themes", content: next, updated_at: new Date().toISOString(), updated_by: "sleeptime_consolidator" },
        { onConflict: "slot" },
      );
  } catch (e: any) {
    console.warn(`[Sleeptime] core_memory update failed: ${e.message}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`💤 [Sleeptime] Consolidation complete: ${diaryRows.length} entries → 1 significance record. ${elapsed}s`);
}

async function writeSignificance(supabase: any, summary: string, kind: string): Promise<void> {
  try {
    await supabase.from("sapphire_significance").insert({
      content: summary,
      kind: `sleeptime_${kind}`,
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    // Table may not exist on older deployments; log and continue.
    console.warn(`[Sleeptime] significance write failed (table may not exist): ${e.message}`);
  }
}
