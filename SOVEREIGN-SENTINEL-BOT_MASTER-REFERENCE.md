# Sovereign Sentinel Bot — Master Reference (LEAN)

> **This file holds INVARIANTS ONLY.** Things that don't change session-to-session: identity, infrastructure IDs, env var map, schemas, protocols, the canonical account map, the product ladder, architectural rules.
>
> **For session-by-session history** (Sessions 1–47, every fix, every DVP tag, every resolved blocker) see [`HISTORY.md`](./HISTORY.md). That file is the append-only journal. This file is the trimmed reference.
>
> **For live runtime truth** (TTS routing, LLM chain, git SHA, env var presence at boot) see [`LIVE_STATE.md`](./LIVE_STATE.md). Auto-generated from `src/voice/tts.ts` + `src/index.ts`. If `LIVE_STATE.md` contradicts anything in this file, **`LIVE_STATE.md` wins** — patch this file and move on.
>
> **For revenue-first sanity check** (the 5 input metrics, current highest-leverage action) see [`NORTH_STAR.md`](./NORTH_STAR.md). Read before authorizing any build task.

**Last trimmed:** 2026-04-11 (Lean rewrite — everything archived to HISTORY.md)

---

## ⚡ Session Start Protocol (from `CLAUDE.md`)

1. Read `NORTH_STAR.md` — revenue gate, 5 input metrics, current highest-leverage action.
2. Read `LIVE_STATE.md` — regenerate via `npm run verify-state` if missing or >24h old.
3. Read this file — invariants, schemas, architectural rules.
4. Read memory index `MEMORY.md` — feedback, prior session learnings.
5. Only read `HISTORY.md` when you need a specific past session's context (searchable by session number or DVP tag).

**Never push to `main` while the pipeline is running.** Railway auto-deploys and kills the container. See `feedback_no_push_during_pipeline.md` in memory.

---

## MISSION CONTROL CROSS-SYNC LOG

*Written BY Mission Control sessions, READ BY Sentinel Bot sessions. Read at every session start. Most recent entries at TOP.*

### 2026-04-15 — S62: Pod Foundation CLOSED (Phase 1 ☑; image published + speaker WAVs on volume)

**What shipped on the bot side:**
- `pod/Dockerfile` patched to resolve Ubuntu-22.04 distutils-`blinker` conflict (pre-install with `--ignore-installed` before `pip install -r requirements.txt`). Commit `57d786f`.
- GitHub Actions `.github/workflows/pod-build.yml` (shipped S62 in `72133f4`) now green on run `24435104242` (10m53s). Image published to GHCR:
  - `ghcr.io/7acerich1-creator/sovereign-sentinel-pod:latest`
  - `ghcr.io/7acerich1-creator/sovereign-sentinel-pod:sha-57d786f`
  - `ghcr.io/7acerich1-creator/sovereign-sentinel-pod:57d786fb0d6a8ad31b3871f1ae50f1048f91eebf`
  - Manifest digest: `sha256:00212d098b3f6516614ccee2a57319fb8579a1f41442422828ca2cf83ccfd9eb`

**Infrastructure state after this session:**
- RunPod network volume `gai851lcfw` (50GB, US-KS-2) holds the XTTSv2 speaker references:
  - `/runpod-volume/speakers/ace_ref.wav` (661578B, sha256 `8dec3af0362287a7…`)
  - `/runpod-volume/speakers/tcf_ref.wav` (661578B, sha256 `524f9e333d248e03…`)
