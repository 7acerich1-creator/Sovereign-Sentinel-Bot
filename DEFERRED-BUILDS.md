# Deferred Builds — Tracking File

When something gets scoped out for later (not abandoned, just not now), it lives here. Read this before starting any new build to check if it's already on the list.

**Last updated:** 2026-05-03

---

## High-priority deferred work

### 1. Self-healing layer for the crew (rescoped — S126 closed deploy/container/bot layers)

**Why:** S126 shipped deploy-failure alerts, auto-retry, boot smoke test, bot health canary, and the diagnose-deploy-failure doctrine. The remaining gaps are crew-dispatch-level: per-agent stateful circuit breakers, a dead-letter queue for failed dispatches, and per-tool error stats so Ace can see which tools fail most.

**What it would include:**

- Stateful circuit breakers per agent (consecutive failure threshold → pause that agent for N minutes)
- Dead-letter queue for failed dispatches (`crew_dispatch_failed` table) with auto-escalation to Ace via Telegram after threshold
- Per-tool error stats (count of failures per tool name, surfaced in a Mission Control tile)

**Estimated work:** ~30–60 minutes. Touches `src/agent/crew-dispatch.ts`, new Supabase table, retry helper.

**Triggers a build:** Next time a crew agent dies repeatedly without auto-recovering.

---

### 2. Goals system with progress journal

**Why:** Per ddxfish/sapphire: hierarchical goals (parent/child) + timestamped progress entries. Lets Sapphire say "you've moved on Plan X 3 times this month" instead of just acknowledging each request fresh.

**What it would include:**

- `sapphire_goals` Supabase table — id, parent_id, title, target, status, created_at
- `sapphire_goal_progress` table — goal_id, note, timestamp
- Tools: `set_goal`, `update_goal`, `log_progress`, `list_goals`, `goal_status`
- Integration with the weekly brief — surface stale goals

**Estimated work:** 1 session.

**Triggers a build:** When Ace asks to track goals he's mentioned multiple times.

---

### 3. Cross-namespace semantic recall for crew agents

**Why:** Agents currently only recall from their OWN Pinecone namespace. The `shared` namespace exists and gets populated by the insight-extractor when an insight is cross-cutting — but agents don't query it yet. This means cross-pollination is one-way (write only, no read).

**What it would include:**

- Modify agent-loop semantic recall to query both own namespace AND `shared`
- Weight own > shared (e.g., topK=3 own + topK=2 shared)
- Test in a low-stakes dispatch first

**Estimated work:** 30 minutes. Touches `src/agent/loop.ts` only.

**Triggers a build:** When a crew agent visibly fails to use insight that another agent already produced.

---

### 4. Light-touch crew agent improvements

**Why:** Same tool discernment + mode filtering treatment Sapphire got. Real value: less token use, less hallucination on dispatches, fewer wasteful tool calls.

**What it would include:**

- ONLY-WHEN tool descriptions for Alfred/Anita/Yuki/Vector tools
- MODE_FILTER pattern (some tools are dispatch-mode only, some are interactive-only)
- Verify insight-extractor is actually firing on their dispatches

**Estimated work:** 1 session.

**Triggers a build:** When Ace has bandwidth to monitor for regressions.

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

## Architect-blocked

### Migrate Gemini conversation history into Sapphire's Pinecone

**Why:** Architect has ~1 year of Gemini conversations holding personal context, family details, brand history, project iterations, recurring patterns. Sapphire only has S114u-onward DM history + 80 hand-seeded vectors + a few hundred sapphire_known_facts. Gemini knows orders of magnitude more about Architect's life than she does.

**What it would include:**

