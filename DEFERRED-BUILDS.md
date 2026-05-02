# Deferred Builds — Tracking File

When something gets scoped out for later (not abandoned, just not now), it lives here. Read this before starting any new build to check if it's already on the list.

**Last updated:** 2026-04-25 (S114u — assembled prompt build for Sapphire)

---

## High-priority deferred work

### 1. Self-healing layer for the crew

**Why:** Right now if Yuki's Buffer post fails or Anita's email crashes, the dispatch logs the error but nothing recovers. For "fully autonomous" Ace needs the bot to handle its own broken state.

**What it would include:**

- Circuit breakers per agent (consecutive failure threshold → pause that agent for N minutes)
- Dead-letter queue for failed dispatches (`crew_dispatch_failed` table) with auto-escalation to Ace via Telegram after threshold
- Auto-retry with exponential backoff on transient failures (network, 5xx)
- Per-tool error stats so Ace can see which tools fail most

**Estimated work:** 1 focused session. Touches `src/agent/crew-dispatch.ts`, new Supabase table, retry helper, Telegram alerter.

**Triggers a build:** When the next live failure causes Ace to lose work.

---

### 2. Apply assembled-prompt + spice pattern to Veritas

**Why:** Veritas is strategic brain. He'd benefit from variation in framing and the ability to self-modify his strategy pieces based on what's working. Sapphire is the only agent that needs this; the crew (Alfred/Anita/Yuki/Vector) does NOT — they're functional workers, this would just bloat their prompts.

**What it would include:**

