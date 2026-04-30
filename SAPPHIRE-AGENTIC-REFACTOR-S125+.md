# SAPPHIRE-AGENTIC-REFACTOR-S125+.md

> The architectural refactor that closes the gap between "Sapphire has hands but no connecting brain" and "Sapphire is the cutting-edge generalist agent in the stack." Sapphire goes first; her shape gets copied across Anita, Yuki, Vector, Veritas, Alfred once she's proof.

**Status:** Live plan, S125+. Author: Sentinel cowork session 2026-04-30.
**Companion files:** `NORTH_STAR.md` (the Highest-Leverage Action points here), `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` (logged at session close).
**Hard constraint during rollout:** never push to `main` while a producer pipeline is running — Railway auto-deploys and kills the container.

---

## Why this document exists

On 2026-04-30, Ace asked Sapphire on Telegram whether there was a YouTube video showing how much cash fits in a briefcase. Sapphire had the `web_search` tool wired into her core pack. She used it. And she still failed — because her Pinecone semantic recall layer injected three unrelated past Ace conversations about *uploading YouTube videos and content strategy*, which hijacked her query intent. She searched the wrong thing, got back text guides about uploading, and rationalized the mismatch as "I can't pull up direct YouTube video tutorial links."

The screenshot of that failure side-by-side with Gemini's clean response (which surfaced two YouTube links inline) was the trigger. Ace's diagnosis was sharper than the immediate bug: *"the neurons are not quantum, it's just so linear, as if I have to specifically program every process. Nothing is translating across domains, nothing is creating the illusion of intelligence."*

He was right. The bug was a symptom, not the root. Sapphire's shape — keyword-regex tier loading, 30 narrowly-scoped tools, bridged Gemini grounding through a custom client tool, no interleaved reasoning between tool calls, flat vector memory — is a *dispatch architecture* in a world that has moved to *agentic loops*. This document captures the five-phase migration from one to the other, plus the governing principles that prevent the waste pattern from recurring.

The deep research that informed the phasing is summarized in section "Reading list" at the end. Source-of-truth references: Anthropic's `web_search` server tool, interleaved extended thinking, the Letta/MemGPT memory architecture, Zep's temporal knowledge graph, Voyager's skill library pattern, and the ReAct/Reflexion loop family.

---

## Governing principles (non-negotiable)

These survive every phase. If a phase ships in violation of one of them, the phase is incomplete.

**The no-waste mandate.** Every phase ships with a measurable cost target — input tokens per turn, output tokens per turn, tools loaded per turn, tool calls per turn — and before/after numbers logged so the curve is visible, not assumed. Past sessions have burned credits on tool-schema bloat (~7,500 input tokens per turn from 30 tool definitions even when only one fired) and on Vector→Anita/Yuki dispatch chains that handed off context redundantly. The Mission Control spend tile (Phase 1) makes this visible in real time.

**The 5-tool test.** Every agent should pass it. If you cannot describe an agent's job in one sentence and list its tools on one hand, the agent has scope creep, the tools are over-decomposed, or both. Sapphire is the deliberate exception — she is the generalist, with up to ~12 fat tools and a 6-call-per-turn budget. Anita and Yuki are specialists with 5–8 tools and 2–3 calls per turn.

**The tools-per-turn budget.** Sapphire: 6. Anita: 3. Yuki: 3. Vector: 3. Veritas/Alfred: 2. If a turn consistently blows the budget, the goal was too complex (split it across turns), the tools are too narrow (consolidate), or the agent is looping (cap and reflect — see Phase 5 reflection layer).

**The model-tier discipline.** Sapphire on Anthropic Claude (top of the line — Sonnet 4.5+ or whichever flagship is current). Anita and Yuki on Gemini Flash (cheap, fast, specialist work). The generalist gets the cutting edge; specialists get cost-efficient capacity. Never invert this.

**No silent fallbacks with hardcoded content.** Already a core memory entry. A silent fallback that pulls from a fixed pool is a convergence gravity well. Retry with a different angle, halt with an error, or pull from a varied source.

---

## The five phases

