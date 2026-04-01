# SOVEREIGN SENTINEL BOT — MASTER REFERENCE
### Last Updated: 2026-04-01 (Pipeline post-mortem fixes deployed: 3 commits today. (1) Agent DM routing fix — telegram→channel on lines 1659/1728. (2) Vid Rush Whisper CLI→API rewrite — eliminates openai-whisper dependency, uses OpenAI Whisper API with verbose_json for timestamps, mp3 compression for 25MB limit. (3) Rate-limit retry — exponential backoff with jitter on 429/529 for all 3 providers (Gemini SDK, OpenAI-compat, Anthropic). (4) Dispatch stagger — 2s delay between agent processing in poller loop to prevent simultaneous LLM hammering. Pipeline needs retest with gold mine video.) | Session Handoff Protocol: UPDATE THIS AFTER EVERY SESSION

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
- **Pinecone:** Semantic vector memory (Tier 2) — **CURRENTLY BROKEN** (see Section 8)
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

**Git write operations (add, commit, push) MUST be executed via Desktop Commander `start_process` with `cmd` shell — NEVER through sandbox Bash.**

Why: The sandbox mounts Windows as Linux FS. It cannot delete `.git/index.lock` files. If git fails mid-way, locks become permanent.

### Pattern:
```
mcp__Desktop_Commander__start_process
  command: "cd C:\Users\richi\Sovereign-Sentinel-Bot && git add <files> && git commit -F commit-msg.txt && del commit-msg.txt && git push origin main"
  shell: "cmd"
  timeout_ms: 30000
```

### Commit Message Workaround:
`cmd.exe` breaks `-m "message with spaces"`. Write message to temp file first:
1. `mcp__Desktop_Commander__write_file` → `C:\Users\richi\Sovereign-Sentinel-Bot\commit-msg.txt`
2. Then: `git commit -F commit-msg.txt && del commit-msg.txt`

### After Push:
Railway auto-deploys from main. No additional deploy step needed.

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

| Agent | Blueprint Size | Last Updated |
|-------|---------------|--------------|
| veritas | 18,003 chars | 2026-03-27 |
| sapphire | 17,088 chars | 2026-03-27 |
| alfred | 16,849 chars | 2026-03-27 |
| yuki | 18,739 chars | 2026-03-27 |
| anita | 17,308 chars | 2026-03-27 |
| vector | 16,830 chars | 2026-03-27 |

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

## 10. THE WEBHOOK BRIDGE (Planned — Not Built)

### The Problem
Right now: **1 agent, 2 windows, different brains.**
- Yuki on Telegram = the REAL Yuki (Railway agent loop with personality, tools, Pinecone memory)
- Yuki on Mission Control = a raw LLM call with no personality, no tools, no memory — a stranger wearing her name tag
- Same applies to ALL agents on the Mission Control dashboard

### The Solution
A webhook bridge that routes Mission Control chat messages to the same Railway agent loop. Both Telegram and dashboard hit the **same brain**.

### Architecture
```
Mission Control (Vercel) → HTTP POST to Railway webhook endpoint
  → Railway receives message, identifies agent
  → Routes to same AgentLoop + persona + tools + memory
  → Returns response to Mission Control via HTTP response or Supabase write
```

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

**Pipeline Status (2026-03-31):**
- Code is FULLY BUILT. `PIPELINE_ROUTES` in index.ts defines the full chain.
- `triggerPipelineHandoffs` auto-chains Alfred → Yuki → Anita → Vector.
- YouTube publishing tool deployed. OAuth tokens obtained 2026-03-31. Awaiting Ace to add env vars to Railway.
- Has NOT been tested end-to-end with live content yet (Phase 3 of execution plan).

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
- 9 Buffer channels configured: TikTok/IG/YT/X/LinkedIn/Threads/Pinterest (Ace Richie) + TikTok/IG (The Containment Field)

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
- 6 image+text posts/day × 2 brands = 12 posts/day = 84/week (LIVE NOW)
- 5 Shorts/day × 2 brands = 70 Shorts/week + 70 companion posts (WHEN YOUTUBE OAUTH IS DONE)
- Combined target: 224 posts/week baseline → 250+ with ad-hoc content
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
- **0/75 synced to Pinecone vectors** (blocked by Pinecone 401 — see Section 8)
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

### Current Problem
Agents feel uncoordinated — doing their own thing or waiting. Need cleaner task flow.

### Desired State
```
Architect sets weekly directive (Veritas Weekly Monday 9AM)
  → Sapphire breaks into daily tasks for each agent
  → Agents execute autonomously via crew_dispatch
  → Results surface in briefings table → Mission Control
  → Architect reviews, approves proposed tasks
  → Task Approval Poller auto-executes approved work
  → Cycle repeats
```

### Immediate Priorities for Agents
1. **Veritas** — Generate meaningful weekly strategic directives. Surface system health.
2. **Sapphire** — Break directives into actionable tasks. Route to correct agents. Monitor completion.
3. **Alfred** — Process YouTube URLs → hooks/scripts. Feed Yuki content.
4. **Yuki** — Produce clips, post to Buffer (images), queue videos for when platform tokens are ready.
5. **Anita** — Create email sequences with conversion purpose. MUST follow Email Brand Standard (Section 15). Wait for `read_nurture_template` + `update_nurture_template` tools before she can push live.
6. **Vector** — Daily metrics sweeps. Revenue tracking. When Stripe key is set, actually pull real data.

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

### PHASE 7 — AGENT COORDINATION & ROLE CLARITY

**The problem Ace identified:** Agents have tools but lack executive clarity. They know the Vid Rush pipeline but not the full scope of their responsibilities. They need individual master references that define not just what they CAN do but what they SHOULD be doing autonomously.

| # | Task | Details |
|---|------|---------|
| 7A | Create individual agent master references | One document per agent: exact responsibilities, tools they own, input/output contracts with other agents, success metrics, autonomy boundaries, escalation rules |
| 7B | Wire strategic cadence | Veritas weekly directive → Sapphire decomposes into daily tasks → agents execute via crew_dispatch → briefings surface to Ace |
| 7C | Pipeline awareness | Agents detect and report broken pipelines instead of silently reverting to chatbot mode |
| 7D | Stasis detection enforcement | Daily sweep at 2PM catches agents that are looping without producing output |

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
| `GROQ_API_KEY` | llama-3.3-70b-versatile | ❌ Not set |
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
6. **Commit via Desktop Commander** (never sandbox git):
   ```
   cd C:\Users\richi\Sovereign-Sentinel-Bot
   git add SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md
   git commit -F commit-msg.txt && del commit-msg.txt
   git push origin main
   ```

### Quick Context Recovery for New Sessions
Read these in order:
1. This file (`SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md`)
2. `CLAUDE.md` (project constitution)
3. Memory files in `.auto-memory/` (indexed by `MEMORY.md`)

---

*This document is the sovereign source of truth. If it doesn't know it, the session doesn't know it. Update it or lose it.*
