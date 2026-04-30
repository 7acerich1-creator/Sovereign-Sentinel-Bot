# Deferred Builds — Tracking File

When something gets scoped out for later (not abandoned, just not now), it lives here. Read this before starting any new build to check if it's already on the list.

**Last updated:** 2026-04-25 (S114u — assembled prompt build for Sapphire)

---

## High-priority deferred work

### 1. Self-healing layer for the crew

**Why:** Right now if Yuki's Buffer post fails or Anita's email crashes, the dispatch logs the error but nothing recovers. For "fully autonomous" Ace needs the bot to handle its own broken state.

**What it would include:**

- Circuit breakers per agent (consecutive failure threshold → pause that agent for N minutes)
- Dead-letter queue for failed dispatches (`crew_dispatch_failed` table) with auto-escalation to Ace via Telegram after threshold
- Auto-retry with exponential backoff on transient failures (network, 5xx)
- Per-tool error stats so Ace can see which tools fail most

**Estimated work:** 1 focused session. Touches `src/agent/crew-dispatch.ts`, new Supabase table, retry helper, Telegram alerter.

**Triggers a build:** When the next live failure causes Ace to lose work.

---

### 2. Apply assembled-prompt + spice pattern to Veritas

**Why:** Veritas is strategic brain. He'd benefit from variation in framing and the ability to self-modify his strategy pieces based on what's working. Sapphire is the only agent that needs this; the crew (Alfred/Anita/Yuki/Vector) does NOT — they're functional workers, this would just bloat their prompts.

**What it would include:**

