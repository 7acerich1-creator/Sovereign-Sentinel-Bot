# Mission Control Dashboard — three real-business-goal tiles

**Status:** PLAN. Implementation belongs in Mission Control repo at `C:\Users\richi\Sovereign-Mission-Control\repo\` (not the Sentinel Bot).
**Why this exists:** Ace asked for the visitor count, the aesthetic A/B/C grid, and the tasks/projects all in the same view as the operational goals — not buried in infra panels.

---

## Tile 1 — Audience funnel snapshot

**Headline KPI:** "**X visitors / 500 target this week**" with a horizontal progress bar.

**Below the headline (4-row mini-table):**

| Metric | This wk | Last wk | Target | Δ |
|---|---|---|---|---|
| Top-of-funnel attention (YT views combined) | live | snapshot | 10,000/wk | % |
| Landing visitors | live | snapshot | 500/wk | % |
| Email signups (`initiates`) | live | snapshot | 50/wk | % |
| Paid conversions (Stripe) | live | snapshot | 1/wk | % |

**Data sources:**
- `landing_analytics` table — already has 21 lifetime rows, refreshed daily 06:00 UTC.
- `initiates` table — currently 0 rows lifetime.
- `youtube_analytics` table — 167 rows; aggregate `views` per channel for "this week".
- Stripe Edge function `revenue_log` — currently empty.

**SQL to wire (drop into a Vercel serverless function `/api/funnel-snapshot`):**
```sql
SELECT
  (SELECT SUM(visitors) FROM landing_analytics WHERE fetched_at > NOW() - INTERVAL '7 days') AS landing_this_wk,
  (SELECT COUNT(*) FROM initiates WHERE created_at > NOW() - INTERVAL '7 days') AS signups_this_wk,
  (SELECT SUM(views) FROM youtube_analytics WHERE fetched_at > NOW() - INTERVAL '7 days') AS yt_this_wk,
  (SELECT COUNT(*) FROM revenue_log WHERE created_at > NOW() - INTERVAL '7 days') AS conversions_this_wk;
```

**Visual treatment:** Top-of-page hero band. Dark amber gradient (matches Sovereign Synthesis brand palette). Progress bar uses `#3EF7E8` for fill, `#1a1a2e` for track. Numeric font: Space Mono.

**Anti-pattern to avoid:** This tile is NOT for ops debugging. Don't add bot health, dispatch counts, or queue depth here. Those live elsewhere. This tile is the bottom-line "are we moving toward $1.2M" view.

---

## Tile 2 — Aesthetic Performance Grid (the 30-video A/B/C test)

This is the existing NORTH_STAR plan (lines 162-210). Building it now means the test data is visible the moment videos start shipping after the faceless-autonomy patch lands.

**Layout — 3×2 grid (3 aesthetic styles × 2 brands):**

```
                  Sovereign Synthesis    The Containment Field
A · Macro          [tile]                 [tile]
B · Sacred Geo     [tile]                 [tile]
C · Oil Painting   [tile]                 [tile]
```

**Per-cell content:**
- Video count shipped (e.g. "5 videos")
- Avg CTR % (large, gold)
- Avg 30-second retention % (large, cyan)
- Avg watch time (small, gray)
- "—" instead of "0" when no data yet (zero implies failure, dash implies no signal)

**Winner halo:** When ≥6 videos exist in a cell, calculate `ctr × retention` for each cell and outline the winner with a gold halo.

**Data join:**
```sql
SELECT
  nc.brand,
  nc.aesthetic_style,
  COUNT(*) AS video_count,
  AVG(ya.ctr) AS avg_ctr,
  AVG(ya.retention) AS avg_retention,
  AVG(ya.engagement) AS avg_engagement
FROM niche_cooldown nc
LEFT JOIN youtube_analytics ya ON ya.video_id = nc.youtube_video_id
WHERE nc.aesthetic_style IS NOT NULL
  AND nc.created_at > '2026-04-24'
GROUP BY nc.brand, nc.aesthetic_style;
```

**🟡 Watch item from audit:** `youtube_analytics.retention` and `.ctr` columns are 100% zeros across all 167 rows. Re-grant OAuth with `yt-analytics.readonly` scope OR this tile renders 0.0% in every cell and produces false "everything failed" signal.

**Read-the-plan link:** Bottom of tile, small text: "Why this matters →" deep-links to NORTH_STAR.md section "🎯 First Real Business Goal".

---

## Tile 3 — Tasks & Projects (the human side)

Pull from existing `tasks` table in Supabase (6 rows, schema in master ref Section 7).

**Layout — Kanban-lite, 3 columns:**

| To Do (priority) | In Progress | Done (last 7 days) |
|---|---|---|

**Tasks displayed:** Filter `type = 'human'` (Ace's tasks) and `type = 'ai'` (bot tasks) with a small chip indicator.

**Quick add field:** Inline form at top — "Add task" → POSTs to Supabase `tasks` table with `status='todo'`, `created_at=now()`. Lets Ace queue work from MC without leaving the dashboard.

**Why this lives next to the A/B/C grid:** The grid is the system's autonomous goal. The task column is Ace's manual goal. Side-by-side keeps both visible — the audit's hard truth was that bot infra is healthy but human-side execution (the 5 To Do high-priority tasks from Apr 12 still sitting open) is where the 0-revenue gap actually lives.

---

## Implementation order

1. **Tile 1 first** — `landing_analytics` already has data. Visible win on day 1.
2. **Tile 3 second** — `tasks` table exists. Pure CRUD against Supabase. ~2 hours of work in Mission Control.
3. **Tile 2 last** — depends on (a) re-consent for YT analytics, (b) faceless-autonomy patch landing in Sentinel, (c) ≥3 videos shipped. Build the empty-state version first; it'll fill itself in over ~10 days once the autonomy patch ships.

---

## Where these go in the existing MC repo

Based on file structure at `C:\Users\richi\Sovereign-Mission-Control\repo\`:
- Each tile = one new React component in `src/components/dashboard/` (or wherever existing tiles live).
- Each tile = one new Vercel API route in `src/app/api/` querying Supabase.
- Add the three components to the home page (`src/app/page.tsx` or equivalent).

Verify exact paths next session — Ace's MC is a separate cowork mount that needs to be opened.