- Railway env vars canonicalized: `XTTS_SPEAKER_WAV_ACE=/runpod-volume/speakers/ace_ref.wav`, `XTTS_SPEAKER_WAV_TCF=/runpod-volume/speakers/tcf_ref.wav`.
- **Stale Railway vars PURGED:** `XTTS_SERVER_URL` (pointed to long-dead pod `a2shyagwexfhon`) and `RUNPOD_POD_ID` (same dead pod). Production TTS has been falling through the chain to Edge/ElevenLabs for ~12 sessions with no one flagging it. Post-Phase 2 wiring, TTS routing will invoke a fresh pod per job instead of a long-lived `RUNPOD_POD_ID`.
- **Pod count after this session: 0.** Three pods terminated during cleanup — temp upload pod `n1tlik82n7phow`, orphan `org42k0erve9kr`, forgotten `1mcle290zo4dnc`. Total session spend on provisioning + upload ≈ $0.08.

**Known hazard captured (reference for future sessions):**
- `ssh.exe` on Windows writes directly to the console handle, NOT stdout — so Desktop Commander shells (and any MCP that captures stdout) cannot read ssh output, even from `ssh -V`. Workaround used this session: paramiko (pure-Python SSH + SFTP). If future sessions need interactive SSH to a pod, use paramiko, not ssh.exe.

**Phase 1 closed. Next session opens Phase 2 Task 2.1** — `src/pod/runpod-client.ts` against the now-live image at `ghcr.io/7acerich1-creator/sovereign-sentinel-pod:latest` and volume `gai851lcfw`.

---

### 2026-04-14 — S57: Funnel Restructure SHIPPED (executed from Sentinel Bot cowork via Desktop Commander)

**What shipped on the landing page repo side (`sovereign-synthesis.com`):**
- `/` now serves the authority dossier (promoted from `/tier-0/links`) with new purpose subtext under STATUS: CONTAINED
- `/diagnostic` captures email POST-result (not pre-result) via gated form; writes to Supabase `initiates` with new `dominant_pattern` field (A→approval-loop, B→overload-spiral, C→identity-lock)
- `/about` publishes the canonical purpose statement in dossier aesthetic (Space Grotesk + Space Mono, gold CTA to `/diagnostic`)
- `/manual` preserves the old root email-capture page (external links still resolve)
- `/tier-0/links` → 307 → `/` (archived-link safety net)
- Two commits: `f712fce` (initial) + `cd5685c` (fix: cleanUrls rewrite destination)

**Supabase migration applied** on project `wzthxohtgojenukmdubz`: `ALTER TABLE initiates ADD COLUMN IF NOT EXISTS dominant_pattern text;`. Verified via `information_schema.columns`.

**Verification (post-deploy, from workspace sandbox curl):**
- `sovereign-synthesis.com/` → 307 → `www.sovereign-synthesis.com/` → 200 (apex-to-www is Vercel default DNS behavior, not a code choice)
- `/diagnostic` → 200, body contains `SEND ME THE MANUAL` + `dominant_pattern`
- `/about` → 200, body contains "never rewarded" + "formation"
- `/manual` → 200, body is preserved old root
- `/tier-0/links` → 307 → `/`

**BOT-SIDE IMPLICATION:**
- New lead source tag format: `diagnostic-{pattern-slug}`. If any bot tool queries `initiates` by source, update the filter to match this format.
- `dominant_pattern` column now exists on `initiates` — the nurture sequence / email personalization can branch on A/B/C.
- NO bot tool changes required — everything shipped is landing-page side.

**Executed from:** Sentinel Bot cowork session, NOT MC cowork. Used Desktop Commander to reach Windows filesystem directly at `C:\Users\richi\Sovereign-Mission-Control\sovereign-landing\*`. New rule: `feedback_cross_folder_via_desktop_commander.md` in memory — never ask the Architect to switch cowork sessions when the target is outside the current mount.

### 2026-04-13 — MC Session: Content Intel 3-Panel Upgrade + fetch-landing-analytics Edge Function

**What shipped on MC side:**
- Content Intel page (`/content`) refactored into 3-tab command surface: PERFORMANCE | CTA AUDIT | LANDING
- New API route `src/app/api/cta-proposals/route.ts` — PATCH endpoint for approve/reject/skip on `cta_audit_proposals` rows
- New Edge Function `fetch-landing-analytics` (v1) deployed to Supabase — pulls Vercel Web Analytics daily into `landing_analytics` table
- Supabase secrets set: `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`
- Git commit `f40ff89` pushed to `main`, Vercel auto-deploying

