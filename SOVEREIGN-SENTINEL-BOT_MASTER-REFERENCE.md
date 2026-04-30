# Sovereign Sentinel Bot — Master Reference (LEAN)

> **This file holds INVARIANTS ONLY.** Things that don't change session-to-session: identity, infrastructure IDs, env var map, schemas, protocols, the canonical account map, the product ladder, architectural rules.
> ****For session-by-session history** (Sessions 1–47, every fix, every DVP tag, every resolved blocker) see `HISTORY.md`. That file is the append-only journal. This file is the trimmed reference.
> ****For live runtime truth** (TTS routing, LLM chain, git SHA, env var presence at boot) see `LIVE_STATE.md`. Auto-generated from `src/voice/tts.ts` + `src/index.ts`. If `LIVE_STATE.md` contradicts anything in this file, `LIVE_STATE.md` **wins** — patch this file and move on.
> ****For revenue-first sanity check** (the 5 input metrics, current highest-leverage action) see `NORTH_STAR.md`. Read before authorizing any build task.

**Last trimmed:** 2026-04-11 (Lean rewrite — everything archived to [HISTORY.md](http://HISTORY.md))

---

## S125+ — Sequential Rotator wired into YouTube pipeline (2026-04-30)

**Commit:** Pending push — 4 files staged + Supabase migration `add_pipeline_rotation_state` already applied to project `wzthxohtgojenukmdubz`.

**Why:** S125+ failure (visible in Telegram screenshot 2026-04-30 10:13) — `ScriptTooSimilarError` rejected SS candidate at cosine 0.871 against shipped `fv_sovereign_synthesis_resource-dynamics_1777388770163`. Surface diagnosis was "uniqueness threshold too tight." Real diagnosis (Architect pushed back on the patch-the-symptom answer) was that **three parallel variety systems existed and only one was wired**: 14-15 niches per brand × 14-15 angles per niche = ~225 curated unique seeds in `src/data/thesis-angles.ts` were sitting unused for the YouTube pipeline (only `content-engine.ts` imported them for Buffer posts). The YouTube pipeline drove its thesis from Alfred's runtime LLM output (1-2 sentences, voice-bounded). When `extractNarrativeBlueprint`'s JSON parse failed (often, due to thin input), it fell back to a hardcoded "Monad / timeline / frequency" blueprint — the SAME blueprint every time. Every fallback-driven script landed in the same lane. Uniqueness guard caught it three retries deep, after wasted compute and a false sense of "writer voice convergence." Architect's call: stop patching, fix the wiring. The infrastructure was always there, it just wasn't connected.

**Code changes:**

- **NEW: `src/tools/rotation-state.ts`** (275 lines) — pure rotator. `computeSeedAtSlot(brand, slot)` is no-I/O and returns the (niche, angle) pair for any slot. `advanceAndPickSeed(brand)` reads Supabase, computes the seed, atomically PATCHes `total_ships+1` with `last_niche`/`last_angle_id`, returns the seed. `assertRotationCoverage()` verifies all 30 niches have angle pools — called at boot. `previewRotation(brand, start, count)` for diagnostics.
- **`src/engine/vidrush-orchestrator.ts`** — rotator wired into `isRawIdeaMode` branch of `executeFullPipeline`. When Alfred fires the auto-pipeline, the rotator overrides his thin thesis with the next curated 2-4 sentence angle from `THESIS_ANGLES`. Alfred's thesis is appended below as flavor context, not the primary thesis. Rotator's `niche` overrides any caller-provided niche.
- **`src/engine/faceless-factory.ts`** — added `BlueprintExtractionFailed` error class. **Killed the silent fallback** in `extractNarrativeBlueprint`. New behavior: parse fails → retry once at `temperature=1.0` → if still fails, throw. The auto-pipeline catches and surfaces via Telegram. The hardcoded "Monad" blueprint is gone.
- **`src/index.ts`** — dropped Alfred's redundant `recordNicheRun` write at line 5513 (was polluting the LRU window with NULL `aesthetic_style` rows — every shipped video produced one row WITH aesthetic + one row WITHOUT). Faceless factory is now the single source of truth for `niche_cooldown` writes. Added boot-time `assertRotationCoverage()`.

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

## ⚡ Session Start Protocol (from `CLAUDE.md`)

1. Read `NORTH_STAR.md` — revenue gate, 5 input metrics, current highest-leverage action.
2. Read `LIVE_STATE.md` — regenerate via `npm run verify-state` if missing or &gt;24h old.
3. Read this file — invariants, schemas, architectural rules.
4. Read memory index `MEMORY.md` — feedback, prior session learnings.
5. Only read `HISTORY.md` when you need a specific past session's context (searchable by session number or DVP tag).

**Never push to** `main` **while the pipeline is running.** Railway auto-deploys and kills the container. See `feedback_no_push_during_pipeline.md` in memory.

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

## 0. ARCHITECTURAL DIRECTIVES (Non-Negotiable)

These are hard rules that govern every session's work. Violations create the bugs history keeps archiving.

### 0.1 Prompt Economy — RETIRED S117
The "1000-token cap" was a band-aid for a different problem (27k context bloat from bulk-loading everything into every prompt). It got cargo-culted forward and started constraining good directive design. Replaced by the **ddxfish active-state pattern** (see [`MAVEN-CREW-DIRECTIVES.md`](./MAVEN-CREW-DIRECTIVES.md) §1.3): prompts assemble per turn from a pieces library + active state + spice rotation, so the prompt is exactly as long as it needs to be for the current scenario, no more. New rule: prompts should be tight, not arbitrarily short. Sapphire's prompt-builder (`src/agent/sapphire-prompt-builder.ts`) is the reference implementation.

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
`INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ID` (Meta API abandoned) · `TIKTOK_ACCESS_TOKEN` (deferred until app approval) · `BUFFER_ACCESS_TOKEN` (v1 REST dead, use `BUFFER_API_KEY`)

> **Note (S117):** `GEMINI_API_KEY` was listed as KILLED here for sessions citing the S35 billing crisis. That note is stale and was wrong. The S35 problem was a runaway Anita/dispatch loop, not the key itself. `GEMINI_API_KEY` has been required ever since — Sapphire PDF/news/research, the insight-extractor, gemini-flash text-gen, and Pinecone embeddings all depend on it. Confirmed live S117 via `/debug/memory` (HTTP 200, embedding endpoint working, 4339 Pinecone vectors).

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

## 14. AGENT COORDINATION — see [`MAVEN-CREW-DIRECTIVES.md`](./MAVEN-CREW-DIRECTIVES.md)

Per-bot calibrated directives, decision trees, autonomy loops, reflection schemas, ddxfish prompt-pieces structure, hive-interface contracts, DM format templates, self-evolution hooks, and tool sets are all canonical in [`MAVEN-CREW-DIRECTIVES.md`](./MAVEN-CREW-DIRECTIVES.md). This section formerly held a 6-row exec-role table + tool summary; both are superseded by the directive doc.

**The Sapphire-as-Life-COO refinement (S117):** Sapphire's "COO" role is COO of Ace's *life*, not the business. Veritas owns business macro. Operational test: business numbers → Veritas; Richie numbers → Sapphire.

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
