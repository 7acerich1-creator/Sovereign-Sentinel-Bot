# Mission Control Handoff: Content Intel Upgrade

**Date:** 2026-04-13 (Session 50)
**System:** Sovereign-Mission-Control (Next.js 15, Vercel)
**Data Source:** Supabase — `youtube_analytics`, `landing_analytics`, `cta_audit_proposals`
**Priority:** HIGH — This is the NORTH_STAR spine visibility layer

---

## What Changed (Bot Side — Already Built)

Three new tools were added to the Sentinel Bot (`youtube-cta-tools.ts`):

1. **`youtube_cta_audit`** — Weekly scan of top YouTube videos. Checks descriptions for sovereign-landing CTAs, proposes optimized descriptions + pinned comments. Writes proposals to `cta_audit_proposals` table. DMs Architect on Telegram when done.

2. **`youtube_update_metadata`** — Executes approved changes: updates title/description/tags on existing YouTube videos via Data API v3.

3. **`youtube_pin_comment`** — Posts channel-owner comments with CTA links on videos.

A new Edge Function (`fetch-landing-analytics`) pulls Vercel Web Analytics data daily into `landing_analytics`.

---

## New Supabase Tables (Migration 002)

### `cta_audit_proposals`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| video_id | TEXT | YouTube video ID |
| video_title | TEXT | |
| brand | TEXT | 'ace_richie' or 'containment_field' |
| channel | TEXT | Display name |
| views | INTEGER | Current view count |
| ctr | NUMERIC(5,2) | Click-through rate |
| issues_found | JSONB | Array of strings (what's wrong) |
| current_description | TEXT | First 500 chars of current desc |
| proposed_description | TEXT | Full optimized description (null if no changes needed) |
| proposed_comment | TEXT | Proposed pinned comment text |
| status | TEXT | `pending_review` → `approved` → `executed` (or `rejected`/`skipped`) |
| reviewed_at | TIMESTAMPTZ | When Architect acted |
| executed_at | TIMESTAMPTZ | When bot pushed the change |
| created_at | TIMESTAMPTZ | |

### `landing_analytics`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| page_path | TEXT | URL path (e.g., '/') |
| visitors | INTEGER | Unique visitors |
| page_views | INTEGER | Total views |
| bounce_rate | NUMERIC(5,2) | |
| avg_duration_seconds | NUMERIC(8,2) | |
| referrer | TEXT | Top referrer source |
| country | TEXT | Top country |
| device | TEXT | Top device type |
| period_start | TIMESTAMPTZ | Window start |
| period_end | TIMESTAMPTZ | Window end |
| fetched_at | TIMESTAMPTZ | |

---

## Content Intel Page — Required UI Changes

The Content Intel page currently shows `youtube_analytics` data. It needs to become a **three-panel command surface**:

### Panel 1: YouTube Performance (existing — minor layout tweak)
- Already reads from `youtube_analytics`
- Add a column or badge showing CTA status per video (pull from latest `cta_audit_proposals` where `video_id` matches)
- Color code: 🔴 = has pending proposals, 🟢 = no issues or already executed, ⚪ = never audited

### Panel 2: CTA Audit Proposals (NEW — the approval surface)
This is where the Architect reviews and approves agent-proposed changes. **This is the most important addition.**

**Layout:** Card list, sorted by `status = 'pending_review'` first, then by `views DESC`

Each card shows:
- Video title + thumbnail (link to YouTube)
- View count + CTR
- Issues found (red badges)
- **Side-by-side diff**: current description (left, dimmed) vs proposed description (right, highlighted changes)
- Proposed pinned comment text
- **Action buttons:** `Approve` | `Reject` | `Skip`
  - **Approve** → sets `status = 'approved'`, `reviewed_at = now()`. The bot's `CheckApprovedTasksTool` pattern (or a scheduled check) picks this up and calls `youtube_update_metadata` + `youtube_pin_comment`, then sets `status = 'executed'`, `executed_at = now()`.
  - **Reject** → sets `status = 'rejected'`, `reviewed_at = now()`
  - **Skip** → sets `status = 'skipped'`, `reviewed_at = now()`

**Empty state:** "No pending proposals. Audits run weekly — next one [date]."

### Panel 3: Landing Analytics (NEW — the measurement layer)
Reads from `landing_analytics`. Shows the NORTH_STAR metric #2: landing page visitors/week.

**Layout:** Simple time-series chart (last 30 days) + summary cards:
- **Visitors this week** (sum of `visitors` for last 7 days)
- **Page views this week**
- **Top referrer** (most common `referrer` value)
- **Top device** (mobile vs desktop split)

Below the chart: a small table of daily rows (date, visitors, page_views, referrer).

**Empty state:** "No analytics data yet. Vercel Analytics is installed — data will appear within 24 hours."

---

## Audit Frequency & Scheduling

The CTA audit should run **weekly** (every Monday). The bot's scheduler can trigger `youtube_cta_audit` as a scheduled task. Recommended slot: Monday 15:00 UTC (after the YouTube stats fetch at 14:00 UTC, so fresh data is available).

The Vercel Analytics Edge Function runs **daily** at 06:00 UTC (low-traffic window, pulls previous 24h).

---

## Approval → Execution Flow (Full Loop)

```
Weekly: Bot runs youtube_cta_audit
  → Scans top N videos from youtube_analytics
  → Checks each for sovereign-landing CTA in description
  → Writes proposals to cta_audit_proposals (status: pending_review)
  → DMs Architect on Telegram: "CTA Audit done, N proposals need review"

Architect opens Mission Control → Content Intel → Panel 2
  → Reviews side-by-side diffs
  → Clicks Approve / Reject / Skip
  → Supabase row updates (status: approved)

Bot (next scheduled check or real-time subscription):
  → Reads approved proposals
  → Calls youtube_update_metadata (updates description/tags)
  → Calls youtube_pin_comment (posts CTA comment)
  → Updates proposal status → 'executed', executed_at = now()
  → DMs Architect: "Changes pushed to N videos"
```

---

## Design Notes (Brand Consistency)

- Follow existing Mission Control dark theme (`#121212` bg, `#1E1E1E` cards)
- Accent: Orange `#E5850F` for pending proposals, Green `#2ECC8F` for executed
- The diff view should use a subtle highlight (not full syntax diff — just bold/highlight the CTA block that was added)
- Keep it clean. Three panels, not cluttered. Tabs or collapsible sections if space is tight.

---

## Env Vars Needed

For the Vercel Analytics Edge Function to work, add these as Supabase Edge Function secrets:
- `VERCEL_API_TOKEN` — Generate at vercel.com/account/tokens
- `VERCEL_PROJECT_ID` — From sovereign-landing project settings in Vercel

The YouTube tools use the existing `YOUTUBE_REFRESH_TOKEN` + `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET` already in Railway.

---

## Summary

This turns Content Intel from a passive stats display into an **active optimization command surface**. The agents do the analysis, propose changes, and the Architect approves with one click. The measurement layer (Vercel Analytics) finally closes the loop: YouTube views → landing page visitors → conversion tracking.
