# CONTINUITY AUDIT — BOTH MASTER REFERENCES
### Date: 2026-04-02 | Session: Cowork

---

## WHAT THIS AUDIT COVERS

Full cross-reference of SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md (23 sections) and MISSION-CONTROL-MASTER-REFERENCE.md (19 sections) to verify: logical flow from top to bottom, no contradictions between documents, no stale data, no undocumented gaps in the infrastructure chain, and both documents telling the same story about the same system.

---

## CONTRADICTIONS FOUND & FIXED (this session)

### 1. Webhook Bridge: "Planned — Not Built" vs. LIVE
- **Sentinel Bot Section 10** said "Planned — Not Built"
- **MC Section 8** + **Sentinel Bot Phase 8D** both said DONE (2026-04-01)
- **Fix applied:** Section 10 header updated to "✅ LIVE (2026-04-01)" with operational details

### 2. Pinecone: "CURRENTLY BROKEN" vs. "FULLY OPERATIONAL"
- **Sentinel Bot Section 3** said "CURRENTLY BROKEN (see Section 8)"
- **Sentinel Bot Section 8** said "✅ FULLY OPERATIONAL (Verified 2026-03-31)"
- **Fix applied:** Section 3 updated to reflect operational status

### 3. Knowledge Nodes: "blocked by Pinecone 401" but Pinecone is live
- **Sentinel Bot Section 13** said "0/75 synced to Pinecone (blocked by Pinecone 401)"
- Pinecone has been working since 2026-03-31
- **Fix applied:** Updated to "sync status unknown — needs verification via Railway boot logs"

### 4. Git Push Protocol: conflicting instructions across both docs
- **MC Section 3** said "Git push is Claude's responsibility — not Ace's" (blanket statement)
- **MC Section 14** said "NEVER ask Ace to push"
- **Sentinel Bot Section 4** (pre-fix) only covered Desktop Commander, not Cowork
- **Reality:** Cowork has no git credentials. Ace MUST push from Cowork sessions.
- **Fix applied:** Both documents updated with environment-specific push rules. Sentinel Bot Section 4 rewritten with full environment table. MC Section 3 + 14 updated.

### 5. Buffer Channel Count: stale mention of LinkedIn/Pinterest
- **Sentinel Bot Section 11** said "TikTok/IG/YT/X/LinkedIn/Threads/Pinterest (Ace Richie)"
- **Verified channel map (Section 8):** Only 9 channels. No LinkedIn. No Pinterest.
- **Fix applied:** Section 11 corrected to match verified channel map

### 6. Posting Math: outdated across both docs
- Both docs said "6 posts/day × 9 channels = 54/day = 378/week"
- **New reality (2026-04-02):** IG capped at 2-3/day → 47 posts/day = 329/week
- Plus 7-day batch strategy and trending override slot
- **Fix applied:** Posting Guide, Sentinel Bot Section 11, MC Section 15 all updated

### 7. YouTube OAuth: MC said "Ace must add 3 env vars" but they're already SET
- **MC Section 15** said tokens need to be added to Railway
- **Sentinel Bot Section 8** confirmed BOTH tokens SET (2026-03-31)
- **Fix applied:** MC Section 15 updated to reflect current state

### 8. Handoff Checklist: only described Desktop Commander path
- **Sentinel Bot Section 22** only had Desktop Commander git commands
- No mention of Cowork or the "push deferred" state
- **Fix applied:** Updated to reference the three-state push protocol from Section 4

---

## STRUCTURAL GAPS — NOT CONTRADICTIONS, BUT MISSING PIECES

### GAP A: No "System Flow Diagram" section in either document
Both documents describe pieces of the system in detail, but neither has a single section that traces the COMPLETE user journey from first touch to Inner Circle membership. The flow exists across multiple sections but requires mental assembly:

**The complete chain (currently spread across both docs):**
```
TRAFFIC (YouTube/social content — Sentinel Bot Section 11)
  → LANDING PAGE (sovereign-synthesis.com — MC Section 7)
  → EMAIL CAPTURE (Supabase insert — MC Section 2)
  → WELCOME EMAIL (Edge Function — MC Section 9)
  → NURTURE SEQUENCE (5 steps over ~17 days — MC Section 9/11)
  → STRIPE CHECKOUT (tier-specific — MC Section 4)
  → PURCHASE EMAIL (Edge Function — MC Section 9)
  → COURSE PORTAL (auth gate — MC Section 10)
  → COURSE CONTENT (NOT YET BUILT — MC Section 10 INFRA-09)
  → INNER CIRCLE (Telegram integration — UNDOCUMENTED specifics)
```

**Recommendation:** Add a "Section 0: Complete System Flow" to the MC master reference that traces this chain with specific section cross-references. Not new content — just an assembly map of what's already documented.

### GAP B: Tier 7 Inner Circle delivery is completely undocumented
- MC Section 4 lists Inner Circle at $12,000 with portal URL `/tier-7/member-portal`
- MC Section 10 INFRA-09 mentions "Tier 7 (Inner Circle): exclusive member portal + Telegram integration"
- **But nowhere in either document** does it say what the Inner Circle member actually GETS
- No documented Telegram group/channel for IC members
- No documented onboarding flow for IC members
- No documented content delivery for IC members
- The purchase email (07-purchase-tier7) mentions "Telegram note" but specifics undocumented

### GAP C: GROQ_API_KEY — mentioned as critical, still not set
- Sentinel Bot session summary says "CRITICAL ENV VAR NEEDED: Add GROQ_API_KEY to Railway"
- Section 18 env var map shows GROQ_API_KEY: ❌ Not set
- This has been called out for TWO sessions but hasn't been acted on
- Without it, pipeline has Gemini (250 req/day quota) → Anthropic (zero credits) → OpenAI as the only fallback

### GAP D: content_engine_queue table — documented in Section 23 but not in Section 7
- Section 23 says `content_engine_queue` was created in Supabase with 19 columns + 3 indexes + RLS
- Section 7 (Supabase Tables) doesn't list it
- MC Section 6 (Supabase) also doesn't list it
- Same for the `content_engine_queue` not appearing in the Supabase Read/Write Ownership Map (MC Section 6)

### GAP E: Make.com Scenarios D, E, F missing from Sentinel Bot master reference
- MC Section 5 lists ALL 6 scenarios (A through F) with webhook URLs and status
- Sentinel Bot Section 14 only mentions Scenario D as a "bot scenario"
- Scenarios E (YouTube Transcription Pipeline) and F (Sovereign Clip Pipeline) are bot-side automation but aren't documented in the Sentinel Bot master reference
- The Make.com boundary rule says bot sessions own D, E, F — but the bot's own doc doesn't describe E and F

### GAP F: Stripe webhook Edge Function (`stripe-webhook`) underdocumented
- MC Section 10 INFRA-08 mentions a `stripe-webhook` Edge Function that handles member_access writes
- This is SEPARATE from `send-purchase-email`
- Both fire on `checkout.session.completed`
- The `stripe-webhook` function ID, version, and full behavior are not documented anywhere with the same detail as the two email Edge Functions (MC Section 9)

### GAP G: No "Verification Status" section for end-to-end paths
- Many items say "BUILT" or "COMPLETE" but the end-to-end verification status is scattered
- Sentinel Bot Phase 3: "3C NEEDS RETEST", "3D NEEDS RETEST", "3E NEEDS RETEST"
- MC says "Funnel is built but has not yet received live traffic"
- No single checklist shows: "has a real human completed this path successfully?"

### GAP H: Agent personality blueprints — last updated 2026-03-27
- All 6 agent blueprints in Supabase `personality_config` were last updated 2026-03-27
- Since then: Vector's role shifted (no longer distribution, now performance tracking), Yuki has YouTube OAuth, the Deterministic Content Engine was built, the webhook bridge went live
- Agents may be operating on stale instructions that don't reflect the current architecture

---

## LOGICAL SEQUENCE ASSESSMENT

### Sentinel Bot Master Reference (23 sections)
The flow is generally logical: identity → domain separation → infrastructure → git workflow → agents → codebase → tables → blockers → API status → webhook bridge → content pipeline → product ladder → knowledge base → Make.com → email tools → agent coordination → strategic plan → env vars → TikTok/IG → legacy assets → reference links → handoff checklist → content engine.

