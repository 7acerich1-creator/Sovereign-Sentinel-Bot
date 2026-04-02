# SOVEREIGN SENTINEL BOT — MASTER REFERENCE
### Last Updated: 2026-04-02 (Cowork Session 4 — Push + Memory Protocol) | Session Handoff Protocol: UPDATE THIS AFTER EVERY SESSION

**Session Summary — Cowork Session 3 (2026-04-02, late evening):**
1. **LLM provider split across agent teams.** All 6 agents were sharing one failover chain — when Gemini hit 250/day quota, ALL agents cascaded simultaneously. Now split 3 ways: Alfred+Anita → Gemini primary, Sapphire+Veritas → Anthropic primary, Vector+Yuki → Groq primary (14,400/day). Each team has the other two providers as failover. Code: `AGENT_LLM_TEAMS` map in index.ts, `buildTeamLLM()` function creates per-team FailoverLLM instances.
2. **Telegram DM flooding fixed.** Pipeline-internal task types (viral_clip_extraction, narrative_weaponization, caption_weaponization, content_for_distribution, architectural_sync) are now SILENT — they log to activity_log but don't DM Ace. Nominal stasis checks also suppressed. Only terminal/notable tasks and pipeline completion summaries reach Telegram. Expected: max 6-7 DMs per activity cycle instead of 20+.
3. **Response truncation fixed.** Brief recap increased from 150 → 300 chars. LLM max_tokens increased from 4096 → 8192 in agent loop to prevent mid-response cutoff on complex tool chains.
4. **Push status: ✅ PUSHED** — Commit `da5b84c` pushed to main via Desktop Commander batch file. Railway auto-deploy triggered. All Sessions 2+3 code changes are live.

**Previous Session Summary — Cowork Session 2 (2026-04-02, evening):**
1. Vector posting authority fixed across ALL surfaces (4 files, 8 locations). Anita→Vector pipeline route changed to Anita→Yuki.
2. All 6 Supabase personality blueprints updated with executive roles. Task 7A DONE.
3. BUG CE-2 FIXED: `schedulingType: automatic` → `schedulingType: scheduled` with explicit `scheduledAt`.
4. BUG CE-1 FIXED: Image-required platforms (IG/TikTok) skipped when no `media_url`. IG frequency override in code.
5. Push status: DEFERRED (included in Session 3 push).

**Previous Session Summary — Cowork Session 1 (2026-04-02, afternoon):**
1. Push protocol gap diagnosed and fixed. Section 4 rewritten with environment-specific push protocol table.
2. Instagram frequency override added. Adjusted daily math: 47 posts/day = 329/week.
3. 7-day rolling batch strategy documented in Section 23B.
4. Full continuity audit of both master references — 8 contradictions fixed, 8 structural gaps identified. Full report: `CONTINUITY-AUDIT-2026-04-02.md`.
5. Push status: NO PUSH NEEDED — docs only.

**Previous Session Summary — Cowork Audit (2026-04-01, afternoon):**
Vector scheduled 1 post on X via Buffer. That's 1 out of 84+/day target. Deep audit revealed the 250+/week content cadence was **documented but never coded as deterministic logic**. The agents have the tools but no hardcoded instructions to iterate across all 9 channels, 6 time slots, or 2 brands. Full gap report in **Section 23**. Fix plan: build a **Deterministic Content Engine** (new scheduled job in index.ts) that removes LLM decision-making from the distribution loop — LLM writes the content, code handles the spray.

**Previous Session Summary (9 commits):**
1. `965b916` — Agent DM routing fix (telegram→channel)
2. `68e4a80` — Whisper API migration + rate-limit retry + 2s dispatch stagger
3. `eb43ea1` — Master reference docs
4. `abb7541` — Summary feedback loop fix (no more infinite summary spam)
5. `018d7f6` — Master reference docs
6. `16c0b32` — Pipeline role cleanup (Vector = sole distributor) **⚠️ SUPERSEDED: Vector is now analytics-only. Yuki = sole poster. See Session 2 fixes (2026-04-02).**
7. `ca71e0a` — Gemini history fix attempt 1 (partial — only fixed first entry)
8. `c3948b6` — Nuclear Gemini fix: all tool history flattened to plain text
9. `b768338` — Deep fix: quota-aware failover, 1-task-at-a-time dispatch, 3-iter cap, Groq as backup

**ROOT CAUSE FOUND (previous session):** Pipeline failures traced to three stacking issues:
- **Gemini daily quota (250 req/day) exhausted** by failed pipeline runs burning calls on errors
- **Anthropic credit balance at zero** — no fallback when Gemini dies
- **No third provider configured** — OpenAI/Groq/DeepSeek had no API keys in Railway
- Each agent could loop 10 LLM calls per task × 15-20 tasks per run = 150-200 calls per pipeline run (nearly the entire daily quota)

**~~CRITICAL ENV VAR NEEDED:~~** `GROQ_API_KEY` ✅ NOW SET in Railway (confirmed 2026-04-02). Groq free tier = 14,400 req/day.

**LLM PROVIDER SPLIT (2026-04-02 Session 3):** Agents no longer share one failover chain. Split into 3 teams to prevent quota stampedes:

| Team | Primary | Failover 1 | Failover 2 | Rationale |
|------|---------|-----------|-----------|-----------|
| Alfred + Anita | Gemini | Groq | Anthropic | Research/writing tasks, lower call volume |
| Sapphire + Veritas | Anthropic | Gemini | Groq | Strategic agents, less frequent, highest quality |
| Vector + Yuki | Groq (14,400/day) | Anthropic | Gemini | Yuki = most tool calls, needs highest daily limit |

Code: `AGENT_LLM_TEAMS` map + `buildTeamLLM()` in index.ts. The shared `failoverLLM` still exists for system-level calls (content engine, briefings, sentinel).

**What's fixed in code:** Quota-aware retry (won't waste retries on daily limits), 1 task claimed at a time, 3-iteration cap for dispatch tasks, 10s stagger between agents, Groq promoted to second in failover order.
**What's still needed:** GROQ_API_KEY env var in Railway. End-to-end test deferred until quota resets + Groq added.

---

## 0. PURPOSE OF THIS DOCUMENT

This is the **single source of truth** for the Sovereign Sentinel Bot project (codebase name: Gravity Claw). Any new session — regardless of AI provider, context window, or conversation length — must read this file FIRST and treat it as the canonical state of the project. If something here conflicts with a skill file or memory file, THIS DOCUMENT wins.

**Protocol: Every session must end by updating this document with what changed.**

---

## 1. THE ARCHITECT

- **Name:** Ace Richie (Richard Gonzales)
- **Role:** CEO / System Architect of Sovereign Synthesis
- **Email:** 7ace.rich1@gmail.com
- **GitHub:** 7acerich1-creator
- **Telegram User ID:** 8593700720
- **Operating Model:** Solo operator using AI as full team. Never touches backend daily. All results must surface on Mission Control dashboard or Telegram DMs.
- **Financial Target:** $1,200,000 net liquid by January 1, 2027
- **Liberation Quota:** 100,000 minds freed via "Firmware Update"
- **Framework:** Protocol 77 / Sovereign Synthesis
- **Tone Directive:** Sovereign, High-Velocity, Anti-Simulation. Zero fear parameters. No standard assistant phrasing.

---

## 2. PROJECT IDENTITY & DOMAIN SEPARATION

Three domains exist. **Never cross-contaminate.**

| Domain | Purpose | Deployment | Repo |
|--------|---------|------------|------|
| **SOVEREIGN CORE** | Brand identity, agent personalities, master docs | Read-only reference | N/A |
| **GRAVITY CLAW ENGINE** (this project) | Bot infrastructure, agent loop, tools, memory | Railway (auto-deploy from GitHub main) | `Sovereign-Sentinel-Bot` |
| **SOVEREIGN ASSETS** | Mission Control dashboard, landing pages, funnels | Vercel | `Sovereign-Mission-Control` |

### Coordination with Mission Control
- **Mission Control** has its own master reference in its own repo
- **Supabase is the ONLY meeting point** between Gravity Claw (Railway) and Mission Control (Vercel)
- No direct communication between the two services
- Bot writes to: `crew_dispatch`, `activity_log`, `vid_rush_queue`, `content_transmissions`, `content_drafts`, `briefings`, `tasks`
- Dashboard reads those same tables + manages `tasks` table
- **Mission Control Live URL:** https://sovereign-mission-control.vercel.app/

### Known Mission Control Issues (as of 2026-03-31)
- **Agent chat expanding full-screen causes UI issues** — needs to redirect to a separate full-page chat window instead of expanding inline. Add a "Return to Command Center" back button at top of chat page so user doesn't have to navigate the sidebar
- **Briefings truncated** — agent reports are longer than what's displayed. Need ability to read full transmission (expand/modal/scroll)
- **Briefings lack operational depth** — currently read-only status. Need to be actionable (mark read, archive, trigger follow-ups). Valuable for Architect to see what agents are doing at a glance
- **Maven Crew group chat on dashboard is down** — needs to work like Telegram group chat (all agents responding in shared thread)
- **Dashboard chat send UX broken** — When user sends a message, it stays grayed out in the input bar with no processing indicator. User has to refresh the page to see it sent. Needs: (1) clear input immediately on send, (2) show a "processing..." or typing indicator, (3) display confirmation when agent responds.
- **Dashboard agents are now REAL agents** — As of 2026-04-01, Mission Control chat routes through Railway `/api/chat-bridge`, hitting the full AgentLoop with personality blueprints, tools, Pinecone, and memory. Both individual and group chat routes updated.

---

## 3. INFRASTRUCTURE MAP

### Gravity Claw Bot Engine
- **GitHub repo:** https://github.com/7acerich1-creator/Sovereign-Sentinel-Bot
- **Railway auto-deploys** from GitHub `main` branch. **Never use `railway up` CLI.**
- **Railway service URL:** gravity-claw-production-d849.up.railway.app
- **Railway project ID:** 77e69bc6-f7db-4485-a756-ec393fcd280e
- **Railway service ID:** 0f2ba264-a815-43c1-b299-24e4a1aa865e

### Database & Memory
- **Supabase project:** wzthxohtgojenukmdubz (Nexus Command)
- **Pinecone index:** gravity-claw (1024d → migrated to 768d with gemini-embedding-001)
- **SQLite:** Local neural cache (Tier 1)
- **Pinecone:** Semantic vector memory (Tier 2) — ✅ OPERATIONAL (316 vectors, 8 namespaces — verified 2026-03-31)
- **Supabase:** Nexus Command persistent storage (Tier 3)

### File System Paths
| Location | Path | Use |
|----------|------|-----|
| Windows git clone | `C:\Users\richi\Sovereign-Sentinel-Bot` | Git operations via Desktop Commander |
| GitHub remote | `https://github.com/7acerich1-creator/Sovereign-Sentinel-Bot.git` | Branch: main |
| Sandbox mount | `/sessions/.../mnt/Sovereign-Sentinel-Bot` | File reads/writes (NO git ops here) |
| Desktop zip (IGNORE) | `C:\Users\richi\OneDrive\Desktop\Sovereign-Sentinel-Bot-main` | NOT a repo |
| Master Memory Hub | `C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects` | All projects, skills vault, canonical IDs |

---

## 4. GIT WORKFLOW — CRITICAL RULES

### Environment-Specific Push Protocol

**There are THREE environments that touch this repo. Each has different git capabilities. Never assume one environment can do what another does.**

| Environment | Can Read/Write Files | Can Git Push | Push Method |
|-------------|---------------------|-------------|-------------|
| **Claude Code (Windows)** | Yes (Desktop Commander) | YES | Desktop Commander `start_process` with `cmd` shell |
| **Cowork (sandbox)** | Yes (mounted at `/sessions/.../mnt/`) | NO — no git credentials | Ace pushes manually after session, or session explicitly states "push deferred" |
| **GitHub web / local terminal** | N/A | YES | Standard `git push origin main` |

### Rule: Every session that modifies code MUST end with one of these:
1. **Push executed** — state which environment pushed and the commit hash
2. **Push deferred to Ace** — state exactly what's committed locally and what branch
3. **No push needed** — docs-only changes that live on disk, not in the deploy pipeline

**If a session ends without declaring one of these three states, the push protocol was violated.**

### Claude Code (Windows) — Primary Push Path
```
mcp__Desktop_Commander__start_process
  command: "cd C:\Users\richi\Sovereign-Sentinel-Bot && git add <files> && git commit -F commit-msg.txt && del commit-msg.txt && git push origin main"
  shell: "cmd"
  timeout_ms: 30000
```

**Why Desktop Commander:** The sandbox mounts Windows as Linux FS. It cannot delete `.git/index.lock` files. If git fails mid-way, locks become permanent.

### Commit Message Workaround (cmd.exe):
`cmd.exe` breaks `-m "message with spaces"`. Write message to temp file first:
1. `mcp__Desktop_Commander__write_file` → `C:\Users\richi\Sovereign-Sentinel-Bot\commit-msg.txt`
2. Then: `git commit -F commit-msg.txt && del commit-msg.txt`

