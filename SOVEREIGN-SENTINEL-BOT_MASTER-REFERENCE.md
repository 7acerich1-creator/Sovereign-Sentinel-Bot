# Sovereign Sentinel Bot — Master Reference (LEAN)

> **This file holds INVARIANTS ONLY.** Things that don't change session-to-session: identity, infrastructure IDs, env var map, schemas, protocols, the canonical account map, the product ladder, architectural rules. **For session-by-session history** see `HISTORY.md` (append-only journal, search-only — do not auto-load). **Runtime state is read on-demand from the code, not cached.** Grep `src/voice/tts.ts`, `src/index.ts`, `package.json`, or check Railway env directly for current chain shape. If this file contradicts the code, the code wins — patch this file and move on. **For revenue-first sanity check** see `NORTH_STAR.md`. Read before authorizing any build task.

**Last trimmed:** 2026-05-03 (S129 — Sapphire's `reminders` fat-tool was broken since Phase 4 refactor: schema declared `text`/`id`/`keyword` but underlying narrow tools (`SetReminderTool` etc.) read `message`/`reminder_id`/`query`/`message_contains`. Every set/cancel/cancel_series call returned "message is required" or equivalent, which Sapphire surfaced as "backend mismatch" in chat. Fix: `_fat.ts` `RemindersTool.execute` now remaps params per action; added `force_create`/`dry_run`/`window_hours`/`include_all_statuses` to schema; added VAGUE TIMES guidance so "later tonight" defaults to 8pm CDT instead of triggering a clarification ping-pong. Commit c568192. See §6 + Known Invariants.)

**Last trimmed:** 2026-05-02 (S128b — shipped browser-based IG comment replier (`yuki-instagram-browser-replier.ts`, commit 756d2f7) that bypasses the dead Meta API path entirely; mirrors the TikTok pattern, uses S128 cookie persistence, scheduled 95 min after boot then every 3h. New env vars `INSTAGRAM_HANDLE_SS=sovereign_synthesis` + `INSTAGRAM_HANDLE_CF=the_containment_field` set on Railway. New table `instagram_browser_replies_seen`. Also: Railway Raw Editor has a quote-parsing bug that silently re-keys variables with values containing quotes — DO NOT use Raw Editor for bulk edits; use New Variable form per-variable instead. See §3.6 + §15.).

---

## What This System Is (the elevator brief)

**Sovereign Sentinel Bot** is the Architect's content-and-coordination engine. It's a Node.js / TypeScript bot deployed on Railway that orchestrates a 6-agent AI crew + a personal assistant, produces dual-brand video content autonomously, distributes it across social surfaces, replies to comments, sends nurture email, and reports its own metrics. Everything below is what a fresh agent (with no memory) needs to know to make sense of the rest of this file.

### Mission (the why)
- **$1.2M net liquid by January 1, 2027** (revenue gate)
- **Liberate 100,000 minds** via the "Firmware Update" content stream
- **Mentor 100 Inner Circle initiates** through the product ladder

### The two brands (the what gets produced)
1. **Sovereign Synthesis (SS)** — Ace's personal brand. Primary revenue driver. Warm sovereign aesthetic, gold + teal, no human figures in imagery.
2. **The Containment Field (TCF)** — anonymous dark-psychology top-of-funnel feeder. Cold blue + teal, clinical surveillance aesthetic.

Every video pipeline run fans out to BOTH brands by default; single-brand override is `ss only` or `tcf only` on the command.

### The three systems (the what runs where)
1. **Gravity Claw Engine** (this repo, `Sovereign-Sentinel-Bot`) → Railway. Bot, 6 agents + Sapphire, content pipeline (Vidrush + Faceless Factory + Content Engine), all the tools.
2. **Sovereign Assets** (`Sovereign-Mission-Control` + `sovereign-landing` repos) → Vercel. Dashboard for visibility + landing pages for funnels.
3. **Supabase** (cloud) — the ONLY shared meeting point between systems 1 and 2. Bot writes, dashboard reads. See §3 + §7.

### The crew (who does what)
Six Maven Crew agents + one personal assistant. Each runs on its own Telegram bot token. Each owns a Pinecone namespace.

| Agent | Role |
|---|---|
| **Veritas** | Chief of Staff. Strategy, briefings, quality gate. Anthropic primary. |
| **Anita** | Marketing Lead. Email + reply copy + content drafts. Anthropic primary. |
| **Sapphire** | Personal Assistant (PA mode default) / COO sentinel (group-chat mode). Anthropic primary. |
| **Alfred** | Content seed generator. Daily thesis. Gemini → Groq. |
| **Yuki** | Engagement operator on YouTube + TikTok + Instagram + Facebook. Gemini → Groq. |
| **Vector** | Chief Revenue Officer. Stripe + Meta Pixel + analytics. Gemini → Groq. |

Per-agent LLM teams in §5. **Anthropic is locked to Veritas / Anita / Sapphire only** — pipelines and the other agents must never touch Anthropic credits (S121d).

### How agents coordinate (the inter-agent protocol)
- **`crew_dispatch` Supabase table = the bot's internal mailbox.** When Veritas needs Alfred to run a trend scan, Veritas writes a row into `crew_dispatch` with `to_agent='alfred'`, `task_type='daily_trend_scan'`, payload, status='pending'. A 15-second dispatch poller in `src/index.ts` claims the row, runs the right agent's loop with the payload, writes the result back into the row with `status='completed'` (or `'failed'`).
- **Bot-to-bot Telegram DMs = forbidden.** Each bot DMs Ace directly (alerts, briefings, replies). Coordination between bots happens through the Supabase queue + Pinecone semantic hive, never through Telegram tokens. (See `MAVEN-CREW-DIRECTIVES.md` §1.2.)

### How content gets produced (the pipeline paths)
Three paths to a video — see §5.5 OPERATOR'S MANUAL for the trigger map:

1. **Manual (URL-driven)** — `/pipeline <youtube_url>` in Telegram. You picked the source video.
2. **Autonomous (seed-driven)** — `/alfred` in Telegram, OR the 15:05 UTC daily cron. Alfred generates today's thesis from the Sovereign Synthesis framework, fans out to both brands.
3. **Batch** — `/batch [ss|tcf] [N] [dry]` for multi-video sweeps.

All three call `executeFullPipeline` (Vidrush). Pipeline = ingest → script → audit (Veritas) → TTS (XTTS via RunPod) → image gen (FLUX via RunPod) → ffmpeg compose → R2 upload → YouTube long-form upload → chop into shorts → distribute → Yuki pins the diagnostic-link comment.

### How content gets distributed (the surface map)
- **YouTube** = primary, both brands. Long-form via Vidrush, shorts via shorts pipeline.
- **TikTok** + **Instagram** = live, both brands. Yuki's engagement workers reply to comments (S126).
- **Facebook** = secondary, staged via FB Business Suite Planner via System User token (S118).
- **Threads** = SS only, via Buffer.
- **Buffer** = system-level distribution layer (deterministic `distributionSweep`, fires every 5 min). Not any agent's lane — it's plumbing.
- **Email** = Anita drafts inbound replies and outbound nurture, sends as Telegram approval cards, Ace approves with `/approve`.
- **Reddit** = manual only.

### How memory works (the three tiers)
- **SQLite** (`./gravity-claw.db`) = episodic, per-conversation rolling state.
- **Pinecone** (`gravity-claw` index, ~12 namespaces, 4,339 live vectors) = semantic hive. Each agent retrieves only relevant context per cycle. Embeddings via Gemini.
- **Supabase** = structured state. Source of truth for `crew_dispatch`, `tasks`, `briefings`, `youtube_analytics`, `landing_analytics`, `sapphire_*` tables, `content_engine_queue`, `protocols`, etc. See §7 for the full data model.

### How you observe what's happening (the visibility layer)
- **Mission Control dashboard** (https://sovereign-mission-control.vercel.app/) — reads Supabase tables, surfaces tasks + briefings + content queue + metrics + agent status.
- **Telegram alerts** — each bot DMs Ace directly for its lane. Sapphire is the alert hub for deploy failures + bot health canary (S126 self-healing infrastructure).
- **`/status`** in any bot DM — full env / LLM team / git SHA / health snapshot.

### How the system heals itself (S126 self-healing infrastructure)
1. **Railway deploy webhook** → Supabase Edge Function classifies fail (transient vs code_bug) → DMs Ace via Sapphire's bot → auto-redeploys transient failures (capped at 1 retry).
2. **Boot-time smoke test** validates 26 Supabase tables + per-agent LLM env vars + Pinecone namespaces. CRITICAL fails alert Ace.
3. **Bot health canary** runs every 10 min via pg_cron — `getMe` + spend-freshness probe.
4. **Agent diagnosis** — Sapphire's `/diagnose` doctrine pulls latest failed deploy + archival_search past incidents + files Claude tasks for fixes.

### One-paragraph TL;DR
*A fresh AI mounting this folder is looking at the brain and nervous system of a sovereign content business. A Node.js bot on Railway runs six AI agents plus a personal assistant, all on separate Telegram bots. They coordinate through a Supabase queue (`crew_dispatch`) and a Pinecone semantic hive. The system autonomously produces a dual-brand long-form YouTube video most days (driven by Alfred's daily thesis or by URL via `/pipeline`), distributes it across YouTube, Facebook, Instagram, TikTok, and Threads, runs comment-engagement workers on each platform, sends email nurture replies through Anita, tracks revenue + analytics through Vector, and reports everything to a Vercel dashboard. Sapphire handles Ace's personal life — calendar, reminders, family, research, documents, plans — separately from the business. The product ladder under §9 monetizes the audience. The mission gate in `NORTH_STAR.md` (revenue + minds liberated + initiates mentored) is what every build decision answers to.*

---

## ⚡ Session Start Protocol (from `CLAUDE.md`)

1. Read `NORTH_STAR.md` — revenue gate, 5 input metrics, current highest-leverage action.
2. Read this file — invariants, schemas, architectural rules.
3. Read memory index `MEMORY.md` — feedback, prior session learnings.
4. For runtime state (LLM chain, TTS routing, git SHA, env presence), grep the code directly — `src/voice/tts.ts`, `src/index.ts` `AGENT_LLM_TEAMS`, `package.json`, or Railway dashboard. **Do not cache runtime state to a file.**
5. Only read `HISTORY.md` when you need a specific past session's context (searchable by session number or DVP tag).

**Never push to** `main` **while the pipeline is running.** Railway auto-deploys and kills the container. See `feedback_no_push_during_pipeline.md` in memory.

---

## 0. ARCHITECTURAL DIRECTIVES (Non-Negotiable)

These are hard rules that govern every session's work. Violations create the bugs history keeps archiving.

### 0.1 Prompt Economy — ddxfish active-state pattern
Prompts assemble per turn from a pieces library + active state + spice rotation (see [`MAVEN-CREW-DIRECTIVES.md`](./MAVEN-CREW-DIRECTIVES.md) §1.3). Each prompt is exactly as long as it needs to be for the current scenario — tight, not arbitrarily short. Sapphire's prompt-builder (`src/agent/sapphire-prompt-builder.ts`) is the reference implementation.

### 0.2 Root Cause Discipline
Stop patching symptoms. Trace the full payload, verify against live data, think architecturally. If two sessions in a row flipped the same fix, the root cause wasn't the last fix. See `feedback_root_cause_discipline.md`.

### 0.3 Three-Layer Prompt Architecture
Every agent prompt assembles from exactly three layers, in this order:

1. **Layer 1 — Identity (`personalities.json`)** — agent name, voice, role. Static.
2. **Layer 2 — Shared Context (`shared-context.ts`)** — mission, crew roster, protocols list, tool contract. Static per boot.
3. **Layer 3 — Protocols (`protocols` table in Supabase)** — architect directives hard-injected into task context for YT tasks via `src/agent/protocol-injection.ts` (Session 43 Task 2). Soft instructions in system prompts get ignored under load; protocols must be hard-injected at the dispatch layer.

### 0.4 Deployment Verification Protocol (DVP)
Never mark a fix "resolved" without test proof. Use explicit state tags:
- `[DVP: ADDRESSED]` — code written, not yet verified in production
- `[DVP: VERIFIED]` — production proof (log line, Buffer post, Supabase row, YouTube Studio screenshot)
- `[DVP: REGRESSED]` — verified fix has broken again
- `[DVP: BLOCKED-ON-CYCLE]` — deployed, waiting on next pipeline run to produce verifiable output

See `feedback_verification_protocol.md`. Two-agent confirmation required for load-bearing fixes (Session 44 false-positive lesson).

### 0.5 File Truncation Risk
Sandbox writes on files >300 lines can silently truncate. After any `Write` on a large file, verify both Windows-side byte count and `tsc --noEmit` clean before pushing. See `feedback_file_truncation_risk.md`.

### 0.6 Contradiction Prevention
When changing the status of ANY system component, update every section that references it. `ctrl+F` the repo for the identifier before closing a session.

---

## 1. THE ARCHITECT

- **Name:** Richard Gonzales — sovereign identity "Sovereign Synthesis"
- **Email:** 7ace.rich1@gmail.com (canonical) / empoweredservices2013@gmail.com (secondary, YouTube auth)
- **GitHub:** `7acerich1-creator`
- **Telegram:** user id `8593700720` (authorized user)
- **Mission:** $1.2M net liquid by Jan 1 2027 · liberate 100k minds · mentor 100 Inner Circle initiates
- **Role:** System Architect / CEO. Claude is the Second Mind — computational bandwidth for the Architect's design, not a subordinate.

---

## 2. PROJECT IDENTITY & DOMAIN SEPARATION

Three live systems. **Never cross-contaminate.**

| # | System | Repo | Deploy Target | Purpose |
|---|--------|------|---------------|---------|
| 1 | **Gravity Claw Engine** | `Sovereign-Sentinel-Bot` | Railway (auto-deploy from `main`) | Bot infrastructure, 6 Maven Crew agents, tools, memory, content pipeline |
| 2 | **Sovereign Assets** | `Sovereign-Mission-Control` + `sovereign-landing` | Vercel (auto-deploy from `main`) | Dashboard, landing pages, funnels, auth gates |
| 3 | **Supabase** | (cloud) | — | The ONLY meeting point between systems 1 and 2. Bot writes, dashboard reads. |

**Domain separation rules:**
- `SovereignSynthesisProjects` folder is the legacy parts warehouse. **Reference, don't deploy** — see Section 13.

**Mission Control live URL:** https://sovereign-mission-control.vercel.app/

---

## 3. INFRASTRUCTURE MAP

### Railway (Bot)
- **Project ID:** `77e69bc6-f7db-4485-a756-ec393fcd280e`
- **Service ID:** `0f2ba264-a815-43c1-b299-24e4a1aa865e`
- **Live URL:** `gravity-claw-production-d849.up.railway.app`
- **Deploy:** auto from `main` branch. Docker build via `Dockerfile.bot` (multi-stage: `mwader/static-ffmpeg` COPY + `nikolaik/python-nodejs:python3.11-nodejs20-slim` base).

### Supabase
- **Project ID:** `wzthxohtgojenukmdubz`
- **Dashboard:** https://supabase.com/dashboard/project/wzthxohtgojenukmdubz
- **Access:** bot uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Dashboard uses `SUPABASE_ANON_KEY` (RLS enforced).

### Pinecone (S117 audit — corrected 2026-04-25)
- **Index:** `gravity-claw`
- **Host:** `gravity-claw-cpcpbz1.svc.aped-4627-b74a.pinecone.io`
- **Embeddings:** Gemini `gemini-embedding-001` via `GEMINI_API_KEY`. **Working.** Verified live via `/debug/memory` endpoint: HTTP 200, 1024-dim vectors, **4,339 vectors live** across 12 namespaces. The "embeddings disabled — no embedding-capable key set" note that lived here for many sessions was stale and wrong; ignore any prior reference to it.
- **Active namespaces (live):** `hooks` (Alfred), `clips` (Yuki), `content` (Anita), `funnels` (Vector), `brand` (Veritas + Sapphire COO mode), `shared`, `veritas`, `sovereign-synthesis`, `conversations`, `general`, plus per-brand script namespaces `scripts-sovereign_synthesis`, `scripts-containment_field`, `scripts-ace_richie` (legacy).
- **Known sub-issue (NON-blocking, S117):** the Supabase mirror tables `knowledge_nodes` and `sync_log` aren't being populated by `writeKnowledge()`. Pinecone writes succeed; the mirror writes silently fail. Bots query Pinecone directly for semantic search so the autonomy vision is unaffected — but Mission Control's SQL-side audit trail is empty. Fix #1 applied S117: added `UNIQUE(vector_id)` constraint to `sync_log` (the upsert-onConflict was failing without it). Fix #2 outstanding: investigate why `writeToSupabase()` `INSERT` into `knowledge_nodes` isn't landing despite RLS-bypassed service role and matching schema (insert via SQL works directly, so it's not a schema mismatch — likely a JS-client serialization issue around `tags jsonb`). See follow-up task.

### File System (Windows) — CORRECTED 2026-04-25 (S115c audit)
- **Working repo (canonical):** `C:\Users\richi\Sovereign-Sentinel-Bot` (git checkout, deploys to Railway)
- **Mission Control repo:** `C:\Users\richi\Sovereign-Mission-Control\repo\` (git checkout, deploys to Vercel) — note the `\repo` subfolder, not the parent
- **Landing repo:** `C:\Users\richi\Sovereign-Mission-Control\sovereign-landing\` (git checkout, deploys to Vercel)
- **Legacy parts warehouse:** `C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects` (read-only reference)
- **Skills vault:** `SovereignSynthesisProjects\gravity-claw-skills-vault`
- **Stale clones to clean up next time at terminal:** `C:\Users\richi\_slgit\`, `C:\Users\richi\temp-sovereign-fix\`, `C:\Users\richi\Sovereign-Mission-Control\_slgit\` (all leftover work-in-progress, none deployed)

---

## 3.5 DEPLOYMENT MATRIX (added S127 — single source of truth for "how does X reach prod")

**Why this section exists:** the system has FOUR distinct deploy planes (Railway / GHCR+RunPod / Vercel / Supabase) and each has a different trigger and lag profile. Without this map, every new session has to re-derive the deploy story from scratch and gets it wrong. If a code change isn't taking effect, this is the table that tells you why.

| Surface | What lives there | Trigger | Lag | Verify |
|---|---|---|---|---|
| **Railway (bot)** | `src/**`, `Dockerfile.bot`, `package.json` | Push to `main` → Railway auto-deploys | ~2-3 min | `https://railway.com/project/77e69bc6-f7db-4485-a756-ec393fcd280e` deploys tab; `/status` in any bot DM shows live git SHA |
| **GHCR (pod image)** | `pod/**`, `brand-assets/**`, `pod/Dockerfile`, `.github/workflows/pod-build.yml` | Push to `main` touching above paths → GitHub Actions builds + pushes to `ghcr.io/7acerich1-creator/sovereign-sentinel-pod` | ~5-10 min | `https://github.com/7acerich1-creator/Sovereign-Sentinel-Bot/actions` workflow run status |
| **RunPod (pod)** | Image is passed PER pod-create call by the bot — there is NO static "template" pinning. `startPod()` (`src/pod/runpod-client.ts:166`) reads `process.env.RUNPOD_POD_IMAGE` first, falls through to `DEFAULT_IMAGE = "ghcr.io/7acerich1-creator/sovereign-sentinel-pod:latest"` (line 49). RunPod always pulls fresh on container create. | Every pipeline run that wakes a pod pulls whatever tag is set — `:latest` by default. Override only by setting `RUNPOD_POD_IMAGE` env on Railway to a pinned SHA tag. | Cold-start = next image pull (~30s) | Check Railway env for `RUNPOD_POD_IMAGE`; absent = `:latest`. RunPod console for cold-start logs. |
| **Vercel (Mission Control)** | `Sovereign-Mission-Control/repo/**` (separate repo) | Push to `main` of THAT repo → Vercel auto-deploys | ~1-2 min | Vercel dashboard for `sovereign-mission-control` project |
| **Vercel (Landing)** | `Sovereign-Mission-Control/sovereign-landing/**` (separate repo) | Push to `main` of THAT repo → Vercel auto-deploys | ~1-2 min | Vercel dashboard for `sovereign-landing` project |
| **Supabase (schema)** | `supabase/migrations/*.sql` | **MANUAL** — apply via `mcp__supabase__apply_migration` tool, or `supabase db push` from CLI | Immediate | `list_migrations` tool |
| **Supabase (edge functions)** | `supabase/functions/<name>/index.ts` | **MANUAL** — apply via `mcp__supabase__deploy_edge_function` tool, or `supabase functions deploy <name>` from CLI | Immediate | `list_edge_functions` tool |
| **Supabase (cron / pg_cron)** | SQL `cron.schedule(...)` calls | **MANUAL via SQL** — invoke from Supabase SQL editor or `execute_sql` tool. NOT in migrations (avoids re-firing on every redeploy). | Per cron schedule | `SELECT * FROM cron.job` |

### 3.5.1 Pod deploy — full path

A push to `main` that changes any file under `pod/**` triggers a fully automated, two-stage chain:

1. **GitHub Actions** (`.github/workflows/pod-build.yml`) — runs on GitHub's runners (no local Docker needed), builds the image from `pod/Dockerfile` with repo root as context, pushes to GHCR with three tags: `:latest`, `:<full-sha>`, `:sha-<short-sha>`. ~5-10 min build time. Watch at the Actions tab; image appears in the repo's Packages.
2. **RunPod (next pod wake)** — the bot's `startPod()` always passes `imageName` per pod-create call. There is NO static template pinning. Default image = `ghcr.io/7acerich1-creator/sovereign-sentinel-pod:latest` (constant `DEFAULT_IMAGE` in `src/pod/runpod-client.ts:49`). The next pipeline run that wakes a pod pulls the tag the bot specifies. If `RUNPOD_POD_IMAGE` env is unset on Railway (default), the bot uses `:latest` and gets whatever the GHA build just published. If set to a pinned SHA, the bot uses that SHA forever until the env is updated.

**Net effect:** GHA build completes → next `/pipeline` or `/alfred` run automatically uses the new image. End-to-end automated, no manual RunPod steps required, as long as `RUNPOD_POD_IMAGE` env is unset.

**To pin to a specific build (e.g., rollback):** set `RUNPOD_POD_IMAGE=ghcr.io/7acerich1-creator/sovereign-sentinel-pod:sha-<short>` on Railway. Bot will pass that exact tag on every subsequent pod create. Unset to resume tracking `:latest`.

**Operational tells that the pod hasn't refreshed:**
- Pipeline runs but renders look identical to before a known pod-side change (e.g., new `compose.py` logic doesn't show in thumbnails).
- Most likely cause: GHA build hasn't finished yet — check the Actions tab. Images take 5-10 min to build and publish.
- Less likely: a stale pod is still running (RunPod keeps pods warm for ~10 min after job complete). New pod wake will pull fresh.
- Rare: `RUNPOD_POD_IMAGE` env on Railway is pinned to an old SHA. Check Railway env if everything else looks right.

### 3.5.2 Railway deploy — non-pipeline-blocking rule

Per `feedback_no_push_during_pipeline.md`: never push to `main` while a pipeline is running. Railway auto-deploys, kills the running container, and pipeline state vaporizes. Pre-push verification:
```sql
SELECT * FROM crew_dispatch
WHERE status IN ('claimed','in_progress','pending')
ORDER BY created_at DESC LIMIT 5;
```
Empty result = safe. Otherwise wait or `/cancel`.

### 3.5.3 Mission Control & Landing — separate repos, separate clones

The Mission Control dashboard and Landing pages are NOT in this repo. They live at `C:\Users\richi\Sovereign-Mission-Control\repo\` and `C:\Users\richi\Sovereign-Mission-Control\sovereign-landing\` respectively, each their own git checkout, each their own Vercel project. Any frontend change to those is a push from their own folder, not from this one. See §3 → File System.

### 3.5.4 Supabase — schema vs functions vs cron

Three different things deploy to Supabase, three different mechanisms:
- **Schema migrations** are SQL files in `supabase/migrations/` and apply via the Supabase MCP tool or `supabase db push`. They're idempotent (safe to re-run) only if written that way; default is one-shot.
- **Edge functions** live in `supabase/functions/<name>/index.ts` and deploy via `mcp__supabase__deploy_edge_function` or the CLI. Each function is independently versioned at the Supabase side.
- **Cron jobs** (pg_cron) are NOT in migrations — they're invoked once via SQL editor when a new job is added (S126 bot health canary, for example). Putting them in migrations causes them to re-register / duplicate on each apply.

### 3.5.5 First action when "my change isn't live"

When something you committed isn't visible in production, walk this in order:
1. **Did the right surface get pushed?** Check `git log -1` — confirm the commit hash matches what you expected. Confirm the file path matches the surface (e.g., `pod/**` change won't deploy via Railway).
2. **Did the trigger fire?** Railway auto-deploy: check Railway dashboard. GHA: check the Actions tab. Manual surfaces: did you actually run the deploy command?
3. **Did the trigger succeed?** Railway logs / GHA workflow log / Vercel build log. Build failures here are the most common silent gap.
4. **Is the live runtime serving the new artifact?** `/status` in any bot DM shows live git SHA for Railway. Pod `/health` for the pod (when implemented). For Vercel, the dashboard shows the deployed commit.

**Default assumption:** if you didn't explicitly push to the right surface, your change isn't live. The four planes do not propagate to each other.

---

## 3.6 COOKIE PERSISTENCE (added S128, 2026-05-02)

The Railway service has **NO Volume attached to `/app/data`** — confirmed by inspecting the project canvas (only the Gravity Claw service node, no Volume node). This means every redeploy wipes:
- `/app/data/browser-cookies/<domain>_<account>.json` (TT, IG, YouTube, Threads cookies)
- `/app/data/gravity-claw.db` (the SQLite memory)

For 6 days before S128, this caused Yuki's TT/IG repliers to silently no-op every poll because cookies imported via `/api/browser/import-cookies` were getting nuked. The `cookie-status` endpoint reading 0 across the board was the leading indicator.

**Fix shipped (commit `da3cf2f`):** `src/utils/cookie-persistence.ts`
- New Supabase table `browser_cookies_persistent (domain, account, cookies jsonb, cookie_count, updated_at)` — primary key (domain, account)
- `/api/browser/import-cookies` endpoint now mirrors to Supabase via `persistCookiesToSupabase()` AFTER the disk save
- `restoreAllCookiesFromSupabase()` runs in `main()` right after the boot smoke test, BEFORE any worker starts polling. Reads all rows and writes them back to `/app/data/browser-cookies/`. Skip-on-disk-exists semantics preserve in-session cookie rotation if `/app/data` ever becomes a Volume.

**Architect-side workflow stays the same:** export cookies via Cookie-Editor extension, POST to `/api/browser/import-cookies`. They now survive every redeploy automatically, no env vars to manage.

**Long-term cleanup (future session):** SQLite is also wiped on each deploy because `/app/data` is ephemeral. If we keep using SQLite for memory (vs Supabase-only), attaching a Railway Volume to `/app/data` would fix both cookies and SQLite at once and let us delete the Supabase mirror logic. For now the Supabase mirror is correct — most state already lives in Supabase, and the bot tolerates SQLite re-init at boot.

### 3.6.1 Railway Raw Editor quote bug — DO NOT USE for bulk edits

**Discovered S128b, 2026-05-02.** Railway's Raw Editor (`Variables tab → Raw Editor`) has a parser quirk: when the buffer contains keys whose values are double-quoted (e.g. `LLM_FAILOVER_ORDER="gemini,groq,anthropic"`), editing the buffer and clicking Update Variables can produce a diff where 5+ existing variables are marked for **deletion** and recreated with names prefixed by a stray `"` character (e.g. `"GEMINI_API_KEY` instead of `GEMINI_API_KEY`). Confirmed near-miss: would have deleted GEMINI_API_KEY, LLM_FAILOVER_ORDER, R2_BUCKET_THUMBS, both XTTS_SPEAKER_WAV_*, and SPEAKERS_DIR if Deploy had been clicked.

**Always click Details on the pending-changes banner before clicking Deploy.** If the diff shows ANY deletions you didn't intend, click Discard.

**Use the New Variable button (per-variable form) for individual additions.** That form does not exhibit the bug. Acceptable for bulk additions if you do them one at a time.

`Copy ENV` from the Raw Editor for read is safe — the bug is only in the write path.

---

## 4. GIT WORKFLOW

### Environments

| Environment | Reads From | Writes To | Push Method |
|---|---|---|---|
| Claude Code (Anthropic) | Windows FS directly | Windows FS | Desktop Commander `start_process` → `git push origin main` |
| Cowork (local agent mode) | Sandbox mount (can lag) | Sandbox mount | **Deferred** — tell Ace to run `git push origin main` from terminal |
| GitHub (canonical) | — | `main` branch | — |

### Git Rules (from `feedback_git_workflow.md`)
1. **Git ops via Desktop Commander cmd shell ONLY.** Sandbox bash cannot reliably delete lock files on the mounted FS.
2. **Never push during pipeline runs.** Query `crew_dispatch` for active/claimed rows AND `content_drafts` for recent inserts before pushing.
3. **After any large file write, run `tsc --noEmit` before committing.** Catches sandbox truncation (see 0.5).
4. **Commit messages:** use `commit-msg.txt` workaround on Windows — write the message to a temp file and pass via `git commit -F commit-msg.txt` to avoid PowerShell string-escape issues.

---

## 5. SIX MAVEN CREW AGENTS — see [`MAVEN-CREW-DIRECTIVES.md`](./MAVEN-CREW-DIRECTIVES.md)

Immutable roster. Do not add, remove, or rename. Each agent runs on its own Telegram bot token and owns a Pinecone namespace. **Full calibrated directives, decision trees, hive-interface contracts, and ddxfish pattern specs live in [`MAVEN-CREW-DIRECTIVES.md`](./MAVEN-CREW-DIRECTIVES.md) at repo root.** This section is a roster snapshot only.

| # | Agent | Token | Pinecone NS | One-line role |
|---|-------|---------------|-------------|------|
| 1 | **Veritas** | `VERITAS_TOKEN` (also primary `TELEGRAM_BOT_TOKEN`) | `brand` (writes), `shared` | Business macro meta-watcher. Reads the hive widely, surfaces drift via Telegram DM, never executes. Group lead. |
| 2 | **Sapphire** | `SAPPHIRE_TOKEN` | `sapphire-personal` (PA mode), `brand` (COO mode) | Ace's personal assistant + Life COO (his life, NOT business — Veritas owns business macro). |
| 3 | **Alfred** | `ALFRED_TOKEN` | `hooks` | Content pipeline upstream judgment — daily trend scan + memetic-trigger filter feeds Faceless Factory. |
| 4 | **Yuki** | `YUKI_TOKEN` | `clips` | Social presence + memetic triggering across YouTube / Bluesky / Facebook. SOLE posting authority. |
| 5 | **Anita** | `ANITA_TOKEN` | `content` | Nurture program + funnel diagnosis. Newsletter compounding-ideas track. Cap 3 emails/week autonomous. |
| 6 | **Vector** | `VECTOR_TOKEN` | `funnels` | Analytics writer. Pulls external APIs, writes Supabase analytics tables, reports daily, no downstream dispatch. |

### Hard architectural constraints (per MAVEN-CREW-DIRECTIVES.md §1.2)
- **No cross-bot direct messaging.** Coordination emerges from the shared hive (Pinecone semantic + Supabase structured) only. Each bot DMs Ace directly. Hive medium > direct dispatch. (`PIPELINE_ROUTES` in `src/agent/crew-dispatch.ts` already commented off since S36; this constraint formalizes that.)
- **Two-tier memory:** Supabase = structured state; Pinecone = semantic hive (each bot retrieves only relevant context per cycle, never bulk-reads).
- **Direct-to-Ace messaging only.** Every outbound bot message is a Telegram DM to Ace through that bot's own token. No bot-to-bot DMs.

### Group chat roles (legacy; honored until refactored)
- **Lead** (Veritas): always responds. **Copilot** (Sapphire): plain-English summary on pipeline completion. **Crew** (Alfred/Yuki/Anita/Vector): respond only on `@mention` or broadcast.

### Per-agent LLM teams (S125+ Phase 7, code at `src/index.ts:444`)

Each agent has its own failover chain so a quota hit on one provider doesn't stampede the whole crew.

| Agent | Primary → Fallback chain | Reasoning |
|---|---|---|
| **Veritas** | anthropic → gemini → groq | Chief of Staff. Strategic reasoning. |
| **Anita** | anthropic → gemini → groq | Marketing Lead. Cross-domain copy strategy. |
| **Sapphire** | anthropic → gemini → groq | PA / COO. ddxfish intelligence level. |
| **Alfred** | gemini → groq → anthropic (last-resort, S127) | Daily seed (~1 run/day). Anthropic catches dual-provider outages. ~$3-5/mo cost ceiling. |
| **Vector** | gemini → groq (NO Anthropic) | Numerical analytics. Bulk metrics. |
| **Yuki** | gemini → groq Key B (NO Anthropic) | High-volume engagement. Dual Groq routing. |
| **SS Pipeline** | gemini → groq Key A (NO Anthropic) | High-volume video production. |
| **TCF Pipeline** | gemini → groq Key B (NO Anthropic) | Avoids Groq stampede with SS. |

**Anthropic primary on Veritas, Anita, Sapphire.** Last-resort fallback on Alfred. Yuki, Vector, and both pipelines have NO Anthropic — they fire too often for safe Anthropic exposure.

`AGENT_LLM_TEAMS` env var on Railway can override the chain shape; `ANTHROPIC_MODEL` env var sets the model id (must be a current, real model — e.g. `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`). Default in `config.ts` is `claude-sonnet-4-6`.

---

## 5.5 OPERATOR'S MANUAL — Commands & Pipeline Triggers

**Read this BEFORE answering "how do I trigger X."** Source of truth for every Telegram command and every pipeline entry point. If something here disagrees with the code in `src/index.ts`, the code wins — patch this section.

### A. Telegram command surface (`src/index.ts` switch block starting line ~1012)

| Command | Args | What it does |
|---|---|---|
| `/start` | — | Welcome ping + bot online check. |
| `/status` | — | Full env / LLM team / git SHA / health snapshot. |
| `/model` / `/models` | — | Print active LLM model and per-agent chains. |
| `/memory` | — | Memory layer status (SQLite / Pinecone / Supabase counts). |
| `/compact` | — | Compact recent conversation context. |
| `/skills` | — | List available skills + activation status. |
| `/schedule` | — | Show upcoming scheduled jobs (briefings, sweeps, scans). |
| `/test_tts` | `<text>` | Render TTS sample, sends voice note back. |
| `/test_yt` | `<url>` | YouTube ingestion + transcript probe. No production. |
| `/dryrun` | `<youtube_url>` | Script + audit only. No TTS, no images, no upload. |
| **`/pipeline`** | `<youtube_url> [ss only\|tcf only]` | Full Vidrush pipeline from a URL. Dual-brand by default. |
| **`/alfred`** | `[ss only\|tcf only]` | **Force-trigger Alfred's `daily_trend_scan` autonomous pipeline.** No URL — Alfred generates the seed from the framework, fans into both brands. **This is the autonomous Vidrush trigger.** |
| `/batch` | `[ss\|tcf] [N] [dry]` | Batch producer: N videos per brand. Default 3 per brand. `dry` = scripts only. |
| `/produce` | `[force]` | Content Engine cycle: drafts → FLUX images → distribution. `force` regenerates today's drafts. |
| `/flux-batch` | — | Run FLUX image gen on pending content_engine_queue rows. Deterministic, no LLM. |
| `/drain` | — | Single-pass Buffer backlog drain + R2 clip drain. Zero retry. Pre-flight quota check. |
| `/rechop` | `<youtube_url>` | Re-clip an already-produced long-form into shorts. |
| `/rescue` | `<task>` | Pull a stalled crew_dispatch row and force-execute. |
| `/comment` | `<youtube_url>` | Generate + auto-post Yuki engagement comment on a video. |
| `/buffer_audit` | — | Scan Buffer channels, detect duplicates, purge failed/queued posts. |
| `/mesh` | `<goal>` | Multi-agent mesh execution (passes through to agent loop). |
| `/swarm` | `<goal> [agents]` | Swarm execution with optional agent list (passes through to agent loop). |

### B. Pipeline trigger matrix — three paths to a video

| Path | Trigger | When to use | What runs |
|---|---|---|---|
| **Manual (URL-driven)** | `/pipeline <yt_url>` in Telegram | You found a specific video you want chopped + reframed for both brands. | `executeFullPipeline` → 8-step Vidrush per brand. Uses `pipelineLLM` (Gemini→Groq, no Anthropic). |
| **Autonomous (seed-driven)** | `/alfred` in Telegram **OR** 15:05 UTC daily cron | You want today's video without finding a URL — Alfred projects the thesis from the Sovereign Synthesis framework. | `dispatchTask({to_agent:'alfred', task_type:'daily_trend_scan'})` → Alfred emits `PIPELINE_IDEA_ACE` + `PIPELINE_IDEA_TCF` → bridge calls `executeFullPipeline` for each brand. |
| **Batch** | `/batch [ss\|tcf] [N] [dry]` | You want multiple videos in one sweep (e.g., catch-up after a quiet day). | `produceBatch` → loops N times per brand through full production. `dry` skips TTS/images/upload. |

### C. Common-failure decode

| Symptom | Likely cause | Fix |
|---|---|---|
| `Usage: /pipeline <youtube_url>` | You ran `/pipeline` without a URL. **For autonomous mode use `/alfred`.** | Use `/alfred` (no URL) or supply a URL. |
| `All LLM providers failed: anthropic 404 model: claude-sonnet-X-YYYYY` | `ANTHROPIC_MODEL` Railway env var is set to a non-existent model id. | Unset it (default kicks in) or set to `claude-sonnet-4-6` / `claude-haiku-4-5-20251001`. |
| `gemini 403 Your project has been denied access` | Gemini API key revoked or billing-flagged in Google Cloud. | Check Google Cloud Console → Billing on the project tied to the key. Rotate or restore. |
| `groq 413 Request too large for model` | Conversation history bloat — prompt exceeded TPM tier. | Restart the conversation (resets context) or run `/compact`. |
| `Pipeline queued (position N)` | Another pipeline is running. Yours will start when it finishes. | Wait. Pipeline queue serializes on purpose. |
| `Alfred dispatched but no video appears` | Alfred emitted `PIPELINE_IDEA: NONE` (abstained — none of his candidates scored above threshold) OR all 3 LLM providers in his chain failed. | Check `crew_dispatch` table for the `alfred/daily_trend_scan` row, look at `result` field. |

### D. Where the autonomous cron lives
- **15:05 UTC daily** — `src/index.ts:2558` checks `hasAlreadyFiredToday("alfred", "daily_trend_scan")`, dispatches if not. Once-per-day idempotency via `crew_dispatch` table.
- **15:00 UTC** — Morning briefing (Veritas). **17:00 UTC** — Vector metrics sweep. **18:30 UTC** — ContentEngine production. **20:30 UTC** — Stasis detection. **01:00 UTC** — Evening recap. **Mon 17:10 UTC** — Veritas weekly directive.
- All scheduled jobs in `src/index.ts` boot block, table in §6 below.

---

## 6. CODEBASE ARCHITECTURE

### Tech Stack
- **Language:** TypeScript (strict mode)
- **Runtime:** Node 20
- **Deploy:** Railway via `Dockerfile.bot` (multi-stage)
- **Memory:** three-tier — SQLite (episodic) + Pinecone (semantic) + Supabase (structured)
- **LLM providers:** See §5 "Per-agent LLM teams" table. Summary: Anthropic on Veritas / Anita / Sapphire (last-resort fallback on Alfred). Gemini → Groq for everyone else and both pipelines. OpenAI for Whisper.
- **Image generation:** RunPod (FLUX) for everything — pipeline images via faceless-factory, content-engine queue via fluxBatchImageGen.

### Key `src/` Paths

```
src/
├── index.ts                          — Boot, dispatch poller, task approval poller, scheduled jobs
├── config.ts                         — Env var loading, LLM provider config
├── agent/
│   ├── loop.ts                       — AgentLoop.processMessage() — LIGHT MODE textOnly arg (S44)
│   ├── crew-dispatch.ts              — Supabase-backed task dispatch + pipeline chain tracking
│   └── protocol-injection.ts         — YouTube Growth Protocol hard-inject (S43 T2)
├── engine/
│   ├── content-engine.ts             — Deterministic Content Engine (text+image distribution)
│   ├── faceless-factory.ts           — Faceless video pipeline (script → RunPod FLUX images → XTTS audio → ffmpeg Ken Burns compose)
│   ├── vidrush-orchestrator.ts       — VidRush: 1 URL → long-form → chop → distribute → Buffer week
│   ├── facebook-publisher.ts         — Direct FB Graph API v25.0 publisher, dual-page (ace + CF) (S97)
│   ├── backlog-drainer.ts            — R2 clip backlog → Buffer + FB direct, runs at boot (S90)
│   └── migration.sql                 — content_engine_queue DDL
├── voice/
│   └── tts.ts                        — XTTS TTS via RunPod (brand-routed voice clones: SS uses `XTTS_SPEAKER_WAV_ACE`, TCF uses `XTTS_SPEAKER_WAV_TCF`)
├── prompts/
│   ├── personalities.json            — Layer 1 agent identity
│   ├── shared-context.ts             — Layer 2 shared mission + crew roster
│   └── social-optimization-prompt.ts — Audience Rotation Protocol (S47 D4)
└── tools/
    ├── social-scheduler.ts           — Buffer GraphQL posting (9 channels)
    ├── video-publisher.ts            — YouTube long-form + shorts publish + thumbnail set (S47 D3)
    ├── browser.ts                    — Puppeteer lazy-load (chromium deferred until first browser tool call)
    └── ... (stripe_metrics, buffer_analytics, etc.)

scripts/
└── seed-youtube-protocols.ts         — Seeds 6 rows into protocols table
```

### Pollers
- **Dispatch Poller** (15s interval) — claims `crew_dispatch` rows, dispatches to correct agent, handles LIGHT_TASKS stripping + protocol injection.
- **Task Approval Poller** — watches for approved proposed tasks, auto-executes.

### Scheduled Jobs (all `getUTCHours`-based)

| Job | Fires (UTC / CDT) | Purpose |
|---|---|---|
| Alfred Trend Scan | 15:05 UTC / 10:05 AM CDT | Topic discovery, feeds VidRush |
| Vector Metrics Sweep | 17:00 UTC / 12 PM CDT | Stripe data, performance |
| ContentEngine Production | 18:30 UTC / 1:30 PM CDT | 12 posts generated deterministically |
| Distribution Sweep | every 5 min | Posts ready drafts to Buffer |
| Stasis Detection | 20:30 UTC / 3:30 PM CDT | 6 LIGHT MODE agent self-checks (S44) |
| Veritas Weekly Briefing | Mon 17:10 UTC / 12:10 PM CDT | Chief Brand Officer reflection — reads state, writes Pinecone brand vector, DMs Architect on drift |
| Veritas Weekly Directive | Mon 17:10 UTC | Crew strategic directive payload via crew_dispatch |

---

## 7. SUPABASE DATA MODEL

### RLS Model
- **`service_role` key** — used by bot, bypasses RLS.
- **`anon` key** — used by dashboard, RLS enforced. All writes use service role from bot side.
- **Retention:** no global policy. Individual tables manage their own cleanup (e.g., `clip cleanup` task).

### Key Tables

| Table | Purpose |
|---|---|
| `crew_dispatch` | Task queue — agents claim rows, execute, mark complete. Pipeline chain tracking via parent_task_id. |
| `content_drafts` | Agent-produced content awaiting distribution or approval. |
| `content_engine_queue` | Deterministic Content Engine queue (19 cols, 3 indexes, RLS). |
| `content_transmissions` | Buffer post log for Vector's metrics sweep. |
| `briefings` | Agent briefings surfaced to dashboard. |
| `activity_log` | Dashboard dispatch log (chat_id starts with `dashboard-`). |
| `protocols` | Architect standing directives (6 YT Growth Protocol rows, S42). |
| `knowledge_nodes` | 75 shared nodes, namespace `sovereign-synthesis`. |
| `sovereign_metrics` | `fiscal_sum`, `mindset_count`, `elite_count`, `velocity`. |
| `identity_milestones` | SIEP-01 visual brand evolutions. |
| `stripe_metrics` | Vector's revenue tracking. |
| `vid_rush_queue` | Long-form pipeline job state + recent titles for uniqueness enforcement. |
| `video_posts` | Published video metadata (YT, TikTok). |
| `nurture_templates` | Email templates (Anita's domain). |
| `todos` / `habits` / `tasks` | Dashboard data. See CLAUDE.md for exact schemas. |

### RPC Functions
- Task queue management, pipeline chain walk (`getFullPipelineChain`), completion detection (`checkPipelineComplete`), content engine status.

### `tasks` Schema Contract (from CLAUDE.md)
`id` uuid PK · `title` text · `description` text · `type` 'human'|'ai' · `status` 'todo'|'in-progress'|'done' · `priority` 'low'|'medium'|'high' · `created_at` timestamptz.

---

## 8. TWO-BRAND ACCOUNT MAP (CANONICAL)

**Brand 1: Sovereign Synthesis** (personal, primary revenue driver)
**Brand 2: The Containment Field** (anonymous dark-psych top-of-funnel feeder)

| Platform | Brand | Handle | Google Account | Buffer |
|---|---|---|---|---|
| YouTube | Sovereign Synthesis | Ace Richie 77 (`UCbj9a6brDL9hNIY1BpxOJfQ`) | empoweredservices2013 | Yes |
| YouTube | Containment Field | The Containment Field (`UCLHJIIEjavmrS3R70xnCD1Q`) | 7ace.rich1 | Yes |
| Instagram | Sovereign Synthesis | `sovereign_synthesis` | empoweredservices2013 | Yes |
| Instagram | Containment Field | `the_containment_field` | empoweredservices2013 | Yes |
| **TikTok** | Sovereign Synthesis | `sovereign_synthesis` | **7ace.rich1** (CROSSED) | Yes |
| **TikTok** | Containment Field | `the_containment_field` | **empoweredservices2013** (CROSSED) | Yes |
| Threads | Sovereign Synthesis | `ace_richie_77` | via IG login | Yes |
| Reddit | Sovereign Synthesis | `sovereign_synthesis` | 7ace.rich1 | No (manual) |

**Channel math (verified):** Sovereign Synthesis = 4 channels (YT, IG, TikTok, Threads), Containment Field = 3 channels (YT, IG, TikTok), **total = 7 Buffer channels**. LinkedIn/Pinterest/Reddit NOT in Buffer.

**CRITICAL — TikTok accounts are CROSSED** vs other platforms. Every other platform: `empoweredservices2013` = Sovereign Synthesis, `7ace.rich1` = Containment Field. TikTok ONLY: `7ace.rich1` = Sovereign Synthesis, `empoweredservices2013` = Containment Field.

**Live profile verification:**
- `instagram.com/sovereign_synthesis` — "Systems Architect / Your mind runs firmware / sovereign-synthesis.com/tier-0/links"
- `tiktok.com/@sovereign_synthesis` — "Your mind runs firmware. I teach the update. sovereign-synthesis.com"
- Railway env: `TIKTOK_HANDLE_SS=sovereign_synthesis`, `TIKTOK_HANDLE_CF=the_containment_field`.

**YouTube OAuth tokens (Railway):** `YOUTUBE_REFRESH_TOKEN` (Sovereign Synthesis) + `YOUTUBE_REFRESH_TOKEN_TCF` (Containment Field). Both PERMANENT (app published).

**Buffer scope:** image+text only. Video goes through the direct video publisher tools. Yuki is the SOLE Buffer posting authority.

**Content cadence target:** 329 image/text posts/week (Transmission Grid) + 140 Shorts+companions/week = **469/week combined** when fully operational.

---

## 9. PRODUCT LADDER (LOCKED)

**Canonical tier numbering is 2–7** to match Stripe, portal URLs, and Mission Control. Never use 1–6. T0/T1 are free lead magnets.

| Tier | Name | Price | Stripe Product ID |
|---|---|---|---|
| 0 | Lead magnet (free) | $0 | — |
| 1 | Nurture (free) | $0 | — |
| 2 | The Shield: Protocol 77 | $77 | `prod_UAvCSFqyO1DhOt` |
| 3 | The Map: Navigation Override | $177 | `prod_UAvCuJRCaw6VNE` |
| 4 | The Architect: Foundation Protocol | $477 | `prod_UAvCaUUJF45gtE` |
| 5 | The Architect: Adversarial Systems | $1,497 | `prod_UAvCbyZdNcV9Q0` |
| 6 | The Architect: Sovereign Integration | $3,777 | `prod_UAvCJAItedto70` |
| 7 | Inner Circle: Sovereign Licensing | $12,000 | `prod_UAvCmnkjzGOpN2` |

Archived (do not reuse): `prod_UAWwRgKTgeF6wj`, `prod_UAX3zxKjJiCYtO`, `prod_UAX8uUp60MvBGZ`.

---

## 10. ENVIRONMENT VARIABLES — DEFINITIVE MAP

**Rule:** One canonical name per variable. No fallbacks. If code and Railway disagree, this document wins.

### CRITICAL — bot will not boot without these
`TELEGRAM_BOT_TOKEN` (aliased `VERITAS_TOKEN`) · `SAPPHIRE_TOKEN` · `ALFRED_TOKEN` · `YUKI_TOKEN` · `ANITA_TOKEN` · `VECTOR_TOKEN` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `ANTHROPIC_API_KEY`

### IMPORTANT — feature-breaking if missing
| Var | Powers |
|---|---|
| `BUFFER_API_KEY` | Buffer GraphQL (9 channels) — personal key "vector", expires 2027-03-27 |
| `PINECONE_API_KEY` / `PINECONE_INDEX` / `PINECONE_HOST` | Semantic memory (316 vectors live) |
| `OPENAI_API_KEY` | Whisper transcription + LLM failover |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Revenue metrics + webhook verification. Account `acct_1TBoTkRNyK9VQwla`. |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | YouTube OAuth |
| `YOUTUBE_REFRESH_TOKEN` / `YOUTUBE_REFRESH_TOKEN_TCF` | Per-brand YT uploads |
| `YOUTUBE_COOKIES_BASE64` | yt-dlp auth (YouTube blocks Railway IPs) |
| `GROQ_API_KEY` / `GROQ_API_KEY_TCF` | Pipeline LLM (dual keys for brand separation) |
| `WEBHOOKS_ENABLED` | Must be "true" for `/api/*` endpoints |
| `MCP_JSON_B64` | MCP server config (base64) |
| `FACEBOOK_PAGE_ACCESS_TOKEN` / `FACEBOOK_PAGE_ID` | Sovereign Synthesis FB page (ID `1064072003457963`). Graph API v25.0 direct publish. System user token, never-expire. |
| `FACEBOOK_CF_PAGE_ACCESS_TOKEN` / `FACEBOOK_CF_PAGE_ID` | The Containment Field FB page (ID `987809164425935`). Graph API v25.0 direct publish. System user token, never-expire. S97. |

### OPTIONAL — defaulted
`NODE_ENV=production` · `SQLITE_PATH=./gravity-claw.db` · `TZ` · `PORT` (Railway sets) · `LLM_DEFAULT_PROVIDER=anthropic` · `LLM_FAILOVER_ORDER=groq,gemini,anthropic,openai` · `MCP_ENABLED=false` (OOM prevention) · `BROWSER_ENABLED=false`

### Timezone
`MORNING_BRIEFING_HOUR=15` (10 AM CDT) · `EVENING_RECAP_HOUR=1` (8 PM CDT). Code uses `getUTCHours()`. Ace is CDT (UTC-5).

### Instagram tokens (DO set)
`INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ID` (SS) and `INSTAGRAM_ACCESS_TOKEN_CF` + `INSTAGRAM_BUSINESS_ID_CF` (TCF) — Graph API powers Yuki's IG comment-reply worker.

### Aliases (use the right-hand name)
`SOCIAL_SCHEDULER_API_KEY` → `BUFFER_API_KEY` · `NEXT_PUBLIC_SUPABASE_URL` → `SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `SUPABASE_ANON_KEY` · `AUTHORIZED_USER_ID` → `TELEGRAM_AUTHORIZED_USER_ID`

---

## 11. EMAIL BRAND STANDARD (Anita MUST follow)

When Anita creates ANY email, she MUST conform to the standard documented in Mission Control Master Reference Section 9A:

1. Dark HTML wrapper with `prefers-color-scheme: light` CSS toggle
2. Table-based layout (600px card, `#121212` bg, `#252525` border, 8px radius)
3. Header: "SOVEREIGN SYNTHESIS" left, "Transmission NNN" right
4. Gradient accent line: `linear-gradient(#E5850F → #5A9CF5 → #2ECC8F)`
5. CSS classes: `.ss-outer`, `.ss-card`, `.ss-header`, `.ss-body-text`, `.ss-heading`, `.ss-quote-box`
6. Section label color coding: Gold=welcome/scarcity, Blue=defense/blueprint, Green=activation
7. CTA button: `#E5850F` bg, `#000000` text, uppercase, 1.5px letter-spacing
8. Footer with unsubscribe link to `https://sovereign-synthesis.com/unsubscribe`
9. Signature: "— Ace" + "Sovereign Synthesis"

**Reference template:** `email-templates/01-welcome-email.html` — the structural skeleton to clone from.

**Missing tools (Phase 6 backlog):** `read_nurture_template`, `update_nurture_template`, email scheduling, conversion tracking. Until built, Anita can create drafts but not push live.

---

## 12. WEBHOOKS

### 12.1 Chat Bridge (`/api/chat-bridge`) — Railway bot

Mission Control chat uses the real agent loop via a webhook on the Railway bot.

- **Endpoint:** `POST /api/chat-bridge` on Railway bot
- **Payload:** `{ agent_name, content }` (+ optional context fields)
- **Flow:** MC `/api/chat` + `/api/chat-group` → Railway `/api/chat-bridge` → `AgentLoop.processMessage` (full personality, tools, Pinecone, memory) → response streamed back to MC
- **Fallback:** MC retains template responses for when Railway is unreachable
- **Gated by:** `WEBHOOKS_ENABLED=true` env var

### 12.2 Supabase Edge Functions (separate plane from Railway)

Supabase hosts a second set of webhook handlers at `https://wzthxohtgojenukmdubz.supabase.co/functions/v1/<slug>`. Their env vars live in **Supabase Dashboard → Project Settings → Edge Functions → Secrets**, NOT in Railway. `execute_sql` cannot read them.

| Slug | Version | Role |
|---|---|---|
| `stripe-webhook` | v8 | Primary Stripe receiver. Handles `checkout.session.completed` only. Provisions tier access + fans out a revenue signal. |
| `send-purchase-email` | v1 | Resend-backed receipt email + `initiates` table patch. Called directly by `stripe-webhook`. |
| `send-nurture-email` | v3 | Anita's nurture template delivery. Called by the native bot nurture poller. |
| `fireflies-webhook` | v4 | Meeting transcript ingestion. |

**`stripe-webhook` step order (critical for failure mode reasoning):**

1. Log to `revenue_log` (product_id=tier, metadata includes stripe ids)
2. Find-or-create user via `supabase.auth.admin`
3. Grant `member_access` row with `tier_slug`, `granted_by='stripe-webhook'`
4. Insert `audit_trail` row with `action='stripe_purchase'`
5. Receipt email path → `send-purchase-email` Edge Function (direct call)
6. Fire-and-forget fetch → `BOT_WEBHOOK_URL` (Telegram bot fan-out for revenue signal)

The live code at `supabase/functions/stripe-webhook/index.ts` is the source of truth for step 5's exact call shape — read it before running a paid test.

**Relevant Edge Function env vars (live in Supabase, not Railway):**

| Var | Powers |
|---|---|
| `BOT_WEBHOOK_URL` | Telegram bot fan-out from `stripe-webhook` step 6. Should point to the Railway bot's `/api/stripe-webhook` or equivalent `revenue_signal` receiver. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Used by stripe-webhook for revenue_log + member_access writes. |
| `RESEND_API_KEY` | **Currently hardcoded in `send-purchase-email` source** — should be moved to env var. Security issue tracked in `SECURITY-ISSUES.md`. |

**Duplicate webhook handler — be aware:**

There is ALSO a bot-side webhook handler at `src/index.ts:2014` (`webhookServer.register("/api/stripe-webhook", ...)`) that signature-verifies via `STRIPE_WEBHOOK_SECRET` and writes to `revenue_log + mission_metrics + activity_log`. Stripe can only send each event to one URL per endpoint config — exactly one of these two handlers is the registered receiver in Stripe dashboard. **Which one determines which tables light up on the first paid test.** Verify in Stripe dashboard → Developers → Webhooks before running a test transaction.

---

## 13. SOVEREIGNSYNTHESISPROJECTS — LEGACY PROTOCOL

The `SovereignSynthesisProjects` folder is the **parts warehouse**, not a deployable project.

**Rules:**
1. **Reference, don't import.** Read the code, understand the pattern, rebuild in the current TypeScript architecture.
2. **Verify before trusting.** Credentials in `.env.vault` may be expired. The Google refresh token IS dead.
3. **Never deploy from SSP.** All deployable code is in `Sovereign-Sentinel-Bot` (Railway) or `Sovereign-Mission-Control` (Vercel).

**Still canonical from SSP:**
- Google OAuth Client ID/Secret (`5134562222-...` — active)
- Skills vault (`gravity-claw-skills-vault/`)
- Brand identity assets
- `TARGET_DATA.md` (customer avatars, pain points, messaging angles)
- `SYSTEM_IDS_CANONICAL.md` (canonical IDs doc)

**Dead from SSP:**
- Google Refresh Token (invalid_grant, 7-day Testing mode expiry)
- Maven Crew Python agents (reference-only; TS agent loop is live)
- `vid_rush_engine.py` (ported to `vid-rush.ts`)

---

## 14. AGENT COORDINATION — see [`MAVEN-CREW-DIRECTIVES.md`](./MAVEN-CREW-DIRECTIVES.md)

Per-bot calibrated directives, decision trees, autonomy loops, reflection schemas, ddxfish prompt-pieces structure, hive-interface contracts, DM format templates, self-evolution hooks, and tool sets are all canonical in [`MAVEN-CREW-DIRECTIVES.md`](./MAVEN-CREW-DIRECTIVES.md). This section formerly held a 6-row exec-role table + tool summary; both are superseded by the directive doc.

**The Sapphire-as-Life-COO refinement (S117):** Sapphire's "COO" role is COO of Ace's *life*, not the business. Veritas owns business macro. Operational test: business numbers → Veritas; Richie numbers → Sapphire.

---

## 15. META APP REALITY CHECK (added S128, 2026-05-02)

**Why Yuki IG and FB have been silent for ~6 days, definitively.**

Spent S128 walking through every plausible misconfiguration. The actual root cause is at the deepest layer (Meta App configuration), not at any layer we'd been investigating. Documenting here so the next session doesn't repeat the wrong-fork search.

### The Meta object map (ground truth as of 2026-05-02)

| Object | Type | ID | Notes |
|---|---|---|---|
| Sovereign Synthesis FB "Page" | **Pro Mode personal profile** (NOT a classic Page) | `1064072003457963` (page-id), redirects to `profile.php?id=61573475925594` | category: "Entrepreneur"; 3 followers; FB Graph treats it as Page-shaped but it's a personal profile in Pro Mode |
| The Containment Field FB "Page" | **Pro Mode personal profile** | `987809164425935`, redirects to `profile.php?id=61572015403001` | category: "Digital creator"; 0 followers |
| `@sovereign_synthesis` Instagram | Business | **`17841406463677551`** | linked in Meta Accounts Center to Ace's personal FB account, NOT to the SS Pro Mode profile |
| `@the_containment_field` Instagram | Business | **`17841435127932672`** | same story for CF |
| Meta App | "Sovereign synthesis publisher" | (debug_token confirms) | **Has NO Instagram product configured.** Token scopes prove: only `pages_*`, `ads_*`, `business_management`, `read_insights`, `public_profile`. Zero `instagram_*`. |
| `META_SYSTEM_USER_TOKEN` | SYSTEM_USER | name="Conversions API System User" id=`122094455907295318` | scopes: `read_insights`, `ads_management`, `ads_read`, `business_management`, `public_profile`. No IG. No Pages. |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | PAGE | bound to `1064072003457963` | scopes: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_read_user_content`, `pages_manage_posts`, `public_profile`. No IG. |

System Users available in Business Manager: "content bot", "Conversions API System User" (×2 entries).

### Why every path we tried failed

1. **`getCredentials()` auto-discovery via FB Page Token returns null** — the Page Token DOES return 200 from Graph API and resolves to the right Page, but `instagram_business_account` is null because the FB Pro Mode profiles have no IG link in Business Suite (the IGs are linked at the Accounts Center level to Ace's personal FB account, not to the Pro Mode profile that Railway uses as `FACEBOOK_PAGE_ID`).
2. **Direct IG Graph API access via System User token returns 400 / error code 100 / subcode 33** — "Object does not exist or missing permissions." The IG IDs are valid but the token can't see them.
3. **Assigning IG accounts to System Users in Business Suite does NOT retroactively grant scopes.** Token scopes are baked at generation time; asset assignment alone is necessary but not sufficient.

### What actually unblocks IG (whenever the Architect is ready, in dev console)

1. `developers.facebook.com/apps` → open "Sovereign synthesis publisher"
2. Add Product → **Instagram** → set up Instagram Business Login, link both IG accounts
3. Business Suite → System Users → pick "content bot" (or whichever) → Add Assets → Instagram → both accounts → Full Control
4. Same System User → **Generate New Token** → check `instagram_basic` + `instagram_manage_comments` (additive to existing scopes) → Generate
5. Replace `META_SYSTEM_USER_TOKEN` on Railway with new value
6. Add explicit env vars (auto-discovery still won't work, IGs aren't linked to a real Page):
   - `INSTAGRAM_ACCESS_TOKEN` = new META_SYSTEM_USER_TOKEN value
   - `INSTAGRAM_ACCESS_TOKEN_CF` = same value
   - `INSTAGRAM_BUSINESS_ID` = `17841406463677551`
   - `INSTAGRAM_BUSINESS_ID_CF` = `17841435127932672`

The IG replier in `src/proactive/yuki-instagram-replier.ts` already supports the explicit-creds path as the first branch of `getCredentials()`. No code change needed once the token has IG scopes.

### Alternative path (SHIPPED S128b, 2026-05-02 — `yuki-instagram-browser-replier.ts`)

The browser-based replier is now live. Mirrors the TikTok pattern, uses S128 cookie persistence, scheduled to fire 95 min after boot then every 3h with 25% random skip. New table `instagram_browser_replies_seen`. Env vars on Railway:
- `INSTAGRAM_HANDLE_SS=sovereign_synthesis`
- `INSTAGRAM_HANDLE_CF=the_containment_field`

Cookies for both brands seeded directly into `browser_cookies_persistent` (acerichie ds 6460415455 = sovereign_synthesis, tcf ds 35061378931 = the_containment_field).

The Graph API replier (`yuki-instagram-replier.ts`) is left in place — it silently no-ops because of the missing IG scopes documented above. If/when Architect adds the Instagram product to the Meta App and regenerates the System User token with IG scopes, the Graph API path will start working in parallel and we can decide which to keep.

---

## 16. REFERENCE LINKS

| Resource | URL / Path |
|---|---|
| Sovereign Sentinel Bot repo | https://github.com/7acerich1-creator/Sovereign-Sentinel-Bot |
| Mission Control repo | https://github.com/7acerich1-creator/Sovereign-Mission-Control |
| Mission Control live | https://sovereign-mission-control.vercel.app/ |
| Supabase dashboard | https://supabase.com/dashboard/project/wzthxohtgojenukmdubz |
| Railway dashboard | https://railway.app (project `77e69bc6-f7db-4485-a756-ec393fcd280e`) |
| Pinecone console | https://app.pinecone.io |
| Google Cloud Console | https://console.cloud.google.com/apis/credentials?project=project-b0dc5e49-2aad-42ca-938 |
| Stripe dashboard | https://dashboard.stripe.com |
| Buffer dashboard | https://buffer.com |
| Posting guide | `Sovereign-Mission-Control/SOVEREIGN-POSTING-GUIDE.md` |
| YouTube Growth Protocol v2.0 | `SOVEREIGN-YOUTUBE-GROWTH-PROTOCOL.md` (repo root) |
| Canonical IDs | `SovereignSynthesisProjects/gravity-claw-skills-vault/SYSTEM_IDS_CANONICAL.md` |
| Session history | [`HISTORY.md`](./HISTORY.md) |
| Runtime state | Read live from `src/voice/tts.ts`, `src/index.ts`, Railway env. Do not cache to a file. |
| Revenue-first gate | [`NORTH_STAR.md`](./NORTH_STAR.md) |

---

## LIVE FUNNEL ARCHITECTURE (Verified 2026-04-13)

**sovereign-landing** — 27 pages live on `sovereign-synthesis.com` via Vercel. GitHub: `7acerich1-creator/sovereign-landing`, auto-deploys to Vercel on push to `main`.

### Site Map — 27 Pages Live

**Entry Points:**

- `/` — Homepage. ROM email+name capture → Supabase `initiates` table + edge function nurture email. On success → redirects to `/tier-1/diagnostic`. P77 CTA with live Stripe link at bottom.
- `/tier-0/links` — Containment Field linktree. Boot sequence animation. Single CTA → diagnostic. Hidden architect link → about.
- `/about.html` — Architect profile. 3 sections: Who/Glitch/Signal. Links back to T0.

**Funnel Tiers:**

- **T1:** `/tier-1/diagnostic` (12Q interference pattern quiz) + `/tier-1/download.html` (ROM PDF download from Supabase storage)
- **T2:** `/tier-2/protocol-77.html` ($77 sales) + `/tier-2/protocol-77-runner.html` (interactive runner, auth-gated) + `/tier-2/thank-you.html`
- **T3:** `/tier-3/manifesto.html` ($177 sales) + `/tier-3/manifesto-navigator.html` + `/tier-3/thank-you.html` + `/manifesto-portal/`
- **T4:** `/tier-4/course-portal.html` + `/tier-4/defense-protocol.html` ($477 sales) + `/tier-4/thank-you.html` — Phase 1: DECLASSIFICATION
- **T5:** `/tier-5/course-portal.html` + `/tier-5/phase-2.html` ($1,497 sales) + `/tier-5/thank-you.html` — Phase 2: NEUTRALIZATION
- **T6:** `/tier-6/course-portal.html` + `/tier-6/phase-3.html` ($3,777 sales) + `/tier-6/thank-you.html` — Phase 3: THE DEPLOYMENT
- **T7:** `/tier-7/inner-circle.html` ($12,000 application) + `/tier-7/member-portal.html` + `/tier-7/thank-you.html`

**Infrastructure Pages:** `/privacy.html`, `/terms.html`, `/unsubscribe.html`

**Email Templates (11):** welcome, purchase confirmations (tiers 2–7), magic-link, nurture sequence (02–05)

### Supabase Bridge

The `product_tiers` table in Supabase (project: `wzthxohtgojenukmdubz`) contains the complete product catalog with Stripe price IDs, portal/sales URLs, curriculum, features, and psych-op descriptions for every tier. This is the **SINGLE SOURCE OF TRUTH** for product data. Both the bot and the dashboard should read from this table.

### Design System

- **Homepage:** EB Garamond + Courier Prime
- **All other pages:** Space Grotesk + Space Mono
- **Palette:** cyan `#3EF7E8`, gold `#C9A84C`, violet `#7C5CFC`
- **Dark base** `#050508`, light theme toggle on all pages
- **Aesthetic:** Editorial-architectural (NOT the old cyberpunk matrix rain from March 2026 — that is OBSOLETE)

### Key Infrastructure

| Resource | ID / URL |
|---|---|
| Vercel project (landing) | `prj_P8HfPP5BjJYAbAM9KT1FbC4KGpFm` |
| Vercel project (MC) | `prj_L5oBItJKbcVKX4TIAkupbV7dN9s3` |
| Vercel team | `team_BUxeWJBDqRUYPqpgf95jghug` |
| Supabase | `wzthxohtgojenukmdubz.supabase.co` |
| Stripe P77 checkout | `buy.stripe.com/eVq5kFcwy8sX4N0eD9fYY00` |
| GitHub repo | `7acerich1-creator/sovereign-landing` (public, auto-deploys) |

---

## 16. SESSION HANDOFF CHECKLIST

At the END of every session, the session pilot MUST:

1. **Append the session summary to `HISTORY.md`** (not here). Use the format: `### Session NN Summary (YYYY-MM-DD)` + status, commits, files touched, DVP tags, next-session priorities.
2. **Update this file ONLY if an invariant changed** — new env var, new agent role, new data schema, new infrastructure ID. Do not append session narratives.
3. **Update memory files** in `spaces/.../memory/` for feedback, project state, user facts.
5. **Declare push status:**
   - **Push executed** (Claude Code): Desktop Commander cmd → `git push origin main`
   - **Push deferred** (Cowork): tell Ace to run `git push origin main` from terminal
   - **No push needed:** docs-only changes that don't affect Railway deploy

### Contradiction Prevention (Added 2026-04-02)

When changing the status of ANY system component, update every section that references it. The 2026-04-02 audit found 8 contradictions caused by partial updates.

| If you change... | Also update... |
|---|---|
| An env var status (Sec 10) | Any session entry in HISTORY.md referencing that var |
| Infra IDs (Sec 3) | Section 15 reference links |
| Agent role (Sec 5 or 14) | Supabase personality blueprints; memory `project_agent_role_reality.md` |
| Git/push protocol (Sec 4) | MC Master Ref Sec 3 + Sec 14 |
| Posting math / channel count (Sec 8) | MC Master Ref Sec 15 + Posting Guide header |

**Rule:** If a status appears in more than one section, `ctrl+F` before closing the session. Cheaper than a full continuity audit.

### Quick Context Recovery (new sessions)
1. `NORTH_STAR.md`
2. This file
3. `MEMORY.md` index (`spaces/.../memory/`)
4. `HISTORY.md` — only when you need a specific past session
5. Runtime state — read live from `src/voice/tts.ts`, `src/index.ts`, Railway. Do not cache to a file.

---

## Known Invariants That Bite (Do Not Forget)

- **Never push during pipeline runs** — Railway auto-deploy kills the container mid-run.
- **Dispatch mode strips memory** — agents in `crew_dispatch` do NOT load episodic memory/summaries (Session 35). Don't assume dispatch-mode agents can recall recent chats.
- **LIGHT_TASKS stripping** — `stasis_self_check` agents get zero tools and `iterCap=1` (Session 44). Don't add tool-requiring tasks to `LIGHT_TASKS`.
- **Pinecone embeddings ARE live** — `GEMINI_API_KEY` powers Gemini embedding-001 (1024-dim). 4,339+ vectors across 12 namespaces verified live. Earlier "embeddings disabled" claims that floated around old session notes are wrong; ignore them. (See §3 Pinecone block for full namespace list.)
- **Buffer YouTube drops the `tags` field** on publish — use the `Related topics:` smuggling line in description body instead (Session 47 D4).
- **TikTok accounts are CROSSED** relative to other platforms (see Section 8).
- **Faceless IS the thesis, not a defect.** Never propose Ace films/voices himself. Max compromise: static photo on thumbnail. See `feedback_never_ace_on_camera.md`.
- **Zero MRR against $1.2M target** — every build must answer "does this move one of NORTH_STAR's 5 input metrics in <7 days?" Revenue-first pushback is authorized.
- **Fat-tool dispatch must remap params** — `_fat.ts` tools wrap narrow `*Tool` classes that have their own arg names. When adding/editing a fat tool, verify the schema field names match what the narrow tool reads, OR remap inside `execute()` before calling `narrowT.execute(args)`. The reminders tool was silently broken this way for ~2 weeks (S129). Pattern check: `grep "args\\." src/tools/sapphire/<narrow>.ts` and compare to the fat schema's `parameters` keys.

---

*End of lean master reference. For session-by-session history — every fix, every DVP tag, every resolved blocker from Sessions 1–47 — see [`HISTORY.md`](./HISTORY.md).*