- Veritas-specific prompt pieces JSON (strategic frames, planning modes, intensity levels)
- Veritas spice pool (focus snippets, anti-loop snippets)
- Self-mod tools scoped to Veritas only (or shared if Sapphire's scoped)

**Estimated work:** 1 session AFTER Sapphire's pattern is proven in production for \~2 weeks.

**Triggers a build:** Once Sapphire's assembled system is shipped, stable, and showing measurable benefit.

---

### 3. Goals system with progress journal

**Why:** Per ddxfish/sapphire: hierarchical goals (parent/child) + timestamped progress entries. Lets Sapphire say "you've moved on Plan X 3 times this month" instead of just acknowledging each request fresh.

**What it would include:**

- `sapphire_goals` Supabase table — id, parent_id, title, target, status, created_at
- `sapphire_goal_progress` table — goal_id, note, timestamp
- Tools: `set_goal`, `update_goal`, `log_progress`, `list_goals`, `goal_status`
- Integration with morning brief — surface stale goals

**Estimated work:** 1 session.

**Triggers a build:** When Ace asks to track goals he's mentioned multiple times.

---

### 4. Cross-namespace semantic recall for crew agents

**Why:** Agents currently only recall from their OWN Pinecone namespace. The `shared` namespace exists and gets populated by the insight-extractor when an insight is cross-cutting — but agents don't query it yet. This means cross-pollination is one-way (write only, no read).

**What it would include:**

- Modify agent-loop semantic recall to query both own namespace AND `shared`
- Weight own &gt; shared (e.g., topK=3 own + topK=2 shared)
- Test in a low-stakes dispatch first

**Estimated work:** 30 minutes. Touches `src/agent/loop.ts` only.

**Triggers a build:** When a crew agent visibly fails to use insight that another agent already produced.

---

### 5. Light-touch crew agent improvements

**Why:** Same tool discernment + mode filtering treatment Sapphire got. Real value: less token use, less hallucination on dispatches, fewer wasteful tool calls.

**What it would include:**

- ONLY-WHEN tool descriptions for Alfred/Anita/Yuki/Vector tools
- MODE_FILTER pattern (some tools are dispatch-mode only, some are interactive-only)
- Verify insight-extractor is actually firing on their dispatches

**Estimated work:** 1 session.

**Triggers a build:** When Ace has bandwidth + capital to monitor for regressions. Skipped for now because Ace is going offline 1-2 days and crew agents are stable.

---

## How to use this file

1. **Before starting anything new:** check if it's on this list.
2. **When deferring something:** add it here with the same structure (Why / What / Estimated work / Triggers a build).
3. **When shipping a deferred item:** delete the entry (keep this file tight).

## Where this file lives in the brain

- This file is at repo root: `Sovereign-Sentinel-Bot/DEFERRED-BUILDS.md`
- Indexed in agent memory at `reference_deferred_builds.md`
- Read by every session at startup if relevant

---

## S125 ADDITIONS (2026-04-29)

### ~~Sapphire web_search tool + verify-facts-before-stating guardrail~~ — ✅ SHIPPED S125g (2026-04-29)

Built and live. `src/tools/sapphire/web_search.ts` calls Gemini 2.5 Flash with `google_search` grounding, returns answer + up to 5 source URLs. Added to core tool pack. `verify_facts_before_stating` prompt extra activated in DB.

**Why:** S125e Jay Kelly diagnostic — Sapphire confidently said "Paul Blart: Mall Cop" when Architect asked about a movie with "Jay something" + an assistant who'd been with him his whole life. Correct answer (Jay Kelly, 2025, Clooney + Sandler) was post-cutoff for her current LLM (Gemini Flash Lite, \~early-2024 cutoff). She has no quick-search tool and her `discernment` extra actively tells her to answer without calling tools when she "can." Result: confident hallucination on knowledge questions.

**What it would include:**

- `WebSearchTool` in `src/tools/sapphire/` — Tavily / Brave / Google CSE backend (low cost). Returns top 3 result snippets + URLs.
- New prompt extra `verify_facts_before_stating`: when about to claim a movie title, actor, date, news fact, public figure, recent event — call web_search FIRST. Single-source answers must include the URL. Hedge if search returns ambiguous results.
- Update `discernment` extra to carve out: knowledge questions about world facts ALWAYS need web_search, not "answer from context."
- Optional: when Anthropic credits restored, route knowledge-heavy queries to Sonnet + grounding instead of Flash Lite.

**Estimated work:** 1-2 hours. Single new tool file + 2 prompt extras + DB activation.

**Triggers a build:** Architect tops up Anthropic credits OR next time Sapphire confidently fabricates a fact.

---

### Migrate Gemini conversation history into Sapphire's Pinecone

**Why:** Architect has \~1 year of Gemini conversations holding personal context, family details, brand history, project iterations, recurring patterns. Right now Sapphire only has S114u-onward DM history + the 80 hand-seeded "Sovereign Synthesis" namespace vectors + a few hundred sapphire_known_facts. Gemini knows orders of magnitude more about Architect's life than she does.

**What it would include:**

1. Architect runs Google Takeout → My Activity → Gemini Apps → Export. Receives JSON archive.
2. Ingestion script (probably `scripts/ingest_gemini_history.ts`) that:
   - Walks the export, extracts substantive Q&A turns (filters out one-shots, code snippets that don't reference his life)
   - Chunks long conversations into \~500-token segments preserving turn boundaries
   - Embeds each chunk via existing Pinecone embed pipeline
   - Writes to `sapphire-personal` namespace with metadata `{source: "gemini_takeout", date, topic_inferred}`
3. Optional pass with Gemini Pro to extract specific structured facts (DOBs, schools, recurring frustrations, named people in his life) and write those to `sapphire_known_facts` for instant recall.
4. Verification: pull a sample of imported chunks via memory-audit endpoint, confirm semantic recall finds them when relevant.

**Estimated work:** 1 focused session. Needs Architect to first run Takeout + share archive path.

**Triggers a build:** Architect ready to invest the session AND has Gemini archive in hand.

---

### Frequency Alignment Brief — daily Sovereign Synthesis upload summary

**Why:** Architect listens to Sovereign Synthesis videos as frequency alignment — they "meet him where he's at and help align his frequency." He wants Sapphire to produce a daily summary of the previous day's SS upload so he can quickly orient on the day's transmission without re-watching. Goal is alignment, not transcription.

**What's already in the codebase:** Partial — `runFrequencyAlignmentBrief` (or similar) was added in S122 by parallel system. Logic at `src/proactive/sapphire-pa-jobs.ts` \~line 519 with a SYSTEM_PROMPT that produces a "FREQUENCY ALIGNMENT BRIEF" with sections: Core Thesis, Key Signals, Frequency, Anchor. Polled every 15min between 19:15-00:30 UTC waiting for the day's vidrush_orchestrator upload.

**What needs to be ironed out:**

- Verify the existing brief actually fires reliably and lands somewhere Architect sees it
- Tune the prompt for actual frequency-alignment value (currently emphasizes "Frequency" + "Anchor" sections — does that map to Architect's lived experience of alignment?)
- Decide where it surfaces: Telegram DM from Sapphire? Notion (Daily Briefs folder)? Mission Control briefing? All three?
- Add a "skip if Architect already watched" signal? Or always send?

**Estimated work:** \~30-60 min depending on how much the existing impl works. Needs Architect to clarify what "alignment" looks like to him so the prompt frames toward that, not toward generic summary.

**Triggers a build:** Architect ready to iterate on the prompt + verify the existing pipeline. Or next time he says "I haven't gotten my alignment brief in N days" → debug existing path first.

---