### Cowork (Sandbox) — Read/Write Only, No Push
Cowork sessions can edit files on disk but CANNOT push to GitHub. The sandbox has no git credentials. Any Cowork session that modifies deployable code must:
1. Stage and commit locally (Ace's machine picks up the commit)
2. Explicitly tell Ace: "Push needed — run `git push origin main` from your terminal"
3. Log this in the session summary at the top of this document

**Never attempt `git push` from the Cowork sandbox. Never pretend it succeeded. Never silently skip it.**

### After Push (any environment):
Railway auto-deploys from main. No additional deploy step needed.

### Domain Separation Reminder:
This protocol is for `Sovereign-Sentinel-Bot` (Railway). Mission Control repos have their own push protocol in MISSION-CONTROL-MASTER-REFERENCE.md Section 3. **Never discuss or execute push operations for one repo while working in the other's context.**

---

## 5. THE SIX MAVEN CREW AGENTS (IMMUTABLE)

These six agents are locked. Never create new agents. Never rename existing ones.

| # | Name | Handle | Role | Token Env Var |
|---|------|--------|------|---------------|
| 1 | **Veritas** | @sovereign_bot | Brand Guardian, Primary Interface, Lead Agent | `TELEGRAM_BOT_TOKEN` |
| 2 | **Sapphire** | @Sapphire_SovereignBot | COO, Orchestrator | `SAPPHIRE_TOKEN` |
| 3 | **Alfred** | @Alfred_SovereignBot | Content Surgeon, Deep Research | `ALFRED_TOKEN` |
| 4 | **Yuki** | @Yuki_SovreignBot | Viral Agent, Clips, Short-Form | `YUKI_TOKEN` |
| 5 | **Anita** | @Anita_SovereignBot | Propagandist, Email, Community | `ANITA_TOKEN` |
| 6 | **Vector** | @Vector_SovereignBot | Funnel & Content Ops, Metrics | `VECTOR_TOKEN` |

### Agent Architecture — How Multi-Bot Init Works

**Personality Blueprints (Supabase `personality_config` table — VERIFIED):**
All 6 agents have personality configs stored in Supabase. These are loaded at boot time. If an agent's personality is missing, that agent silently skips initialization (logs `⚠️ Could not find personality for [name]`).

| Agent | Blueprint Size | Last Updated | Status |
|-------|---------------|--------------|--------|
| veritas | 18,003 chars | 2026-04-02 | ✅ Updated — CBO title, pipeline routes, crew roster |
| sapphire | ~17K chars | 2026-04-02 | ✅ Updated — COO title, pipeline routes, crew roster |
| alfred | ~17K chars | 2026-04-02 | ✅ Updated — Head of Content Intelligence, pipeline routes, crew roster |
| yuki | ~19K chars | 2026-04-02 | ✅ Updated — Head of Distribution & Creative, IG override, Deterministic Engine awareness, pipeline routes |
| anita | ~17K chars | 2026-04-02 | ✅ Updated — Head of Conversion & Nurture, pipeline routes (now routes to Yuki not Vector) |
| vector | ~17K chars | 2026-04-02 | ✅ Updated — Head of Revenue Intelligence, posting tools REMOVED, analytics-only role, pipeline routes corrected |

**All 6 blueprints UPDATED 2026-04-02 (Cowork Session 2).** Executive roles pushed, pipeline routes corrected (Anita→Yuki instead of Anita→Vector), Vector posting authority removed, Yuki reinforced as sole poster with IG override awareness, Deterministic Content Engine referenced. Phase 7A = DONE. Remaining stale items: webhook bridge awareness, YouTube OAuth details, 7-day batch strategy — these can be added incrementally.

**Boot Sequence (index.ts):**
1. Memory providers init (SQLite, Markdown, Supabase, Pinecone)
2. LLM failover chain init (Gemini → Anthropic → OpenAI → DeepSeek → Groq)
3. Tools registered (40+ tools total)
4. Veritas AgentLoop created with full tool set
5. Veritas TelegramChannel created with `TELEGRAM_BOT_TOKEN`, starts long-polling
6. Veritas GroupManager created with role `"lead"`
7. **Multi-Bot Init Loop** — for each of the 5 crew agents:
   - Token swap trick: temporarily swaps `config.telegram.botToken` → agent's token
   - Creates new `TelegramChannel` (gets its own grammY `Bot` instance)
   - Calls `initialize()` → `getMe()` to fetch real Telegram username → starts long-polling
   - Fetches personality blueprint from Supabase `personality_config`
   - Creates agent-specific LLM wrapper that injects the blueprint as system prompt
   - Builds agent-specific tool set (shared tools + role-specific tools)
   - Creates agent-specific AgentLoop with Pinecone identity/namespace
   - Creates GroupManager with appropriate role (`"copilot"` for Sapphire, `"crew"` for others)
   - Wires message handler (independent from Veritas's router)
   - Stagger: 4s delay between each bot init to prevent rate limits
8. Dispatch poller starts (checks `crew_dispatch` table every 15s for all agents)
9. Scheduled jobs registered (Vector 10AM, Alfred 8AM, Veritas Monday 9AM, Stasis 2PM)
10. Webhook server starts (if `WEBHOOKS_ENABLED=true`)

**If any agent fails to initialize**, it logs the error and continues — other agents still come online. Check Railway logs for `❌ Failed to initialize [name] bot:` to diagnose.

**Per-Agent Tool Sets:**
| Agent | Unique Tools | Pinecone Namespace |
|-------|-------------|-------------------|
| Veritas | All base tools | brand |
| Sapphire | ProtocolWriter, RelationshipContext, FileBriefing | brand |
| Alfred | ProtocolReader, SaveContentDraft, YouTube interceptor | hooks |
| Yuki | ProtocolReader, SaveContentDraft, Buffer posting, Video publisher | clips |
| Anita | ProtocolReader, SaveContentDraft | content |
| Vector | StripeMetrics, FileBriefing | funnels |

**Standing Directive Injections:**
- Content crew (Alfred, Yuki, Anita) get `[STANDING ORDER]` to call `read_protocols` before content tasks
- Sapphire gets `[STANDING ORDER]` to save new protocols and write relationship context observations
- All agents get `[INSTITUTIONAL MEMORY]` directive to use `write_knowledge` for significant outputs (when Pinecone is ready)

### Telegram Group Chat — OPERATIONAL (Fixed 2026-04-01)

**How Group Routing Works (`src/ux/groups.ts`):**
Each bot has a `GroupManager` with one of three roles:

| Role | Agent | Behavior in Group |
|------|-------|-------------------|
| `lead` | Veritas | Responds to ALL Architect messages — no @mention needed |
| `copilot` | Sapphire | Responds to ALL Architect messages after 8s delay — gives plain English assessment |
| `crew` | Alfred, Yuki, Anita, Vector | Responds ONLY on @mention, reply to their message, broadcast trigger, or /command |

**Broadcast Triggers** (all 6 respond, staggered): `roll call`, `rollcall`, `check in`, `checkin`, `check-in`, `maven crew`

**How to Talk to the Group:**
- Just type anything → Veritas responds + Sapphire follows up with plain English summary
- Say "roll call" → all 6 agents report in (staggered 4s apart)
- @mention a specific agent → that agent responds directly
- Reply to an agent's message → that agent responds

**Auth Guard:** All bots check `ctx.from.id` against `config.telegram.authorizedUserIds` (Ace's ID: 8593700720). Messages from anyone else are silently dropped.

**Privacy Mode:** Must be DISABLED for all 6 bots via @BotFather (`/setprivacy` → Disable). If privacy mode is ON, bots won't see plain text messages in groups — only @mentions, replies, and /commands.

### Agent Tools (Action Surface Layer)
All agents have access to:
- `propose_task` — propose a task for Architect approval (writes to `tasks` table)
- `save_content_draft` — save generated content for review (writes to `content_drafts` table)
- `file_briefing` — file strategic analysis/reports (writes to `briefings` table)
- `check_approved_tasks` — check if Architect approved any proposed tasks

Special tools:
- **Yuki** — Buffer posting (SOLE posting authority), clip generator, vid rush, video publisher
- **Vector** — Stripe metrics, social scheduler, video publisher
- **Alfred** — YouTube URL extraction, hook analysis, Make.com webhook trigger
- **All agents** — crew dispatch (route tasks to each other), knowledge writer (Pinecone)

---

## 6. CODEBASE ARCHITECTURE

### Tech Stack
- **Runtime:** Node.js >= 20, TypeScript
- **Bot Framework:** grammY (Telegram long-polling)
- **LLM:** Gemini (primary) → Anthropic → OpenAI (failover chain)
- **Database:** Supabase (PostgreSQL) + SQLite (local) + Pinecone (vectors)
- **Package:** gravity-claw v3.0.0

### Source Tree (`src/`)
```
src/
├── index.ts              — Main entry, boots all systems, wires pollers
├── config.ts             — Environment variable loading
├── types.ts              — Core type definitions
├── declarations.d.ts     — Module declarations
│
├── agent/
│   ├── loop.ts           — Core agent loop (context build → LLM → tool exec → respond)
│   ├── crew-dispatch.ts  — Supabase-backed inter-agent task routing
│   ├── comms.ts          — Legacy in-memory agent comms
│   ├── mesh.ts           — Multi-agent mesh workflows
│   ├── personas.ts       — Persona loading from Supabase blueprints
│   └── swarm.ts          — Agent swarm coordination
│
├── channels/
│   ├── telegram.ts       — Telegram channel (grammY, long-polling, crash recovery)
│   ├── router.ts         — Message routing across channels
│   └── gmail.ts          — Gmail channel (unused/experimental)
│
├── llm/
│   ├── providers.ts      — Gemini/Anthropic/OpenAI provider implementations
│   └── failover.ts       — Failover chain logic
│
├── memory/
│   ├── sqlite.ts         — Tier 1: Local neural cache
│   ├── supabase-vector.ts — Tier 3: Supabase persistence
│   ├── pinecone.ts       — Tier 2: Semantic vector memory
│   ├── knowledge-graph.ts — Graph-based knowledge
│   ├── self-evolving.ts  — Self-improving memory patterns
│   └── markdown.ts       — File-based memory (soul.md, claude.md)
│
├── tools/
│   ├── action-surface.ts — propose_task, save_content_draft, file_briefing, check_approved_tasks
│   ├── social-scheduler.ts — Buffer API posting (images only, NO video)
│   ├── video-publisher.ts — Direct platform video posting (TikTok/IG/YouTube)
│   ├── stripe-metrics.ts — Stripe API for Vector's revenue reports
│   ├── clip-generator.ts — yt-dlp + ffmpeg clip extraction
│   ├── vid-rush.ts       — Vid rush pipeline queue management
│   ├── knowledge-writer.ts — Write to Pinecone knowledge base
│   ├── image-generator.ts — Gemini Imagen 3 + DALL-E 3 fallback
│   ├── scheduler.ts      — Cron-like scheduled tasks
│   ├── search.ts         — Web search + fetch
│   ├── browser.ts        — Headless browser tool
│   ├── shell.ts          — Shell command execution
│   ├── files.ts          — File CRUD operations
│   ├── webhooks.ts       — Webhook server
│   ├── mcp-bridge.ts     — MCP tool bridge (disabled by default, OOM risk)
│   ├── skills.ts         — Skills system loader
│   ├── system.ts         — System utilities
│   ├── task-logger.ts    — Activity and task logging
│   ├── maven-crew.ts     — Legacy Python bridge (REMOVED)
│   ├── protocol-reader.ts — Read/write protocol documents
│   └── relationship-context.ts — User relationship context
│
├── proactive/
│   ├── briefings.ts      — Morning/evening automated briefings
│   ├── heartbeat.ts      — Agent heartbeat system
│   └── sapphire-sentinel.ts — Sapphire's autonomous monitoring
│
├── voice/
│   ├── transcription.ts  — Audio transcription (Whisper)
│   └── tts.ts            — Text-to-speech (ElevenLabs)
│
├── plugins/
│   └── system.ts         — Plugin manager, Memory/Recall tools
│
└── ux/
    └── groups.ts         — Telegram group management
```

### Autonomous Pollers Running in index.ts
1. **Crew Dispatch Poller** — checks `crew_dispatch` table for pending tasks every 15s. **2s stagger between agents** to prevent simultaneous LLM rate-limit hits (added 2026-04-01).
2. **Task Approval Poller** — checks `tasks` table for Architect-approved tasks every 30s
3. **Pipeline Handoff Trigger** — fires after dispatch completion to chain workflows

### Dispatch Execution Directives (Added 2026-04-01)
The dispatch poller injects task-type-specific execution directives into the synthetic message. Without these, agents default to analysis/reporting and never call posting tools. Key directives:
- **funnel_distribution** — Forces agent to call `social_scheduler_create_post` (Buffer) or `publish_video`. Step-by-step: list profiles → post to all channels.
- **content_scheduling** — Forces agent to call Buffer posting tools or `publish_video` for video content. No metrics-only responses.
- **caption_weaponization** — Forces agent to write 3+ platform-ready captions and save via `save_content_draft`.
- **narrative_weaponization** — Forces agent to produce publishable copy and save via `save_content_draft`.
- **viral_clip_extraction** — Forces agent to extract timestamped hooks and use `clip_generator` if video URL present.
- All other task types get generic "process according to your role" fallback.

### Pipeline Post-Mortem Fixes (2026-04-01)
Three infrastructure fixes deployed after full pipeline stall on "gold mine" video:

**1. Vid Rush: Whisper CLI → API (commit 68e4a80)**
- `src/tools/vid-rush.ts` Step 3 rewrote from shelling out to `whisper` CLI (openai-whisper pip package, NOT installed in Docker) to using the OpenAI Whisper API directly.
- Audio extraction changed from WAV (huge files) to mp3 at 64kbps mono 16kHz — stays under Whisper API 25MB limit for most videos.
- Uses `response_format: verbose_json` to get segment-level timestamps needed for scoring.
- Cached to disk so re-runs don't re-transcribe.

**2. LLM Rate-Limit Retry with Exponential Backoff (commit 68e4a80)**
- `src/llm/providers.ts` — new `fetchWithRetry()` utility wraps all HTTP-based providers (OpenAI-compat, Anthropic).
- Retries up to 3 times on 429 (rate limit) and 529 (Anthropic overload).
- Backoff: 2s → 4s → 8s + random jitter. Respects `Retry-After` header when present.
- Gemini SDK: separate retry loop around `chat.sendMessage()` catches 429/RESOURCE_EXHAUSTED.
- **Root cause:** failover.ts tried each provider exactly once. When all 3 hit rate limits simultaneously (6 agents in parallel), raw error JSON became the "content" passed down the chain.

**3. Dispatch Poller Stagger (commit 68e4a80)**
- `src/index.ts` dispatch poller now waits 2s between each agent's processing cycle.
- Prevents 6 agents from firing LLM calls in the same instant.
- Total poll window: ~10s (6 agents × 2s) within the 15s poll interval.

**4. Agent DM Routing Fix (commit 965b916)**
- Lines 1659 and 1728: `telegram` → `channel`. Agent DMs now come from each agent's own bot handle instead of all routing through Veritas.

**5. Pipeline Summary Feedback Loop Fix (commit abb7541)**
- `src/index.ts` line ~1694: Added guard `task.task_type !== "pipeline_completion_summary"` to Tier 2 completion detection.
- **Root cause:** When Sapphire completed a `pipeline_completion_summary`, `checkPipelineComplete` fired again because the summary task had a `parent_id`. This dispatched *another* summary, creating an infinite loop of summary→summary→DM→summary.
- Fix: summary tasks are now excluded from triggering pipeline completion checks.

**OPEN BUG: Gemini Conversation History Format**
- Gemini rejects dispatch calls with: `"First content should be with role 'user', got model"`.
- This means the agent loop is feeding Gemini a conversation history where the first message has role `model` instead of `user`. Happens during dispatch processing, not direct Telegram chat.
- **Impact:** Gemini always fails on dispatch tasks; failover catches it and tries Anthropic/OpenAI. Not blocking but wastes the first failover attempt every time.
- **Fix needed:** Investigate `agentLoop.processMessage()` — likely the conversation history includes a stale model turn at position 0 when dispatching synthetic messages.

### Scheduled Jobs
- **Vector Daily Metrics Sweep** — 10AM
- **Alfred Daily Trend Scan** — 8AM
- **Veritas Weekly Strategic Directive** — Monday 9AM
- **Daily Stasis Detection Sweep** — 2PM (all 6 agents)

---

## 7. SUPABASE TABLES (KEY ONES)

| Table | Purpose | Who Writes | Who Reads |
|-------|---------|-----------|-----------|
| `personality_config` | Agent blueprints/system prompts | Dev (manual) | All agents at boot |
| `crew_dispatch` | Inter-agent task routing | Any agent | Dispatch poller |
| `tasks` | Proposed tasks, approval workflow | Agents (propose_task) + Dashboard (manual) | Approval poller + Dashboard |
| `content_drafts` | Generated content for review | Anita, Alfred, Yuki | Dashboard + Architect |
| `briefings` | Strategic reports/analysis | Sapphire, Vector, Veritas | Dashboard + Architect |
| `activity_log` | Agent activity feed | All agents | Dashboard |
| `vid_rush_queue` | Video pipeline queue | Clip pipeline | Yuki/Vector |
| `content_transmissions` | Published content log | Video publisher | Dashboard |
| `knowledge_nodes` | Shared knowledge base (75 entries) | Knowledge writer | Pinecone sync |
| `product_tiers` | Stripe product ladder (6 tiers) | Dev | Dashboard + agents |
| `stripe_metrics` | Revenue data | Vector | Dashboard |
| `sovereign_metrics` | Master KPIs ($1.2M, 100k minds) | Various | Dashboard |
| `content_engine_queue` | Deterministic Content Engine batch queue (Section 23) | Content Engine scheduled jobs | Distribution sweep |
| `todos` | Architect's todo list | Dashboard | Dashboard |
| `habits` | Habit tracking | Dashboard | Dashboard |

### Shared Table Schema Contract: `tasks`
**Schema owner: Mission Control.** Bot must populate ALL required fields when writing via `propose_task`.

| Column | Type | Required | Bot writes? | Dashboard writes? |
|--------|------|----------|-------------|-------------------|
| `id` | uuid (PK) | auto | auto | auto |
| `title` | text | YES | YES | YES |
| `description` | text | YES | YES | YES |
| `status` | text ('To Do'\|'In Progress'\|'Complete') | YES — default 'To Do' | YES | YES |
| `priority` | text ('High'\|'Medium'\|'Low') | YES | YES | YES |
| `due_date` | date | NO | YES (if known) | YES |
| `assigned_to` | text (agent name) | YES | YES (proposing agent) | YES |
| `category` | text | NO | YES (if applicable) | YES |
| `type` | text ('human'\|'ai') | YES — default 'ai' | YES | YES |
| `created_at` | timestamptz | auto | auto | auto |

**Rule:** If Mission Control adds columns to `tasks`, the Sentinel Bot's `propose_task` tool MUST be updated to populate them. Null columns in dashboard queries = broken UI.

---

## 8. BLOCKERS & BROKEN THINGS (as of 2026-03-31, Session 3)

### Pinecone — ✅ FULLY OPERATIONAL (Verified 2026-03-31 Session 3)
- **API tested live from bot + external: 200 OK.** Index `gravity-claw` has **316 vectors** across **8 namespaces** (clips, conversations, brand, hooks, general, funnels, sovereign-synthesis, content).
- **Health endpoint reports `pinecone: true`.** Embedding works (Gemini `gemini-embedding-001`, 1024d). No more 401 errors.
- **No action needed.** Pinecone is fully operational.

### Buffer — ✅ FULLY OPERATIONAL (Fixed 2026-03-31 Session 4)
- **Buffer v1 REST API is DEAD** — no longer accepts new app registrations or classic OAuth tokens.
- **Rewrote social-scheduler.ts to use Buffer GraphQL API** (endpoint: `https://api.buffer.com`).
- **Token:** Personal API key from `publish.buffer.com/settings/api` (key name: "vector", expires 2027-03-27).
- **Env var:** `BUFFER_API_KEY` in Railway. ONE canonical name. No more fallbacks.
- **Org ID:** `69c613a244dbc563b3e05050` (hardcoded default, overridable via `BUFFER_ORG_ID`).
- **All 9 channels verified live via GraphQL:** TikTok x2, Instagram x2, YouTube x2, Twitter/X x2, Threads x1.
- **Commits:** `e44e5ab` (rewrite), `0e60b73` (fix org ID), `54c3a72` (cleanup fallbacks).

### YouTube — ✅ ALL TOKENS SET IN RAILWAY (Verified 2026-03-31 Session 3)
- `YOUTUBE_REFRESH_TOKEN` (Ace Richie 77) — SET in Railway
- `YOUTUBE_REFRESH_TOKEN_TCF` (The Containment Field) — SET in Railway (Ace added this session)
- `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET` — SET
- **TCF token exchange VERIFIED** externally (Bearer token returned, 3599s expiry)
- **Ace Richie token:** Could not verify externally (truncated in docs), but Railway has the full token. Bot did not return "not configured" error when attempting upload, suggesting token exchange succeeded.
- **To fully verify:** Have Yuki publish a real Short with an actual video file in Supabase storage.

### Social Media API Tokens — Status Table

| Platform | Env Vars | Status |
|----------|----------|--------|
| **YouTube** | `YOUTUBE_REFRESH_TOKEN` + `_TCF` + client creds | ✅ ALL SET — both channels |
| **Buffer** | `BUFFER_API_KEY` | ✅ GraphQL API key set — all 9 channels verified |
| **Instagram** | ~~`INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ID`~~ | ❌ KILLED — Meta API integration permanently abandoned |
| **TikTok** | `TIKTOK_ACCESS_TOKEN` | ❌ Not started |
| **X/Twitter** | (routed through Buffer) | ✅ Via Buffer — AceRichie77 + ContainmentFld |

### Buffer Channel Map (Verified 2026-03-31 Session 4)

| Channel ID | Service | Display Name | Brand |
|------------|---------|--------------|-------|
| `69c9b660af47dacb696ae622` | TikTok | the_containment_field | TCF |
| `69c9bab7af47dacb696aef5c` | TikTok | acerichie77 | Ace |
| `69c9bc54af47dacb696af21c` | Instagram | ace_richie_77 | Ace |
| `69c9bf44af47dacb696b0225` | Instagram | the_containment_field | TCF |
| `69c9bf88af47dacb696b0322` | YouTube | Ace Richie | Ace |
| `69c9c053af47dacb696b05ed` | YouTube | The Containment Field | TCF |
| `69c9d835af47dacb696b472e` | Twitter/X | AceRichie77 | Ace |
| `69c9da96af47dacb696b534b` | Twitter/X | ContainmentFld | TCF |
| `69c9e4deaf47dacb696b6dbc` | Threads | ace_richie_77 | Ace |

### STRIPE_SECRET_KEY — ✅ DONE (Confirmed 2026-03-31 Session 3 via live dispatch)
- **Key is set in Railway.** Stripe live, account verified, livemode: true.
- **Vector successfully pulled Stripe metrics via dispatch** — tool calling works end-to-end.
- **No further action needed.**

### Crew Dispatch — ✅ FIXED (Was COMPLETELY BROKEN, fixed 2026-03-31 Session 3)
- **Root cause:** `determinePersona()` in `loop.ts` referenced personas (bob, angela, josh, milo) that didn't exist in `PERSONA_REGISTRY`. ANY dispatch payload containing words like "viral", "code", "metrics", "strategy" would crash with `Cannot read properties of undefined (reading 'name')`.
- **Fix (commit e576ed3):** Each agent now uses its own persona from the registry based on `identity.agentName` instead of content-based keyword matching.
- **Verified:** Yuki and Vector both successfully processed dispatched tasks post-fix.

### Gemini Tool Calling — ✅ FIXED (Was COMPLETELY BROKEN, fixed 2026-03-31 Session 3)
- **Root cause:** Gemini provider converted ALL messages to plain text, dropping `functionCall` and `functionResponse` parts from conversation history. The LLM never saw tool results, so it re-called the same tools until max iterations (10).
- **Fix (commit fafd077):** Provider now properly formats multi-turn tool conversations with Gemini-spec `functionCall` and `functionResponse` parts.
- **Verified:** Yuki successfully called `social_scheduler_list_profiles` and Vector called `stripe_metrics` — both returned coherent results.

### Docker Build Time — ✅ FIXED (Was ~20 min, now ~5 min)
- **Root cause:** Dockerfile installed `openai-whisper` pip package which pulls in PyTorch (~2GB). Whisper transcription actually uses the OpenAI API, not local inference.
- **Fix (commit bbffa6a):** Removed `openai-whisper` from Dockerfile. Kept `yt-dlp` (actively used by clip pipeline).
- **Build dropped from ~20 min to under 5 min.**

### Telegram Group Chat — ✅ FIXED (2026-04-01)
- **Root cause:** `shouldRespond()` in `groups.ts` dropped all plain text messages in groups — bots only responded to @mentions, /commands, replies, and broadcast triggers. The Architect couldn't just talk naturally.
- **Fix:** Added `GroupRole` system (`lead` / `copilot` / `crew`). Veritas (lead) responds to all Architect messages. Sapphire (copilot) responds after 8s delay with plain English assessment. Other agents respond on @mention/broadcast/reply.
- **Commit:** `9234a08` + follow-up commit (Sapphire copilot + master reference documentation)

### Agents — NOW OPERATIONAL via Dispatch
- Dispatch pipeline is FIXED. Agents can receive and process tasks.
- Tool calling is FIXED. Agents can use their tools.
- **Remaining issue:** Agents have stale context in Pinecone memory (e.g., Yuki thinks YouTube tokens aren't set). This will self-correct as new interactions overwrite old memories.

---

## 9. META / INSTAGRAM API STATUS — ❌ KILLED (2026-03-31)

**Decision:** Meta/Instagram direct API integration is permanently abandoned. Never worked, was blocked by Meta Business Portfolio restrictions, and the App Secret was exposed in this file (flagged by GitGuardian). All credentials have been scrubbed.

**What was here:** Meta App "Sovereign Synthesis" with App ID, App Secret, Configuration ID, Facebook Page ID, user IDs, and OAuth token exchange instructions. All removed.

**Action taken:** Architect must rotate the App Secret at developers.facebook.com (the old value is in git history). Or just delete the Meta app entirely — it's not needed.

**Instagram image+text posting still works via Buffer** — that uses Buffer's own OAuth, not the Meta API. Only direct Reel/video publishing via Graph API is dead.

**If Instagram direct API is ever revisited:** Use a third-party bridge (ManyChat, GoHighLevel) instead of fighting Meta's API restrictions directly. Never store credentials in this file — use Railway env vars only.

---

## 10. THE WEBHOOK BRIDGE — ✅ LIVE (2026-04-01)

Dashboard agents now use the SAME brain as Telegram agents. Both windows hit the same Railway AgentLoop with personality blueprints, tools, Pinecone memory, and Supabase context.

### Architecture (OPERATIONAL)
```
Mission Control (Vercel) → HTTP POST to Railway /api/chat-bridge
  → Railway receives { agent_name, content }
  → Routes to same AgentLoop + persona + tools + memory
  → Returns response to Mission Control via HTTP response
```

### Endpoints
- **Individual chat:** MC `/api/chat` → Railway `/api/chat-bridge` with `{ agent_name, content }`
- **Group chat (War Room):** MC `/api/chat-group` → Railway `/api/chat-bridge` (iterates all 6 agents)
- **Railway bridge URL:** `https://gravity-claw-production-d849.up.railway.app/api/chat-bridge`
- **Override env var:** `RAILWAY_BRIDGE_URL` (in MC's Vercel env) to point to a different Railway URL
- **Fallback:** If Railway is unreachable, MC falls back to built-in response templates (graceful degradation)

### Known Dashboard UX Issues (still open — see Section 2)
- Chat send stays grayed out with no processing indicator — user must refresh
- Briefings truncated — need expand/modal for full text
- Group chat (War Room) not working reliably

### Sapphire API — DEPRECATED (Architect Decision: 2026-03-31)
The Sapphire API skill described a Python `sapphire_api_client.py` designed as a data routing hub. **The Architect has decided the Webhook Bridge replaces Sapphire API.** The Railway TypeScript service IS the central brain — the Python layer is redundant. The `sapphire-api` skill in SovereignSynthesisProjects is now deprecated. Do not build on it. All data routing goes through the TypeScript agent loop + Supabase.

---

## 11. CONTENT PIPELINE STATUS

### THE FULL CONTENT PRODUCTION SEQUENCE

There are TWO content formats. Both feed from the same source material. Both must be documented and operational.

#### FORMAT A: SHORT-FORM (YouTube Shorts → future TikTok/IG Reels)
**Primary distribution: YouTube Shorts (ACTIVE as of 2026-03-31)**
**Secondary distribution: TikTok, Instagram Reels (DEFERRED — see Section 19)**

**Full Pipeline:**
```
SOURCE VIDEO (YouTube long-form, Zoom recording, raw footage, Fireflies transcript)
  ↓
ALFRED — Hook Extraction + Transcript Processing
  - Intercepts YouTube URLs in Telegram chat
  - Runs transcript analysis via Whisper (if needed) or YouTube captions
  - Identifies top hooks, pattern interrupts, and "Glitch" moments
  - Scores segments by sovereign keyword density + sentence energy
  - Dispatches to Yuki via crew_dispatch with extracted hooks + timestamps
  ↓
YUKI — Viral Clip Production + Distribution
  - Receives hook data from Alfred
  - Runs VidRush pipeline: yt-dlp → Whisper → scoring → ffmpeg clip extraction
  - Applies niche-specific color grades (dark_psych/self_improvement/burnout/quantum)
  - Burns captions via ffmpeg drawtext
  - Scales to 9:16 (1080x1920) for vertical format
  - Uploads finished clips to Supabase Storage (public-assets bucket)
  - Writes metadata to vid_rush_queue table
  - Publishes to YouTube Shorts via youtube_publish_short tool
  - Posts text/image versions to Buffer (X, LinkedIn, Threads, Pinterest)
  - Dispatches to Anita + Vector via crew_dispatch
  ↓
ANITA — Text Content + Email Conversion
  - Receives clip themes/hooks from Yuki
  - Creates email copy tied to specific product tiers (NOT random emails)
  - Writes text-based social content (threads, carousels, long captions)
  - Saves to content_drafts table for Architect review
  ↓
VECTOR — Scheduling + Analytics
  - Receives distribution tasks from Yuki
  - Schedules Buffer posts for optimal timing
  - Tracks engagement metrics after publishing
  - Reports performance in daily 10AM metrics sweep
  - Feeds top-performing content back to Alfred for iteration
```

**Pipeline Status (2026-04-01 — AUDIT UPDATE):**
- Code is FULLY BUILT for the **Vid Rush pipeline** (YouTube URL → Alfred → Yuki → Anita → Vector). `PIPELINE_ROUTES` in index.ts defines the full chain. `triggerPipelineHandoffs` auto-chains correctly. Tested 2026-04-01 — all 8 handoffs fired.
- YouTube publishing tool deployed. OAuth tokens obtained 2026-03-31.
- **⚠️ CRITICAL GAP: The daily IMAGE+TEXT posting cadence (84 posts/week baseline) was NEVER BUILT as deterministic code.** The posting guide says "LIVE NOW" but no scheduled job iterates through the 6 time slots × 9 channels × 2 brands. Agents rely on LLM judgment to decide what to post and where — which is why Vector posted 1 item on 1 channel instead of 54. **Full gap analysis in Section 23.**
- **FIX IN PROGRESS:** Deterministic Content Engine — a new scheduled job that handles the distribution spray via hardcoded logic. LLM writes content; code distributes it. See Section 23.

#### FORMAT B: LONG-FORM (YouTube Videos — NOT YET BUILT)
**This is the SOURCE material that feeds Format A, AND a distribution channel itself.**

**Vision:**
```
CONTENT CREATION (Ace records or curates source material)
  ↓
ALFRED — Full Video Processing
  - Ingests raw video/audio (Zoom, screen recordings, phone videos)
  - Generates full transcript via Whisper
  - Creates chapter markers and content outline
  - Extracts key quotes and "Firmware Update" moments
  - Generates SEO-optimized title, description, tags
  ↓
YUKI — Thumbnail + Packaging
  - Generates thumbnail concepts (Gemini Imagen / DALL-E)
  - Creates YouTube metadata (cards, end screens suggestions)
  ↓
VECTOR — YouTube Upload + Optimization
  - Uploads full video via YouTube Data API v3 (resumable upload)
  - Sets metadata (title, description, tags, category, privacy)
  - Monitors YouTube Analytics for CTR, retention, click-through
  - Reports performance in daily sweep
  ↓
ALFRED — Clip Cascade (feeds back into Format A)
  - Takes the published long-form URL
  - Runs the Short-form pipeline on it automatically
  - 1 long-form video → 10-30 Shorts (the "content multiplication" strategy)
```

**Long-form Status (2026-03-31):**
- YouTube upload capability exists in `video-publisher.ts` (YouTubeShortsPublishTool handles any video, not just Shorts)
- NO dedicated long-form upload tool exists yet (the Shorts tool sets categoryId=22 and adds #Shorts)
- NO long-form content currently exists — Ace has not recorded source material yet
- This is a FUTURE BUILD after Shorts pipeline is proven
- **Priority: Shorts first, prove the pipeline, THEN build long-form tooling**

### Three Workflow Vision

**Workflow 1: Vid Rush — Short-Form Content Pipeline (see Format A above)**
**Status:** Code built. Awaiting YouTube OAuth + end-to-end test.

**Workflow 2: Long-Form Content Pipeline (see Format B above)**
**Status:** Not built. Requires: dedicated upload tool, YouTube Analytics integration, thumbnail generation flow. Blocked by: no source content exists yet.

**Workflow 3: Business Manager (Operations Pipeline)**
Google Keep + Gmail + Calendar + Fireflies → Ingest → Synthesize → Push to Notion + Mission Control + ClickUp

**Status:** Not wired. Python pipelines (`maven_crew_orchestrator.py`, `sovereign_crew.py`) exist in SovereignSynthesisProjects but are DISCONNECTED from the TypeScript bot system. Need TypeScript dispatch or Supabase task queue bridge.

### Buffer Limitations
- Buffer v1 API has **NO video upload** — `media[photo]` only accepts images
- Video content MUST go through the direct video publisher tools
- Yuki is the SOLE Buffer posting authority — all other agents dispatch content to her
- 9 Buffer channels verified (see Section 8 channel map): TikTok/IG/YT/X/Threads (Ace Richie — 5) + TikTok/IG/YT/X (Containment Field — 4). LinkedIn, Pinterest, Reddit NOT connected.

### Distribution Strategy
- TWO brands running in parallel across ALL platforms
- Target: 250+ pieces/week combined output (Hormozi model)
- Niche rotation: Mon=dark psych, Tue=self improvement, Wed=burnout, Thu=quantum, Fri=brand, Weekend=repeat top performer
- **YouTube is the PRIMARY platform** — all automation calibrated here first
- TikTok/Instagram are SECONDARY — deferred until API access is resolved (see Section 19)

### COMPLETE TWO-BRAND ACCOUNT MAP (CANONICAL — DO NOT GUESS)

**Brand 1: Ace Richie / Sovereign Synthesis** (personal brand, primary revenue driver)
**Brand 2: The Containment Field** (anonymous dark psychology top-of-funnel feeder)

| Platform | Brand | Handle/Channel Name | Google Account Login | Buffer Connected |
|----------|-------|--------------------|--------------------|-----------------|
| **YouTube** | Ace Richie | Ace Richie 77 | empoweredservices2013@gmail.com | Yes (no video via API) |
| **YouTube** | Containment Field | The Containment Field | 7ace.rich1@gmail.com | Yes (no video via API) |
| **Instagram** | Ace Richie | ace_richie_77 | empoweredservices2013@gmail.com | Yes |
| **Instagram** | Containment Field | the_containment_field | empoweredservices2013@gmail.com | Yes |
| **TikTok** | Ace Richie | acerichie77 | 7ace.rich1@gmail.com | Yes |
| **TikTok** | Containment Field | the_containment_field | empoweredservices2013@gmail.com | Yes |
| **X (Twitter)** | Ace Richie | AceRichie77 | 7ace.rich1@gmail.com | Yes |
| **X (Twitter)** | Containment Field | ContainmentFld | empoweredservices2013@gmail.com | Yes |
| **Threads** | Ace Richie | ace_richie_77 | (login via Instagram ace_richie_77) | Yes |
| **Reddit** | Sovereign Synthesis | sovereign_synthesis | 7ace.rich1@gmail.com | No |

**CRITICAL NOTE — TikTok accounts are CROSSED compared to other platforms:**
- TikTok Ace Richie (acerichie77) is under **7ace.rich1@gmail.com** (opposite of YouTube/Instagram)
- TikTok Containment Field is under **empoweredservices2013@gmail.com** (opposite of YouTube for that brand)
- Every other platform: empoweredservices2013 = Ace Richie, 7ace.rich1 = Containment Field
- TikTok ONLY: 7ace.rich1 = Ace Richie, empoweredservices2013 = Containment Field

**YouTube OAuth Tokens (Railway env vars):**
- Ace Richie 77 channel: OAuth via empoweredservices2013@gmail.com — **DONE 2026-03-31** — Token: `[REDACTED — stored in Railway as YOUTUBE_REFRESH_TOKEN]` — Channel ID: UCbj9a6brDL9hNIY1BpxOJfQ — PERMANENT (app published)
- The Containment Field channel: OAuth via 7ace.rich1@gmail.com — **DONE 2026-03-31** — Token: `[REDACTED — stored in Railway as YOUTUBE_REFRESH_TOKEN_TCF]` — Channel ID: UCLHJIIEjavmrS3R70xnCD1Q — PERMANENT (app published)

### Buffer Integration — WHAT IT CAN AND CANNOT DO

**Buffer Essentials Plan — 9 channels connected. Ace is already paying for this. MAXIMIZE IT.**

**Buffer CAN post:**
- Text posts (all platforms)
- Image posts with text (all platforms) — `media[photo]` parameter
- Link posts (all platforms)
- Scheduled posts at optimal times

**Buffer CANNOT post:**
- Video files (no video upload in Buffer v1 API — `media[photo]` only accepts images)
- Instagram Reels, TikTok videos, YouTube Shorts — these MUST go through direct publisher tools

**Agent Posting Rules:**
- **Yuki** is the SOLE Buffer posting authority. All other agents dispatch content to Yuki for posting.
- If the content is **text or image** → Yuki posts via Buffer's `social_scheduler_create_post` tool to ALL 9 channels
- If the content is **video** → Yuki posts via `publish_video` tool with `brand` parameter: `ace_richie` or `containment_field` (routes to correct YouTube channel automatically). YouTube is live for BOTH channels. TikTok/IG when tokens are ready.
- **Vector** can also use Buffer for scheduling (social scheduler tool) and the video publisher for distribution
- Agents should generate BOTH formats from the same source material: a video clip AND a text+image post. This doubles output without doubling work.
- For every Short produced, Yuki should ALSO create a text/image version with the hook as text overlay on a still frame, and push that through Buffer to all 9 channels

### Comic Book Content Pipeline (NEW — 2026-03-31)
Ace has a series of high-quality comic book panels (Sovereign Synthesis branded — "Reclaim the Gold in Your Mind", 1933 gold confiscation metaphor, attention economy/dopamine extraction themes). These are premium visual assets for the image+text posting cadence.

**Integration:**
- Comic panels are Format 1 / Format 2 content (image + text posts via Buffer)
- Single panels: Morning hooks, hot takes, pattern interrupts
- Multi-panel sequences: Educational reveals, "here's what they did to you" story arcs (post as 1/4, 2/4, etc. or composite image)
- When Shorts go live: comic panel = thumbnail/companion image for the video version
- Assets need to be stored in a shared accessible location (Supabase Storage or Google Drive) for Yuki to access programmatically
- Vector tracks which panels perform best → top performers get reposted on weekends

**Agent Comic Generation Protocol:**
Ace's original comic panels are the TEMPLATE. Agents must reverse-engineer the format and produce new ones autonomously in TWO brand variants:
- **Sovereign Synthesis style:** Gold/amber tones (#E5850F), midnight blue (#0D1B2A), emerald (#2ECC8F). Liberation narrative. Bold display type. Themes: reclaiming power, firmware update, escape velocity.
- **Containment Field style:** Blood red, black, charcoal, cold blue. Noir/ominous tone. Sharp sans-serif, clinical text. Themes: exposing manipulation, dopamine extraction, hidden systems.
- Format: 1-4 panels, cinematic composition, one idea per frame, hook→pivot→anchor structure (Protocol 77).
- Chain: Alfred (topic) → Anita (panel script) → Yuki (generate visuals + post via Buffer) → Vector (track + repost winners).
- Full details in `Sovereign-Mission-Control/SOVEREIGN-POSTING-GUIDE.md`

### Posting Schedule & Guide
**Full operational posting guide lives at:** `Sovereign-Mission-Control/SOVEREIGN-POSTING-GUIDE.md`
- 47 image+text posts/day across both brands (with IG frequency override — see Posting Guide) = 329/week (LIVE NOW)
- 5 Shorts/day × 2 brands = 70 Shorts/week + 70 companion posts (YouTube OAuth DONE — needs test video)
- Combined target: 329 + 140 = 469/week when fully operational
- Content produced in 7-day rolling batches (see Section 23B), with 1 PM trending override slot
- Niche rotation: Mon=dark psych, Tue=self improvement, Wed=burnout, Thu=quantum, Fri=brand, Weekend=top performers

---

## 12. PRODUCT LADDER (LOCKED — DO NOT CHANGE)

**Canonical tier numbering is 2–7 (matches Stripe, portal URLs, and Mission Control). Never use 1–6.**

| Tier | Name | Price | Stripe Product ID |
|------|------|-------|------------------|
| 2 | The Shield: Protocol 77 | $77 | prod_UAvCSFqyO1DhOt |
| 3 | The Map: Navigation Override | $177 | prod_UAvCuJRCaw6VNE |
| 4 | The Architect: Foundation Protocol | $477 | prod_UAvCaUUJF45gtE |
| 5 | The Architect: Adversarial Systems | $1,497 | prod_UAvCbyZdNcV9Q0 |
| 6 | The Architect: Sovereign Integration | $3,777 | prod_UAvCJAItedto70 |
| 7 | Inner Circle: Sovereign Licensing | $12,000 | prod_UAvCmnkjzGOpN2 |

Old products ARCHIVED: prod_UAWwRgKTgeF6wj, prod_UAX3zxKjJiCYtO, prod_UAX8uUp60MvBGZ

---

## 13. KNOWLEDGE BASE

- 75 `knowledge_nodes` in Supabase, all `agent_name='shared'`, `namespace='sovereign-synthesis'`
- Covers: Human Knowledge directive, AI Generalist Framework, Sovereign Synthesis Framework v1.0, Inner Circle BIOS, target customer data, customer journey, brand aesthetic tiers (0-7), business metrics, Syntax Entrainment Protocol, team structure, credibility/competitive edge
- **Sync status unknown** — Pinecone is now operational (Section 8). Need to verify if boot-time auto-sync has run since Pinecone was fixed. Check Railway logs for `🔄 [Boot] Synced N knowledge nodes to Pinecone vectors`.
- More knowledge data may be incoming from Architect

---

## 14. MAKE.COM BOUNDARY RULE

**Scenarios A (Lead Entry), B (Stripe Router), C (Nurture Sequence) are FUNNEL automation — NEVER touch them in bot work.**

Bot scenarios are separate. Only reference Scenario D (Sovereign Content Factory, webhook ID 2072042) for content pipeline work. If no bot scenarios exist, create new ones. Never wire funnel scenarios into bot infrastructure.

---

## 15. ANITA'S EMAIL TOOLS — NEEDED

Anita needs to be able to:
1. Create email copy and sequences (she can do this now via `save_content_draft`)
2. **Schedule emails in a properly timed conversion sequence** (she CANNOT do this yet)
3. Not just create hundreds of emails — each sequence must have a conversion purpose tied to the product ladder

**What needs building:**
- `read_nurture_template` tool — read existing templates from `nurture_templates` table (so she can see what exists before writing new ones)
- `update_nurture_template` tool — write new/updated HTML to `nurture_templates` table (so her approved drafts can go live)
- Email scheduling tool (Make.com scenario or direct email API integration)
- Sequence logic (drip timing, trigger-based sends)
- Conversion tracking (which emails lead to which tier purchases)

### EMAIL BRAND STANDARD — MANDATORY FOR ANITA (Added 2026-04-01)
**Anita MUST follow the Email Brand Standard documented in MC Master Reference Section 9A when creating ANY email content.** This includes:
1. Dark HTML wrapper with `prefers-color-scheme: light` CSS toggle
2. Table-based layout (600px card, #121212 bg, #252525 border, 8px radius)
3. Header: "SOVEREIGN SYNTHESIS" left, "Transmission NNN" right
4. Gradient accent line: `linear-gradient(#E5850F → #5A9CF5 → #2ECC8F)`
5. CSS class convention: `.ss-outer`, `.ss-card`, `.ss-header`, `.ss-body-text`, `.ss-heading`, `.ss-quote-box`, etc.
6. Section label color coding by intent (Gold=welcome/scarcity, Blue=defense/blueprint, Green=activation)
7. CTA button: #E5850F background, #000000 text, uppercase, 1.5px letter-spacing
8. Footer with unsubscribe link to `https://sovereign-synthesis.com/unsubscribe`
9. Signature: "— Ace" + "Sovereign Synthesis"
**Reference template**: `email-templates/01-welcome-email.html` is the structural skeleton to clone from.

---

## 16. AGENT COORDINATION — STRATEGIC PLAN

### Current Problem (UPDATED 2026-04-01)
Two layers of dysfunction identified:
1. **Strategic layer** — Agents feel uncoordinated, doing their own thing or waiting. Need cleaner task flow. (Original problem, still valid.)
2. **Distribution layer (NEW — critical)** — The 250+/week posting cadence depends entirely on LLM agents deciding to call the right tools with the right parameters. No agent has the channel map, time-slot schedule, or dual-brand rules baked into its execution logic. Vector posted 1 item on X when he should have posted 54+ across 9 channels. **The entire posting cadence was documented in the posting guide but never coded as deterministic logic.** Full gap report: Section 23.

### Desired State
```
Architect sets weekly directive (Veritas Weekly Monday 9AM)
  → Sapphire breaks into daily tasks for each agent
  → Agents execute autonomously via crew_dispatch
  → Results surface in briefings table → Mission Control
  → Architect reviews, approves proposed tasks
  → Task Approval Poller auto-executes approved work
  → Cycle repeats

CONTENT DISTRIBUTION (Deterministic Engine — NEW):
  → Scheduled job fires 6x/day per brand (7AM, 10AM, 1PM, 4PM, 7PM, 10PM)
  → LLM generates content for the day's niche + time slot
  → Code distributes to ALL 9 channels via Buffer (no LLM decision-making in distribution)
  → Vector tracks performance; top performers auto-reposted on weekends
```

### Immediate Priorities for Agents
1. **Veritas** — Generate meaningful weekly strategic directives. Surface system health.
2. **Sapphire** — Break directives into actionable tasks. Route to correct agents. Monitor completion.
3. **Alfred** — Process YouTube URLs → hooks/scripts. Feed Yuki content. Daily trend scan at 8AM.
4. **Yuki** — Produce clips, post to Buffer (images), queue videos for when platform tokens are ready.
5. **Anita** — Create email sequences with conversion purpose. MUST follow Email Brand Standard (Section 15). Wait for `read_nurture_template` + `update_nurture_template` tools before she can push live.
6. **Vector** — Daily metrics sweeps. Revenue tracking. **NOT responsible for distribution spray** — that's now handled by the Deterministic Content Engine (Section 23). Vector's role shifts to: performance tracking, repost scheduling, and conversion optimization.

### What Happened After Anita's Content Was Approved?
**THIS NEEDS INVESTIGATION.** Architect approved Anita's content transmissions. Need to verify:
- Did anything get queued?
- Is content sitting in `content_drafts` waiting?
- Does she have the tools to actually execute (answer: partially — she can create, but can't schedule/send)?

---

## 17. STRATEGIC EXECUTION PLAN — INFRASTRUCTURE TO OPERATIONS

> **The Big Picture:** Mission Control (funnel side) is operational — landing page, email system, Stripe checkout, nurture sequence, auth gates all live. The Sentinel Bot side is where infrastructure must finish so agents can autonomously run the business: content production, distribution, promotion, email nurture, revenue tracking. The moment this plan completes, the system flips from "Ace building things" to "agents running the business while Ace steers."
>
> **Sequencing Rule:** Never build downstream before upstream is solid. Each phase depends on the one before it. This eliminates double work.
>
> **Date created:** 2026-03-31 | **Target completion:** Before first sales push (April 2026)

---

### PHASE 0 — ACE MANUAL ACTIONS (No code. Dashboard clicks only. Unblocks everything.)

| # | Action | Status | Verified |
|---|--------|--------|----------|
| 0A | Verify `PINECONE_API_KEY` in Railway | ✅ DONE | 2026-03-31 — API key confirmed valid (HTTP 200), index `gravity-claw` status: Ready |
| 0B | Verify `PINECONE_HOST` in Railway | ✅ DONE | 2026-03-31 — Host confirmed: `gravity-claw-cpcpbz1.svc.aped-4627-b74a.pinecone.io` |
| 0C | Add `STRIPE_SECRET_KEY` to Railway | ✅ DONE | 2026-03-31 — Stripe live, account `acct_1TBoTkRNyK9VQwla` responding, livemode: true |
| 0D | ~~Link Instagram to Facebook Page~~ | ❌ KILLED | Meta API integration permanently abandoned. See Section 9. |

**Unblocks remaining:** None — 0D killed. Phase 4A (Instagram direct API) permanently abandoned.
**Phases 1, 3, 5 are now UNBLOCKED** — 0A/0B/0C confirmed.

---

### PHASE 1 — CORE ENGINE VERIFICATION (Verify agents are functional after Phase 0)

| # | Task | Blocked by | How to verify |
|---|------|-----------|---------------|
| 1A | Confirm Pinecone activates on Railway after env fix | 0A, 0B | Railway logs show `🧠 Pinecone semantic memory: gravity-claw — ACTIVE` on boot |
| 1B | Confirm 75 knowledge_nodes auto-sync to Pinecone on boot | 1A | Logs show `🔄 [Boot] Synced N knowledge nodes to Pinecone vectors` |
| 1C | Confirm crew_dispatch poller is running | None (already coded) | Logs show `📡 [DispatchPoller] Starting...` every 30s |
| 1D | Confirm task approval poller is running | None (already coded) | Logs show `📋 [TaskPoller] Starting...` |
| 1E | Confirm scheduled jobs fire (Vector 10AM, Alfred 8AM, Veritas Monday 9AM) | None (already coded) | Check Railway logs at those times |
| 1F | Fix Telegram group chat | ✅ DONE (2026-04-01) | Veritas = lead (always responds), Sapphire = copilot (plain English summary), others = @mention/broadcast. Commit `9234a08` + follow-up. |

**Audit note (2026-03-31):** Code audit confirmed crew_dispatch, task approval poller, and pipeline handoffs are ALL fully implemented. The content pipeline routing (Alfred → Yuki → Anita → Vector) is defined in `PIPELINE_ROUTES` and auto-fires via `triggerPipelineHandoffs`. This was NOT reflected in the previous master reference. Phase 1 is verification, not building.

---

### PHASE 2 — NOTIFICATION SYSTEM OVERHAUL ✅ CORE DONE (2026-04-01)

**What was built (commits `568423d` → `991c7f5`):**
- **Two-tier notification system (commit `991c7f5`):**
  - TIER 1 — Per-agent Telegram DM: Every agent sends a short plain-English recap of their specific vector to Ace's real Telegram (`defaultChatId`). Extracts first meaningful sentence from agent response (150 char cap). Always routes to Telegram, never dashboard string.
  - TIER 2 — Sapphire full-picture summary: When the full pipeline chain completes (detected via `checkPipelineComplete()`), dispatches a `pipeline_completion_summary` task to Sapphire. Her plain-English summary hits Telegram as the final message.
  - Every dispatch also writes to `activity_log` table for dashboard visibility.
- **Dashboard routing fix (commit `3181918`):** Added `isDashboardChat()` check + `notifyChat()` router. Dashboard dispatches (`chat_id: "dashboard-*"`) write to `activity_log` instead of crashing on Telegram. Root cause of all "failed" dispatches in the 2026-04-01 morning test.
- **Pipeline chain tracking (commit `568423d`):** New exports in `crew-dispatch.ts`: `getFullPipelineChain()` (walks full ancestor tree via Supabase), `checkPipelineComplete()` (returns completed chain or null).
- Proactive agent actions also route through the same notification path — any dispatch completion triggers a Telegram DM.

**Still TODO:**
- 2B: Telegram briefing relay (push condensed briefing summaries to Telegram DM when agents write to `briefings` table)
- 2C: `/briefings` command for on-demand briefing pull

---

### PHASE 3 — CONTENT PIPELINE END-TO-END TEST (IN PROGRESS)

**First live test (2026-04-01 ~07:19 UTC):** Ace fired the YouTube URL (`https://youtu.be/WhqdFNK58S8`) through the dashboard to Sapphire. Sapphire dispatched to Alfred via `multi_pass_hook_extraction`. Alfred completed and auto-chained to Yuki + Anita + Sapphire. Those completed and auto-chained to Vector. **The full 8-dispatch chain fired correctly.**

**Why it showed as "failed":** The OLD notification code (pre-Phase 2 fix) tried to send Telegram messages using `chat_id: "dashboard-sapphire"`. Telegram rejected every one ("chat not found"), and the catch block overwrote each dispatch status from "completed" to "failed". The agents DID process the tasks — the failure was purely in the notification layer.

**Status after Phase 2 fix:** Both the notification spam and the dashboard chat_id routing are now fixed. Next test should complete cleanly.

| # | Task | Status |
|---|------|--------|
| 3A | Feed a YouTube URL through pipeline | ✅ DONE — chain fires, Alfred extracts |
| 3B | Verify auto-dispatch fires downstream | ✅ DONE — all 8 handoffs fired correctly |
| 3C | Verify full chain completes without errors | 🔄 NEEDS RETEST — Phase 2 fix now deployed, rerun should pass |
| 3D | Check `content_drafts` table for output | 🔄 NEEDS RETEST — verify agents write output to DB |
| 3E | Verify Sapphire completion summary fires | 🔄 NEEDS RETEST — new feature, first live test pending |

---

### PHASE 4 — DISTRIBUTION CHANNEL ACTIVATION (Yuki's video posting tools)

Video publisher code is fully written and registered. This is purely a credential + platform approval problem.

| # | Platform | Steps | Blocked by |
|---|----------|-------|-----------|
| 4A | ~~**Instagram**~~ | ❌ KILLED — Meta API integration permanently abandoned. Buffer image+text still works. | N/A |
| 4B | **TikTok** | Upload app icon + demo video to TikTok developer portal → submit for review → get `TIKTOK_ACCESS_TOKEN` → add to Railway | App review (external timeline) |
| 4C | **YouTube** | Set up OAuth → get refresh token + client credentials → add to Railway | OAuth setup |
| 4D | **End-to-end test** | Yuki publishes one test video to each platform that has tokens | 4A, 4B, 4C (whichever are ready) |

**Note:** Don't wait for all three platforms. Activate whichever clears first. YouTube is priority. Instagram direct API is dead — Buffer handles image+text.

---

### PHASE 5 — REVENUE INTELLIGENCE (Vector wakes up)

| # | Task | Blocked by |
|---|------|-----------|
| 5A | Confirm `stripe_metrics` tool responds after Railway env update | Phase 0C |
| 5B | Verify Vector's daily 10AM sweep runs and populates `stripe_metrics` table | 5A |
| 5C | Confirm `sovereign_metrics` reflects real $1.2M progress | 5B |

**Audit finding:** Code is fully built. This phase is 100% verification after Phase 0C.

---

### PHASE 6 — EMAIL AUTOMATION (Anita becomes a conversion engine)

| # | Task | Details |
|---|------|---------|
| 6A | Build email scheduling tool for Anita | Either new Make.com scenario (Scenario G) or direct Resend API tool callable by Anita |
| 6B | Define conversion sequences per tier | Each email sequence maps to a specific product tier with a conversion purpose |
| 6C | Investigate Anita's approved content transmissions | Where did they go? Are they in `content_drafts`? Did anything execute? |
| 6D | Wire conversion tracking | Track which email → which Stripe purchase for ROI visibility |

---

### PHASE 7 — AGENT EXECUTIVE ROLES & OPERATIONAL CLARITY

**The problem Ace identified:** Agents have tools but lack executive clarity. They know the Vid Rush pipeline but not the full scope of their business responsibilities. Each agent needs a defined EXECUTIVE ROLE (business function), OPERATIONAL SCOPE (what duties that covers), and TOOL MANDATE (which tools they must use to fulfill those duties). These must be documented in both the master reference AND updated in Supabase `personality_config` blueprints so agents actually operate with this knowledge.

#### AGENT EXECUTIVE ROLE MAP (Canonical — to be pushed to Supabase blueprints)

| Agent | Executive Role | Business Function | Revenue Accountability |
|-------|---------------|-------------------|----------------------|
| **Veritas** | Chief Brand Officer | Brand integrity, strategic direction, weekly directive | Sets the agenda that drives all downstream revenue activity |
| **Sapphire** | Chief Operating Officer | Task decomposition, pipeline health, coordination | Ensures every agent's work chains into revenue outcomes |
| **Alfred** | Head of Content Intelligence | Trend scanning, topic research, source material processing, YouTube pipeline | Feeds the raw material that becomes all distributed content |
| **Yuki** | Head of Distribution & Creative | Visual content production, Buffer posting, YouTube Shorts, clip generation | SOLE posting authority — 329+ posts/week output target |
| **Anita** | Head of Conversion & Nurture | Email sequences, community engagement, copy for all tiers | Converts attention into purchases across the $77-$12K ladder |
| **Vector** | Head of Revenue Intelligence | Stripe metrics, performance tracking, repost scheduling, funnel analytics | Tracks what's working, kills what isn't, optimizes for $1.2M target |

#### OPERATIONAL SCOPE BY AGENT

**VERITAS — Chief Brand Officer**
- Duties: Weekly strategic directive (Monday 9 AM), brand consistency review, system health surfacing, Architect interface
- Tools: All base tools, crew_dispatch, file_briefing, propose_task
- Output: Weekly directive → dispatched to Sapphire for decomposition
- Success metric: One actionable directive per week that results in measurable agent output
- Autonomy boundary: Sets direction but does NOT execute content or distribution

**SAPPHIRE — Chief Operating Officer**
- Duties: Break directives into daily tasks, monitor pipeline completion, dispatch to correct agents, pipeline completion summaries
- Tools: ProtocolWriter, RelationshipContext, FileBriefing, crew_dispatch, check_approved_tasks
- Output: Daily task dispatches to all agents, pipeline health briefings, completion summaries to Architect
- Success metric: Zero stalled pipelines, all dispatched tasks completed within 24 hours
- Autonomy boundary: Coordinates but does NOT create content directly

**ALFRED — Head of Content Intelligence**
- Duties: 8 AM daily trend scan, YouTube URL processing (hook extraction + transcript), topic research for niche rotation, source material for Yuki/Anita
- Tools: ProtocolReader, SaveContentDraft, YouTube interceptor, web search, clip_generator (analysis), Make.com webhook trigger (Scenarios E/F)
- Output: Hook extractions → dispatched to Yuki. Trend reports → dispatched to Anita. Research → saved to content_drafts
- Success metric: Daily trend scan fires at 8 AM, every YouTube URL processed within 1 hour, 6+ hooks extracted per video
- Autonomy boundary: Discovers and analyzes. Does NOT post to social or send emails.

**YUKI — Head of Distribution & Creative**
- Duties: SOLE Buffer posting authority, YouTube Shorts production, comic panel generation, visual content creation, clip extraction via VidRush
- Tools: Buffer posting (social_scheduler_create_post), video publisher (youtube_publish_short), clip_generator, image_generator, SaveContentDraft
- Output: 329+ posts/week across 9 Buffer channels (with IG override), YouTube Shorts, comic panels
- Success metric: All 9 channels receiving posts at cadence, Shorts pipeline producing 10+/day when live
- Autonomy boundary: Creates and distributes visual/video content. Does NOT handle email, analytics, or strategic direction.

**ANITA — Head of Conversion & Nurture**
- Duties: Email copy tied to specific product tiers, conversion sequences, community engagement copy, text content for social
- Tools: ProtocolReader, SaveContentDraft, (NEEDED: read_nurture_template, update_nurture_template, email scheduling)
- Output: Email sequences per tier, thread copy, long captions → saved to content_drafts
- Success metric: Each tier has a purpose-built conversion sequence, email open rates tracked
- Autonomy boundary: Creates copy. Does NOT post to social (dispatches to Yuki). MUST follow Email Brand Standard (Section 15).
- **MISSING TOOLS:** Cannot read or update `nurture_templates` table. Cannot schedule emails. Cannot track conversion. These need to be built (Phase 6).

**VECTOR — Head of Revenue Intelligence**
- Duties: 10 AM daily metrics sweep, Stripe revenue tracking, content performance analysis, top performer identification for weekend reposts, conversion optimization
- Tools: StripeMetrics, FileBriefing, social_scheduler (for analytics), video_publisher (for analytics)
- Output: Daily metrics briefing, revenue dashboard data (sovereign_metrics, stripe_metrics), top performer lists for repost engine
- Success metric: Daily sweep fires at 10 AM, revenue data current in dashboard, top performers identified for weekend repost
- Autonomy boundary: Analyzes and reports. Does NOT create content or post (distribution handled by Deterministic Engine). Recommends strategy changes to Sapphire.

#### DEVELOPMENT TASKS (to make this operational)

| # | Task | Status | Details |
|---|------|--------|---------|
| 7A | Update all 6 Supabase personality blueprints with executive roles | ✅ DONE (2026-04-02) | All 6 updated: executive titles, pipeline routes (Anita→Yuki), Vector posting removed, Yuki IG override + Deterministic Engine awareness added. Crew roster updated across all blueprints. |
| 7B | Wire strategic cadence | 📋 PLANNED | Veritas weekly directive → Sapphire decomposes into daily tasks → agents execute via crew_dispatch → briefings surface to Ace |
| 7C | Build Anita's missing tools | 📋 PLANNED | `read_nurture_template`, `update_nurture_template`, email scheduling tool. Blocked Phase 6 tasks. |
| 7D | Pipeline awareness | 📋 PLANNED | Agents detect and report broken pipelines instead of silently reverting to chatbot mode |
| 7E | Stasis detection enforcement | 📋 PLANNED | Daily sweep at 2PM catches agents that are looping without producing output |
| 7F | Build individual agent master reference docs | 📋 PLANNED | One markdown doc per agent in the repo, referenced from personality blueprints. Full I/O contracts, tool usage patterns, escalation rules. |

---

### PHASE 8 — ARCHITECT VISIBILITY (Funnel Visualization + Command View)

**Ace's request:** A page that shows the funnel and automation paths visually — like Make.com's grid. Blocks for each agent, showing how they're interconnected. Not necessarily a full project if difficult, but needed for clarity.

| # | Task | Details |
|---|------|---------|
| 8A | Build funnel visualization page on Mission Control | Visual flowchart showing: landing page → email capture → Supabase → welcome email → nurture sequence → Stripe checkout → purchase email → course portal. Each node is a clickable block showing status. |
| 8B | Build agent pipeline visualization | Visual flow showing: YouTube URL → Alfred → Yuki → Anita → Vector → platforms. Each agent is a block with status, last activity, queue depth. |
| 8C | Mission Control goal sync | Goals/tasks from agent chat surface on dashboard instead of vanishing. |
| 8D | Webhook Bridge | ✅ **DONE (2026-04-01)** — `/api/chat-bridge` webhook on Railway accepts `{ agent_name, content }`, routes through the REAL AgentLoop (personality, tools, Pinecone, memory). Mission Control `/api/chat` and `/api/chat-group` routes rewritten to call Railway instead of direct Anthropic. Fallback templates retained for when Railway is unreachable. |

---

### REMAINING GAPS (Low priority, non-blocking)
- Image generation tool (exists, needs testing)
- Buffer API profile connection (key set, profiles being connected — Buffer stays for image-only posts)
- MCP config (disabled for OOM prevention, low priority)

---

## 18. ENVIRONMENT VARIABLES — DEFINITIVE MAP (Updated 2026-03-31 Session 4)

**RULE: One canonical name per variable. No fallbacks. If code and Railway disagree, this document wins.**

### CRITICAL — Bot will not start without these

| Env Var (Railway) | Code References | Status |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | config.ts (also aliased as VERITAS_TOKEN) | ✅ SET |
| `VERITAS_TOKEN` | config.ts, index.ts | ✅ SET |
| `SAPPHIRE_TOKEN` | config.ts, index.ts | ✅ SET |
| `ALFRED_TOKEN` | config.ts, index.ts | ✅ SET |
| `YUKI_TOKEN` | config.ts, index.ts | ✅ SET |
| `ANITA_TOKEN` | config.ts, index.ts | ✅ SET |
| `VECTOR_TOKEN` | config.ts, index.ts | ✅ SET |
| `GEMINI_API_KEY` | config.ts (primary LLM) | ✅ SET |
| `SUPABASE_URL` | config.ts, index.ts, 5 tool files | ✅ SET (also has NEXT_PUBLIC_SUPABASE_URL) |
| `SUPABASE_ANON_KEY` | config.ts, index.ts, 5 tool files | ✅ SET (also has NEXT_PUBLIC_SUPABASE_ANON_KEY) |

### IMPORTANT — Features broken without these

| Env Var (Railway) | What It Powers | Status |
|---|---|---|
| `BUFFER_API_KEY` | Buffer GraphQL social posting (9 channels) | ✅ SET — Personal key "vector", expires 2027-03-27 |
| `PINECONE_API_KEY` | Semantic memory (316 vectors) | ✅ SET |
| `PINECONE_INDEX` | Index name ("gravity-claw") | ✅ SET |
| `PINECONE_HOST` | Pinecone host URL | ✅ SET |
| `OPENAI_API_KEY` | Whisper transcription + LLM failover | ✅ SET |
| `STRIPE_SECRET_KEY` | Revenue metrics tool | ✅ SET |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | ✅ SET |
| `YOUTUBE_CLIENT_ID` | YouTube OAuth | ✅ SET |
| `YOUTUBE_CLIENT_SECRET` | YouTube OAuth | ✅ SET |
| `YOUTUBE_REFRESH_TOKEN` | Ace Richie 77 channel uploads | ✅ SET |
| `YOUTUBE_REFRESH_TOKEN_TCF` | The Containment Field uploads | ✅ SET |
| `MAKE_SCENARIO_E_WEBHOOK` | Make.com Scenario E trigger | ✅ SET |
| `MAKE_SCENARIO_F_WEBHOOK` | Make.com Scenario F trigger | ✅ SET |
| `WEBHOOKS_ENABLED` | Must be "true" for /api/* endpoints | ✅ SET |
| `MCP_JSON_B64` | MCP server config (base64 encoded) | ✅ SET |

### OPTIONAL — Have sensible defaults

| Env Var (Railway) | Default | Status |
|---|---|---|
| `NODE_ENV` | "production" | ✅ SET |
| `SQLITE_PATH` | "./gravity-claw.db" | ✅ SET |
| `TZ` | (system) | ✅ SET |
| `PORT` | 3000 | Set by Railway automatically |
| `BUFFER_ORG_ID` | "69c613a244dbc563b3e05050" (hardcoded) | Not needed in Railway |
| `LLM_DEFAULT_PROVIDER` | "gemini" | Not needed |
| `GEMINI_MODEL` | "gemini-3.1-pro-preview" | Not needed |
| `BROWSER_ENABLED` | "false" | NOT SET — see Browser section below |
| `SHELL_ENABLED` | "true" (default) | Not needed |
| `SEARCH_PROVIDER` | "duckduckgo" | Not needed |
| `MCP_ENABLED` | "false" (OOM prevention) | NOT SET |

### LLM FAILOVER — Optional providers

| Env Var | Default Model | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 | ✅ SET |
| `OPENAI_API_KEY` | gpt-4o | ✅ SET (shared with Whisper) |
| `DEEPSEEK_API_KEY` | deepseek-chat | ❌ Not set |
| `GROQ_API_KEY` | llama-3.3-70b-versatile | ✅ SET (confirmed 2026-04-02) |
| `OPENROUTER_API_KEY` | anthropic/claude-sonnet-4 | ❌ Not set |

### NOT YET AVAILABLE — Blocked/Deferred

| Env Var | Blocker | Status |
|---|---|---|
| ~~`INSTAGRAM_ACCESS_TOKEN`~~ | Meta API KILLED | ❌ DEAD — will never be set |
| ~~`INSTAGRAM_BUSINESS_ID`~~ | Meta API KILLED | ❌ DEAD — will never be set |
| `TIKTOK_ACCESS_TOKEN` | TikTok app approval pending | ❌ DEFERRED |
| `ELEVENLABS_API_KEY` | Voice features not prioritized | ⏸️ Optional |
| `SEARCH_API_KEY` | Only needed if search provider != duckduckgo | ⏸️ Optional |

### DEPRECATED — DO NOT USE

| Old Name | Replaced By | Notes |
|---|---|---|
| `BUFFER_ACCESS_TOKEN` | `BUFFER_API_KEY` | v1 REST API is dead. GraphQL uses BUFFER_API_KEY only. |
| `SOCIAL_SCHEDULER_API_KEY` | `BUFFER_API_KEY` | Legacy fallback removed Session 4. |
| `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_URL` | Dashboard var, bot should use SUPABASE_URL. Both work but canonical is SUPABASE_URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY` | Same — dashboard var kept for compat but canonical is SUPABASE_ANON_KEY. |
| `AUTHORIZED_USER_ID` | `TELEGRAM_AUTHORIZED_USER_ID` | Old name, code checks both. |

---

## 19. TIKTOK — DEFERRED / INSTAGRAM DIRECT API — KILLED

**Decision (2026-03-31):** YouTube is the primary platform. Instagram direct API (Meta Graph API) is permanently abandoned — never worked, credentials were leaked, not worth fighting Meta's restrictions. Instagram image+text posting still works fine through Buffer. TikTok app review has not started.

### Instagram Direct API — ❌ KILLED
- Meta API integration permanently abandoned as of 2026-03-31
- All credentials scrubbed from this document (were exposed in git — GitGuardian alert)
- Architect should rotate or delete the Meta App at developers.facebook.com
- **Buffer still handles Instagram image+text posts** — no impact on content pipeline

### TikTok — DEFERRED
- TikTok Developer App created but needs: app icon upload, demo video, review submission
- Content Posting API requires approved app to get `TIKTOK_ACCESS_TOKEN`
- External timeline (TikTok reviews can take days to weeks)

### If Secondary Channels Are Revisited Later
1. **Third-Party Bridges (ManyChat / GoHighLevel):** Already have whitelisted API access. Hook agents via webhooks.
2. **YouTube-First Transfer:** Prove on YouTube Shorts → manually cross-post top performers.

**Rule: Do NOT spend engineering time on these until YouTube pipeline is producing 50+ Shorts/week autonomously.**

---

## 20. SOVEREIGNSYNTHESISPROJECTS — LEGACY ASSET SOURCING PROTOCOL

**The `SovereignSynthesisProjects` folder is the original codebase from the first iteration of Sovereign Synthesis.** It contains working parts, broken parts, and deprecated parts. It is NOT a deployable project — it is a parts warehouse.

### How to Use Legacy Assets
- **Reference, don't import.** Read the code, understand the pattern, rebuild in the current TypeScript architecture.
- **Verify before trusting.** Credentials in `.env.vault` may be expired (the Google refresh token was dead). API keys may be rotated. Schemas may have changed.
- **Never deploy from SovereignSynthesisProjects.** All deployable code lives in `Sovereign-Sentinel-Bot` (Railway) or `Sovereign-Mission-Control` (Vercel).

### What's Salvageable
| Asset | Location | Status | Notes |
|-------|----------|--------|-------|
| Google OAuth Client ID + Secret | `.env.vault` | ✅ VALID | Client `5134562222-...` still active in Google Cloud Console |
| Google Refresh Token | `.env.vault` | ❌ DEAD | `invalid_grant` — expired due to Testing mode 7-day limit |
| Maven Crew Python agents | `maven_crew/` | 🔶 REFERENCE ONLY | CrewAI-based. Pattern is useful but Python layer is deprecated in favor of TypeScript agent loop |
| Vid Rush Engine (Python) | `maven_crew/vid_rush_engine.py` | 🔶 REFERENCE ONLY | Ported to TypeScript `vid-rush.ts` in Sentinel Bot |
| YouTube API Test Script | `scripts/test_youtube_api.py` | 🔶 USEFUL | Validates Google OAuth token refresh — updated script at `scripts/youtube_oauth_flow.py` |
| Make.com Scenario Blueprints | `docs/` | 🔶 REFERENCE | Scenario IDs may still be valid but flows may be outdated |
| Skills Vault | `gravity-claw-skills-vault/` | ✅ ACTIVE | Canonical skill definitions — still referenced by both Claude and Antigravity |
| Content Templates | `funnel-assets/` | 🔶 REFERENCE | HTML templates for tier pages — canonical versions now in `sovereign-landing` repo |
| Brand Identity Assets | Various | ✅ ACTIVE | Brand guidelines, design tokens, voice/tone — still the source of truth |
| Target Data | `TARGET_DATA.md` | ✅ ACTIVE | Customer avatars, pain points, messaging angles |

### Session Protocol for Legacy Assets
When a new session needs to reference SovereignSynthesisProjects:
1. Read the specific file needed
2. Verify any credentials/APIs are still live before using
3. Rebuild in the correct domain (Sentinel Bot or Mission Control)
4. Document what was pulled and its current status in this master reference
5. Never modify SovereignSynthesisProjects directly — it is read-only reference material

---

## 21. REFERENCE LINKS

| Resource | Location |
|----------|----------|
| Sovereign Sentinel Bot repo | https://github.com/7acerich1-creator/Sovereign-Sentinel-Bot |
| Mission Control repo | https://github.com/7acerich1-creator/Sovereign-Mission-Control |
| Mission Control live | https://sovereign-mission-control.vercel.app/ |
| Supabase dashboard | https://supabase.com/dashboard/project/wzthxohtgojenukmdubz |
| Railway dashboard | https://railway.app (project: 77e69bc6-f7db-4485-a756-ec393fcd280e) |
| Pinecone console | https://app.pinecone.io |
| Google Cloud Console | https://console.cloud.google.com/apis/credentials?project=project-b0dc5e49-2aad-42ca-938 |
| Meta Developer Portal | https://developers.facebook.com |
| Graph API Explorer | https://developers.facebook.com/tools/explorer |
| Stripe dashboard | https://dashboard.stripe.com |
| Buffer dashboard | https://buffer.com |
| Skills Vault (Windows) | `C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects\gravity-claw-skills-vault` |
| Canonical IDs doc | `gravity-claw-skills-vault/SYSTEM_IDS_CANONICAL.md` |
| YouTube OAuth Script | `SovereignSynthesisProjects/scripts/youtube_oauth_flow.py` |

---

## 22. SESSION HANDOFF CHECKLIST

At the END of every session, the session pilot MUST:

1. **Update this document** with any changes made during the session
2. **Update the "Last Updated" date** at the top
3. **Move completed items** out of Section 8 (Blockers) if resolved
4. **Add new blockers** discovered during the session
5. **Update agent coordination status** in Section 16 if priorities changed
6. **Declare push status** — one of three states (see Section 4):
   - **Push executed** (Claude Code): via Desktop Commander `start_process` → `git push origin main`
   - **Push deferred** (Cowork): tell Ace to run `git push origin main` from terminal
   - **No push needed**: docs-only changes that don't affect Railway deploy

### Contradiction Prevention Protocol (Added 2026-04-02)

**When changing the status of ANY system component, update ALL sections that reference it.** The 2026-04-02 continuity audit found 8 contradictions caused by updating one section without updating cross-references.

**Mandatory cross-reference checklist when changing status:**

| If you change... | Also update... |
|---|---|
| An env var status (Section 18) | The session summary + any section referencing that var |
| A blocker status (Section 8) | Section 3 (Infrastructure Map) if it references the blocker |
| Webhook bridge status (Section 10) | MC Section 8 (Dashboard Pages) + Phase 8D |
| Content pipeline status (Section 11) | MC Section 15 (Content Pipeline) + Posting Guide |
| Posting math / channel count | Section 11 + MC Section 15 + Posting Guide header |
| Agent role changes | Section 5 (Agents) + Section 16 (Agent Coordination) + Supabase blueprints |
| Git/push protocol | Section 4 + Section 22 (Handoff) + MC Section 3 + MC Section 14 |

**Rule: If a status appears in more than one section, grep for it before closing the session. `ctrl+F` is cheaper than a full continuity audit.**

### Quick Context Recovery for New Sessions
Read these in order:
1. This file (`SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md`)
2. `CLAUDE.md` (project constitution)
3. Memory files in `.auto-memory/` (indexed by `MEMORY.md`)

---

---

## 23. CONTENT DISTRIBUTION AUDIT — GAP REPORT & FIX PLAN (2026-04-01)

> **Full pipeline clarity document:** `CONTENT-PIPELINE-CLARITY.md` in this repo — covers both engines (Transmission Grid + Vid Rush), verified channel counts, Vid Rush gaps VR-1 through VR-9, and priority build sequence.

### The Two Engines
1. **Transmission Grid** (text+image via Buffer) — ✅ BUILT, fully autonomous, code at `src/engine/content-engine.ts`
2. **Vid Rush** (video via YouTube API) — 🔧 BUILT but has 9 gaps (VR-1 through VR-9, documented in CONTENT-PIPELINE-CLARITY.md)

### Corrected Channel Math (Verified from Buffer screenshot 2026-04-01)
- **Ace Richie: 5 channels** — TikTok (acerichie77), Instagram (ace_richie_77), YouTube (Ace Richie 77), X (AceRichie77), Threads (ace_richie_77)
- **Containment Field: 4 channels** — TikTok (the_containment_field), Instagram (the_containment_field), YouTube (The Containment Field), X (ContainmentFld)
- **Total: 9 channels across both brands** (NOT 9 per brand)
- **LinkedIn: ❌ NOT CONNECTED** to Buffer — listed in old posting guide but never added. Needs manual Buffer connection.
- **Threads: Ace Richie ONLY** — Containment Field has no Threads channel
- **Pinterest: ❌ NOT CONNECTED** — mentioned in old posting guide, not in Buffer
- **Reddit: ❌ NOT IN BUFFER** — manual or direct API only
- Transmission Grid daily: (5 × 6) + (4 × 6) = **54 posts/day = 378/week** — exceeds 250+ target on its own

### The Problem
The SOVEREIGN-POSTING-GUIDE.md describes a 250+/week posting cadence. Testing revealed Vector scheduled 1 post on X. That's a 99% execution gap. Deep code audit confirmed the cadence was **documented but never implemented as deterministic logic**.

### What IS Built (Working)
| Component | Status | Code Location |
|-----------|--------|---------------|
| Buffer GraphQL posting tool | ✅ WORKING | `src/tools/social-scheduler.ts` |
| Multi-channel support (comma-separated IDs) | ✅ WORKING | `SocialSchedulerPostTool.execute()` loops through `channelIds` |
| Crew dispatch (Supabase-backed) | ✅ WORKING | `src/agent/crew-dispatch.ts` |
| Dispatch poller (15s interval, auto-claim) | ✅ WORKING | `src/index.ts` line ~1565 |
| Pipeline routes (Alfred→Yuki+Anita+Sapphire, Yuki→Anita, Anita→Vector) | ✅ WORKING | `PIPELINE_ROUTES` in crew-dispatch.ts |
| Auto-handoffs (triggerPipelineHandoffs) | ✅ WORKING | Fires after each agent completes |
| Scheduled auto-ops (Alfred 8AM, Vector 10AM, Veritas Mon 9AM) | ✅ WORKING | `src/index.ts` line ~567 |
| Content logging to Supabase `content_transmissions` | ✅ WORKING | Inside social-scheduler.ts |

### What Is NOT Built (The Gaps)

**GAP 1: No "post to all 9 channels" instruction in agent context**
- The `social_scheduler_create_post` tool ACCEPTS comma-separated channel IDs and loops through them correctly.
- BUT no agent's system prompt, persona, or dispatch payload includes the actual 9 channel IDs.
- Vector would have to independently call `social_scheduler_list_profiles`, parse the response, build a comma-separated list, and pass it. This is unreliable LLM-dependent behavior.
- **Fix:** Hardcode the channel ID list in the Deterministic Content Engine. No LLM decides WHERE to post.

**GAP 2: No multi-time-slot scheduling**
- The posting guide defines 6 time slots per brand: 7AM, 10AM, 1PM, 4PM, 7PM, 10PM.
- No code exists that schedules across these slots. The auto-ops only fire Vector's metrics sweep (10AM), Alfred's trend scan (8AM), and Veritas's directive (Mon 9AM).
- There is no "content production" scheduled job at any of the 6 posting times.
- **Fix:** The Deterministic Content Engine adds a new scheduled job for each time slot OR a single job that pre-schedules the full day's content each morning.

**GAP 3: No per-platform content reformatting**
- LinkedIn needs professional tone, longer copy, no hashtag spam.
- X needs punchy hooks, 280-char cap awareness, hashtags.
- TikTok/IG need visual-first hooks, shorter text.
- Threads can be more conversational.
- Currently: identical `text` string goes to every channel.
- **Fix:** The LLM content generation step produces a `platform_variants` object with per-platform text. The Deterministic Engine picks the right variant per channel.

**GAP 4: No dual-brand distribution**
- Two brands (Ace Richie, Containment Field) should each get every post adapted to their voice.
- Nothing in the pipeline splits, duplicates, or re-voices content for both brands.
- The channel map has channels for both brands but no code iterates both brand sets.
- **Fix:** The Deterministic Engine runs two passes per time slot — one for each brand, with brand-appropriate voice/tone in the LLM prompt.

**GAP 5: No daily content production trigger**
- Alfred's 8AM trend scan dispatches a "scan and report" task — NOT "produce 6 posts for today."
- The scan produces a briefing for Ace. It does not generate actual post content.
- There is no job that says "generate content for today's niche for each time slot."
- **Fix:** New `daily_content_production` scheduled job that runs early morning. Uses the niche rotation (Mon=dark psych, Tue=self improvement, etc.) to generate 6 unique hooks/captions per brand. Stores in `content_drafts` table. The distribution engine then reads and fires them at scheduled times.

**GAP 6: Agent personas lack operational instructions**
- Vector's persona: "Route outputs to correct channels, monitor conversion metrics" — vague.
- Yuki's persona: "Find viral moments, cut short clips" — no mention of Buffer distribution responsibility.
- No persona includes the actual channel IDs, posting schedule, or niche rotation.
- **Fix (Phase 7 — still valid):** Create individual agent master references with exact responsibilities, input/output contracts, tool usage patterns, and success metrics. BUT for distribution specifically, this is superseded by the Deterministic Engine (don't rely on prompt engineering for 250+/week output).

### Deterministic Content Engine — Implementation Plan

**Concept:** LLM handles CREATIVE (writing hooks, captions, platform variants). CODE handles DISTRIBUTION (channel iteration, time-slot scheduling, brand duplication). This eliminates the LLM reliability problem.

**Architecture:**
```
DAILY CONTENT PRODUCTION JOB (runs once at 6AM)
  │
  ├── Determine today's niche from rotation (Mon=dark_psych, Tue=self_improvement, etc.)
  ├── For EACH of 6 time slots:
  │   ├── Generate content via LLM (hook + caption + platform variants)
  │   ├── Generate for BOTH brands (Ace Richie voice + Containment Field voice)
  │   └── Store in content_drafts table with scheduled_time + brand + status="ready"
  │
DISTRIBUTION JOB (runs every 5 minutes, checks for "ready" drafts whose time has arrived)
  │
  ├── Pull drafts where scheduled_time <= now AND status="ready"
  ├── For EACH draft:
  │   ├── Determine brand → select correct channel IDs (hardcoded map)
  │   ├── Select platform-specific text variant per channel
  │   ├── Call social_scheduler_create_post with ALL channel IDs for this brand
  │   ├── Mark draft status="posted", store Buffer post IDs
  │   └── Log to content_transmissions
  │
PERFORMANCE TRACKING (Vector's 10AM sweep — already exists)
  │
  └── Vector checks posted content performance, queues top performers for weekend repost
```

**Hardcoded Channel Map (from Buffer — needs verification at build time):**
```typescript
const CHANNEL_MAP = {
  ace_richie: {
    youtube: "CHANNEL_ID_HERE",
    instagram: "CHANNEL_ID_HERE",
    tiktok: "CHANNEL_ID_HERE",
    x: "CHANNEL_ID_HERE",
    linkedin: "CHANNEL_ID_HERE",
    threads: "CHANNEL_ID_HERE",
  },
  containment_field: {
    youtube: "CHANNEL_ID_HERE",
    instagram: "CHANNEL_ID_HERE",
    tiktok: "CHANNEL_ID_HERE",
    x: "CHANNEL_ID_HERE",  // ContainmentFld — verify this channel exists in Buffer
  },
};
```

**NOTE on Containment Field channels:** The Buffer channel map in Section 11 only shows 9 total channels. Containment Field only has YouTube + Instagram + TikTok + X (4 channels). Ace Richie has YouTube + Instagram + TikTok + X + LinkedIn + Threads (6 channels). No LinkedIn or Threads for Containment Field. Verify before hardcoding.

**BUILD STATUS: ✅ COMPLETE (2026-04-01 Cowork Session)**

**What was built:**
- `src/engine/content-engine.ts` — Full deterministic content engine module
- `src/engine/migration.sql` — Supabase table DDL (already applied)
- Wired into `src/index.ts` as two scheduled jobs
- `content_engine_queue` table created in Supabase with 19 columns + 3 indexes + RLS

**How it works:**
1. **Channel Discovery:** Fetches all 9 Buffer channels at boot via GraphQL, caches them, categorizes by brand using name pattern matching (ace/richie/77 vs containment). No hardcoded IDs.
2. **Daily Production Job** (6:30 AM ET / 11:30 UTC): Determines today's niche from rotation → generates 6 time slots × 2 brands = 12 LLM calls → stores in `content_engine_queue` with `status: "ready"` and `scheduled_time`. Deduplicates (won't regenerate if already exists for that slot+brand+date).
3. **Distribution Sweep** (every 5 minutes): Queries `content_engine_queue` for `status=ready AND scheduled_time <= now` → posts to ALL channels for that brand using platform-specific text variants → updates status to `posted` → logs to `content_transmissions` for Vector's metrics sweep.
4. **Weekend Reposts:** Sat/Sun automatically queries top-performing posts from the week and re-queues them instead of generating new content.
5. **Health Check:** `contentEngineStatus()` function returns ready/posted/failed counts for today.

**Key design decisions:**
- Buffer channel IDs are fetched dynamically (not hardcoded) — survives account changes
- LLM generates platform variants in ONE call per slot per brand (not one call per platform)
- Distribution is a separate job from production — if LLM fails, previously generated content still distributes
- Telegram notification sent to Architect after daily production completes

**Dependencies (all satisfied):**
- ✅ Buffer channel IDs: fetched dynamically via GraphQL at boot
- ✅ `content_engine_queue` table: created in Supabase (project wzthxohtgojenukmdubz)
- ✅ LLM quota: 12 calls/day for content generation (well within Gemini's 250/day)
- ✅ GROQ_API_KEY set in Railway (2026-04-02) — failover chain now has backup

**FIRST LIVE TEST RESULTS (2026-04-02 — from Buffer screenshot):**

Posts appeared in Buffer but with TWO critical bugs:

**BUG CE-1: Only X and Threads receive posts. IG, TikTok, YouTube at zero.** ✅ PARTIALLY FIXED (2026-04-02)
- Root cause: Content engine sends text-only posts (no `media_url`). IG and TikTok require images — Buffer silently rejects text-only.
- **Fix applied (defensive):** Added `IMAGE_REQUIRED_PLATFORMS` set in content-engine.ts. Distribution sweep now SKIPS instagram/tiktok when no `media_url` attached instead of sending doomed requests. Also added `IG_FREQUENCY_OVERRIDE` config object enforcing the Ace 3/day + CF 2/day cap directly in the engine.
- **Remaining work:** Image generation still needed. `dailyContentProduction()` needs to produce or attach a `media_url` for each draft. Options: (a) Gemini Imagen 3 generates a branded image per post, (b) pull from a pre-loaded asset library in Supabase Storage, (c) use Canva API for templated quote cards. Until then, IG/TikTok remain skipped — X/Threads/YouTube get text posts at correct times.

**BUG CE-2: Posts clustered at 8-11 AM instead of 6 time slots.** ✅ FIXED (2026-04-02)
- Root cause: `schedulingType: automatic` let Buffer pick times (clustered in morning).
- **Fix applied:** Changed to `schedulingType: scheduled` with `scheduledAt` pulled from `draft.scheduled_time`. Posts now hit at the exact 6 time slots defined in the cadence (7AM/10AM/1PM/4PM/7PM/10PM ET).

**Current state after fixes:** X and Threads get 6 posts/day at correct times. YouTube community posts get 6/day text-only. IG and TikTok are skipped until image pipeline is wired up. The IG frequency override is in the code and ready — it will activate automatically once images are available.

### 23B. CONTENT BATCHING STRATEGY — 7-Day Rolling Batch (Added 2026-04-02)

**Decision:** Content is generated in 7-day rolling batches, not daily. This gives a full week of runway so a missed session or API outage never causes silence on the grid.

**How it changes the engine:**

| Aspect | Old (Daily) | New (7-Day Rolling) |
|--------|-------------|---------------------|
| Production job | 6:30 AM daily, generates 12 items (6 slots × 2 brands) | **Sunday 11 PM** (or Monday 3 AM), generates 84 items (6 slots × 2 brands × 7 days) |
| LLM calls per batch | 12/day | ~84/week (can be parallelized in chunks of 6) |
| Queue depth | Always 0-12 items ahead | Always 0-84 items ahead |
| Failure mode | If daily job fails, that day has no content | If weekly job fails, 6 days of runway remain. Alert fires, next daily check-in can regenerate. |
| Trending content | All content generated same-day | **Evergreen batch + daily trending override** (see below) |

**The Trending Override Slot:**
Each day reserves **1 slot (1 PM across both brands)** as a "trending override." This slot is NOT pre-filled by the weekly batch. Instead, Alfred's 8 AM trend scan produces a real-time hook, and the 1 PM slot picks it up. If no trending content exists by 12:30 PM, the engine falls back to a pre-generated evergreen post for that slot.

**Niche rotation still applies per day:**
The weekly batch follows the existing rotation (Mon=dark psych, Tue=self improvement, etc.) so each day's content matches its assigned niche. Weekend slots pull top performers from the week as before.

**Implementation changes needed in `content-engine.ts`:**
1. Add a `weekly_production_job` that generates 7 days of content in one run
2. Change the daily production job to a **gap-filler only** — checks if today's slots exist, generates any missing ones (handles the trending override slot + any failures from the weekly batch)
3. Add a `batch_id` column to `content_engine_queue` so each weekly batch can be tracked/audited
4. Add a Telegram notification: "Weekly batch generated: X/84 items queued for [date range]"

**Stale content protection:**
7 days is the max batch window because trend-adjacent hooks (dark psych angles on current events, etc.) lose punch after ~5 days. The niche rotation helps — Monday's "dark psychology" hooks reference timeless manipulation patterns, not last week's news. The 1 PM trending slot handles anything time-sensitive.

**Platform Frequency Overrides (from Posting Guide):**
The weekly batch must respect the IG cap: Instagram (Ace) = 3 slots/day (7 AM, 1 PM, 7 PM), Instagram (CF) = 2 slots/day (10 AM, 4 PM). When generating the weekly batch, IG-excluded time slots should still generate content for all other platforms but skip IG channel IDs.

**BUILD STATUS:** 📋 PLANNED — requires modification to existing `content-engine.ts`. Current daily engine works and should continue running until the weekly batch upgrade is built and tested.

**To deploy:**
1. Push to GitHub main → Railway auto-deploys
2. Watch Railway logs at 11:30 UTC for `[ContentEngine] Daily production firing`
3. Watch every 5 minutes for `[ContentEngine] Distribution sweep posted X piece(s)`
4. Check Supabase `content_engine_queue` table for rows
5. Check Buffer queue at buffer.com for scheduled posts

### Other Coordination Gaps — Future Fix Backlog

**GAP 7: Agent Stasis Detection lacks teeth**
- Daily 2PM stasis check dispatches self-check tasks to all agents. But the check just asks agents to report — no automated consequence if they've produced nothing.
- **Recommendation:** Add a metric: "posts_created_today" per agent. If zero by 2PM, escalate to Architect via Telegram.

**GAP 8: Weekend repost logic doesn't exist**
- Posting guide says Sat/Sun = repeat top performers. No code identifies or reposts top performers.
- **Recommendation:** Vector's 10AM sweep should query `content_transmissions` for highest-engagement posts of the week. On Sat/Sun, the Deterministic Engine should pull from a `repost_queue` table instead of generating new content.

**GAP 9: Comic book asset pipeline has no storage**
- Posting guide describes comic panels as high-value assets. No panels are stored in Supabase Storage or any accessible location.
- **Recommendation:** Ace uploads panels → Supabase Storage `comic-panels` bucket. Yuki references them by URL in posts. Blocked by: Ace hasn't uploaded panels yet.

**GAP 10: Anita's content drafts may be orphaned**
- Section 16 asks "What happened after Anita's content was approved?" — still unanswered.
- Content may be sitting in `content_drafts` table with no mechanism to move it to distribution.
- **Recommendation:** The Deterministic Engine should also check `content_drafts` for Anita-produced content with `status=approved` and include it in the distribution queue.

**GAP 11: Alfred's trend scan output doesn't feed content production**
- Alfred's 8AM scan produces a briefing. It does NOT produce structured content that the Deterministic Engine can consume.
- **Recommendation:** Alfred's scan output should include a `suggested_hooks` array in structured JSON. The daily content production job can optionally consume these instead of generating from scratch.

**GAP 12: No image generation in the posting loop**
- The posting guide assumes image+text posts. The image generator tool exists (`src/tools/image-generator.ts`) but is not integrated into any content production workflow.
- **Recommendation:** The Deterministic Engine's LLM content generation step should also produce an image prompt. A follow-up call to the image generator creates the visual. The image URL is passed to `media_url` in the Buffer post.

---

*This document is the sovereign source of truth. If it doesn't know it, the session doesn't know it. Update it or lose it.*