1. Architect runs Google Takeout → My Activity → Gemini Apps → Export. Receives JSON archive.
2. Ingestion script (`scripts/ingest_gemini_history.ts`) that:
   - Walks the export, extracts substantive Q&A turns (filters one-shots, code snippets that don't reference his life)
   - Chunks long conversations into ~500-token segments preserving turn boundaries
   - Embeds each chunk via existing Pinecone embed pipeline
   - Writes to `sapphire-personal` namespace with metadata `{source: "gemini_takeout", date, topic_inferred}`
3. Optional pass with Gemini Pro to extract structured facts (DOBs, schools, recurring frustrations, named people) and write those to `sapphire_known_facts` for instant recall.
4. Verification: pull a sample of imported chunks via memory-audit endpoint, confirm semantic recall finds them when relevant.

**Estimated work:** 1 focused session. Needs Architect to first run Takeout + share archive path.

**Triggers a build:** Architect ready to invest the session AND has Gemini archive in hand.

---

## Mission Control repo (different mount required)

### MC Aesthetic Performance Tile

**Target repo:** `Sovereign-Mission-Control` (not Sentinel). Mount that folder in the next session and build there.

**What to build:** A single KPI tile on the existing Mission Control dashboard, titled "Aesthetic Performance." It surfaces a 3×2 grid (3 aesthetics A/B/C × 2 brands SS/TCF) with per-cell:
- Video count shipped
- Avg YouTube CTR
- Avg 30-second retention %
- Avg watch time (seconds)

Plus a "winner" highlight on the cell with highest CTR-per-retention product once ≥6 videos per cell exist.

**Data source — two joins, no new tables required:**

1. `niche_cooldown` table in Supabase project `wzthxohtgojenukmdubz` — columns `brand`, `aesthetic_style`, `job_id`, `created_at`. Ground truth for which aesthetic was used on which video.
2. Wherever MC currently reads YouTube analytics from. Join against `niche_cooldown.job_id` → the YouTube `videoId` stored at ship time.

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
LEFT JOIN youtube_analytics ya ON ya.video_id = nc.job_id
WHERE nc.aesthetic_style IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;
```

**When to build:** After ~10 videos have shipped with the new rotation so there's data. Before then, the tile would be empty and misleading.

**Acceptance criteria:**
1. Tile renders the 3×2 grid with live data from Supabase.
2. Empty cells show "—" not "0".
3. At ≥6 videos per cell, a winner halo appears.
4. Tile is read-only. No writes, no migrations.

---

### MC Agent Spend Tile

**Target repo:** `Sovereign-Mission-Control`.

**What to build:** A KPI tile titled "Agent Spend" with three time windows (Today / This Week / This Month). Each window shows:
- Total cost across all agents (USD)
- Per-agent breakdown (Sapphire, Anita, Yuki, Vector, Veritas, Alfred)
- Per-agent split: model tokens vs server-tool fees
- Average cost per turn per agent
- Anomaly highlight: any agent's cost-per-turn >2σ above its 14-day average flags red

**Data source:** Supabase `agent_spend` table on project `wzthxohtgojenukmdubz`.

Query sketch:
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

**Why it matters:** Architect explicitly does NOT want to manually reconcile Anthropic dashboard numbers against bot logs. This tile makes per-agent cost visible so anomalies (a runaway tool-call loop, an agent suddenly burning $5/day) surface within hours, not at the next credit card statement.

**When to build:** Once `agent_spend` has at least 24h of data.

**Acceptance criteria:**
1. Three time windows, populated from `agent_spend`.
2. Per-agent rows ordered by total_cost descending.
3. >2σ anomaly cells get a red border.
4. Read-only. No writes, no migrations from the MC side.

---

## Implementation open items (still on the floor)

### channel_milestones Supabase table

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

Mission Control home widget queries WHERE `status='active'` only. Future tiers exist but stay invisible per Ace's directive: "I don't want to be seeing those on my command center home page."

---

### bot_active_state Supabase table

ddxfish active-state for the 5 non-Sapphire bots:
```
agent text  -- "veritas" | "yuki" | "alfred" | "anita" | "vector"
key text  -- "active_persona" | "active_relationship" | etc
value text
updated_at timestamptz
PK (agent, key)
```

Already populated for Veritas (verified in this session — `chief_brand_officer` + `weekly_review` + `terse_briefing`). Other agents need their rows seeded.

---

### Master Reference rewrite scope

Sections 5 (agent roles), 6 (codebase architecture summary), 14 (executive role map) get rewritten to point at MAVEN-CREW-DIRECTIVES as canonical. Section 0.1 (1000-token rule) retired with a note that the ddxfish active-state pattern (bot_active_state above) handles the context bloat more elegantly.

Also patch: master ref currently claims "embeddings disabled — no embedding-capable key set" — this is stale. Verified live in this session (320 knowledge_nodes writes in last 7d, last write 2026-05-01). Embeddings ARE firing in production via the Gemini-primary → OpenAI-fallback chain in `src/memory/pinecone.ts`.
