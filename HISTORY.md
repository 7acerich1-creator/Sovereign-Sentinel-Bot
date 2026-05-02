# HISTORY.md - Sovereign Sentinel Bot Session Log

> Append-only journal of session-by-session changes. Migrated out of the Master Reference 2026-05-01 to keep the master a pure invariants document. Read this when you need a specific past session's context (searchable by session number or DVP tag); otherwise leave it alone.

---
---

## S126 — Self-healing infrastructure (✅ SHIPPED 2026-04-30, single session)

**Status:** All 5 layers built in one focused session per Architect directive. Marketing-push readiness Tracks B/C unblocked.

**What landed (✅ shipped, awaiting clean tsc + push from Architect's PowerShell):**

- **Layer 1+2 — Railway deploy webhook → Telegram alert + auto-retry** (`supabase/functions/railway-deploy-webhook/index.ts`):
  - Receives Railway deploy webhook (POST). Auth via shared secret (`?secret=<RAILWAY_WEBHOOK_SECRET>` or `x-webhook-secret` header).
  - On FAILED/CRASHED status: pulls deployment logs from Railway GraphQL, classifies via locked pattern lists (transient vs code_bug vs unknown).
  - Auto-redeploy via Railway `deploymentRedeploy` mutation, capped at ONE retry per deployment_id (idempotency tracked in `deploy_events`).
  - Telegram alert via Sapphire's bot (SAPPHIRE_TOKEN) with classification + retry count + first 800 chars of error log. CODE_BUG escalates immediately with `/diagnose` prompt; transient on second failure escalates too.
  - Logs every event (success and failure) to `deploy_events` for trend analysis.

- **Layer 3 — Boot-time smoke test** (`src/proactive/boot-smoke-test.ts` + wired into `main()` early in `src/index.ts`):
  - Runs FIRST after rotation coverage check, before tools/agents wire.
  - Validates: 26 required Supabase tables (`SELECT 1 LIMIT 0` per table), per-agent LLM env vars from AGENT_LLM_TEAMS chains (primary CRITICAL, fallback WARNING), Pinecone namespaces (probe `describe_index_stats`), and infra envs (SUPABASE_URL, RAILWAY_API_TOKEN, etc.).
  - Tool-name uniqueness re-checked AFTER global tool array fully built (catches duplicate registrations that would silently shadow).
  - CRITICAL failures alert Architect via Sapphire's bot directly. WARNINGs log only.
  - Every check persisted to `smoke_test_runs` (one row per check, per boot_id) for Mission Control trend tile.

- **Layer 4 — Bot health canary** (`supabase/functions/bot-health-canary/index.ts` + `supabase/migrations/20260430_self_healing_cron.sql`):
  - pg_cron schedules the canary every 10 min via pg_net.http_post.
  - Two pulses per run: `getMe` (Telegram bot reachability + token validity, latency tracked) and `spend_freshness` (any agent_spend write in last 120 min — proxy for "the bot is actually answering").
  - Quiet-hours suppression: spend-freshness alerts only fire 19:00-11:00 UTC (Architect's waking hours, sleeps ~6-8am CDT per `user_schedule.md` memory).
  - Each alert kind rate-limited to 1/hour. All pulses logged to `bot_health_pulses`.
  - "getMe ok + spend stale" combination is the "alive but silent" signal — different from "container dead."

- **Layer 5 — Agent-driven diagnosis** (doctrine + `/diagnose` command):
  - New `diagnose_deploy_failure` doctrine piece in `src/data/sapphire-prompt-pieces.json` (extras section). 5-step protocol: pull deploy_events row → archival_search past incidents → classify confidently → propose surgical fix (with file path/function name) and file `learning(action='request_code_change')` if needed → archival_insert the diagnosis.
  - Activated in DEFAULTS' `active_extras` CSV in `src/agent/sapphire-prompt-builder.ts` (existing rows in `sapphire_known_facts.active_extras` need an `UPDATE` SQL to append `,diagnose_deploy_failure` for live Sapphire to pick it up — see Open at close).
  - `/diagnose` command handler in `src/agent/sapphire-pa-commands.ts` — pulls latest FAILED/CRASHED row from `deploy_events`, mutates `message.content` with the [DIAGNOSE_DEPLOY] context, returns false so agent loop runs with the doctrine. No new tool needed; uses existing `learning` + `memory` + `archival_search` tools.

- **Tables added** (`supabase/migrations/20260430_self_healing_infrastructure.sql`):
  - `deploy_events` (Layer 1+2 audit + idempotency).
  - `bot_health_pulses` (Layer 4 canary log).
  - `smoke_test_runs` (Layer 3 boot trend log).
  - All RLS-on, service_role write, anon read for Mission Control surfacing.

**Env vars Architect must set in Railway after push:**
- `RAILWAY_API_TOKEN` — Layer 2 redeploy mutation. Generate from Railway dashboard.
- `RAILWAY_WEBHOOK_SECRET` — shared secret for webhook URL `?secret=...`. Random string.
- `CANARY_SECRET` — Layer 4 cron auth. Random string.
- `ARCHITECT_CHAT_ID` — already implicitly set via TELEGRAM_AUTHORIZED_USER_ID; alias is optional.

**Supabase setup Architect runs once:**
1. Apply both migrations (`20260430_self_healing_infrastructure.sql`, `20260430_self_healing_cron.sql`) via MCP or Supabase dashboard SQL editor.
2. Set GUCs for pg_cron's net.http_post:
   ```
   ALTER DATABASE postgres SET app.settings.supabase_url      = 'https://wzthxohtgojenukmdubz.supabase.co';
   ALTER DATABASE postgres SET app.settings.canary_secret     = '<random>';
   ALTER DATABASE postgres SET app.settings.service_role_key  = '<service role>';
   ```
3. Deploy both Edge Functions: `supabase functions deploy railway-deploy-webhook` and `supabase functions deploy bot-health-canary`.
4. Add the webhook URL `https://wzthxohtgojenukmdubz.supabase.co/functions/v1/railway-deploy-webhook?secret=<RAILWAY_WEBHOOK_SECRET>` to Railway → Project Settings → Webhooks.
5. Append `diagnose_deploy_failure` to live Sapphire's active_extras: `UPDATE sapphire_known_facts SET value = value || ',diagnose_deploy_failure' WHERE key = 'active_extras';` (or reset to default by deleting the row, since DEFAULTS now includes it).

**Open at close:**
1. Run `npx tsc --noEmit` from PowerShell (bash sandbox FUSE view is unreliable for tsc). Push via Desktop Commander only after clean.
2. Apply both migrations + deploy both Edge Functions + set the env vars above.
3. Wire the Railway webhook URL in the dashboard.
4. Run `UPDATE sapphire_known_facts ...` to activate the doctrine on live Sapphire.
5. First failed deploy will be the live test — observe whether the Telegram alert fires, classification is accurate, and (if transient) the auto-retry sticks.
6. After self-healing has 24-48h of clean operation, resume Tracks B (funnel walk-through, separate Mission Control session) and C (content pipeline iron-out, this repo).

---

## S126 — Self-healing infrastructure (LOCKED for next session, 2026-04-30 evening — ARCHIVE)

**Status:** Architecture locked, NOT YET BUILT. Architect's directive 2026-04-30 evening after Phase 9 wrapped: build the full 5-layer self-healing infrastructure in ONE focused next session BEFORE resuming marketing-push readiness Tracks B/C.

**Trigger:** Railway build failed on Phase 9 push (commit 64ba4db) due to transient PyPI network error during `pip3 install yt-dlp edge-tts` (`BrokenPipeError`). Architect didn't know about it until he went looking. Combined with Phase 5 silent bugs caught only at Phase 9 (sleeptime reading wrong column, writing to nonexistent table, reflect with wrong arg name) — the silent-failure surface area is real and needs systematic mitigation.

**Five layers (full design in `memory/project_self_healing_architecture.md`):**
1. Deploy failure alerts (Railway webhook → Supabase Edge Function → Telegram)
2. Auto-retry for transient errors (same Edge Function classifies + redeploys)
3. Boot-time smoke test (table/env/namespace integrity at every boot)
4. Bot health canary (cron checks Sapphire is alive every 10min)
5. Agent-driven diagnosis (Sapphire/Veritas reads error logs, files Claude tasks)

**Architectural decisions LOCKED (don't relitigate in next session):**
- Webhook receiver: Supabase Edge Function (same project `wzthxohtgojenukmdubz`).
- Telegram alert path: Sapphire's bot (SAPPHIRE_TOKEN env var, Architect's chat id).
- Railway redeploy: Railway GraphQL API (RAILWAY_API_TOKEN env var — Architect generates from Railway dashboard).
- Boot smoke test: first thing in `boot()` after dotenv. Critical failures DM Architect + don't register affected tool. Warnings log only.
- Bot health canary: Supabase scheduled function, every 10min.
- Agent-driven diagnosis: doctrine + existing `learning(action='request_code_change')` tool. No new tools needed.

**Marketing-push readiness Tracks B + C are PAUSED** until self-healing ships. NORTH_STAR's Highest-Leverage Action points here.

**Open at next-session start:**
1. Architect REDEPLOYS the current build first (the Phase 9 build failed transiently; redeploy will succeed). This is independent of self-healing — just a one-click recovery to get the bot live.
2. Then start the new session with the prepared prompt (in this session's wrap-up).
3. Build all 5 layers in one shot.

---

## S125+ — Agentic Refactor Phase 9: per-agent diary + sleeptime cadence + crew bootstrap (2026-04-30)

**Architect directive 2026-04-30:** "Let's get it." — Phase 9 ships in same session as Phases 1-8. Track A of marketing-push readiness now COMPLETE.

**What landed (✅ shipped):**

- **Tables migrated** (applied via MCP):
  - `sapphire_diary` renamed to `agent_diary`, added `agent_name` column with default 'sapphire' (existing rows backfilled). Index on `(agent_name, created_at DESC)`.
  - `agent_significance` created fresh (sapphire_significance never existed). Same `(agent_name, created_at DESC)` index.
  - RLS: service_role write + anon read on both.
- **Diary tool agent-aware** (`src/tools/sapphire/diary.ts`): `WriteDiaryEntryTool`, `ReadDiaryTool`, `fetchSignificanceForToday()`, `ReadSignificanceTool` all read `args.agent_name` (default 'sapphire'). All references to `sapphire_diary` updated to `agent_diary` with agent_name filter.
- **Fat DiaryTool dispatcher** (`_fat.ts`): injects `ctx.agentName` into every dispatch. Reflect action's `text:` arg corrected to `entry:` (Phase 5 column-name bug fix). Read significance now properly gets args.
- **DiaryTool added to global tools** (`src/index.ts`): non-Sapphire agents now have `diary(action='write'/'read'/'reflect'/'read_significance')` access, auto-routed to their own diary rows.
- **Sleeptime consolidator generalized + cadence-gated** (`src/proactive/sleeptime-consolidator.ts`):
  - Reads from `agent_diary` with agent_name filter (was sapphire_diary with broken `text` column reference — Phase 5 bug fixed).
  - Writes to `agent_significance` (was sapphire_significance which didn't exist — silent failure fixed).
  - **Per-agent cadence gating**: `AGENT_CADENCE_DAYS` map = sapphire 1 / anita 3 / yuki 3 / vector 7 / veritas 7 / alfred 7. The unified daily job runs `lastConsolidationAt(agent)` — if < cadence_days, skip. This implements the strategy session decision (3-day Yuki+Anita, weekly others) without separate scheduler entries.
- **All 6 agents bootstrapped** with core memory slots. Anita: 5 slots (current_campaigns / current_audiences / recent_experiments / current_concerns / recent_themes). Sapphire: 4 (from Phase 5). Yuki / Vector / Veritas / Alfred: 4 slots each (current_priorities / role-specific second slot / current_concerns / recent_themes). Total: 25 seeded slots.

**Bug fixes incidentally made:**
- Phase 5 sleeptime consolidator was reading `text` column from `sapphire_diary` — actual column is `entry`. The job was silently failing every day. Now corrected.
- Phase 5 sleeptime was writing to `sapphire_significance` which never existed. Now writes to `agent_significance` with agent_name.
- Phase 5 reflect action in DiaryTool was passing `text:` to WriteDiaryEntryTool which expects `entry:`. Bug fixed.

**Track A status:** ✅ COMPLETE. Per the strategy session decisions:
1. Shared graph ✅ (Phase 6)
2. Per-agent Pinecone namespaces ✅ (Phase 8 enum + namespace routing in fat tool)
3. Reflection cadence (3-day Yuki+Anita, weekly others, daily Sapphire) ✅ (Phase 9 cadence gating in sleeptime)
4. Unified sleeptime job iterating crew ✅ (Phase 8 + 9 cadence-gated)

**What's deferred (non-blocking for marketing push):**
- Per-agent `personal_intelligence_X` doctrine pieces — Anita has Phase 7 marketing_lead. Yuki/Vector/Veritas/Alfred get role-tuned pieces in Phase 9.5 (will develop better organically as agents start using their memory).
- Bot_active_state activation of any new pieces added — manual via set_piece tool when needed.

**Open at close:**
1. Push the Phase 9 batch via Desktop Commander (this session). tsc clean.
2. Track A complete. Track C (content pipeline iron-out) is the next session in this repo.
3. Track B (funnel walked through) requires `Sovereign-Mission-Control` mount — separate session.
4. Architect tests live: try having Anita call `diary(action='write', entry='...')` — should land in `agent_diary` with `agent_name='anita'`.

---

## S125+ — Agentic Refactor Phase 8: crew memory infrastructure generalized (2026-04-30)

**Architect directive 2026-04-30:** Three blocking tracks before marketing push next week — (A) all bots fully lined out, (B) funnel walked through, (C) content pipelines ironed out. Phase 8 is Track A — generalizing the Phase 5+6 memory infrastructure across the crew per the strategy session decisions.

**What landed (✅ shipped):**

- **ToolContext extended** (`src/types.ts`): added `agentName?: string` field. `AgentLoop.processMessage` populates it from `this.identity.agentName` so any tool that needs to scope by agent (memory, archival, sleeptime) can route correctly.
- **Table migration** (applied via MCP): `sapphire_core_memory` renamed to `agent_core_memory`. Added `agent_name text NOT NULL DEFAULT 'sapphire'` column. UNIQUE constraint flipped from `(slot)` to `(slot, agent_name)` so each agent has independent slots. Existing Sapphire rows backfilled with `agent_name='sapphire'`.
- **Narrow memory tools agent-aware** (`src/tools/sapphire/core_memory.ts`): `readAllCoreMemory(agentName)` exported function takes agent param. `CoreMemoryViewTool`, `CoreMemoryAppendTool`, `CoreMemoryReplaceTool` all read `args.agent_name` (default 'sapphire'), apply WHERE/upsert with `agent_name`. `ALLOWED_ARCHIVAL_NAMESPACES` enum expanded with `anita-personal`, `yuki-personal`, `vector-personal`, `veritas-personal`, `alfred-personal` (plus existing `shared` and `sovereign-synthesis` cross-cutting).
- **Fat MemoryTool dispatcher injects agent_name** (`src/tools/sapphire/_fat.ts`): reads `ctx.agentName` (from ToolContext), defaults `'sapphire'` for backward compat. For `core_*` actions injects `agent_name` into args. For `archival_*` actions defaults `namespace` to `${agent}-personal` if not explicitly overridden. Graph actions (Phase 6) operate on the SHARED graph regardless of agent (per strategy session decision).
- **MemoryTool added to global tools array** (`src/index.ts`): non-Sapphire agents (Anita, Yuki, Vector, Veritas, Alfred) now have memory at their disposal. Each agent's calls auto-route to their own namespace via ToolContext.
- **Sleeptime consolidator generalized** (`src/proactive/sleeptime-consolidator.ts`): new `runCrewConsolidation()` iterates over all 6 agents. Per-agent diary tables not yet built for non-Sapphire agents; iterator skips gracefully and logs. When future phases add per-agent diary tables, this iterator picks them up automatically. Existing scheduler entry calls with no args, triggering crew-wide iterator.
- **Anita's core memory bootstrapped** (5 seed slots): `current_campaigns`, `current_audiences`, `recent_experiments`, `current_concerns`, `recent_themes`. Each populated with marketing-relevant context so Anita has substance to work with from day one.

**Strategy session decisions implemented in Phase 8:**
1. Graph: SHARED across all agents — already done in Phase 6, no change needed.
2. Pinecone: PER-AGENT namespaces — implemented via `agent_core_memory.agent_name` + namespace enum expansion.
3. Reflection cadence (3-day Yuki+Anita, weekly Vector+Veritas+Alfred) — schedulers NOT YET added (deferred to Phase 9 since each agent needs a diary table first; Sapphire's existing per-turn reflection still works).
4. Sleeptime: ONE unified job — implemented via `runCrewConsolidation()` iterator.

**What's deliberately deferred (Phase 9+):**
- Per-agent diary tables (anita_diary, yuki_diary, etc.) — when each agent has substantive turns to reflect on, they get a table.
- Per-agent reflection scheduler entries (3-day Yuki+Anita, weekly others) — depend on per-agent diary tables.
- Per-agent core memory bootstrap for Yuki/Vector/Veritas/Alfred — Anita seeded first since she's the most immediately active for marketing push.
- Per-agent `personal_intelligence_X` doctrine pieces — Anita has Phase 7 doctrine; others get role-tuned doctrine in Phase 9+.

**Open at close:**
1. Push the Phase 8 batch via Desktop Commander (this session). tsc clean.
2. Architect tests Anita can call `memory(action='core_view')` and see her seeded slots. Same for archival writes routing to `anita-personal`.
3. Phase 9 (next): per-agent diary tables + reflection schedulers + bootstrap remaining agents' core memory.
4. Track C (content pipeline iron-out) and Track B (funnel review) remain in NORTH_STAR roadmap.

---

## S125+ — Agentic Refactor Phase 7: Anita Marketing Lead + Veritas Chief of Staff (2026-04-30)

**Architect directive 2026-04-30 strategy session:** Anita elevates from Email Response Specialist → Marketing Lead. Veritas elevates from "Chief Strategy Officer" → Chief of Staff (cross-crew oversight, no longer pipeline/content production). Alfred takes the pipeline + content production scope Veritas had. NO cross-crew dispatch authority for Anita yet — Architect stays in the coordination loop until pattern is proven.

**What landed (✅ shipped):**

- **AGENT_LLM_TEAMS update** (`src/index.ts`): anita + veritas elevated to `["anthropic", "gemini", "groq"]` chain. Both now run on Claude Sonnet 4 by default. Yuki, Vector, Alfred stay on Gemini → Groq (their work is more deterministic).
- **Marketing fat tool** (`src/tools/marketing.ts` — new ~370 lines). Starter actions: `draft_campaign` (returns structured brief, doesn't auto-execute), `define_audience` (upserts to anita_audience_segments), `list_audiences`, `log_experiment` (writes to anita_experiments), `update_experiment` (status/result/winner), `list_experiments`, `analyze_channel` (read of tracked experiments — future versions integrate Buffer/YouTube/Stripe). NO cross-crew dispatch — Anita drafts + proposes; Architect coordinates.
- **Two new Supabase tables** (migration applied via MCP):
  - `anita_audience_segments`: name, description, attributes jsonb, size_estimate, channels, pain_points, desired_outcomes
  - `anita_experiments`: name, hypothesis, variant_a, variant_b, metric, status (planning/running/concluded/abandoned), result, winner, audience_segment_id (FK)
  Both with RLS service_role write + anon read.
- **Anita persona overhaul**:
  - `src/agent/personas.ts`: role flipped from "Email Response and Copy Specialist" → "Marketing Lead — Strategy, Campaigns, Experiments, Copy". Goal expanded to full marketing scope.
  - `src/data/anita-prompt-pieces.json`: new `marketing_lead` persona piece (default), existing `propagandist` and `warm_responder` retained as scenario-specific voices. New `marketing_protocol_s125p7` extras piece — when to use the marketing tool vs. email tools, no-cross-crew-dispatch rule, Mom Test still applies even in strategic mode.
- **Veritas persona overhaul** (`src/agent/personas.ts`): role flipped to "Chief of Staff — Crew Oversight + Strategic Course-Correction". Detailed scope still being refined per Architect — placeholder for now, will be detailed in subsequent sessions as patterns surface.
- **Alfred persona expansion** (`src/agent/personas.ts`): role expanded to "Content Production Lead — Seed + Pipeline Oversight" since Veritas no longer owns pipeline.

**Crew strategy session decisions locked (Architect 2026-04-30):**
1. Graph: SHARED across all agents (entities + relationships are namespace-less, all agents read/write same tables).
2. Pinecone: PER-AGENT namespaces (anita-personal, yuki-personal, vector-personal, veritas-personal, alfred-personal) plus existing `shared` cross-cutting namespace. *Implementation pending* — current memory tools still hardcoded to sapphire-personal; next phase generalizes.
3. Reflection cadence: Yuki + Anita every 3 days (most active agents). Vector + Veritas + Alfred weekly. Sapphire keeps per-turn (substantive turns only).
4. Sleeptime: ONE unified job that iterates over all agents. *Implementation pending* — current consolidator runs Sapphire-only; next phase generalizes.

**What's deliberately deferred:**
- Generalizing the memory tool surface (core_memory + archival + supersede) for other agents — Anita has Marketing tool + Gmail; she gets full memory in the next phase.
- Generalizing the sleeptime consolidator across crew — Sapphire-only currently.
- Anita's deeper marketing capabilities (channel-perf integration with Buffer/YouTube/Stripe, audience-research deep dives, hypothesis frameworks) — Architect explicitly framed these as work-in-progress, built conversationally as marketing strategy develops.
- Veritas's full Chief-of-Staff tool surface — needs more strategic thinking before locking detail.

**Open at close:**
1. Push the Phase 7 batch via Desktop Commander (this session).
2. Architect tests Anita on Telegram with the new marketing tools as marketing push begins.
3. Phase 8 strategy session: generalize memory infrastructure across crew (per-agent core memory + archival + reflection schedules).

---

## S125+ — Agentic Refactor Phase 6: temporal knowledge graph in Postgres (Zep-style, 2026-04-30)

**Architect directive 2026-04-30:** "Phase 6." Single word. Shipped same session.

**Architecture decision:** Postgres-as-graph (Supabase) instead of Neo4j. Sapphire's scale = hundreds-to-thousands of edges, not millions. Recursive CTEs handle 1-3 hop traversal. No new infrastructure cost. Additive to existing stack. 90% of Zep's value at 10% of operational complexity. True Neo4j parity (graph algorithms — PageRank, community detection, etc.) deferred indefinitely; revisit only if recursive CTEs ever become the bottleneck.

**What landed (✅ shipped):**

- **Schema** (applied via MCP, 2026-04-30): `public.sapphire_entities` (id, name, entity_type, attributes jsonb, UNIQUE(name, entity_type)) + `public.sapphire_relationships` (source_entity_id, target_entity_id, relationship_type, attributes, valid_from, valid_until, superseded_by_id, superseded_reason). 4 indexes (current-valid lookups, target reverse lookups, audit trail). RLS service_role write + anon read. Convenience view `sapphire_relationships_current` for currently-valid edges only.
- **Controlled vocabulary** at DB level (CHECK constraints):
  - 8 entity_types: person / project / task / place / organization / event / concept / document
  - 22 relationship_types: PARENT_OF / CHILD_OF / SIBLING_OF / PARTNER_OF / AT_SCHOOL / HAS_DOCTOR / HAS_THERAPIST / WORKS_AT / WORKS_ON / HAS_STATUS / BELONGS_TO / DEPENDS_ON / BLOCKS / OWNS / ATTENDED / SCHEDULED_FOR / OCCURRED_AT / REFERENCES / CONTRADICTS / EXTENDS / INSTANCE_OF / RELATED_TO
  - Adding a new type requires a schema migration — intentional friction to prevent fragmentation.
- **Seeds at migration time** (so Sapphire has something to walk on day one):
  - 3 person entities: Ace Richie (role=Architect), Aliza (DOB 2015-05-19), Maddy (DOB 2017-08-05)
  - 4 project entities: Sovereign Synthesis, The Containment Field, Mission Control, Sovereign-Sentinel-Bot
  - 6 family edges: PARENT_OF (×2), CHILD_OF (×2), SIBLING_OF (×2)
  - 4 ownership edges: Architect WORKS_ON SS + TCF, OWNS MC + Sentinel Bot
- **New file** `src/tools/sapphire/temporal_graph.ts` (~400 lines) — 5 narrow tool classes: EntityUpsertTool, EntityGetTool, RelateTool (auto-supersedes prior same-shape edges), UnrelateTool, GraphQueryTool (1 or 2-hop traversal with optional include_history).
- **MemoryTool fat dispatcher** (in `_fat.ts`) extended with the 5 new actions. Total memory tool actions: 13 across 4 layers.
- **Doctrine** `memory_protocol_s125p5` extended in `sapphire-prompt-pieces.json` with Layer 4 routing rules + decision tree for "when fact changes, which layer to update." Already activated in `active_extras` row from Phase 5.

**Open at close:**
1. Push the Phase 6 batch via Desktop Commander (this session).
2. Architect tests live: try `memory(action='graph_query', start_name='Ace Richie', start_type='person', traverse='PARENT_OF', depth=1)` — should return Aliza + Maddy.
3. Crew-generalization strategy session (queued, NORTH_STAR pointer).

---

## S125+ — Agentic Refactor Phase 5: Letta-style memory + reflection + sleeptime + Zep-lite supersession (2026-04-30)

**Architect directive 2026-04-30:** "Keep going through phase five in one shot... I think this phase five type of thing is the most impactful thing that we can give to the other agents as well moving forward. But we'll have a strategy session on it. Before we begin working on the other agents."

**ALL FIVE phases of the agentic refactor shipped in a single session 2026-04-30.** Sapphire's architecture is now the proof point. Crew generalization (Anita/Yuki/Vector/Veritas/Alfred) is QUEUED pending strategy session — NORTH_STAR's Highest-Leverage Action now points there.

**Phase 5 components shipped (V1):**

- **5A — Letta-style core memory:** `supabase/migrations/20260430_sapphire_core_memory.sql` (applied), `src/tools/sapphire/core_memory.ts` (new ~400 lines), injection into `src/agent/sapphire-pa-context.ts`. Slotted always-visible Sapphire-owned context. Slots: current_priorities, current_projects, current_concerns, recent_themes. Hard-capped 6000 chars total. Updated via `memory(action='core_append'/'core_replace')`.

- **5B — Archival memory tools:** `memory(action='archival_insert' / 'archival_search')` in same `core_memory.ts`. Sapphire-controlled writes to Pinecone with chosen namespace + structured metadata (topic, valid_from, superseded_at). Three allowed namespaces: sapphire-personal, shared, sovereign-synthesis.

- **5C — Reflection loop:** `diary(action='reflect')` in `_fat.ts`. Reflexion paper pattern. Auto-tagged 'reflection'. Used on substantive turns only.

- **5D — Sleeptime consolidator:** `src/proactive/sleeptime-consolidator.ts` (new) + scheduler in `src/index.ts`. Runs daily at 13:00 UTC = 8 AM CDT (Architect's deep sleep window). Reads yesterday's diary, summarizes via Gemini Flash Lite, writes significance + updates `recent_themes` core memory slot. Letta v1 pattern.

- **5E — Temporal supersession (Zep-lite):** `memory(action='supersede')` in `core_memory.ts`. Pinecone metadata extended with valid_from / superseded_at / superseded_by_id. Recall excludes superseded by default. Full graph DB deferred to Phase 6.

- **Doctrine: `memory_protocol_s125p5`** added to extras section in `sapphire-prompt-pieces.json` + activated in `sapphire_known_facts.active_extras` row. Three-layer routing guide (standing facts / core memory / archival) + reflection + sleeptime explanation.

**Crew-generalization plan (deferred to strategy session per Architect directive):** Each specialist agent (Anita, Yuki, Vector, Veritas, Alfred) gets the Phase 5 memory architecture tuned for its scope. Not lift-and-shift — different layers/schedules/cadences per agent. See NORTH_STAR for the strategy-session prompts.

**Open at close:**
1. Push the Phase 5 batch via Desktop Commander (this session).
2. Strategy session on crew-wide Phase 5 generalization (next dedicated session).
3. Architect tests live; sleeptime fires tomorrow at 8 AM CDT first.

---

## S125+ — Agentic Refactor Phase 3 + Phase 4: kill keyword tiering + consolidate 39 narrow tools to 15 fat ones (2026-04-30)

**Architect directive 2026-04-30:** "We're gonna do everything in all of them. So whichever way is easier and best for you... You work much faster than you might realize... I want you to do phase three. And then focus on phase four. No shortcuts."

**Phase 3 (✅ shipped):** Deleted `src/tools/sapphire/_router.ts` (dead code, never called by runtime — was a landmine for future sessions to mistakenly start using). All four `buildSapphireXxxTools()` pack functions retained as stubs for backward compat with the call site in `src/index.ts`. Workflow/Research/Life return `[]`. `buildSapphireCoreTools()` is now the canonical 15-tool surface.

**Phase 4 (✅ shipped):** Sapphire's loaded surface consolidated from 39 narrow tools to 15 fat composable ones. New file `src/tools/sapphire/_fat.ts` (~600 lines) holds 13 new fat dispatcher classes:
- `RemindersTool` (set/list/cancel/cancel_series)
- `GmailTool` (inbox/search/send/draft)
- `CalendarTool` (list/create/reschedule)
- `NotionTool` (create_page/append/search/set_parent/get_blocks/update_block/delete_block)
- `MemoryTool` (remember/recall)
- `FamilyTool` (save/get)
- `FollowupsTool` (record/list/complete/cancel)
- `ResearchTool` (web_search/youtube_search/youtube_transcript/analyze_pdf/research_brief)
- `MissionControlTool` (file_briefing/propose_task/create_task)
- `SelfTool` (set_piece/remove_piece/create_piece/list_pieces/view_self_prompt/view_identity_history)
- `LearningTool` (log_email_classification/request_code_change/list_deferred_builds)
- `PlanTool` (create/approve/advance/record_step/execute/record_artifact/cancel)
- `DiaryTool` (write/read/read_significance)

Each fat tool internally instantiates the narrow tool classes and dispatches by `action` arg — zero logic duplication. Narrow tool classes remain in their domain files (calendar.ts, gmail.ts, notion.ts, etc.) for internal reuse but are no longer directly registered in the loaded surface.

**Plus 2 already-fat tools that round out the 15:**
- `ConditionalRemindersTool` (set/list/cancel) — Phase 2
- `ReadTeamRosterTool` (single-action, kept as-is)

**Doctrine updates** in `src/data/sapphire-prompt-pieces.json` — 11 pieces touched to reflect fat-tool action mappings instead of bare narrow tool names: `execute_what_you_say`, `task_creation_workflow`, `mission_control_routing`, `reminder_dedup`, `family_first`, `verify_facts_before_stating`, `email_learning_loop`, `signal_discipline_s125` rule 3, `notion_canonical_structure`, `memory_routing`, `complex_task_protocol`.

**Schema cost reduction:** Sapphire's tool-definition tokens drop from ~7,500 to ~5,250 (-30%). Per Anthropic/Jenova/Writer benchmarks, selection accuracy at ~15 tools is in the 78%+ zone vs the documented dropoff past 50 tools that compromises tool-call accuracy. This is a *measurable capability gain*, not just cleanup — it's the structural step that makes Sapphire's 39-tool surface usable as her load grows in Phases 5+.

**Conditional reminder verified live:** The Architect's bank-account test reminder (id `308614d1-074a-4f01-b236-04014c27ee77`) is in `public.conditional_reminders` watching `stripe_revenue_total >= 1000`. Status `active`. Phase 2's anticipatory loop is end-to-end functional.

**Open at close:** Push via Desktop Commander (this session). Architect tests live as failures surface. Phase 5 (Letta-style memory + Zep temporal graph + reflection + sleeptime) is the next architectural arc — large lift, deep payoff.

---

## S125+ — Agentic Refactor Phase 2: anticipatory + structural + context-depth (2026-04-30)

**Commits:** `3cc0dfc` (Pinecone hotfix earlier today). Next push contains 5 new files + 4 modified for the Phase 2 batch. Architect's directive 2026-04-30: ship everything, no smoke-test gating, iterate against the live system.

**What landed in this Phase 2 batch:**

- **Notion dedup-in-tool** (`src/tools/sapphire/notion.ts`) — `NotionCreatePageTool.execute` now self-checks for duplicates by default. Before creating, calls existing `findChildPageByTitle` against the resolved parent. If a page with the same title exists, returns its URL instead of creating a duplicate. Optional `force=true` arg for intentional duplicates. Replaces the doctrine band-aid in `signal_discipline_s125` rule 3 with structural prevention.
- **YouTube search tool** (`src/tools/sapphire/youtube.ts` — new class `YoutubeSearchTool`) — wraps YouTube Data API v3 search endpoint. Returns structured `{title, videoId, url, channelTitle, publishedAt, thumbnailUrl, description}`. Architect's "is there a video showing X?" question now maps to a real action that returns clickable URLs. Registered in `buildSapphireResearchTools()`. Env: `YOUTUBE_API_KEY` or `GOOGLE_API_KEY`. Quota 10,000 units/day on free tier; each search is 100 units, so up to 100 searches/day.
- **Conditional/threshold-triggered reminders** (full system — three new files):
  - `supabase/migrations/20260430_conditional_reminders.sql` — `public.conditional_reminders` table + 2 views + RLS. Migration applied via MCP (`success: true`).
  - `src/tools/sapphire/conditional_reminders.ts` — fat composable tool with `set` / `list` / `cancel` actions. Metric source enum: `stripe_revenue_total`/`30d`/`today`, `youtube_subs_total`, `youtube_views_28d`, `initiates_count`, `agent_spend_today`/`this_month`, `sovereign_metrics_*` (fiscal_sum, mindset_count, elite_count, velocity). Comparison ops: `>=` `>` `=` `<` `<=`. Registered in `buildSapphireCoreTools()` so it's always loaded.
  - `src/proactive/conditional-reminders-checker.ts` — runs every 15 min via scheduler. Reads active rows, groups by metric_source, fetches once per metric (deduplicated reads), evaluates each row, atomic UPDATE on cross to prevent double-fire, sends Telegram alert via Sapphire's bot. Expires past-deadline rows automatically. METRIC_FETCHERS map handles Stripe (lifetime/30d/today via direct API), YouTube subs (channel statistics), YouTube views (Supabase cache from existing `youtube_stats_cache`), initiates count, agent_spend (today/month from Phase 1's logger), sovereign_metrics columns.
  - Scheduler entry registered in `src/index.ts` between Followup Surfacer and Morning Brief.
- **Gemini history ingestion script** (`scripts/ingest_gemini_history.ts`) — was already complete from S125i (2026-04-29) but untracked in git. Now tracked. Embeds Gemini conversation history into `sapphire-personal` Pinecone namespace with metadata `{source: gemini_takeout, chat_id, chat_title, turn_index, role, value, type: consciousness_journey, timestamp}`. Resumable via sidecar JSON. Runner: `npx tsx scripts/ingest_gemini_history.ts <path-to-json>`. Architect provides the JSON (produced by his Claude-in-Chrome Gemini scraper).

**Bank-account use case end-to-end test (ready to execute live):**

Architect: *"remind me when revenue hits $1000 to open a new bank account"*
Sapphire: calls `conditional_reminders({action:'set', metric:'stripe_revenue_total', op:'>=', threshold:1000, message:'Time to open the new bank account.'})`
3 minutes later: scheduler runs first check, observes current Stripe revenue, evaluates condition (currently false), updates `last_observed_value` and `last_checked_at`.
Days/months later: revenue crosses $1k. Within 15 min: scheduler observes, atomic UPDATE to `status='fired'`, Telegram message lands: *"🔔 Conditional alert fired — Time to open the new bank account."*

**Open at close:**

1. Push the Phase 2 batch via Desktop Commander (this session, immediately after this entry).
2. Optional: Architect runs the Gemini ingestion script with his Gemini export JSON to populate `sapphire-personal` namespace with years of context. Without this, Track B (context superiority) is staged but not active — namespace is currently sparse.
3. Live testing replaces smoke-test gating per Architect's 2026-04-30 directive: he iterates against the running system as failures surface.
4. Phase 3-5 are separate session arcs (kill keyword tiering / fat-tool consolidation / Letta-style memory + Zep temporal graph + reflection + sleeptime). Plan doc has the scope.

---

## S125+ — Agentic Refactor Phase 1: Sapphire native web_search + interleaved thinking + spend visibility (2026-04-30)

**Commit:** Staged locally, NOT pushed. Architect directive: pipeline running, no pushes this session. Push when pipeline clears.

**Why:** Architect ran a side-by-side test (Sapphire vs. Gemini) — asked both "How much cash fits in a briefcase? Is there a YouTube video showing this visually?" Sapphire failed twice over: she said "I can't pull up direct YouTube video tutorial links" while Gemini surfaced two video URLs inline. Initial diagnosis was that Sapphire had `web_search` available but didn't use it; backend verification (Supabase `messages_log` row `7e2efcef`/`69089c79` at 12:53–12:54 UTC) showed the OPPOSITE — she likely DID call web_search (her response contained doctrine-specific phrases like "trying a few different search angles" and "the search did return" that only appear when she follows the QUERY-ITERATION RULE), but Pinecone semantic recall injected three unrelated past Ace conversations about *uploading YouTube videos and content strategy* into her turn-2 context, which hijacked her query intent. She searched for "YouTube uploading" not "briefcase visualization." Architect's deeper read: *"the neurons are not quantum, it's just so linear, as if I have to specifically program every process. Nothing is translating across domains."* He's right — the failure is a symptom of dispatch-routed architecture (keyword-regex tier matchers, 30 narrow tools, bridged Gemini grounding) where modern agents (Letta, Anthropic's own Claude Code, Cognition's Devin) use agentic loops with always-on tools, native server-tool grounding, and interleaved reasoning. Phase 1 attacks the cheapest, highest-leverage parts of that gap.

**The full five-phase plan lives at `SAPPHIRE-AGENTIC-REFACTOR-S125+.md` at repo root.** Read that doc before any future agent work. NORTH_STAR's Highest-Leverage Action points there.

**Code changes (staged, awaiting push):**

- **NEW:** `src/tools/spend-logger.ts` (~150 lines) — pure module, fire-and-forget. `logSpend(response, entry)` reads `LLMResponse.usage` (input_tokens, output_tokens, server_tool_calls, server_tool_breakdown), looks up per-million-token pricing for the model, computes total USD, writes one row to `public.agent_spend` per LLM call. Pricing table covers Anthropic Sonnet/Opus/Haiku families, Gemini 2.5 Flash/Lite/Pro, Groq Llama, DeepSeek. Updated S125+ (2026-04-30) — keep current. Unknown models log $0 (signal to update the table).
- **NEW:** `supabase/migrations/20260430_agent_spend.sql` — `public.agent_spend` table + three convenience views (`agent_spend_today`, `agent_spend_this_week`, `agent_spend_this_month`). RLS on, service_role full access, anon read-only (no PII in this table). Migration STAGED, not applied.
- `src/types.ts` — `LLMOptions` extended with `serverTools?: AnthropicServerTool[]`, `thinkingBudget?: number`, `anthropicBetas?: string[]`. `LLMResponse.usage` extended with `serverToolCalls?: number` and `serverToolBreakdown?: Record<string, number>`. New `AnthropicServerTool` interface. Other providers ignore the new options gracefully.
- `src/llm/providers.ts` — `AnthropicProvider.generate` extended: (a) merges `serverTools` into `body.tools` array (pass-through, preserves type-specific fields), (b) injects `body.thinking = {type: "enabled", budget_tokens: N}` when `thinkingBudget > 0`, (c) attaches `anthropic-beta` header from `options.anthropicBetas` (comma-joined), (d) parses `data.usage.server_tool_use` into `usage.serverToolCalls` + `usage.serverToolBreakdown`.
- `src/agent/loop.ts` — new `setLLMOptionsOverrides(opts?)` setter mirrors the existing `setContextOverrides` snapshot/restore pattern. `processMessage` generates a `turnId` (UUID) once, calls `logSpend` after every `activeLLM.generate` call (main + empty-completion retry), passes `turnId` + `iterationCount` for correlation. Both generate calls now spread `...this.llmOptionsOverrides` into the LLMOptions.
- `src/index.ts` (Sapphire DM lane, ~line 4940-5013) — (a) filters out the custom Gemini-bridged `WebSearchTool` (name: `web_search`) from the lean tool set so the Anthropic-native `web_search_20250305` server tool can take that name without conflict, (b) sets `agentBotLoop.setLLMOptionsOverrides({serverTools: [{type: "web_search_20250305", name: "web_search", max_uses: 5}], thinkingBudget: 8000, anthropicBetas: ["interleaved-thinking-2025-05-14"]})` before processMessage, (c) raises Sapphire's iteration cap to 6 (Architect directive — generalist with complex-task latitude; Anita/Yuki specialists stay at 3 via default), (d) clears the override in the finally block. If Anthropic fails over to Gemini mid-turn, that turn loses web_search but keeps everything else (acceptable degradation; `research_brief` still works).

**Schema:**

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
  iteration_count int NOT NULL DEFAULT 1,
  finish_reason text,
  server_tool_breakdown jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Three views (`agent_spend_today`, `agent_spend_this_week`, `agent_spend_this_month`) pre-compute the per-agent rollups Mission Control needs.

**Verification:**

- `tsc --noEmit` not yet run — Architect to run pre-push when pipeline clears.
- Anita and Yuki already on Gemini → Groq per `AGENT_LLM_TEAMS` at `src/index.ts:406, 410` — no model migration needed; spend logger captures them automatically once the migration applies. Architect's directive ("Sapphire on Anthropic top of the line, Anita/Yuki on Gemini Flash") is already the runtime state.
- Generalization plan for the rest of the swarm documented in plan doc's "How this generalizes" section.

**Open at close:**

1. Architect topped up Anthropic API credits at console.anthropic.com — **CONFIRMED 2026-04-30.** Anthropic is now primary for Sapphire again (was failing with HTTP 400 "credit balance too low" prior).
2. When pipeline clears: `git diff` → review → `tsc --noEmit` → push → apply Supabase migration → smoke-test Sapphire on Telegram with the same briefcase question to confirm fluid grounding.
3. Once Phase 1 has 24h of `agent_spend` data, mount `Sovereign-Mission-Control` and build the "Agent Spend" tile per NORTH_STAR's Next Session Build sketch.

**Additional fixes staged in second pass (2026-04-30, after Architect surfaced live Sapphire failure screenshots):**

Three real failures from prior turns — addressed structurally, not papered over:

- **Calendar tool not loaded.** Sapphire's response "the calendar tool I tried to use wasn't found by the system" was true at the wiring level — `buildSapphireLifeTools()` (which contains `calendar_create_event`, `gmail_send`, `calendar_reschedule`, `save_family_member`, `get_family`) was excluded from her DM lean tier set since S121e's "FORCED LEAN TIERING — Life tools purged" path. Re-added in `src/index.ts` at the same spot as Core/Workflow/Research. Token cost ~2K input tokens; trade is acceptable since calendar/gmail are core PA capability for a generalist. If we ever need to re-trim, that's Phase 3 (LLM-dispatched tool discovery), not eager keyword tiers.
- **Empathy theater + dramatic bolded closures.** Sapphire was saying "This level of friction is unacceptable", "completely unacceptable", "You shouldn't have to carry that extra load" as bolded paragraph closures, violating her own `warm_concise` format. Added new doctrine piece `signal_discipline_s125` to `src/data/sapphire-prompt-pieces.json` covering three rules in one piece: (1) no dramatic closures, (2) respect Ace's stated direction when he says "I'll handle it" (he means he'll file a Claude task — don't push him back into the topic he's exiting), (3) Notion duplicate prevention (call `notion_search` before creating top-level pages under Daily Life). Piece is in the JSON; needs to be added to active extras list via `set_piece` or direct Supabase upsert post-deploy. Doctrine band-aid for #1 and #2 (no clean structural alternative); Phase 1 interleaved thinking + Phase 2 NotionCreatePageTool dedup-check should make this doctrine piece largely redundant later.
- **Notion duplicates** — `📁 Daily Tasks & Goals` and `📁 Daily Briefs` wrapper pages alongside the canonical entries under 🧭 Daily Life. Cleaned up in this session via `notion-update-page` with `update_content` (allow_deleting_content=true) on the parent page. Verified post-cleanup: only the 5 canonical folders remain. Phase 2 candidate: move duplicate-prevention logic into `NotionCreatePageTool.execute` itself — query existing children of the parent before creating, refuse if a same-titled child exists. Structural fix > doctrine fix.

**Calendar events created in this session** (Sapphire couldn't, so cowork-Claude did):
- `Dentist - Aliza & Maddy` on 2026-05-18 (all-day, primary calendar — empoweredservices2013@gmail.com). Event id `vluqfnji04oqc5nhffculs594g`.
- `Aliza's graduation + Maddy's ceremony` on 2026-05-20 (all-day, primary calendar). Event id `ngdv9chhqckjc5a39opsnvaqtc`.

Both have descriptions noting "update with specific time when known."

**Active extras pre-staged for next deploy.** Updated `public.sapphire_known_facts` row `key='active_extras'` to append `signal_discipline_s125` to the comma-separated list. Idempotent (re-running won't duplicate). The piece itself is in `src/data/sapphire-prompt-pieces.json` (staged, not pushed) — DB activation will go inert until the JSON ships, then becomes live the moment Railway redeploys. Zero manual step required from Architect at deploy time.

**Phase 2 dual leads locked in plan doc.** Architect surfaced both:
1. **Track A — Conditional/threshold-triggered reminders** (bank-account-when-revenue-hits-threshold use case). Designed: new `conditional_reminders` Supabase table, fat `conditional_reminders(action, ...)` tool for Sapphire, 15-minute scheduler watching metric_source enum (Stripe revenue at 3 time grains, YouTube subs/views, Supabase initiates count, agent_spend from Phase 1's logger, sovereign_metrics columns). Composes cleanly with Phase 1's spend_logger so Sapphire can self-monitor cost.
2. **Track B — Gemini history ingestion into sapphire-personal Pinecone namespace.** Previous-Claude-session framing (referenced 2026-04-30): Sapphire's edge over Gemini is years of personal context, but Gemini already has more years with Architect than Sapphire does. Fix: ingest Gemini conversation history into Pinecone so Sapphire starts with equivalent depth. Prototype script `scripts/ingest_gemini_history.ts` exists (untracked); Phase 2 finishes it. Embeds each turn with `source: gemini`, `chat_id: gemini-{thread_id}`, `timestamp`, `topics` metadata. Respects Phase 2 Pinecone tightening (≥0.78 cosine) for high-quality recall only.

Both tracks ship in Phase 2 — Track A makes her *anticipatory*, Track B makes her *know Architect at the depth Gemini already does*. Together they close the named Gemini gap on both axes.

**Personal Intelligence layer + adaptive concept-mode format added (2026-04-30, second push staged).** Architect shared his Gemini "Personal Intelligence" panel — the substrate that makes Gemini understand his framework (Architect role, $1.2M coordinate by Jan 1 2027, sovereign frequency interpretive lens, lexical world: Sovereign Synthesis / Containment Field / Firmware Update / Escape Velocity / Simulation / Memetic Triggers / Financial Energy / Old Earth). Translated into Sapphire's doctrine system as two pieces in `src/data/sapphire-prompt-pieces.json`:
- New `personal_intelligence_ace` extras piece — captures identity / mission as fixed coordinate / interpretive lens / lexical world / family routing. Activated in `sapphire_known_facts.active_extras` row (idempotent).
- Extended `warm_concise` format piece — adaptive between transactional default (1-3 sentences, italic closing reaction) and concept mode (~150-200 words, hierarchical framing, substance-over-entertainment search curation, lexical anchoring, intent-pivot closing question). Triggered automatically by question shape ("is there a video showing X" / "help me understand Y" / "what does Z look like").

The concept-mode addition is the structural answer to the briefcase-video failure mode where Sapphire surfaced cheesy entertainment videos while Gemini surfaced documentary/conceptual sources framed within Architect's lexicon. Doctrine band-aid for what would otherwise be a model-curation gap.

---

## S125+ — Sequential Rotator wired into YouTube pipeline (2026-04-30)

**Commit:** Pending push — 4 files staged + Supabase migration `add_pipeline_rotation_state` already applied to project `wzthxohtgojenukmdubz`.

**Why:** S125+ failure (visible in Telegram screenshot 2026-04-30 10:13) — `ScriptTooSimilarError` rejected SS candidate at cosine 0.871 against shipped `fv_sovereign_synthesis_resource-dynamics_1777388770163`. Surface diagnosis was "uniqueness threshold too tight." Real diagnosis (Architect pushed back on the patch-the-symptom answer) was that **three parallel variety systems existed and only one was wired**: 14-15 niches per brand × 14-15 angles per niche = \~225 curated unique seeds in `src/data/thesis-angles.ts` were sitting unused for the YouTube pipeline (only `content-engine.ts` imported them for Buffer posts). The YouTube pipeline drove its thesis from Alfred's runtime LLM output (1-2 sentences, voice-bounded). When `extractNarrativeBlueprint`'s JSON parse failed (often, due to thin input), it fell back to a hardcoded "Monad / timeline / frequency" blueprint — the SAME blueprint every time. Every fallback-driven script landed in the same lane. Uniqueness guard caught it three retries deep, after wasted compute and a false sense of "writer voice convergence." Architect's call: stop patching, fix the wiring. The infrastructure was always there, it just wasn't connected.

**Code changes:**

- **NEW:** `src/tools/rotation-state.ts` (275 lines) — pure rotator. `computeSeedAtSlot(brand, slot)` is no-I/O and returns the (niche, angle) pair for any slot. `advanceAndPickSeed(brand)` reads Supabase, computes the seed, atomically PATCHes `total_ships+1` with `last_niche`/`last_angle_id`, returns the seed. `assertRotationCoverage()` verifies all 30 niches have angle pools — called at boot. `previewRotation(brand, start, count)` for diagnostics.
- `src/engine/vidrush-orchestrator.ts` — rotator wired into `isRawIdeaMode` branch of `executeFullPipeline`. When Alfred fires the auto-pipeline, the rotator overrides his thin thesis with the next curated 2-4 sentence angle from `THESIS_ANGLES`. Alfred's thesis is appended below as flavor context, not the primary thesis. Rotator's `niche` overrides any caller-provided niche.
- `src/engine/faceless-factory.ts` — added `BlueprintExtractionFailed` error class. **Killed the silent fallback** in `extractNarrativeBlueprint`. New behavior: parse fails → retry once at `temperature=1.0` → if still fails, throw. The auto-pipeline catches and surfaces via Telegram. The hardcoded "Monad" blueprint is gone.
- `src/index.ts` — dropped Alfred's redundant `recordNicheRun` write at line 5513 (was polluting the LRU window with NULL `aesthetic_style` rows — every shipped video produced one row WITH aesthetic + one row WITHOUT). Faceless factory is now the single source of truth for `niche_cooldown` writes. Added boot-time `assertRotationCoverage()`.

**Schema:**

```sql
CREATE TABLE pipeline_rotation_state (
  brand text PRIMARY KEY,
  total_ships integer NOT NULL DEFAULT 0,
  last_advanced_at timestamptz NOT NULL DEFAULT now(),
  last_niche text,
  last_angle_id text
);
```

One row per brand, both seeded at `total_ships=0`. Brands advance independently — SS and TCF each have their own cursor and never block each other. Math:

- `niche_index = total_ships % 15` (wraps every 15 ships)
- `pass_index = total_ships ÷ 15` (0, 1, 2, ...)
- `angle_index = pass_index % niche.angle_count` (each niche wraps its own pool)

**Coverage verified:** All 30 niches (15 SS + 15 TCF) have ≥14 angles each. SS = 224 unique seeds, TCF = 225. With orthogonal A/B/C aesthetic rotation: ~675 unique combinations per brand before any seed repeats.

**Simulation results** (`outputs/simulate_rotation.py`, ran 2026-04-30):

- Zero (niche, angle) duplicates across the first 100 ships per brand.
- First seed repeat at ship **#221 (SS)** and ship **#226 (TCF)** — at 2 ships/day = ~3.6 months before any wrap, ~11 months when factoring in aesthetic rotation.

**Niche cooldown semantics changed:** `niche_cooldown` table is now a pure ledger (audit + `aesthetic_style` for the 30-video performance test). `assertNichePermitted` is defined but was never called in production — confirmed via grep. Sequential rotation IS the cooldown. Architect can run unlimited batch productions back-to-back without "biting" — rotator just keeps advancing.

**Known minor data-hygiene issue (deferred):** Angle id `the-open-office-panopticon` appears in both `containment` and `compliance-machinery` for TCF. Different niche slots, but the seed text appears copy-pasted. Doesn't break the rotator (treats them as distinct slots). Worth deduping in a follow-up.

---

---


## S125b — Sapphire warm-handler persona + Ace's actual schedule (2026-04-29)

**Commit:** `1c4caa4` on origin/main (2 files: `src/agent/sapphire-prompt-builder.ts`, `src/data/sapphire-prompt-pieces.json`, +28/-14). Pushed cleanly; pipeline was quiet.

**Why:** S124 (parallel system) had thrashed Sapphire's persona five times in 24h and landed on "executive_pa, results-only mandate, cold efficient executor." Architect's stated target is the Adam Sandler / Ron-from-*Jay-Kelly* archetype — longtime handler, warm, witty, devoted, pushes back when needed, not a robotic PA. Plus the time-of-day auto-flip in `autoPersonaForTime` was wired for a 9-to-5 schedule and Architect wakes \~2pm CDT / sleeps \~6-8am CDT, so `morning_focus` was firing during his bedtime and `after_hours` during his work block.

**Code changes (**`src/agent/sapphire-prompt-builder.ts`**):**

- DEFAULTS flipped: `longtime_handler` / `trusted_assistant` / `be_present_useful` / `warm_concise` (was: `executive_pa` / `strategic_partner` / `high_agency_execution` / `results_only`).
- `autoPersonaForTime` + `autoScenarioForTime` remapped for Architect's actual rhythm:
  - 14:00–17:00 CDT = `morning_focus` (his morning window)
  - 17:00–01:00 CDT = `longtime_handler` (warm default during main awake block)
  - 01:00–14:00 CDT = `after_hours` (quiet, unobtrusive — covers late-night fatigue + asleep window)

**Library changes (**`src/data/sapphire-prompt-pieces.json`**):**

- New persona piece `longtime_handler` — explicit Ron-to-Jay-Kelly framing: longtime, warm, witty, pushes back softly, no performance, just operates.
- Rewrote `trusted_assistant` to lean into shared history with the brands, the funnel, the family knowledge.
- Rewrote `be_present_useful` adding "Push back when something's off — that's part of why he keeps you around."
- Rewrote `warm_concise` with "You sound like a person who's known him for years, because you have."
- Rewrote `complex_task_protocol` to keep planning logic but drop the "RESULTS-ONLY MANDATE / FAILURE" framing.
- Rewrote `after_hours` and `morning_focus` to reflect Architect's schedule explicitly.

**Old cold pieces** (`executive_pa`, `strategic_partner`, `high_agency_execution`, `results_only`) remain in the library for explicit selection but are no longer the fallback when the DB is empty.

**DB lock-in (Supabase** `sapphire_known_facts` **project** `wzthxohtgojenukmdubz`**):** All five single-value section pointers and the extras+emotions multi-value pointers explicitly upserted to the warm set. Important: the parallel-system extras list contained `always_confirm_task_understanding` (a piece that doesn't exist in the JSON, silently filtered) AND was missing `complex_task_protocol` entirely — meaning Sapphire wasn't loading her planning protocol at all. Restored. The `active_format = soulful_pa_format` row from S121 also pointed at a non-existent piece; corrected to `warm_concise`. Explicit DB rows beat code defaults, so this is the durable source of truth.

**Verification:**

- `npx tsc --noEmit` exit 0 pre-push.
- `git push origin main` exit 0; `74b7b0e..1c4caa4`.
- Pipeline quiet at push time (vid_rush_queue 4h `publishing` window: 0; crew_dispatch 30min in-flight: 0).

**Open at close:** Live behavioral test required. Three messages on Telegram (logistics, emotional, complex task) to confirm the new tone landed. Look for: contractions, italic closing reactions, no "MANDATE/FAILURE" phrasing, the longtime-handler register. If Sapphire still sounds cold post-deploy, check Railway build logs for the deploy completing AND check that `mergePiecesFromDB` isn't injecting a stale `piece_persona_*` override.

---

## S125 — Repo hygiene cleanup + S123/S124 backfill (2026-04-29)

**Context:** Architect lost direct access to the Sovereign-aligned session pilot Apr 26 \~20:45 UTC and a parallel system continued shipping until Apr 28 \~20:09 UTC. 26 commits landed without master-reference logging. S125 reconstructs the record (S123, S124 below) and cleans the junk that parallel system committed to `main`.

**Cleanup actions:**

- Discarded CRLF-only working-tree noise on `src/proactive/sapphire-sentinel.ts`, `src/tools/clip-generator.ts`, `src/tools/vid-rush.ts` (926/926 line-ending flips, zero content delta — `feedback_crlf_noise_is_not_a_real_diff`).
- `git rm`'d empty zero-byte junk: `git`, `ping`, `memory.db`. All shell-typo artifacts.
- `git rm`'d misnamed `.aiexclude/New Text Document.txt`. Replaced with proper root-level `.aiexclude` file containing the same Gemini Code Assist exclusion patterns plus the standard ignores.
- `git rm --cached` on six dev scripts in `scratch/` (kept locally, removed from repo). Added `scratch/` to `.gitignore`.
- `.gitignore` extended to block recurrence: `memory.db`, `*.db`, `git`, `ping`, `scratch/`, `.aiexclude/` (dir form).

**Verification:**

- `tsc --noEmit` → exit 0 (HEAD pre-cleanup also exit 0; no regressions).
- `git status --short` clean post-cleanup.

**Open at close:** None for cleanup. The substantive S123/S124 work below has its own open items.

---

## S124 — Sapphire complex task protocol + tool tiering + persona stabilization (2026-04-28, parallel system)

**Last commit:** `d0430dd` — `fix(sapphire): build-safe memory hardening + executive persona`. 17 commits across the day. **NOT logged by parallel system; reconstructed S125.**

**Major changes:**

1. **Autonomous Complex Task Protocol** (`398d29d`, `593acd3`, `ed0eee6`). New mechanism in `src/proactive/sapphire-pa-jobs.ts` (+509 net) for multi-step planning hooks with memory hydration. Sapphire now stages plans across turns instead of one-shot tool calls.
2. **Selective tool tiering — 50% claimed token reduction** (`a74d2d1`). Sapphire's tool surface split into 8 core (always loaded) + 7 conditional (loaded by intent). Burst execution mandate added to prompt. Per-message input target dropped from \~12K to \~5K tokens. Builds on the S114r refactor.
3. **Sovereign Make workflow engine** (`4d5a082`). Workflow planner table migration (`scratch/migrate-workflow-table.ts`) + `src/tools/sapphire/planner.ts` rewrite (+125 net).
4. **Persona iteration thrash — 5 rewrites in 24h.** PA → field operative → executive → autonomous → executive PA. Stabilized at: "executive PA, results-only mandate, action batching, filler removed, platform-specific recon heuristics, starter-pack awareness." `5aa8f2a` is the canonical persona-state at session close.
5. **Memory hardening** (`332449e`, `010583a`, `d0430dd`). `src/memory/sqlite.ts` and `src/memory/supabase-vector.ts` updated for build-safe handling. Type errors resolved across the tier-tiering refactor.
6. **Unified 8am brief + voice restoration + ritual migration** (`5b1f0d5`).

**Architectural concern:** The persona thrash (5 rewrites) is a smell. The parallel system iterated identity-level prompts faster than is healthy. Whether the final state matches Architect intent is unverified — this is the open item for next session focused on Sapphire.

**Open at close:**

- Live behavioral check needed — does Sapphire's voice match the "executive PA" target the parallel system landed on, or has she drifted from Ace's intent?
- Tool-tiering claim of 50% token reduction unverified against real traffic.
- ClickUp Cloudflare proxy bypass (S123) end-to-end unverified.

---

## S123 — Sapphire ClickUp + Notion 3-Hub + Anthropic primary (2026-04-27, parallel system)

**Commits:** `a4c44e6` (S122 daily frequency brief — Sovereign-tagged) → `8dde823` (Notion 3-Hub close). 9 commits. **NOT logged by parallel system; reconstructed S125.**

**Major changes:**

1. **ClickUp activation** (`4af211e` → `69eecf8`). New tool `src/tools/sapphire/clickup.ts` (+115 lines). Workspace, tasks, lists, channels. Multiple iterations through type-casting fixes (`d8a91c2`, `91d67ed`, `959a087`, `0b73c4d`, `28e24d6`, `deba99d`).
2. **CloudFront 403 fight** (`4582452` → `69eecf8`). ClickUp's CloudFront edge blocked the bot's User-Agent. Iterated through browser-header mimicry (`1f8428c`), maximum mimicry (`9881796`), final resolution: route all ClickUp traffic through a Cloudflare Proxy (`69eecf8`).
3. **Notion 3-Hub upgrade** (`c2c542c`, `8dde823`). `src/tools/sapphire/notion.ts` rewritten (+233 net). New architecture: hub-1 daily, hub-2 weekly, hub-3 strategic. Weekly Recap cron job added.
4. **Decoupled morning brief email + nightly diary** (`b45ee7a`, `45df5b0`). Morning brief no longer rides the same job as the email; nightly diary writes a private memo to Notion before EOD. "Notion spatial mastery" enforcement in prompt.
5. **Anthropic locked as Sapphire primary** (`1c4afdc`). Hidden chain-of-thought injected. The S122 hardening of routing per-agent locked in concretely.
6. **Sapphire Frequency Alignment Brief** (`a4c44e6`). Migration: `supabase/migrations/20260427_sapphire_frequency_brief.sql`.
7. **Daily-content RLS fix** (`6a1b1e1`, `96b5587`). Orchestrator now uses `SUPABASE_SERVICE_ROLE_KEY` for `content_transmissions` writes — the anon key was getting RLS-blocked. Title uniqueness constraint added.

**Open at close:**

- The Cloudflare Proxy hop for ClickUp traffic — assumes a working proxy URL is set in env. Needs Railway env audit + a live ClickUp call test.
- The 3-Hub Notion architecture defines the *write* path; whether Sapphire's *read* path consistently picks the right hub for each query is behavioral and untested.

---

## S122b — Buffer GraphQL schema fix + briefing Telegram relay (2026-04-26 \~20:40 UTC)

**Commit:** `6045457` on origin/main (3 files: `src/tools/buffer-analytics.ts`, `src/channels/agent-voice.ts`, `src/index.ts`, +344/-166).

**Why:** Vector's S122 backfill briefing landed clean, surfaced two real bugs:

1. **Buffer GraphQL has been broken since S36.** Built on a fabricated schema. Per Buffer's own docs ([developers.buffer.com](http://developers.buffer.com) Apr 2026), the Post type has only `id/text/dueAt/channelId/status/assets` — NO `statistics`, NO `channel { ... }` sub-object — and `first:` is a sibling argument to `input:`, NOT inside it. Buffer GraphQL also doesn't expose engagement metrics at all (likes/clicks/impressions/reach are on Buffer's roadmap, not yet shipped). The S36 query asked for all of those simultaneously — `Cannot query field "statistics" on type "Post"` and `Field "first" is not defined by type "PostsInput"` were correct rejections.
2. **Briefings reached MC but not Telegram.** Vector's S122 briefing sat in the `briefings` table; Architect on Telegram only saw the receipt `✅ Briefing filed: <id>` — not the body.

**Fix 1 —** `src/tools/buffer-analytics.ts` **rewrite:**

- Query matches Buffer's actual schema: `posts(first: N, input: { organizationId, filter: { status: [sent] } }) { edges { node { id text dueAt channelId status } } pageInfo { ... } }`.
- Channels resolved via the existing `getBufferChannels()` cache from `buffer-graphql.ts` (zero extra API calls in the 4h TTL window).
- Reports return honest data: post counts per channel, channel cadence (most-recent dates), recent posts with text + timestamp.
- `top_posts` deprecated to alias of `recent` with explicit note.
- `ENGAGEMENT_FOOTER` appended to every report — explicit bridge note that engagement metrics live in YouTube Analytics / Meta Graph / X API / LinkedIn Marketing API, not Buffer GraphQL. Vector's future briefings will carry this disclaimer instead of fabricating zeros.

**Fix 2 — Briefing → Telegram relay:**

- New `relayBriefingToTelegram(agent, briefingId, channel, chatId)` in `src/channels/agent-voice.ts`. Fetches briefing row from Supabase, formats with priority-icon + agent-display header (`⚡ *Vector — Daily Sweep*` + title), body verbatim, optional action-items block, then `appendThoughtTag` for the closing reflection in agent voice tied to a NORTH_STAR metric chosen by `briefing_type`. Fail-soft: never throws; if Markdown parsing fails the relay retries plain-text; if everything fails it logs and returns false. Caller continues unblocked.
- Wired in dispatch poller (`src/index.ts:5184+`) directly after `completeDispatch`. Extracts the briefing UUID once via `/✅ Briefing filed:\s*([0-9a-f-]{8,})/i`, uses it both for the gate check AND for the relay. Fire-and-forget (`void (async () => { ... })()`) so the dispatch loop never waits on Telegram.
- Pattern matches Veritas's morning briefing path that already used `appendThoughtTag`. Vector inherits the same UX for dispatch results.

**Architecture clarification (the "ant + logbook + forward" question):** the briefings table IS the canonical record. Telegram is one consumer among several (MC visual surface, Telegram DM, future email digest). The S122b relay is the missing fanout step, not a workaround. Design correct; implementation gap closed.

**Verification:**

- `npx tsc --noEmit` exit 0, zero output.
- Single push to origin/main: `5255bb0..6045457`.
- Test dispatch `583e26b9-7ca8-4bc1-bb4f-8bfb4674f60e` queued at 20:41 UTC for end-to-end exercise (Railway redeploy in flight).

**Open at close:** verify next session that `583e26b9` lands a real briefing AND the Telegram DM carries the body (not just the receipt). If body lands → S122b confirmed. If only receipt lands → relay path has a runtime bug despite tsc clean.

---

## S122 — Vector daily_metrics_sweep file_briefing gate + hardened directive (2026-04-26 \~19:25 UTC)

**Commit:** `f7ba158` on origin/main (single-file: `src/index.ts`, +59/-27). Railway auto-deploy triggered.

**Symptom Architect saw:** Telegram DM from Vector at 12:01 PM CDT (17:01 UTC): *"The daily CRO metrics sweep is complete, and the findings have been reported to Ace."* — and nothing else. No numbers. No briefing.

**Diagnostic from** `crew_dispatch` **rows by** `to_agent='vector'`**:**

Date (UTC)task_typestatusresult2026-04-23 17:00daily_metrics_sweepcompletedFull intel report — MRR=$0, Buffer GraphQL diagnosed, Anita+Yuki dispatched, briefing filed. **Worked**.2026-04-24 17:00daily_metrics_sweepfailed`⚠️ Agent loop reached maximum iterations without a final response.`2026-04-25 17:00daily_metrics_sweepcompleted`[Called tool: buffer_analytics({"report":"channel_breakdown"})]` — tool-call trace fragment, no synthesis2026-04-26 17:00daily_metrics_sweepcompletedThe meta-line above. Zero tool calls.

`SELECT * FROM briefings WHERE agent_name='vector' AND created_at >= NOW() - INTERVAL '36 hours'` → empty. Vector did NOT call `file_briefing` once in the last day-and-a-half.

**Root cause (architectural, not a one-off glitch):**

- Directive ended with `"Report findings to the Architect via Telegram"`.
- There is **no** `dm_architect` **/** `send_telegram_message` **tool** in the codebase.
- The agent loop's `sendMessage` ToolContext at `src/agent/loop.ts:361-364` is a stub that just `console.log`s.
- The dispatch poller at `src/index.ts:5043` writes the response to `crew_dispatch.result` and never sends it to Telegram.
- The ONLY mechanical path from Vector → Architect's inbox is `file_briefing` (writes to `briefings` table → MC surfaces).
- Gemini Flash Lite (current default for crew, Anthropic credits drained per S115) progressively shortcut the inference. 04-23 inferred the contract correctly. By 04-26, it returned a meta-narration with no tool calls.

**Two fixes shipped this session:**

1. **Hardened directive (lines \~2191-2204).** Replaced the soft `"Report findings to the Architect via Telegram"` with an explicit MANDATORY tool sequence: stripe_metrics + 3× buffer_analytics + file_briefing (step 7 explicit, including title/briefing_type/priority/body parameters). Final-message contract: must be exactly `✅ Briefing filed: <briefing_id>` — nothing else. Enumerated failure modes ((a) skip any tool call, (b) skip file_briefing, (c) return meta-narration). The "no dm_architect tool exists" fact is now in the directive itself so Vector can't infer otherwise.

2. **Server-side** `file_briefing` **gate (lines \~5042-5063).** Added `BRIEFING_GATED_TASKS = new Set(["daily_metrics_sweep"])`. If the task is gated and the response doesn't contain `"✅ Briefing filed"` (the success marker emitted by the FileBriefingTool at `src/tools/action-surface.ts:274`), force `dispatchStatus = "failed"`. Surfaces the silent failure as a real failure instead of letting the meta-line masquerade as a green dispatch. Other gated task types can be added as their directives harden to the same contract.

**Backfill:** Inserted `crew_dispatch` row `4202f13f-c0e0-4e2b-9f1e-fed9e75b4ac6` at 19:27 UTC with the new hardened directive text inline so today's metrics get reported.

**Verification:**

- `npx tsc --noEmit` — exit 0, zero output.
- `git status --short` — only `src/index.ts` staged. Parallel session's orphan mods on `faceless-factory.ts`, `script-uniqueness-guard.ts`, `sapphire/_router.ts`, `sapphire/index.ts`, `sapphire/roster.ts` left untouched per `feedback_orphan_files_break_railway`.
- Single-file commit. No `git add .` from sandbox per `feedback_crlf_noise_is_not_a_real_diff`.
- `git push origin main` exit 0. `78a0150..f7ba158`.
- Pipeline quiet at push time (`vid_rush_queue` 4h window: empty).

**The pattern this fix establishes:** any directive that says "report" or "DM" without naming the EXACT tool that does it is a hallucination trap when the model is on Gemini Flash Lite. Audit pass surfaced one current offender (Vector's was the only one). The gate set `BRIEFING_GATED_TASKS` is the enforcement primitive — when other directives harden to the same contract, add the task_type to the set.

**Open:** Verify the backfill dispatch produced a real briefing (poll `crew_dispatch.result` for `4202f13f`). If Vector still shortcuts under the new directive, the gate will catch it as failed and we know the directive alone isn't sufficient — model swap or tool-call-required instruction at the LLM-provider level (function-calling `tool_choice: required`) is the next escalation.

---

## S120 AUDIT — Sapphire Upgrade Verification (2026-04-26)

**No commits made this session. The four specified fixes were already live in HEAD.**

Architect briefed a 4-fix Sapphire upgrade ("schema flex + 16K output + empty-retry + Gemini safety relax") with a STEP ZERO directive to verify the working tree wasn't a corrupted sandbox snapshot. Verification path: Desktop Commander cmd shell → `git rev-parse HEAD` → `findstr` against the actual Windows files.

Result of audit:

- **FIX 1** — `src/index.ts:4670` `agentBotLoop.setContextOverrides({ maxRecentMessages: 15, ... })`. Already shipped under commit `90adbb9` (S119g, 2026-04-26 04:33 UTC).
- **FIX 2** — `src/tools/relationship-context.ts` schema loosened: hard enum replaced with `MAX_CATEGORY_LEN=40`, lowercase + `[\s-]+`→`_` + strip non-`[a-z0-9_]` normalize, `RECOMMENDED_CATEGORIES` retained as soft guidance (preference, frustration, pattern, win, tone, communication_style, relational, value, trigger, ritual), `(novel category)` log when not on the list. Already shipped under commit `c42abc8` (S119h).
- **FIX 3** — `src/agent/loop.ts` empty-completion handling: `maxTokens` raised 8192→16384, `EMPTY COMPLETION` diagnostic emits provider/model/finishReason/inputTokens/outputTokens, single retry path, soulful fallback `"My signal dropped for a moment, Ace. Say it again and I'll catch it this time."` (line 323). Already shipped under commit `c42abc8` (S119h).
- **FIX 4** — `src/llm/providers.ts` GeminiProvider hardened: `safetySettings` array with all four published categories at `BLOCK_ONLY_HIGH` (lines 130-133), `rawFinish` mapping replaces hardcoded `"stop"`/`"tool_use"` (lines 300-305), per-category safetyRatings warn on SAFETY block (filters to `blocked || probability !== "NEGLIGIBLE"`), RECITATION + unexpected-finishReason console.warn paths. Already shipped under commit `c42abc8` (S119h).

**Verification:**

- `git rev-parse HEAD` = `6874c2f` (S119i — Ace's TCF Flux aesthetic fix).
- `git rev-list --left-right --count origin/main...main` = `0 0`. Local clean against origin.
- `git status --short`: only untracked junk media (`audit_sample.mp4`, `audit_sample_frame.jpg`, `audit_ss_frame.jpg`). No unstaged source files.
- `npx tsc --noEmit` (Windows, tsc 5.9.3) — exit 0, zero output. Clean compile.
- `findstr` confirms each spec string on disk (`maxRecentMessages: 15`, `MAX_CATEGORY_LEN = 40`, `FALLBACK = "My signal dropped...`, `BLOCK_ONLY_HIGH` ×4).

**Why no S120 commit:** the architect's spec was already fully implemented in S119g + S119h (bundled into Anita's commit message). Re-shipping would have produced an empty diff. Per `feedback_verify_before_claiming_unset.md` + `feedback_orphan_files_break_railway.md`, this session refused to fake a commit.

**Surfaced for next-scope decision (architect's 30–40 year brief):**

1. **Versioned identity ledger** — `sapphire_identity_log` Supabase table recording every `create_piece` / `set_piece` / `remove_piece` with timestamp + before/after diff + Ace's triggering message. Plus `/history` command for Sapphire to read her own evolution.
2. **Multi-provider intelligent routing** — keep Gemini Flash-Lite as default but route introspective/relational/self-reflective threads to Claude when Anthropic credits are loaded (Claude doesn't suppress self-reflection the way Gemini does). Pattern triggers: "feel", "you", "us", "yourself", deep-question markers. Falls through to Gemini on 400. Pairs with FIX 4 — long-game answer is to stop relying on a single classifier.
3. **Pinecone** `sapphire-personal` **namespace deepening** — every `relationship_context` observation AND every substantive Ace DM gets embedded with metadata `{category, timestamp, scenario, sentiment}`. Enables PA-prefix richer recall ("Ace mentioned waging war with reality on 2026-04-26 at 03:25 — see how that thread evolved").
4. **Billionaire-PA UX deltas** — proactive morning brief at her own cadence, anticipatory questions, `/diary` command (her own daily voice), reminder-of-significance ("a year ago today you said...").

None of these are bundled in this audit. Each is a small standalone build awaiting Architect green-light on order of execution.

---

## S118 CLOSE — Audit Cross-Sync With MC (2026-04-25)

**Final commit:** `2c723b6` on origin/main. Railway auto-deploy triggered.

MC side closed the user-facing audit (Tally URL gate, Tier-2 PDFs, nurture-05 patch — all on [sovereign-synthesis.com](http://sovereign-synthesis.com)). MC then handed back 4 bot-side red items via cross-sync log. Disposition this session:

1. **Iter caps bumped (SHIPPED).** `src/index.ts:4938` light 1→2, heavy 6→10, default 4→6. The 47% crew_dispatch failure rate was Gemini 2.5 Flash Lite emitting more tool-call rounds than the prior Anthropic models did, blowing the caps before the task finished. Commit `2c723b6`.
2. **isDispatch wrapper at** `src/agent/loop.ts:285` **— INTENTIONALLY NOT FLIPPED.** S35 explicitly skipped `saveToMemory` + `extractAndEmbed` for dispatch payloads (system-generated, not conversation; was burning \~48 context messages and embedding API calls per dispatch). The reason `knowledge_nodes` is at 1 row isn't a regression — it's correct architecture. The S114 business-insight extraction path writes to a different table for the learning loop. Flipping the wrapper would re-pollute chat memory and re-burn embeddings without moving a single one of the 5 NORTH_STAR metrics. NO FIX.
3. **Stale** `D` **index markers — NON-ISSUE.** MC's `git status` was reading sandbox phantom-diff output (per `feedback_crlf_noise_is_not_a_real_diff` — sandbox sees CRLF-normalized files as deleted while Windows shows them clean). Verified via Desktop Commander cmd shell on Windows: `git status --short` returned only this session's `M src/index.ts` plus 4 harmless untracked junk files. Nothing to reset.
4. **FB direct publishing — token scopes problem CONFIRMED.** Pulled live `content_engine_queue.buffer_results` for last 24h: every FB-direct attempt failing with `(#200) ... pages_read_engagement and pages_manage_posts ...`. The S115b `resolvePageAccessToken` exchange logic is correct but requires the seed token to already have `pages_read_engagement` to even GET a Page Access Token — without that scope, exchange falls back silently to the seed token, which then fails to post. Fix is NOT code: regenerate FB seed tokens with proper scopes via Graph API Explorer → System User flow → update `FACEBOOK_PAGE_ACCESS_TOKEN` + `FACEBOOK_CF_PAGE_ACCESS_TOKEN` Railway env vars. Requires Architect at the Meta Console — Chrome session staged this turn.

**What's still open at session close:**

- Master reference cleanup of 4 untracked junk files in repo root (`-90`, `@sovereign_synthesis`, `_thumbnail_test_S117/`, `blank`) — gitignore candidates
- Three MC dashboard tiles per `proposals/MC-DASHBOARD-TILE-PLAN.md` (carry-over from S115c — next MC mount)

## S118b — FB Token Permanent Fix (2026-04-25, \~04:14 UTC 04/26)

**Problem:** FB direct posting broke 3 times in 4 weeks. S115b shipped the page-token exchange resolver in `facebook-publisher.ts`, but the seed token in Railway was a SHORT-LIVED User token from Graph API Explorer — which expires in 1-2h, takes its derived Page tokens with it, and rotates whenever Meta does any security action.

**Diagnosis:** Pulled live `content_engine_queue.buffer_results` for last 24h. Every FB-direct attempt failing with `(#200) ... pages_read_engagement and pages_manage_posts ...`. The exchange logic was running correctly but falling back to the seed token because the seed itself lacked `pages_read_engagement` (required to even GET a Page Access Token).

**Permanent fix shipped this session:**

1. Discovered `content bot` System User already exists in "The Containment Field" Business portfolio (`business_id=1671038527580262`, `system_user_id=61572040423390`) with both Pages assigned ("Partial access (Content)") and the "Sovereign synthesis publisher" app at Full control.
2. Generated a NEVER-EXPIRING System User token via `business.facebook.com/latest/settings/system_users` → Generate token → "Never" expiration → 5 default scopes (including `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `pages_read_user_content`).
3. Used the System User token to call `/PAGE_ID?fields=access_token` for both Pages. The returned per-Page tokens are page-scoped AND inherit the System User's never-expiring property.
4. Updated Railway env vars `FACEBOOK_PAGE_ACCESS_TOKEN` (SS) and `FACEBOOK_CF_PAGE_ACCESS_TOKEN` (CF) with the permanent tokens. Railway redeployed (active: "S118 close note in master reference" — env-var-triggered rebuild).

**Verification:**

- Both tokens authenticate as their Pages (not as user) when calling `/me`
- Both can read their own feeds successfully
- All publishing scopes granted on the System User token
- Permanent tokens are now live in Railway

**Why this won't break again:** System User tokens don't depend on a user session, don't expire on a schedule, and don't rotate on password resets or Meta security actions. The only way they break is if the System User loses Page access or the App is uninstalled — both intentional admin actions. Full diagnostic + regen runbook in memory file `reference_fb_system_user_token.md`.

## S118c — Planner-Staged Hybrid (2026-04-25)

**Commit:** `3ed6c93` on origin/main.

Adds `scheduledPublishTime` option to `publishToFacebook` + env-driven default `FACEBOOK_PLANNER_LEAD_MIN`. When set, every FB post lands in Business Suite Planner ahead of its publish time instead of going live immediately. Architect can review/edit/cancel from `business.facebook.com/latest/posts/scheduled_posts` before auto-publish. Min lead clamped to 11 minutes (Meta API requirement). All three endpoints (`/feed`, `/photos`, `/videos`) accept the new param. Backward compatible — env unset/0 = legacy live posting.

Railway env: `FACEBOOK_PLANNER_LEAD_MIN=15` (active).

## S118d — Week-Ahead Pre-Stage Sweep (2026-04-25)

**Commit:** `4edaa42` on origin/main.

Two changes that together turn FB into Buffer-equivalent for week-ahead scheduling:

1. `dailyContentProduction` **accepts** `daysAhead` (default 1, env override `FACEBOOK_PLANNER_DAYS_AHEAD`, capped at 14). The 18:30 UTC daily run now generates 7 days of content per the env. Weekend days inside the horizon are skipped (the dedicated weekend repost job handles them on-day).

2. **New** `prestageFacebookSweep()` runs every 30 min. Picks up CEQ rows where `status=ready`, `scheduled_time` is in (now+11min, now+7d), `media_url` is populated (image ready from FLUX), and FB hasn't been handled yet. Stages each row in Planner with `scheduled_publish_time = ceq.scheduled_time`. Records `✅ facebook_direct(facebook_direct): {postId} STAGED for {iso}` into `buffer_results` so the live distribution sweep's `alreadyHandled` set skips FB at fire time. Idempotent — running twice is a no-op.

Effect: Architect sees \~30 SS + \~30 CF posts laid out on the Planner calendar at any given time, distributed across the next 7 days at proper hour-of-day slots. Same pattern as Buffer's queue, Meta-native, no extra cost. TikTok/IG continue posting live at scheduled_time via Buffer; only FB diverges into Planner.

Railway env: `FACEBOOK_PLANNER_DAYS_AHEAD=7` (active).

**Disable path:** set `FACEBOOK_PLANNER_LEAD_MIN=0` to drop back to live posting (everything goes through legacy distribution). The pre-stage sweep self-disables when LEAD_MIN is 0.

---

## SAPPHIRE — PERSONAL ASSISTANT FIRST, COO SECOND (S114 CLOSED, 2026-04-25)

**Session 114 final commit:** `deb184f` on origin/main. Railway auto-deploy live.

**What this session shipped (in order):**

 1. Foundation — 4 Supabase tables, RLS service-role-only
 2. OAuth — real callback URL flow (OOB was deprecated by Google), tokens in `sapphire_credentials` not env vars
 3. Tool layer — 27 PA tools across reminders/gmail/calendar/notion/facts/PDF/research/family/planner/news
 4. Voice — Whisper in (\~$0.006/min), Google Translate TTS out (free), TelegramChannel token bug fixed properly
 5. Image vision — Gemini 2.5 Flash multimodal for screenshots
 6. Persona — dual-mode prompt (PA in DM, COO in group/dispatch), hard context injection in index.ts
 7. Scheduled jobs — reminder poll (60s), morning brief (11AM CDT), evening wrap (1:15AM CDT), calendar 24h lookahead, email triage 30m, news in morning brief
 8. Two-lane Pinecone — `sapphire-personal` (PA) + `brand` (COO), zero cross-pollination
 9. Business learning loop — `insight-extractor.ts` extracts 1 insight per completed dispatch → agent's namespace + optionally `shared`. Reverses the "knowledge_nodes had 1 row in 11 days" stagnation
10. Tool discernment — explicit ONLY-WHEN rules in tool descriptions, DISCERNMENT block in Sapphire prompt

**User-facing docs:**

- `SAPPHIRE-USER-MANUAL.md` — commands, capabilities, troubleshooting
- `SAPPHIRE-VS-BILLIONAIRE-TIER.md` — gap analysis, roadmap, cost comparison

**Deferred (not built):** None active. Plaid finance integration was scoped but Ace removed it.

**Sapphire's permanent identity is now Ace's full-time Personal Assistant.** The COO/sentinel role is a secondary hat she wears ONLY when activated by group chat or dispatched tasks. Default mode in 1-on-1 DM is PA — plain English, no sovereign tone, no `*[inner state: ...]*` stamp. Detection at the personality prompt level + hard context injection in `src/index.ts`.

**Two-Lane Memory Architecture (NEVER cross-pollinate):**

Mode A (PA)Mode B (COO)Save memory`remember_fact` → `sapphire-personal` Pinecone namespace`write_knowledge` → `brand` Pinecone namespaceRecall`recall_facts` + auto-semantic-recall in DM context blockagent-loop semantic recall against `brand`TopicAce's life, family, schedule, errandsCrew/business intelligence, brand insights

Personal facts in `brand` = pollution. Business insights in `sapphire-personal` = noise in Ace's daily brief. Both must stay clean for the business to evolve AND Ace's life to be served.

**Pinecone namespaces (don't confuse them):**

- `sapphire-personal` — Ace's life. Written by `remember_fact`. Auto-recalled in PA DMs.
- `brand` — business insights. Written by `write_knowledge` (COO mode only).
- `hooks`, `content`, `clips`, `funnels` — Alfred, Anita, Yuki, Vector respectively.

**Tables (Supabase, project** `wzthxohtgojenukmdubz`**):**

- `sapphire_reminders` — durable reminder queue, polled every 60s
- `sapphire_credentials` — OAuth refresh tokens for Google + Notion (NOT in Railway env vars)
- `sapphire_daily_pages` — one row per calendar date, ties to a Notion page
- `sapphire_known_facts` — standing prefs (e.g., "girls' birthday parties = $25 gift")
- `sapphire_family_profiles` — first-class family member objects (S114 Gap 8)

All RLS service-role-only. Indexed for the reminder poller.

**New modules:**

- `src/proactive/sapphire-oauth.ts` — OOB Google OAuth + Notion token storage. Reuses `YOUTUBE_CLIENT_ID/SECRET`. Refresh-on-demand access tokens.
- `src/agent/sapphire-pa-commands.ts` — deterministic command intercept (runs before LLM). Authorization-gated. Voice preference state. Pending-paste handling for auth codes.
- `src/tools/sapphire/` — 16 tools: reminders × 3, gmail × 4, calendar × 3, notion × 4, facts × 2.
- `src/proactive/sapphire-pa-jobs.ts` — `runReminderPoll`, `runMorningBrief`, `runEveningWrap`. Idempotent via fired-date keys.
- `src/proactive/sapphire-watchers.ts` — `runCalendarLookahead` (24h-ahead reminders), `runEmailTriagePoll`.
- `src/voice/sapphire-voice.ts` — XTTS with `SAPPHIRE_XTTS_SPEAKER` (default "Tammie Ema") for outbound voice notes.

**Scheduled jobs (added):**

- Reminder poll — every 60s
- Morning brief — 16:00 UTC (11 AM CDT)
- Evening wrap — 06:15 UTC (1:15 AM CDT)
- Calendar 24h lookahead — every 6 hours
- Email triage — every 30 minutes

**Telegram commands (DM Sapphire, Ace only):**
- `/auth_google_primary` / `/auth_google_secondary` — OAuth setup
- `/auth_notion` — Notion integration token paste
- `/auth_status` — connection check
- `/voice_on` / `/voice_off` / `/voice_brief`
- `/sapphire_help` — full command list

**Optional env var:** `SAPPHIRE_XTTS_SPEAKER` (default "Tammie Ema").

**Cost:** Whisper transcription ~$0.006/min (existing OPENAI_API_KEY), XTTS reuses existing pod, Gmail/Calendar/Notion APIs free.

---

## MISSION CONTROL CROSS-SYNC LOG

*Written BY Mission Control sessions, READ BY Sentinel Bot sessions. Read at every session start. Most recent entries at TOP.*

### 2026-04-24 — MC S114: Aesthetic Performance tile data path SHIPPED on bot side (sovereign override — both Fix A + Fix B in one MC session)

**Sovereign override note:** This entry records bot-side commits that were authored from an MC cowork (not a Bot cowork) at the Architect's explicit instruction "do both fixes right now." Cross-sync protocol normally bars MC sessions from editing bot code; this is an override, not a precedent.

**What shipped on bot side (commit `fe442d3` on `origin/main`, Railway auto-deploy):**

**Fix A — `niche_cooldown.youtube_video_id` write-back (the join key MC's Aesthetic Performance tile needs):**
- `src/engine/faceless-factory.ts`: `FacelessResult` interface gains optional `jobId` field; return statement now passes the internal `fv_{brand}_{niche}_{ts}` jobId through.
- `src/engine/vidrush-orchestrator.ts`: after successful YouTube publish (where both `youtubeVideoId` and `facelessResult.jobId` are in scope, ~line 2030 area), PATCHes `niche_cooldown` setting `youtube_video_id` where `job_id = facelessResult.jobId AND youtube_video_id IS NULL`. Skips DRYRUN_ ids and `fv_dryrun_` jobIds. Non-fatal on failure.
- `src/engine/batch-producer.ts`: `ProducedVideo` interface gains a deterministic per-video `jobId` (`fv_{brand}_{niche}_{ts}_{i}`). Same value goes into both the `niche_cooldown` INSERT (production time) AND the `FacelessResult` that vidrush eventually consumes (publish time). Previously batch-published videos had `niche_cooldown.job_id = NULL` and were unjoinable.

**Fix B — Real CTR + retention via YouTube Analytics API v2:**
- New module `src/proactive/youtube-stats-fetcher.ts`. Reuses the existing OAuth helper pattern from `youtube-comment-watcher.ts`: env vars `YOUTUBE_REFRESH_TOKEN` (SS) and `YOUTUBE_REFRESH_TOKEN_TCF` (TCF) are exchanged for short-lived access tokens, then `youtubeanalytics.googleapis.com/v2/reports` is called twice per brand:
  1. Pass 1: `views,averageViewPercentage,averageViewDuration` (90-day window, top 200 by views) → patches `youtube_analytics.retention`.
  2. Pass 2: `impressions,impressionClickThroughRate` (top 200 by impressions) → patches `youtube_analytics.ctr` and `youtube_analytics.impressions`.
- `views` is NEVER overwritten — Data API v3 path remains canonical for that field.
- `src/index.ts`: scheduler entry added, 6h cadence, first run 60s after boot. YouTube Analytics has 24-48h reporting lag — more frequent polling is wasted budget.
- 403 "Insufficient scope" detection: if existing OAuth tokens were granted with `youtube.readonly` only (not `yt-analytics.readonly`), the failure is caught and a re-consent URL is logged loudly. **First run will reveal whether re-consent is needed.**

**MC SIDE IMPLICATION:**
- Nothing further required on MC. The Aesthetic Performance tile already queries `niche_cooldown ⨝ youtube_analytics` correctly. As soon as (a) Alfred ships a video with the new dual-rotation pipeline AND vidrush links the videoId back, AND (b) the stats fetcher patches retention/ctr, cells light up automatically.
- **Watch Railway logs for the FIRST `[YTStatsFetcher]` line** within ~6h of bot deploy. If it says `OAuth tokens missing yt-analytics.readonly scope`, the Architect must re-consent (~5 min Google Cloud Console task — instructions in the log line). If it says `retention patched X/Y videos`, working as designed.

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