- Veritas-specific prompt pieces JSON (strategic frames, planning modes, intensity levels)
- Veritas spice pool (focus snippets, anti-loop snippets)
- Self-mod tools scoped to Veritas only (or shared if Sapphire's scoped)

**Estimated work:** 1 session AFTER Sapphire's pattern is proven in production for \~2 weeks.

**Triggers a build:** Once Sapphire's assembled system is shipped, stable, and showing measurable benefit.

---

### 3. Goals system with progress journal

**Why:** Per ddxfish/sapphire: hierarchical goals (parent/child) + timestamped progress entries. Lets Sapphire say "you've moved on Plan X 3 times this month" instead of just acknowledging each request fresh.

**What it would include:**

- `sapphire_goals` Supabase table — id, parent_id, title, target, status, created_at
- `sapphire_goal_progress` table — goal_id, note, timestamp
- Tools: `set_goal`, `update_goal`, `log_progress`, `list_goals`, `goal_status`
- Integration with morning brief — surface stale goals

**Estimated work:** 1 session.

**Triggers a build:** When Ace asks to track goals he's mentioned multiple times.

---

### 4. Cross-namespace semantic recall for crew agents

**Why:** Agents currently only recall from their OWN Pinecone namespace. The `shared` namespace exists and gets populated by the insight-extractor when an insight is cross-cutting — but agents don't query it yet. This means cross-pollination is one-way (write only, no read).

**What it would include:**

- Modify agent-loop semantic recall to query both own namespace AND `shared`
- Weight own &gt; shared (e.g., topK=3 own + topK=2 shared)
- Test in a low-stakes dispatch first

**Estimated work:** 30 minutes. Touches `src/agent/loop.ts` only.

**Triggers a build:** When a crew agent visibly fails to use insight that another agent already produced.

---

### 5. Light-touch crew agent improvements

**Why:** Same tool discernment + mode filtering treatment Sapphire got. Real value: less token use, less hallucination on dispatches, fewer wasteful tool calls.

**What it would include:**

- ONLY-WHEN tool descriptions for Alfred/Anita/Yuki/Vector tools
- MODE_FILTER pattern (some tools are dispatch-mode only, some are interactive-only)
- Verify insight-extractor is actually firing on their dispatches

**Estimated work:** 1 session.

**Triggers a build:** When Ace has bandwidth + capital to monitor for regressions. Skipped for now because Ace is going offline 1-2 days and crew agents are stable.

---

## How to use this file

1. **Before starting anything new:** check if it's on this list.
2. **When deferring something:** add it here with the same structure (Why / What / Estimated work / Triggers a build).
3. **When shipping a deferred item:** delete the entry (keep this file tight).

## Where this file lives in the brain

- This file is at repo root: `Sovereign-Sentinel-Bot/DEFERRED-BUILDS.md`
- Indexed in agent memory at `reference_deferred_builds.md`
- Read by every session at startup if relevant

---

## S125 ADDITIONS (2026-04-29)

### ~~Sapphire web_search tool + verify-facts-before-stating guardrail~~ — ✅ SHIPPED S125g (2026-04-29)

Built and live. `src/tools/sapphire/web_search.ts` calls Gemini 2.5 Flash with `google_search` grounding, returns answer + up to 5 source URLs. Added to core tool pack. `verify_facts_before_stating` prompt extra activated in DB.

**Why:** S125e Jay Kelly diagnostic — Sapphire confidently said "Paul Blart: Mall Cop" when Architect asked about a movie with "Jay something" + an assistant who'd been with him his whole life. Correct answer (Jay Kelly, 2025, Clooney + Sandler) was post-cutoff for her current LLM (Gemini Flash Lite, \~early-2024 cutoff). She has no quick-search tool and her `discernment` extra actively tells her to answer without calling tools when she "can." Result: confident hallucination on knowledge questions.

**What it would include:**

- `WebSearchTool` in `src/tools/sapphire/` — Tavily / Brave / Google CSE backend (low cost). Returns top 3 result snippets + URLs.
- New prompt extra `verify_facts_before_stating`: when about to claim a movie title, actor, date, news fact, public figure, recent event — call web_search FIRST. Single-source answers must include the URL. Hedge if search returns ambiguous results.
- Update `discernment` extra to carve out: knowledge questions about world facts ALWAYS need web_search, not "answer from context."
- Optional: when Anthropic credits restored, route knowledge-heavy queries to Sonnet + grounding instead of Flash Lite.

**Estimated work:** 1-2 hours. Single new tool file + 2 prompt extras + DB activation.

**Triggers a build:** Architect tops up Anthropic credits OR next time Sapphire confidently fabricates a fact.

---

### Migrate Gemini conversation history into Sapphire's Pinecone

**Why:** Architect has \~1 year of Gemini conversations holding personal context, family details, brand history, project iterations, recurring patterns. Right now Sapphire only has S114u-onward DM history + the 80 hand-seeded "Sovereign Synthesis" namespace vectors + a few hundred sapphire_known_facts. Gemini knows orders of magnitude more about Architect's life than she does.

**What it would include:**

1. Architect runs Google Takeout → My Activity → Gemini Apps → Export. Receives JSON archive.
2. Ingestion script (probably `scripts/ingest_gemini_history.ts`) that:
   - Walks the export, extracts substantive Q&A turns (filters out one-shots, code snippets that don't reference his life)
   - Chunks long conversations into \~500-token segments preserving turn boundaries
   - Embeds each chunk via existing Pinecone embed pipeline
   - Writes to `sapphire-personal` namespace with metadata `{source: "gemini_takeout", date, topic_inferred}`
3. Optional pass with Gemini Pro to extract specific structured facts (DOBs, schools, recurring frustrations, named people in his life) and write those to `sapphire_known_facts` for instant recall.
4. Verification: pull a sample of imported chunks via memory-audit endpoint, confirm semantic recall finds them when relevant.

**Estimated work:** 1 focused session. Needs Architect to first run Takeout + share archive path.

**Triggers a build:** Architect ready to invest the session AND has Gemini archive in hand.

---

### Frequency Alignment Brief — daily Sovereign Synthesis upload summary

**Why:** Architect listens to Sovereign Synthesis videos as frequency alignment — they "meet him where he's at and help align his frequency." He wants Sapphire to produce a daily summary of the previous day's SS upload so he can quickly orient on the day's transmission without re-watching. Goal is alignment, not transcription.

**What's already in the codebase:** Partial — `runFrequencyAlignmentBrief` (or similar) was added in S122 by parallel system. Logic at `src/proactive/sapphire-pa-jobs.ts` \~line 519 with a SYSTEM_PROMPT that produces a "FREQUENCY ALIGNMENT BRIEF" with sections: Core Thesis, Key Signals, Frequency, Anchor. Polled every 15min between 19:15-00:30 UTC waiting for the day's vidrush_orchestrator upload.

**What needs to be ironed out:**

- Verify the existing brief actually fires reliably and lands somewhere Architect sees it
- Tune the prompt for actual frequency-alignment value (currently emphasizes "Frequency" + "Anchor" sections — does that map to Architect's lived experience of alignment?)
- Decide where it surfaces: Telegram DM from Sapphire? Notion (Daily Briefs folder)? Mission Control briefing? All three?
- Add a "skip if Architect already watched" signal? Or always send?

**Estimated work:** \~30-60 min depending on how much the existing impl works. Needs Architect to clarify what "alignment" looks like to him so the prompt frames toward that, not toward generic summary.

**Triggers a build:** Architect ready to iterate on the prompt + verify the existing pipeline. Or next time he says "I haven't gotten my alignment brief in N days" → debug existing path first.

---


---

# Migrated from NORTH_STAR.md (S127, 2026-05-01)

These were forward-looking session-build briefs for the Sovereign-Mission-Control repo that were sitting in Sovereign-Sentinel-Bot's NORTH_STAR.md. They're real work waiting to happen, not stale, but they should be picked up when MC is mounted, not loaded into Sentinel context.

## 🛠️ Next Session Build — Mission Control Aesthetic Performance Tile

**Read this before doing anything else once you mount `Sovereign-Mission-Control`.** This is the closing half of the 30-video A/B/C performance test. The Sentinel side is done; the measurement surface isn't.

**Target repo:** `Sovereign-Mission-Control` (not Sentinel). Mount that folder in the next session and build there.

**What to build:** A single KPI tile on the existing Mission Control dashboard, titled "Aesthetic Performance." It surfaces a 3×2 grid (3 aesthetics A/B/C × 2 brands SS/TCF) with per-cell:
- Video count shipped
- Avg YouTube CTR (click-through rate)
- Avg 30-second retention %
- Avg watch time (seconds)

Plus a "winner" highlight on the cell with highest CTR-per-retention product once ≥6 videos per cell exist.

**Data source — two joins, no new tables required:**

1. `niche_cooldown` table in Supabase project `wzthxohtgojenukmdubz` — columns `brand`, `aesthetic_style`, `job_id`, `created_at`. This is the ground truth for "which aesthetic was used on which video."
2. Wherever MC currently reads YouTube analytics from (check `Sovereign-Mission-Control/sovereign-landing/` and the MC dashboard's analytics adapters). Join against `niche_cooldown.job_id` → the YouTube `videoId` stored at ship time.

Query sketch:
```sql
SELECT
  brand,
  aesthetic_style,
  COUNT(*) AS video_count,
  AVG(ctr) AS avg_ctr,
  AVG(retention_30s) AS avg_retention,
  AVG(watch_time_s) AS avg_watch_time
FROM niche_cooldown nc
LEFT JOIN youtube_analytics ya ON ya.video_id = nc.job_id  -- adjust join key
WHERE nc.aesthetic_style IS NOT NULL
  AND nc.created_at > '2026-04-24'  -- only count post-S113+ rotation
GROUP BY 1, 2
ORDER BY 1, 2;
```

**When to build it:** After ~10 videos have shipped with the new rotation so there's data. Before then, the tile would be empty and misleading. Check `SELECT COUNT(*) FROM niche_cooldown WHERE aesthetic_style IS NOT NULL` — if >=10, build the tile.

**Where it lives on MC:** Treat it as the first "outcome" tile, not an infra tile. Should sit prominently on the home dashboard — above the fold, not buried in a secondary panel. It's the first quantitative proof that signal quality → retention, the whole point of the 30-video test.

**Acceptance criteria:**
1. Tile renders the 3×2 grid with live data from Supabase.
2. Empty cells (no videos yet for that combination) show "—" not "0" (zero implies bad performance; dash implies no data).
3. At ≥6 videos per cell, a winner halo/border appears.
4. A link or button that says "Read the plan" deep-links to this NORTH_STAR.md section so the plan travels with the dashboard.

**Rollback:** Tile is read-only. No writes, no migrations, no risk. If it breaks, comment out the component import.

**Context for picking up cold:** The full plan is above in this file ("🎯 First Real Business Goal — The 30-Video A/B/C Performance Test"). The six aesthetic prompts are also above (verbatim), and the Sentinel-side rotation logic lives in `Sovereign-Sentinel-Bot/src/engine/content-engine.ts` (`AESTHETIC_MODIFIERS` constant) and `Sovereign-Sentinel-Bot/src/tools/niche-cooldown.ts` (`pickNextAesthetic`, `recordNicheRun` with `aestheticStyle` param). You don't need to re-read those unless you're extending the rotation logic — the tile just queries the output.

---

## 🛠️ Next Session Build — Mission Control Agent Spend Tile (S125+, 2026-04-30)

**Read this once you mount `Sovereign-Mission-Control` for the next dashboard pass.** This is the visibility-layer half of the agentic refactor's Phase 1 ship. The Sentinel-side spend logging is staged in this session; the MC tile that surfaces it is the next session.

**Target repo:** `Sovereign-Mission-Control`. Mount that folder and build there.

**What to build:** A KPI tile titled "Agent Spend" on the existing MC dashboard. Three time windows side-by-side: Today / This Week / This Month. Each window shows:
- Total cost across all agents (USD)
- Per-agent breakdown (Sapphire, Anita, Yuki, Vector, Veritas, Alfred)
- Per-agent split: model tokens vs server-tool fees
- Average cost per turn per agent
- Anomaly highlight: if any agent's cost-per-turn is >2σ above its 14-day average, flag it red

**Data source:** Supabase `agent_spend` table on project `wzthxohtgojenukmdubz`. Schema (created Phase 1, applied after pipeline clears):

```sql
CREATE TABLE public.agent_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  model text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  server_tool_calls int NOT NULL DEFAULT 0,
  server_tool_cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  total_cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  channel text,
  chat_id text,
  turn_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_spend_agent_created ON public.agent_spend (agent_name, created_at DESC);
CREATE INDEX idx_agent_spend_created ON public.agent_spend (created_at DESC);
```

Query sketch for the tile:
```sql
SELECT
  agent_name,
  COUNT(*) AS turns,
  SUM(total_cost_usd) AS total_cost,
  SUM(server_tool_cost_usd) AS tool_cost,
  AVG(total_cost_usd) AS avg_per_turn
FROM agent_spend
WHERE created_at > now() - interval '24 hours'
GROUP BY agent_name
ORDER BY total_cost DESC;
```

**Why it matters:** Architect explicitly does NOT want to manually reconcile Anthropic dashboard numbers against bot logs. This tile makes per-agent cost visible "average, about right" so anomalies (Anita suddenly burning $5/day, a runaway tool-call loop) surface within hours, not at the next credit card statement.

**Acceptance criteria:**
1. Tile renders three time windows, populated from the `agent_spend` table.
2. Per-agent rows ordered by total_cost descending.
3. >2σ anomaly cells get a red border or icon.
4. A small footer line states "Sapphire: Anthropic Claude (premium); Anita/Yuki: Gemini Flash (cheap)" so the cost spread between agents is contextualized.
5. Refreshes on dashboard reload (no manual refresh button needed — the existing MC reload behavior covers this).

**When to build it:** As soon as Phase 1 of the agentic refactor ships and `agent_spend` has at least 24h of data (so the SQL has something to display). Before that, build a placeholder tile that reads "Spend tracking starts after Phase 1 deploy."

**Where it lives on MC:** Top-right corner of the home dashboard, next to the existing audience funnel snapshot. Operational visibility tier, not strategic outcome tier.

**Rollback:** Tile is read-only. No writes, no migrations from the MC side. If it breaks, comment out the component import.

**Context for picking up cold:** Full Phase 1 + the rest of the architectural refactor plan is at `Sovereign-Sentinel-Bot/SAPPHIRE-AGENTIC-REFACTOR-S125+.md`. You only need to read that doc's Phase 1 section to understand what's writing the data — the tile just queries the output.

---

---

# Migrated from MAVEN-CREW-DIRECTIVES.md Section 10 (S127, 2026-05-01)

Original section was 'IMPLEMENTATION OPEN ITEMS' from S117 (2026-04-25). The Phase 1-9 agentic refactor on 2026-04-30 closed many of these but the list was never audited item-by-item. Triage each before declaring done.

## 10. IMPLEMENTATION OPEN ITEMS

### 10.1 New Supabase table: `channel_milestones`
The visible-milestone scaffold. Schema:
```
id uuid PK
channel text  -- "sovereign_synthesis" | "containment_field"
tier int  -- 0 = pre-AdSense, 1 = D-tier monetized, 2 = C-tier, 3 = B-tier, 4 = A-tier, 5 = S-tier
name text  -- e.g. "AdSense Gate"
target_metric text  -- e.g. "subs"
target_value numeric  -- e.g. 1000
current_value numeric  -- updated by Vector
status text  -- "active" | "achieved" | "future"
hidden_until_active boolean  -- true = invisible on dashboard until status='active'
created_at timestamptz
achieved_at timestamptz null
```

Mission Control home widget queries WHERE `status='active'` only. Future tiers exist but stay invisible per Ace's S117 requirement: "I don't want to be seeing those on my command center home page."

### 10.2 New Supabase table: `bot_active_state`
ddxfish active-state for the 5 non-Sapphire bots:
```
agent text  -- "veritas" | "yuki" | "alfred" | "anita" | "vector"
key text  -- "active_persona" | "active_relationship" | etc
value text
updated_at timestamptz
PK (agent, key)
```

### 10.3 Routing fix: YouTube comment watcher → Yuki
`src/proactive/youtube-comment-watcher.ts:216` currently uses the primary `telegram` (Veritas's bot token). Change the function signature to accept Yuki's bot channel, route alerts there. Veritas keeps the system-health view via `youtube_comments_seen` table reads.

### 10.4 Pinecone embedding fallback verification
Master ref Section 3 says "embeddings disabled — no embedding-capable key set." The code in `src/memory/pinecone.ts:67-84` HAS an OpenAI `text-embedding-3-small` fallback that should fire when Gemini fails. `OPENAI_API_KEY` is set per master ref Section 10. Verify in Railway logs whether the fallback is actually firing. If yes — patch master ref. If no — fix the fallback. **Without working embeddings, the entire ant-hive-mind architecture is half-broken** (writes silently no-op, semantic reads return empty).

### 10.5 Persona-registry vs personalities.json conflict
For Alfred / Anita / Yuki, `src/agent/personas.ts` and `src/data/personalities.json` say slightly different things. Today, JSON wins for crew loops; persona registry only matters for Veritas (primary loop). **Resolution:** the calibrated prompts in this document become the canonical source. `personalities.json` gets rewritten to load from the pieces files. `personas.ts` gets retired.

### 10.6 Master Reference rewrite scope
Sections 5 (agent roles), 6 (codebase architecture summary), 14 (executive role map) get rewritten to point here. Sections 0.1 (1000-token rule) gets retired with a note that the rule was a band-aid for the 27k context bloat — the ddxfish active-state pattern handles that problem more elegantly.

---