Order is by leverage-per-effort-per-risk. Phase 1 is the cheapest with the largest qualitative jump. Phase 5 is the largest lift and the deepest payoff.

### Phase 1 — Native `web_search` + interleaved thinking + spend visibility

**Status:** Staged in this session, awaiting pipeline-clear push.

The bridged-Gemini `WebSearchTool` is replaced (for Sapphire's Anthropic-primary path) with Anthropic's native `web_search_20250305` server tool. The native tool runs on Anthropic's infrastructure — Claude decides mid-reasoning to invoke it, results stream back as input tokens for Claude to reason over, and there's no client roundtrip. The custom client tool is kept as a fallback for Sapphire's Gemini and Groq fallback chains so failover behavior is preserved.

The `interleaved-thinking-2025-05-14` beta header is attached to Sapphire's Anthropic calls along with an extended-thinking budget (initial: 8,000 tokens). This produces the Think → Act → Think → Act loop that closes the gap between "she has tools" and "she reasons between tool results." Without this, every tool result is processed in a single-shot completion. With it, Claude can mid-reason over a search result before deciding whether to search again, fetch a URL, or answer.

Sapphire's per-turn iteration cap is raised from her current value to **6** to give her latitude on complex tasks (Ace's directive 2026-04-30). Anita and Yuki stay at 3.

A new Supabase table `agent_spend` captures per-turn cost data: `agent_name`, `model`, `input_tokens`, `output_tokens`, `server_tool_calls`, `server_tool_cost_usd`, `total_cost_usd`, `channel`, `chat_id`, `turn_id`, `created_at`. The `AgentLoop.processMessage` method writes a row after every LLM call. This data feeds the Mission Control spend tile (next session, Sovereign-Mission-Control repo) so Ace can see per-agent cost in real time without manually reconciling logs against Anthropic's dashboard.

**Files touched:**
- `src/types.ts` — extend `LLMOptions` with `serverTools`, `thinkingBudget`, `anthropicBetas`; extend `LLMResponse.usage` with `serverToolCalls`.
- `src/llm/providers.ts` — extend `AnthropicProvider.generate` to merge `serverTools` into the tools array, attach `thinking` config when `thinkingBudget` is set, send `anthropic-beta` header, and parse `server_tool_use` counts from response.
- `src/index.ts` (~line 4940-5013) — Sapphire DM lane passes the new options.
- `src/tools/spend-logger.ts` (new) — the per-turn writer.
- `src/agent/loop.ts` — call the spend logger after each `activeLLM.generate`.
- `supabase/migrations/00X_agent_spend.sql` (new) — the table + RLS, staged not applied.

**Cost target:** Sapphire's per-turn average should drop in absolute token spend (no more Gemini bridge round-trip + custom tool schema), even though search-heavy turns may rise slightly because search results stream back as input tokens. Net: -10% to -25% on plain conversational turns; +5% to +20% on search-heavy turns. Mission Control tile makes this verifiable.

**Rollback:** All changes are additive on the provider side. If `web_search_20250305` regresses, set `serverTools: undefined` at the call site and the system reverts to the bridged tool. If interleaved thinking regresses, drop the beta header. No DB migration to undo (the migration is staged, not applied).

### Phase 2 — Conditional reminders + Pinecone recall tightening + structured `youtube_search` tool + Notion dedup-in-tool

**Status:** Planned. Dependent on Phase 1 ship.

**Phase 2 lead item — conditional/threshold-triggered reminders.** Architect surfaced this 2026-04-30 with the bank-account example: "create a new bank account when revenue reaches a certain amount." Current Sapphire can't watch metrics and fire on threshold crosses — only time-based reminders. This makes her *reactive only*, not anticipatory, which is the single biggest capability gap separating her from a real PA.

Architecture:

A new Supabase table `conditional_reminders` with columns: `id`, `created_at`, `created_by`, `chat_id`, `metric_source` (text — see enum below), `comparison_op` (`>=`, `>`, `=`, `<`, `<=`), `threshold` (numeric), `message` (text — what fires when crossed), `status` (`active`, `fired`, `cancelled`, `expired`), `last_checked_at`, `last_observed_value`, `fired_at`, `expires_at`, `metadata` (jsonb). RLS service-role write, anon read.