**BOT-SIDE IMPLICATION:**
- MC dashboard now reads `cta_audit_proposals` and renders a review UI. Status flow the bot must honor: `pending_review` → Architect clicks Approve → status becomes `approved`, `reviewed_at` set. **Bot must poll for `status = 'approved'` rows, execute `youtube_update_metadata` + `youtube_pin_comment`, then set `status = 'executed'` + `executed_at = now()`.**
- `fetch-landing-analytics` needs a daily cron trigger (recommended: 06:00 UTC POST to `https://wzthxohtgojenukmdubz.supabase.co/functions/v1/fetch-landing-analytics`). Wire this into the bot's scheduler or a Make.com scenario.
- Full handoff spec with table schemas is at `MISSION-CONTROL-HANDOFF_content-intel-upgrade.md` (already in this repo).

**What the bot does NOT need to do:**
- No changes to `youtube_analytics` table or `fetch-youtube-stats` Edge Function — those are untouched
- No changes to any existing bot tools — the 3 new youtube-cta-tools referenced in the handoff were already built bot-side

---

## 0. ARCHITECTURAL DIRECTIVES (Non-Negotiable)

These are hard rules that govern every session's work. Violations create the bugs history keeps archiving.

### 0.1 Prompt Economy
Agent system prompts MUST stay under 1000 tokens. Session 27 shipped an 85% reduction after bloated prompts caused silent Groq→Gemini failover. Session 35 applied the same discipline to dispatch-mode tool schemas. See `feedback_prompt_economy.md`.

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
- Make.com Scenarios A/B/C (funnel automation) are OFF-LIMITS to bot work. Only Scenario D (Sovereign Content Factory, webhook `2072042`) is in-bounds for content pipeline.
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

### Pinecone
- **Index:** `gravity-claw`
- **Host:** `gravity-claw-cpcpbz1.svc.aped-4627-b74a.pinecone.io`
- **Namespaces:** one per agent (`veritas`, `sapphire`, `alfred`, `yuki`, `anita`, `vector`) + `shared` for knowledge_nodes.
- **Note:** embeddings currently disabled — no embedding-capable key set. Pinecone reads still work against existing vectors (316 live).

### File System (Windows)
- **Working repo (canonical):** `C:\Users\richi\Sovereign-Sentinel-Bot`
- **Mission Control repo:** `C:\Users\richi\Sovereign-Mission-Control`
- **Landing repo:** `C:\Users\richi\sovereign-landing`
- **Legacy parts warehouse:** `C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects` (read-only reference)
- **Skills vault:** `SovereignSynthesisProjects\gravity-claw-skills-vault`

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

## 5. SIX MAVEN CREW AGENTS

Immutable roster. Do not add, remove, or rename. Each agent runs on its own Telegram bot token and owns a Pinecone namespace.

| # | Agent | Token Env Var | Role | Pinecone NS |
|---|-------|---------------|------|-------------|
| 1 | **Veritas** | `VERITAS_TOKEN` (also `TELEGRAM_BOT_TOKEN`) | Chief Brand Officer — weekly directive, strategic oversight, group lead (always responds) | `veritas` |
| 2 | **Sapphire** | `SAPPHIRE_TOKEN` | Chief Operating Officer — task decomposition, pipeline health, group copilot (plain-English summaries) | `sapphire` |
| 3 | **Alfred** | `ALFRED_TOKEN` | Head of Content Intelligence — trend scan (8 AM CDT), YouTube URL processing, VidRush feeder | `alfred` |
| 4 | **Yuki** | `YUKI_TOKEN` | Head of Distribution & Creative — SOLE Buffer posting authority, visual content, clip generation | `yuki` |
| 5 | **Anita** | `ANITA_TOKEN` | Head of Conversion & Nurture — email sequences, copy, must follow Email Brand Standard (Section 11) | `anita` |
| 6 | **Vector** | `VECTOR_TOKEN` | Head of Revenue Intelligence — 10 AM CDT metrics sweep, Stripe tracking, performance analysis | `vector` |

