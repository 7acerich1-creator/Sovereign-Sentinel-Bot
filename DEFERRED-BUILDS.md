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

**Estimated work:** 1 session AFTER Sapphire's pattern is proven in production for ~2 weeks.

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
- Weight own > shared (e.g., topK=3 own + topK=2 shared)
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