A new fat tool `conditional_reminders(action, ...)` for Sapphire — actions: `set`, `list`, `cancel`. Tool description documents the metric_source enum so the model can't make up sources.

A new scheduler job `conditional-reminders-checker` running every 15 min: reads `status='active'` rows, groups by `metric_source`, fetches current value once per unique metric (deduplicated reads), evaluates each row's condition. On cross: fire Telegram message to chat_id, atomic UPDATE to `status='fired'` + `fired_at = now()`. Hysteresis prevents double-fire.

Metric sources at launch (the enum):
- `stripe_revenue_total`, `stripe_revenue_30d`, `stripe_revenue_today` — Stripe gross revenue at three time grains
- `youtube_subs_total` — Sovereign Synthesis + The Containment Field combined
- `youtube_views_28d` — trailing 28-day view count across both channels
- `initiates_count` — Supabase `initiates` table row count (lead capture)
- `agent_spend_today`, `agent_spend_month` — *uses the spend_logger from Phase 1* — Sapphire can self-monitor cost and alert on anomalies
- `mindset_count`, `velocity` — existing `sovereign_metrics` columns

The composability principle: the metric_source enum is the registry. New metrics added to the enum become available to all conditional reminders without further tool changes. Phase 5 expands this to support computed metrics (e.g., "revenue / spend ratio").

Why this is the lead Phase 2 item: it's the structural change that makes Sapphire *anticipatory* — she watches the world and notifies you when something matters, instead of waiting for you to ask. Combined with Phase 1's interleaved thinking and native web_search, this is the largest qualitative jump in her presence-as-PA.

**Other Phase 2 items below:**


The 2026-04-30 failure had a second cause beyond tool wiring: Sapphire's `sapphire-personal` Pinecone namespace recalled three semantically unrelated past conversations into the briefcase turn. The cosine threshold in `src/agent/loop.ts:181` is 0.75 for the main namespace, but the polluting recalls scored ~0.63 — which means there is a separate code path with a lower threshold for the personal namespace, OR the threshold is being bypassed entirely for sapphire-personal. Phase 2 begins with grep-tracing this code path, reading the actual threshold logic in `src/proactive/sapphire-pa-context.ts` and any `sapphire-prefix` injectors, and tightening the threshold to ≥0.78 with an explicit floor.

Then, to close the structural mismatch where "show me the YouTube video" maps to no real action in Sapphire's tool surface, a new `youtube_search` tool is added that returns structured results: `{title, videoId, url, channelTitle, publishedAt, thumbnailUrl}`. Backed by the YouTube Data API v3 search endpoint (already authed for the comment watcher in S58). When Ace asks for a video, Sapphire returns clickable URLs, not prose summaries.

Phase 2 also moves Notion duplicate-prevention from doctrine into the tool itself. The current `NotionCreatePageTool.execute` accepts a parent page id and a title and creates the child without checking whether a child with that title already exists under that parent. The `signal_discipline_s125` doctrine piece tells Sapphire to call `notion_search` first, but doctrine is a band-aid — the model can forget. Structural fix: `NotionCreatePageTool` queries the parent's children before creating, returns "Page with this title already exists at <url>" if a match is found, and only creates if there's no match. Optional `force=true` arg allows intentional duplicates when Architect explicitly wants one. This pattern generalizes — any tool that creates a unique-by-name resource should self-check for collisions.

