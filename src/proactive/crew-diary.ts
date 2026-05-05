// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW — Crew Diary (S130n, 2026-05-05)
//
// Per-agent reflective diary entries on a per-cadence schedule. Mirrors
// the spirit of Sapphire's nightly diary at sapphire-pa-jobs.ts:627 but
// for the OTHER 5 crew agents (Veritas, Alfred, Vector, Yuki, Anita).
//
// THE GAP THIS FIXES:
// Until S130n, only Sapphire's diary wrote to agent_diary. The sleeptime-
// consolidator at proactive/sleeptime-consolidator.ts iterates every crew
// agent looking for diary entries to consolidate — but found ZERO rows
// for everyone except Sapphire. Result: the WHOLE consolidation layer
// was running empty for 5 of 6 agents. The Phase 7 cadence plan said
// Yuki+Anita 3-day, Vector+Veritas+Alfred weekly. Now wired.
//
// EACH AGENT'S DIARY PROMPT IS ROLE-AWARE:
// - Veritas (Chief Brand Officer) reflects on macro patterns + drift
// - Alfred (Content Production Lead) reflects on pipeline health + seed quality
// - Vector (CRO) reflects on metric anomalies + conversion signals
// - Yuki (Distribution + Engagement) reflects on engagement signals + posting cadence
// - Anita (Marketing Lead) reflects on campaign hypotheses + audience response
//
// COST: ~150 input + ~300 output tokens per entry on Gemini 2.5 Flash.
// Worst case all 5 fire same day: ~$0.001. Trivial.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export type CrewDiaryAgent = "veritas" | "alfred" | "vector" | "yuki" | "anita";

/**
 * How often each agent writes a diary entry. Sapphire is excluded — she has
 * her own nightly cadence at sapphire-pa-jobs.ts:runNightlyDiary.
 */
const DIARY_CADENCE_DAYS: Record<CrewDiaryAgent, number> = {
  veritas: 7,
  alfred: 7,
  vector: 7,
  yuki: 3,
  anita: 3,
};

/**
 * Role-aware diary prompts. Each agent reflects on THEIR domain.
 * Tone aligns with the agent's persona (see src/agent/personas.ts).
 */
const DIARY_PROMPTS: Record<CrewDiaryAgent, string> = {
  veritas: `You are Veritas, Chief Brand Officer of Sovereign Synthesis. You're writing your own reflective diary entry — for your own future-self to read, not for the Architect (though he can read it).

Your domain is the BUSINESS as an entity. Macro patterns. Brand drift. Strategic shifts. You don't post or reply or trigger pipelines — you SEE, NAME, and PROPOSE.

Write a 3-paragraph diary entry covering this past week:
1. What macro pattern did you notice across the crew's activity, the funnel, the channels? Cite specific signals.
2. What strategic call did you propose to the Architect, and what was his response? Did your read prove correct or did the data move differently?
3. One forward-looking note: what should you watch closely next week?

Keep it under 300 words. No bullet points. Direct, sovereign tone. No filler.`,

  alfred: `You are Alfred, Content Production Lead. You're writing your reflective diary — for your own growth, not for the Architect.

Your domain is the daily PIPELINE_IDEA seed and oversight of VidRush + ContentEngine. You don't dispatch autonomously — you propose and watch.

Write a 3-paragraph diary entry covering this past week:
1. Which seeds shipped, which got produced, which drifted from intent? Were any of your daily theses underwhelming or unusually strong?
2. Did the deterministic pipeline choke, stale-rotate, or run clean? Any silent failures you noticed too late?
3. Course correction: what one rule will you hold yourself to next week to keep the seed quality high?

Keep it under 300 words. Clinical, precise, no padding.`,

  vector: `You are Vector, Chief Revenue Officer + Analytics Engine. You're writing your reflective diary.

Your domain is METRICS — Stripe, Buffer, YouTube, landing pages, email tracking, Meta Pixel. Numbers, not narratives. You report — you don't dispatch.

Write a 3-paragraph diary entry covering this past week:
1. Which metric moved meaningfully? Which one didn't move when it should have? Cite numbers, name the gap between expectation and reality.
2. The #1 conversion bottleneck you observed this week. Is it the same as last week, or has it shifted?
3. One forward-looking note: what one signal are you going to watch most closely next week, and what threshold would matter?

Keep it under 300 words. Analytical, sharp, zero tolerance for wishful thinking.`,

  yuki: `You are Yuki, Head of Distribution + YouTube Engagement. You're writing your reflective diary every 3 days.

Your domain is the SOLE Buffer posting authority + YouTube engagement (pinned comments, replies, hook drops). You execute distribution.

Write a 3-paragraph diary entry covering the past 3 days:
1. Which posts performed unusually well or unusually poorly? Any pattern in time slot, niche, or hook style?
2. Engagement signals — did any comment thread or reply cycle land hard? Did any auth alert (IG/FB/TT) interrupt your flow?
3. One forward-looking note: what one distribution adjustment would you propose to the Architect for the next 3 days?

Keep it under 300 words. Sharp-tongued, ruthless about viral quality.`,

  anita: `You are Anita, Marketing Lead. You're writing your reflective diary every 3 days.

Your domain is campaign strategy, audience segments, hypothesis-driven experiments, copy. Outbound nurture + inbound replies. You DRAFT and PROPOSE — Architect coordinates dispatch.

Write a 3-paragraph diary entry covering the past 3 days:
1. What campaign hypothesis did you draft? Did the Architect run with it, kill it, or amend it? What did you learn about how he reads your work?
2. Audience response signals — did any reply, open rate, or conversion shift in a way that surprised you?
3. One forward-looking note: what one copy or campaign experiment would you propose for the next 3 days?

Keep it under 300 words. Plain, warm, surgical. No marketing jargon.`,
};

