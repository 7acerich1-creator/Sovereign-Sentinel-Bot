# Deferred Builds — Tracking File

When something gets scoped out for later (not abandoned, just not now), it lives here. Read this before starting any new build to check if it's already on the list.

**Last updated:** 2026-05-03 (post-sweep — all in-repo deferred work closed; only cross-repo MC tiles + one rescoped self-healing entry remain)

---

## How to use this file

1. **Before starting anything new:** check if it's on this list.
2. **When deferring something:** add it here with the same structure (Why / What / Estimated work / Triggers a build).
3. **When shipping a deferred item:** delete the entry (keep this file tight).

---

## Sentinel-Bot repo (this repo)

### Self-healing layer for the crew (rescoped — S126 closed deploy/container/bot layers)

**Why:** S126 shipped deploy-failure alerts, auto-retry, boot smoke test, bot health canary, and the diagnose-deploy-failure doctrine. The remaining gaps are crew-dispatch-level: per-agent stateful circuit breakers, a dead-letter queue for failed dispatches, and per-tool error stats so Ace can see which tools fail most.

**What it would include:**

- Stateful circuit breakers per agent (consecutive failure threshold → pause that agent for N minutes)
- Dead-letter queue for failed dispatches (`crew_dispatch_failed` table) with auto-escalation to Ace via Telegram after threshold
- Per-tool error stats (count of failures per tool name, surfaced in a Mission Control tile)

**Estimated work:** ~30–60 minutes. Touches `src/agent/crew-dispatch.ts`, new Supabase table, retry helper.

**Triggers a build:** Next time a crew agent dies repeatedly without auto-recovering.

---

## Mission Control repo (different mount required — pick up when MC is the active repo)

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