### Group Chat Roles
- **Lead** (Veritas): always responds in group chat. No gating.
- **Copilot** (Sapphire): plain-English summary when full pipeline completes.
- **Crew** (Alfred, Yuki, Anita, Vector): respond only when `@mentioned` or broadcast-triggered.

### Agent Autonomy Boundaries
- **Veritas/Sapphire** — coordinate, do NOT execute content or distribution directly.
- **Alfred** — discovers and analyzes, does NOT post to social or send emails.
- **Yuki** — creates and distributes visual/video content, does NOT handle email or strategic direction.
- **Anita** — creates copy, does NOT post to social (dispatches to Yuki), MUST follow Email Brand Standard.
- **Vector** — analyzes and reports, does NOT create content or post (distribution handled by Deterministic Content Engine).

---

## 6. CODEBASE ARCHITECTURE

### Tech Stack
- **Language:** TypeScript (strict mode)
- **Runtime:** Node 20
- **Deploy:** Railway via `Dockerfile.bot` (multi-stage)
- **Memory:** three-tier — SQLite (episodic) + Pinecone (semantic) + Supabase (structured)
- **LLM providers:** Anthropic (primary, all agent dispatches) → Groq (pipelines only) → OpenAI (Whisper + failover). Gemini is NUKED for text-gen (billing crisis, Session 35); `GEMINI_IMAGEN_KEY` isolated for Imagen 4 image gen only.

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
│   ├── faceless-factory.ts           — Faceless video pipeline (script→Imagen→TTS→ffmpeg Ken Burns)
│   ├── vidrush-orchestrator.ts       — VidRush: 1 URL → long-form → chop → distribute → Buffer week
│   ├── facebook-publisher.ts         — Direct FB Graph API v25.0 publisher, dual-page (ace + CF) (S97)
│   ├── backlog-drainer.ts            — R2 clip backlog → Buffer + FB direct, runs at boot (S90)
│   └── migration.sql                 — content_engine_queue DDL
├── voice/
│   └── tts.ts                        — TTS routing (edge→elevenlabs, FORCE_ELEVENLABS=true to flip)
├── prompts/
│   ├── personalities.json            — Layer 1 agent identity
│   ├── shared-context.ts             — Layer 2 shared mission + crew roster
│   └── social-optimization-prompt.ts — Audience Rotation Protocol (S47 D4)
└── tools/
    ├── social-scheduler.ts           — Buffer GraphQL posting (9 channels)
    ├── video-publisher.ts            — YouTube long-form + shorts publish + thumbnail set (S47 D3)
    ├── browser.ts                    — Puppeteer lazy-load (chromium deferred, see LIVE_STATE)
    └── ... (stripe_metrics, buffer_analytics, etc.)