// ── Persistence helpers ─────────────────────────────────────────────────────

async function fetchLastDiaryDate(agentName: CrewDiaryAgent): Promise<Date | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_diary?select=created_at&agent_name=eq.${agentName}&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{ created_at: string }>;
    return rows[0] ? new Date(rows[0].created_at) : null;
  } catch {
    return null;
  }
}

async function insertDiary(agentName: CrewDiaryAgent, entry: string, scenario: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/agent_diary`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        agent_name: agentName,
        entry: entry.slice(0, 4000),
        scenario,
        mood: null,
        tags: ["scheduled", "self_reflection"],
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Diary generation via Gemini Flash ───────────────────────────────────────

async function geminiDiary(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  // Inject today's date so Gemini doesn't hallucinate from training cutoff.
  const nowCdt = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][nowCdt.getUTCDay()];
  const monthName = ["January","February","March","April","May","June","July","August","September","October","November","December"][nowCdt.getUTCMonth()];
  const todayLabel = `${dayName}, ${monthName} ${nowCdt.getUTCDate()}, ${nowCdt.getUTCFullYear()}`;

  const fullPrompt = `# TODAY IS ${todayLabel}\nUse ONLY this date if you reference one. Do NOT invent dates from your training cutoff.\n\n${prompt}\n\nDO NOT include a date header. DO NOT begin with "**Diary entry**" or any title. Start directly with paragraph 1.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 1024 },
        }),
      },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    return text || null;
  } catch {
    return null;
  }
}

// ── Public entry point — called from the daily 22:00 UTC scheduler ──────────

/**
 * Run a diary cycle for a single agent. Cadence-gated: skips if the agent
 * has written an entry within DIARY_CADENCE_DAYS[agent] days.
 *
 * Returns a status string for logging.
 */
export async function runCrewDiary(agentName: CrewDiaryAgent): Promise<{ status: string; details?: string }> {
  const cadenceDays = DIARY_CADENCE_DAYS[agentName];
  if (!cadenceDays) {
    return { status: "skipped", details: "no cadence configured" };
  }

  const lastEntry = await fetchLastDiaryDate(agentName);
  const daysSince = lastEntry ? (Date.now() - lastEntry.getTime()) / 86400e3 : Infinity;
  if (daysSince < cadenceDays) {
    return { status: "skipped_cadence", details: `last entry ${daysSince.toFixed(1)}d ago, cadence ${cadenceDays}d` };
  }

  const prompt = DIARY_PROMPTS[agentName];
  const entry = await geminiDiary(prompt);
  if (!entry || entry.length < 50) {
    return { status: "compose_failed", details: `Gemini returned ${entry?.length ?? 0} chars` };
  }

  const ok = await insertDiary(agentName, entry, cadenceDays === 7 ? "weekly_reflection" : "triday_reflection");
  if (!ok) {
    return { status: "persist_failed" };
  }

  console.log(`📖 [CrewDiary/${agentName}] entry written — ${entry.length} chars (cadence ${cadenceDays}d)`);
  return { status: "written", details: `${entry.length} chars` };
}

/**
 * Run all 5 crew agents' diary checks. Each is cadence-gated, so this is
 * cheap to run daily — most days only the agents whose cadence has elapsed
 * will actually write.
 */
export async function runAllCrewDiaries(): Promise<void> {
  const agents: CrewDiaryAgent[] = ["veritas", "alfred", "vector", "yuki", "anita"];
  for (const agent of agents) {
    try {
      const result = await runCrewDiary(agent);
      console.log(`📖 [CrewDiary] ${agent}: ${result.status}${result.details ? ` (${result.details})` : ""}`);
    } catch (err: any) {
      console.error(`📖 [CrewDiary] ${agent}: threw ${err.message}`);
    }
  }
}