**Issue:** Sections 9 (Meta/IG KILLED) and 19 (TikTok Deferred / IG KILLED) overlap significantly. Both describe the same decision about Instagram. Section 9 could be collapsed into Section 19 or vice versa.

**Issue:** Section 10 (Webhook Bridge) is sandwiched between Meta/IG status (9) and Content Pipeline (11). It would be more logical next to Section 5 (Agents) or Section 6 (Codebase Architecture) since it's core infrastructure.

**Issue:** Section 20 (Legacy Asset Protocol) duplicates Section 16 in the MC master reference. Same content, slightly different wording. Should be documented in ONE place with a cross-reference.

### Mission Control Master Reference (19 sections)
The flow: objective → system architecture → hosting → Stripe → Make.com → Supabase → landing pages → dashboard → design system → email → course delivery → infrastructure pipeline → operational tasks → credentials → operational rules → content pipeline → legacy assets → handoff → deliverable inventory → session log.

**Issue:** The Infrastructure Pipeline (Section 11) is the longest section in the document at ~180 lines with INFRA-01 through INFRA-10. Most items are ✅ COMPLETE. This section should be collapsed to a summary table with a note that the detailed audit trail is preserved in the session log.

**Issue:** Section 12 (Operational Tasks) still shows items from March 31 with "due 3/31" and "due 4/3" — some of these are stale.

---

## CROSS-REFERENCE INTEGRITY CHECK

| Shared Concept | Sentinel Bot Says | MC Says | Match? |
|---|---|---|---|
| Supabase project ID | wzthxohtgojenukmdubz | wzthxohtgojenukmdubz | ✅ |
| Railway URL | gravity-claw-production-d849.up.railway.app | gravity-claw-production-d849.up.railway.app | ✅ |
| Railway project ID | 77e69bc6-f7db-4485-a756-ec393fcd280e | (not listed) | ⚠️ MC should reference |
| Vercel project ID | (not listed) | prj_P8HfPP5BjJYAbAM9KT1FbC4KGpFm | ✅ (Sentinel doesn't need it) |
| Buffer channels | 9 verified | 9 verified | ✅ |
| Stripe product IDs | Section 12 | Section 4 | ✅ Match |
| Make.com scenarios | Section 14 (mentions D only) | Section 5 (A–F) | ⚠️ Sentinel missing E, F |
| Agent count | 6 (immutable) | 6 (displayed on dashboard) | ✅ |
| Agent colors | Not documented | Section 8 | ✅ (only MC needs them) |
| Domain separation rule | Section 2 | Section 6 ownership map | ✅ |
| Push protocol | Section 4 (full table) | Section 3 + 14 | ✅ (now aligned) |
| Posting cadence | Section 11 (329/week) | Section 15 (329/week) | ✅ (now aligned) |
| Webhook bridge | Section 10 (LIVE) | Section 8 (LIVE) | ✅ (now aligned) |
| Legacy asset protocol | Section 20 | Section 16 | ⚠️ Duplicated |

---

## PRIORITY ACTIONS

### Immediate (this session or next)
1. **Add GROQ_API_KEY to Railway** — called out for 2+ sessions, still missing
2. **Verify knowledge node sync** — check Railway boot logs for Pinecone auto-sync
3. **Add `content_engine_queue` to Supabase table maps** in both Section 7 (Sentinel) and Section 6 (MC)

### Near-term
4. **Update agent personality blueprints** in Supabase — stale since 2026-03-27, don't reflect current architecture
5. **Document Inner Circle (Tier 7) delivery specifics** — what does the $12K buyer actually get?
6. **Add Scenarios E + F details** to Sentinel Bot master reference
7. **Document `stripe-webhook` Edge Function** with same detail level as the email functions

### Cleanup (low priority, non-blocking)
8. **Collapse MC Section 11 (Infrastructure Pipeline)** — most items complete, move detail to session log
9. **Merge duplicate legacy asset sections** (Sentinel 20 + MC 16) into one location
10. **Consider consolidating Sentinel Sections 9 + 19** (both about killed/deferred APIs)
11. **Add system flow diagram to MC** — assembly map of the complete user journey