scripts/
├── verify-state.ts                   — Generates LIVE_STATE.md from runtime code
└── seed-youtube-protocols.ts         — Seeds 6 rows into protocols table
```

### Pollers
- **Dispatch Poller** (15s interval) — claims `crew_dispatch` rows, dispatches to correct agent, handles LIGHT_TASKS stripping + protocol injection.
- **Task Approval Poller** — watches for approved proposed tasks, auto-executes.

### Scheduled Jobs (all `getUTCHours`-based)

| Job | Fires (UTC / CDT) | Purpose |
|---|---|---|
| Morning Briefing | 15:00 UTC / 10 AM CDT | Telegram to Architect |
| Alfred Trend Scan | 15:05 UTC / 10:05 AM CDT | Topic discovery, feeds VidRush |
| Vector Metrics Sweep | 17:00 UTC / 12 PM CDT | Stripe data, performance |
| ContentEngine Production | 18:30 UTC / 1:30 PM CDT | 12 posts generated deterministically |
| Distribution Sweep | every 5 min | Posts ready drafts to Buffer |
| Stasis Detection | 20:30 UTC / 3:30 PM CDT | 6 LIGHT MODE agent self-checks (S44) |
| Evening Recap | 01:00 UTC next day / 8 PM CDT | Telegram to Architect |
| Veritas Weekly Directive | Mon 17:10 UTC / 12:10 PM CDT | Strategic assessment |

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
| Instagram | Sovereign Synthesis | `ace_richie_77` | empoweredservices2013 | Yes |
| Instagram | Containment Field | `the_containment_field` | empoweredservices2013 | Yes |
| **TikTok** | Sovereign Synthesis | `acerichie77` | **7ace.rich1** (CROSSED) | Yes |
| **TikTok** | Containment Field | `the_containment_field` | **empoweredservices2013** (CROSSED) | Yes |
| X (Twitter) | Sovereign Synthesis | `AceRichie77` | 7ace.rich1 | Yes |
| X (Twitter) | Containment Field | `ContainmentFld` | empoweredservices2013 | Yes |
| Threads | Sovereign Synthesis | `ace_richie_77` | via IG login | Yes |
| Reddit | Sovereign Synthesis | `sovereign_synthesis` | 7ace.rich1 | No (manual) |

**Channel math (verified):** Sovereign Synthesis = 5 channels, Containment Field = 4 channels, **total = 9 Buffer channels**. LinkedIn/Pinterest/Reddit NOT in Buffer.

**CRITICAL — TikTok accounts are CROSSED** vs other platforms. Every other platform: `empoweredservices2013` = Sovereign Synthesis, `7ace.rich1` = Containment Field. TikTok ONLY: `7ace.rich1` = Sovereign Synthesis, `empoweredservices2013` = Containment Field.

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
| `GEMINI_IMAGEN_KEY` | Imagen 4 image gen ONLY — isolated from text-gen |
| `MAKE_SCENARIO_E_WEBHOOK` / `MAKE_SCENARIO_F_WEBHOOK` | Make.com content factory triggers |
| `WEBHOOKS_ENABLED` | Must be "true" for `/api/*` endpoints |
| `MCP_JSON_B64` | MCP server config (base64) |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (Adam Brooding). **Reloaded by Ace 2026-04-10.** See `project_edge_tts_primary.md`. |
| `FACEBOOK_PAGE_ACCESS_TOKEN` / `FACEBOOK_PAGE_ID` | Sovereign Synthesis FB page (ID `1064072003457963`). Graph API v25.0 direct publish. System user token, never-expire. |
| `FACEBOOK_CF_PAGE_ACCESS_TOKEN` / `FACEBOOK_CF_PAGE_ID` | The Containment Field FB page (ID `987809164425935`). Graph API v25.0 direct publish. System user token, never-expire. S97. |

### OPTIONAL — defaulted
`NODE_ENV=production` · `SQLITE_PATH=./gravity-claw.db` · `TZ` · `PORT` (Railway sets) · `LLM_DEFAULT_PROVIDER=anthropic` · `LLM_FAILOVER_ORDER=groq,gemini,anthropic,openai` · `FORCE_ELEVENLABS=false` (flip to `true` to force ElevenLabs) · `MCP_ENABLED=false` (OOM prevention) · `BROWSER_ENABLED=false`

### Timezone
`MORNING_BRIEFING_HOUR=15` (10 AM CDT) · `EVENING_RECAP_HOUR=1` (8 PM CDT). Code uses `getUTCHours()`. Ace is CDT (UTC-5).

### KILLED — do not set
`GEMINI_API_KEY` (billing crisis, S35) · `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ID` (Meta API abandoned) · `TIKTOK_ACCESS_TOKEN` (deferred until app approval) · `BUFFER_ACCESS_TOKEN` (v1 REST dead, use `BUFFER_API_KEY`)

### DEPRECATED aliases
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

The standalone Sapphire API service is DEPRECATED — the webhook bridge replaced it.

### 12.2 Supabase Edge Functions (separate plane from Railway)

Supabase hosts a second set of webhook handlers at `https://wzthxohtgojenukmdubz.supabase.co/functions/v1/<slug>`. Their env vars live in **Supabase Dashboard → Project Settings → Edge Functions → Secrets**, NOT in Railway. `execute_sql` cannot read them.

| Slug | Version | Role |
|---|---|---|
| `stripe-webhook` | v8 | Primary Stripe receiver. Handles `checkout.session.completed` only. Provisions in 6 steps (see below). |
| `send-purchase-email` | v1 | Resend-backed receipt email + `initiates` table patch. Accepts raw Stripe payload OR flat `{customer_email, amount_total}` from Make.com relay. |
| `send-nurture-email` | v3 | Anita's nurture template delivery. |
| `fireflies-webhook` | v4 | Meeting transcript ingestion. |

**`stripe-webhook` step order (critical for failure mode reasoning):**

1. Log to `revenue_log` (product_id=tier, metadata includes stripe ids)
2. Find-or-create user via `supabase.auth.admin`
3. Grant `member_access` row with `tier_slug`, `granted_by='stripe-webhook'`
4. Insert `audit_trail` row with `action='stripe_purchase'`
5. Fire-and-forget fetch → `MAKE_STRIPE_ROUTER_URL` (Make.com fan-out)
6. Fire-and-forget fetch → `BOT_WEBHOOK_URL` (Telegram bot fan-out)

**Fan-out is `.catch((e) => console.warn(...))`.** If steps 5 or 6 hit a dead URL, the buyer is still provisioned (steps 1–4) and the webhook returns 200. But the Make.com scenario at `MAKE_STRIPE_ROUTER_URL` is the relay that normally invokes `send-purchase-email` with a flat payload — so a dead Make.com URL means **no receipt email** even though tier access is granted. The two env vars are SEPARATE: `MAKE_STRIPE_ROUTER_URL` is NOT `BOT_WEBHOOK_URL`. Any doc that says "forwards to Make.com + Telegram via BOT_WEBHOOK_URL" is wrong — that was an earlier conflation bug.

**Relevant Edge Function env vars (live in Supabase, not Railway):**

| Var | Powers |
|---|---|
| `MAKE_STRIPE_ROUTER_URL` | Make.com fan-out from `stripe-webhook` step 5. Likely target: receipt email relay to `send-purchase-email`, HubSpot/Notion syncs, Slack ping. If this is one of the four dead hooks deleted during funnel cleanup, receipt email is silently broken. |
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

## 14. AGENT COORDINATION — EXECUTIVE ROLE MAP (Canonical)

The canonical roles for each agent. Supabase `personality_config` blueprints match this table (pushed Session 7A, 2026-04-02).

| Agent | Exec Role | Business Function | Revenue Accountability |
|---|---|---|---|
| Veritas | Chief Brand Officer | Weekly directive, brand integrity, strategic direction | Sets agenda that drives all downstream revenue |
| Sapphire | Chief Operating Officer | Task decomposition, pipeline health, coordination | Ensures work chains into revenue outcomes |
| Alfred | Head of Content Intelligence | Trend scanning, source material, YT pipeline feeder | Feeds raw material that becomes distributed content |
| Yuki | Head of Distribution & Creative | Buffer posting, Shorts, clip generation | SOLE posting authority — 329+ posts/week target |
| Anita | Head of Conversion & Nurture | Email sequences, conversion copy | Converts attention into purchases ($77–$12K ladder) |
| Vector | Head of Revenue Intelligence | Metrics sweep, Stripe, performance tracking | Kills what's not working, optimizes for $1.2M |

### Agent Tool Sets (summary — full contracts in `src/tools/`)

- **Veritas** — base tools, crew_dispatch, file_briefing, propose_task
- **Sapphire** — ProtocolWriter, RelationshipContext, FileBriefing, crew_dispatch, check_approved_tasks
- **Alfred** — ProtocolReader, SaveContentDraft, YouTube interceptor, web search, clip_generator (analysis), Make.com trigger
- **Yuki** — social_scheduler_create_post, video_publisher, clip_generator, image_generator, SaveContentDraft
- **Anita** — ProtocolReader, SaveContentDraft (+ NEEDED: read_nurture_template, update_nurture_template, email scheduling)
- **Vector** — StripeMetrics, FileBriefing, buffer_analytics, social_scheduler (analytics), video_publisher (analytics)

---

## 15. REFERENCE LINKS

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
| Live runtime state | [`LIVE_STATE.md`](./LIVE_STATE.md) |
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
3. **Update `LIVE_STATE.md`** if runtime routing changed (run `npm run verify-state`).
4. **Update memory files** in `spaces/.../memory/` for feedback, project state, user facts.
5. **Declare push status:**
   - **Push executed** (Claude Code): Desktop Commander cmd → `git push origin main`
   - **Push deferred** (Cowork): tell Ace to run `git push origin main` from terminal
   - **No push needed:** docs-only changes that don't affect Railway deploy

### Contradiction Prevention (Added 2026-04-02)

When changing the status of ANY system component, update every section that references it. The 2026-04-02 audit found 8 contradictions caused by partial updates.

| If you change... | Also update... |
|---|---|
| An env var status (Sec 10) | Any session entry in HISTORY.md referencing that var; LIVE_STATE.md |
| Infra IDs (Sec 3) | LIVE_STATE.md; Section 15 reference links |
| Agent role (Sec 5 or 14) | Supabase personality blueprints; memory `project_agent_role_reality.md` |
| Git/push protocol (Sec 4) | MC Master Ref Sec 3 + Sec 14 |
| Posting math / channel count (Sec 8) | MC Master Ref Sec 15 + Posting Guide header |

**Rule:** If a status appears in more than one section, `ctrl+F` before closing the session. Cheaper than a full continuity audit.

### Quick Context Recovery (new sessions)
1. `NORTH_STAR.md`
2. `LIVE_STATE.md`
3. This file
4. `MEMORY.md` index (`spaces/.../memory/`)
5. `HISTORY.md` — only when you need a specific past session

---

## Known Invariants That Bite (Do Not Forget)

- **Never push during pipeline runs** — Railway auto-deploy kills the container mid-run.
- **Dispatch mode strips memory** — agents in `crew_dispatch` do NOT load episodic memory/summaries (Session 35). Don't assume dispatch-mode agents can recall recent chats.
- **LIGHT_TASKS stripping** — `stasis_self_check` agents get zero tools and `iterCap=1` (Session 44). Don't add tool-requiring tasks to `LIGHT_TASKS`.
- **Pinecone embeddings disabled** — no embedding-capable key. Reads work, new writes fail gracefully with empty vectors.
- **Buffer YouTube drops the `tags` field** on publish — use the `Related topics:` smuggling line in description body instead (Session 47 D4).
- **Imagen 4 does NOT support negative prompts.** Never use "NO blue" phrasing; use positive constraints only ("EXCLUSIVELY warm amber").
- **TikTok accounts are CROSSED** relative to other platforms (see Section 8).
- **Faceless IS the thesis, not a defect.** Never propose Ace films/voices himself. Max compromise: static photo on thumbnail. See `feedback_never_ace_on_camera.md`.
- **Zero MRR against $1.2M target** — every build must answer "does this move one of NORTH_STAR's 5 input metrics in <7 days?" Revenue-first pushback is authorized.

---

*End of lean master reference. For session-by-session history — every fix, every DVP tag, every resolved blocker from Sessions 1–47 — see [`HISTORY.md`](./HISTORY.md).*