**Files touched:**
- `src/agent/loop.ts` (line ~174-195) — verify threshold logic and tighten.
- `src/proactive/sapphire-pa-context.ts` — find any namespace-specific recall paths, audit thresholds.
- `src/tools/sapphire/youtube.ts` — extend with `YoutubeSearchTool` class (next to existing `YoutubeTranscriptTool`).
- `src/tools/sapphire/index.ts` — register `YoutubeSearchTool` in `buildSapphireResearchTools()` (Phase 4 will collapse research/core/life packs anyway, so don't worry about pack purity).

**Cost target:** Eliminate Pinecone recall pollution turns (currently estimated 5–15% of Sapphire's failures). Reduce average context size on Sapphire DM turns by ~500–1,500 tokens (less polluted recall content).

**Rollback:** Threshold change is one-line; revert if it suppresses legitimate recalls. New tool is additive; deregister to remove.

### Phase 3 — Kill keyword tiering; move to LLM-dispatched tool discovery

**Status:** Planned. Medium effort. Dependent on Phase 1 + Phase 2 stable.

The current `src/tools/sapphire/_router.ts` (which is dead code — never called by the runtime, but exists as a landmine) and the active tier loaders in `src/tools/sapphire/index.ts` (`buildSapphireCoreTools`, `buildSapphireWorkflowTools`, `buildSapphireResearchTools`, `buildSapphireLifeTools`) are eliminated as gating mechanisms. They are replaced with one of two patterns:

The first pattern is **always-on with consolidated tools**: all of Sapphire's tools (post-Phase-4 consolidation, ~12 tools) load every turn, no tiering, no regex. Anthropic's own products (Claude Code, Claude Desktop) use this pattern. It works because the model picks tools by reasoning over their descriptions, not by keyword matching against user text. Once tools are consolidated to ~12 with strong descriptions, the always-on schema cost is ~3,000 tokens — comparable to the current tiered cost, with full domain reach.

The second pattern is **`tool_search` meta-tool**: Sapphire is given a single meta-tool that returns the list of tools matching a semantic query. When she needs a tool she doesn't have loaded, she calls `tool_search("upload to YouTube")` and gets back the relevant tool's full schema, which becomes available for the next iteration. Anthropic ships this pattern; Letta uses it; the Speakeasy MCP guides treat it as the canonical fix to the "30 tools loaded" problem.

Decision between patterns happens at Phase 3 kickoff. Default lean: pattern one (always-on with consolidation) for Sapphire because the consolidation in Phase 4 makes it viable. Pattern two becomes attractive again if Sapphire's tool count drifts back up past ~15.

**Files touched:**
- Delete `src/tools/sapphire/_router.ts` entirely.
- Refactor `src/index.ts` Sapphire DM lane to skip tier matching and pass the consolidated tool set directly.
- If pattern two: add `src/tools/sapphire/tool_search.ts` and remove other tools from the always-loaded set.

**Cost target:** Net-neutral or slight reduction in input tokens per turn. Net-positive in cross-domain reach: regex misses (e.g., asking about a video without using "video" or "youtube") stop happening.

**Rollback:** Restore `_router.ts` and the tier matchers. Tier system is a known-working state.

### Phase 4 — Consolidate 30 narrow tools to ~12 fat composable tools

**Status:** Planned. Medium effort. Compounds with Phase 3.

The current 30-tool sprawl has clusters that should collapse:
- `record_followup`, `list_followups`, `complete_followup`, `cancel_followup` → one `followups(action: "record"|"list"|"complete"|"cancel", ...)` tool.
- `set_reminder`, `list_reminders`, `cancel_reminder`, `cancel_reminder_series` → one `reminders(action, ...)`.
- `notion_create_page`, `notion_append_to_page`, `notion_search`, `notion_set_parent_page`, `notion_get_blocks`, `notion_update_block`, `notion_delete_block` → one `notion(action, ...)`.
- `gmail_inbox`, `gmail_search`, `gmail_send`, `gmail_draft` → one `gmail(action, ...)`.
- `calendar_list`, `calendar_create_event`, `calendar_reschedule` → one `calendar(action, ...)`.
- `set_piece`, `remove_piece`, `create_piece`, `list_pieces`, `view_self_prompt`, `view_identity_history` → one `self(action, ...)`.

Each consolidated tool gets a description written like a new-hire onboarding doc per Anthropic's "Writing tools for agents" engineering blog: when to use it, what each action means, what comes back, what NOT to use it for, examples. The model picks well when descriptions are precise; SOTA gains on SWE-bench come from description quality, not from adding tools.

**Files touched:** All `src/tools/sapphire/*.ts` files refactored to expose one composable tool per domain. `src/tools/sapphire/index.ts` exports the consolidated set.

**Cost target:** Tool schema size drops from ~7,500 tokens (30 tools × ~250 each) to ~3,000 tokens (12 tools × ~250 each). Also reduces "should I use `find_followup` or `list_followups`?" decision cost the model is silently paying.

**Rollback:** Phase 4 is the largest API-shape change in the refactor. Recommend a feature-flag rollout: keep both the old tools and the new composable tools registered, route Sapphire to the new set via `USE_FAT_TOOLS=true` env var, monitor for a week, then remove the old set. If consolidated tools regress (e.g., model can't pick the right action), revert env var.

### Phase 5 — Letta-style memory + Zep-style temporal graph + reflection loop

**Status:** Planned. Largest lift. The deepest payoff.

Sapphire's three-tier memory (SQLite for facts/family, Pinecone for semantic, Supabase for ops) already has the bones of MemGPT/Letta's context-as-OS-memory-hierarchy. What's missing is **the agent owning memory writes as normal tool calls** instead of memory being plumbed by the framework. Phase 5 introduces:

`core_memory_append`, `core_memory_replace` — Sapphire-controlled writes to a small in-context "core memory" block (always visible, capped at ~1,500 tokens) holding her current understanding of who Ace is, what's active, what she's tracking. Replaces the rigid `[CORE MEMORY]` block currently injected from SQLite facts.

`archival_insert`, `archival_search` — Sapphire-controlled writes to an out-of-context archival store (Pinecone, but with namespaces she chooses). Replaces the framework-driven `extractAndEmbed` pattern in `src/agent/loop.ts`.

`recall_with_temporal` — Zep-style retrieval over a temporal knowledge graph (new infrastructure: probably Neo4j or Postgres with graph extensions). Edges carry `valid_from` / `superseded_at` windows. When Ace says "Aliza's school" and Aliza switched schools last month, recall returns the *current* school, not both. On LongMemEval, Zep beats Mem0's flat-vector approach by ~14 points specifically on temporal-update questions — exactly what a personal assistant lives or dies on.

A **reflection loop** runs after substantive turns: Sapphire reviews what she just did, what worked, what didn't, and writes a short reflection to her diary (existing tool). Reflexion paper (Shinn 2023) shows this measurably improves agent performance over time when the reflections feed back into the next-turn context. The cost is one extra LLM call per turn she chooses to reflect on (she controls the trigger).

**Sleeptime consolidation** (Letta v1) runs as a Railway scheduled job at 4am Ace-time: re-embeds drifted memories, prunes stale recalls, updates the temporal graph with overnight events from email/calendar. The user-facing turn stays fast; the agent reorganizes itself in the background.

**Files touched:** Major. `src/memory/letta-style.ts` (new), `src/memory/temporal-graph.ts` (new), `src/tools/sapphire/memory_*.ts` (new), `src/proactive/sleeptime-consolidator.ts` (new). Migration to Neo4j or pgvector-with-graph extensions.

**Cost target:** Eliminate the entire class of "Sapphire forgot something" failures. Eliminate temporal staleness bugs (telling Ace someone is at a job they left). Move from ~70% memory-question accuracy (current Mem0-class flat vector) to ~85% (Zep-class temporal graph) on the LongMemEval benchmark.

**Rollback:** Phase 5 is the largest lift and the largest risk. Strict feature flagging required. Old memory paths kept live and routable until new architecture proves stable across a multi-week period.

---

## How this generalizes — the rest of the swarm

Sapphire is the proof. Once she ships Phases 1-4, the same shape applies to the other agents with role-appropriate tuning:

**Anita (email reply specialist)** — gets the same provider-level upgrades from Phase 1 (native `web_search` is overkill for her; skip it. Interleaved thinking on Gemini Flash isn't a thing yet — she stays on Gemini Flash for cost. The spend logger is automatic for her too once `AgentLoop.processMessage` writes spend rows on every LLM call regardless of agent.). **Already on Gemini → Groq per `AGENT_LLM_TEAMS.anita = ["gemini", "groq"]` at `src/index.ts:406`** — no model migration needed; spend logger captures her by default once the migration applies. Phase 4 tool consolidation: she should have ~5 tools max — `gmail`, `email_classify`, `email_reply`, `recall_facts_about_sender`, `escalate_to_sapphire`. Tools-per-turn budget: 3.

**Yuki (social engagement specialist)** — same deal. **Already on Gemini → Groq per `AGENT_LLM_TEAMS.yuki = ["gemini", "groq"]` at `src/index.ts:410`** — no migration needed; spend logger captures her automatically. Phase 4 tools: `youtube_engage`, `bluesky_engage`, `instagram_engage`, `recall_brand_voice`, `escalate_to_sapphire`. Tools-per-turn: 3. The current Yuki module sprawl (`yuki-bluesky-replier.ts`, `yuki-comment-replier.ts`, `yuki-hook-dropper.ts`, `yuki-instagram-replier.ts`, `yuki-shorts-pinner.ts`, `yuki-bluesky-hook-dropper.ts`) is six modules where one composable agent with a `platform` argument would do.

**Vector (metrics + dispatch)** — already simplified after S109 killed the inter-agent dispatch chain. Phase 4 tools: `read_metrics`, `read_recent_briefings`, `propose_action`, `escalate_to_sapphire`. Tools-per-turn: 2. Possibly the simplest agent post-refactor.

**Veritas, Alfred** — to be evaluated when Phase 4 comes around. Both are content-side; tool surfaces probably collapse to 4-6 tools each.

**Common pattern across all specialists:** every one has an `escalate_to_sapphire` tool. When a specialist is out of its depth, it doesn't try to reason across domains it wasn't built for — it hands off to the generalist. This is the cleanest expression of specialist/generalist separation and prevents the Vector→Anita→Yuki dispatch chain pattern from re-emerging in disguise.

---

## What's NOT in this plan

A few things deliberately deferred or excluded:

**Multi-agent autonomous coordination (Crew Mode 2.0).** Out of scope until Sapphire is stable. The current Vector→specialists pattern (post-S109) is sufficient for the current load.

**Voice mode upgrades.** Sapphire's voice replies (Groq Whisper transcription, ElevenLabs TTS) are a separate concern from cognitive architecture. Untouched here.

**Cross-language / multimodal expansion.** Sapphire's English-only and text-with-image-vision is fine for current Ace use. No reason to add complexity.

**A move off Telegram.** Telegram remains Sapphire's primary channel. Mission Control is read-only visualization, not a control surface.

---

## Reading list (sources for the architectural choices)

- Anthropic — `web_search` server tool blog and API docs.
- Anthropic — extended thinking docs and the `interleaved-thinking-2025-05-14` beta.
- Anthropic Engineering — "Writing tools for agents" (the new-hire-grade tool description argument).
- Lee Han Chung — "Claude Agent Skills: A First Principles Deep Dive" (Anthropic's own products use LLM-dispatched tool selection, not regex routing).
- Letta — "Agent Memory" blog and Letta v1 architecture rewrite (sleeptime consolidation, agent-owned memory writes).
- Packer et al. — MemGPT paper (UC Berkeley Sky Lab) — the canonical context-as-OS-memory-hierarchy reference.
- Mem0 — "Building Production-Ready AI Agents" (arXiv 2504.19413) and the State of AI Agent Memory 2026 piece.
- Atlan — "Zep vs Mem0" (LongMemEval data showing Zep beats Mem0 by ~14 points on temporal questions).
- Yao et al. — ReAct paper (arXiv 2210.03629).
- Shinn et al. — Reflexion paper (arXiv 2303.11366).
- Wang et al. — Voyager paper (arXiv 2305.16291) — lifelong skill library.
- Speakeasy — MCP dynamic tool discovery guides.
- Patronus AI — Agent Routing guide (LangGraph + ReAct as 2026 default).

URLs and full citations are in the prior session's research agent report; reproduce in this document if it ever needs to travel without that context.

---

## Maintenance

This document is the source of truth for the multi-session refactor arc. The master reference points here. Every session that touches a phase updates the **Status** of that phase in this file, plus a short note in the relevant phase section about what shipped, what regressed, and what to do next. When all five phases are complete, this document gets archived and the master reference picks up the running invariants.

**Last touched:** 2026-04-30 (S125+ — Phase 1 staged, awaiting pipeline-clear push).
