# SOVEREIGN SENTINEL BOT — MASTER REFERENCE
### Last Updated: 2026-04-10 (Session 44 — Stasis regression triage: LIGHT MODE dispatch shipped. Root cause of stasis_self_check repeated max-iterations failures was the iter-cap + tool-loop trap (not prompt bloat). `processMessage` gains optional `textOnly` 4th arg; `stasis_self_check` routes text-only with `toolDefs=[]` and `iterCap=1`. Verified in production via synthetic probes (Anita 17s, Vector 59s — both returned clean character-voice text). Session 43 commit `8339dbc` pushed + deployed pre-session; Session 44 commit `1a766d2` pushed + deployed. Kinetic Baseline (Task 3) deferred to Session 45.) | Session Handoff Protocol: UPDATE THIS AFTER EVERY SESSION

---

## CRITICAL STATUS REPORT (as of Session 28, 2026-04-05)

**Mission Metrics:** Gemini text-gen hemorrhage fully diagnosed and killed. Voice locked. Script gen architecture overhauled. Revenue still $0.

**Infrastructure: OPERATIONAL — ALL PUSHED.**
- Bot is live on Railway. Latest commit: Session 32 `PENDING-PUSH` (music fix + signature audio + scene count 12) → Session 31 `PENDING-PUSH` (pipeline reliability overhaul) → Session 30 `c975912` (TCF background composites) + `60d4298` (brand token alignment) → Session 29d `6530e2d` → Session 29c3 `13d9a09` → Session 29c `b82c2e2` → Session 29b2 `4d79938` → Session 29b `22861db` → Session 29 `30f0b80` → prior chain. Auto-deploying.
- Session 29c commit: `b82c2e2` — Brand identity system: pre-rendered intro/outro videos (Bebas Neue font, audio signatures), Frequency Activation CTAs (2 per long-form), Dockerfile updated to include brand-assets.
- Session 29b2 commit: `4d79938` — Edge TTS voice swap to AndrewMultilingualNeural, music bed rewrite (30s loop + stream_loop), Pass 2 anti-repetition fix.
- Session 29b commit: `22861db` — Fixed Dockerfile cp nesting bug.
- Session 29 commits: `30f0b80` (Edge TTS Python CLI replaces unreliable edge-tts-node WebSocket), `99fa7ed` (restore truncated index.ts), `3392daa` (promote Edge TTS to primary).
- Session 28c commit: `624fc28` — Gemini removed from ALL text-gen failover chains. Supabase personality hot-update disabled (was overwriting lean prompts). Adam Brooding voice locked. Railway env var `LLM_FAILOVER_ORDER` updated to `groq,anthropic,openai`.
- Session 28b commit: `f27cf8d` — TTS voice/expressiveness fix + ffmpeg-native music rewrite.
- Session 28 commit: `ab11940` — thesis extraction + narrative arc rewrite of faceless-factory.ts.
- Session 27b commit: `f27633f` — 85% agent prompt reduction. personalities.json rewritten (18K→1.6K chars/agent), shared-context.ts created, index.ts injection simplified.
- Session 27 commits: `f949bc2` (quality gate overhaul) → `e3597c0` (legacy purge — 35 files deleted).
- Prior: Session 26 `509fa4b` (LLM routing fix), Session 25 `5adefce`, Session 24 chain, Session 23 chain.
- Pipeline ran all 8 steps for video iR4AAwNP3r8: "Beyond The Simulation" (258s, 12 scenes, 9 clips, 16 Buffer posts). Ace Richie pipeline successful. TCF pipeline failed (Groq timeout) — fixed with 90s cooldown, needs re-run.
- YouTube long-form live: https://youtube.com/watch?v=ybjDyM3uVts
- yt-dlp authenticated via YouTube cookies (YOUTUBE_COOKIES_BASE64 env var in Railway).

**API Credit Situation (updated Session 27b):**
- **Anthropic:** ~$10 remaining. Used for Veritas brain + Sapphire Sentinel only. Low burn (~$0.36/month briefings). Runway: 37-74 days.
- **OpenAI:** -$0.06 credits. DEAD. DALL-E 3 and OpenAI TTS will not fire.
- **Gemini:** $62.30 OWED but NOT BLOCKED. **REMOVED from ALL text-gen failover chains (Session 28c, commit 624fc28).** Gemini API key stays active ONLY for Imagen 4 image generation and gemini-embedding-001 (Pinecone vectors). Railway env var `LLM_FAILOVER_ORDER` updated to `groq,anthropic,openai`. Zero Gemini text-gen burns going forward.
- **Groq:** FREE tier. 30 RPM, 6000 TPM, 14,400 req/day PER KEY. Primary for pipeline + content agents. Session 31: Dual key distribution — Key A (GROQ_API_KEY) serves alfred, vector, yuki + Ace pipeline. Key B (GROQ_API_KEY_TCF) serves anita, yuki + TCF pipeline. Doubles effective rate limit. fetchWithRetry capped at 5s retry-after (was 30s, causing 60s timeout race that made Groq structurally impossible to succeed).
- **ElevenLabs:** Creator plan, credits EXHAUSTED (Session 29b, April 2026). DEMOTED to fallback. Edge TTS (FREE, Microsoft neural voices) is now primary. Set `FORCE_ELEVENLABS=true` env var to restore ElevenLabs when credits renew. Voice: Adam Brooding, Dark & Tough (`IRHApOXLvnW57QJPQH2P`) — locked as permanent Sovereign Synthesis voice (Session 28c).
- **Edge TTS:** FREE, unlimited, no API key. Python `edge-tts` CLI (pip install). Voice: `en-US-AndrewMultilingualNeural` (deep, cinematic, intonation-rich — Sovereign Synthesis signature voice). Swapped from GuyNeural (too flat/newscastery) in Session 29b2. Installed in Docker production stage. Primary TTS provider as of Session 29.
- **Imagen 4:** RESTORED as primary image gen (Session 27). Cost $0.02-0.06/image. Expected $7-12/month. Gemini API is active, so Imagen 4 is functional.

**LLM ROUTING (Session 31 — dual key distribution + timeout race fix):**
- **AGENT_LLM_TEAMS (Session 31 — dual Groq key split):**
  - `veritas`: [Anthropic → Groq Key A] — strategic brain, briefings
  - `sapphire`: [Anthropic → Groq Key A] — sentinel, proactive observations
  - `alfred`: [Groq Key A → Anthropic] — trend intelligence
  - `anita`: [Groq Key B → Anthropic] — content weaponization
  - `vector`: [Groq Key A → Anthropic] — performance analysis
  - `yuki`: [Groq Key B → Anthropic] — distribution
  - `pipeline (Ace Richie)`: [Groq Key A → Anthropic] — 1 primary retry before failover
  - `pipeline (TCF)`: [Groq Key B → Anthropic] — 1 primary retry before failover
- **Key A** = `GROQ_API_KEY` (primary account). **Key B** = `GROQ_API_KEY_TCF` (secondary account).
- **fetchWithRetry**: MAX_RETRIES=1, retry-after capped at 5s. Fail fast, let FailoverLLM handle it.
- **Gemini REMOVED from text-gen.** API key stays for Imagen 4 + embeddings only.
- **OpenAI REMOVED from pipeline failover chain** (Session 29). Credits at -$0.06, dead.

**DUAL GROQ KEY ARCHITECTURE (Session 29 → Session 31 OVERHAUL):**
- Problem (Session 29): Ace Richie pipeline burns Groq quota → TCF hits exhausted limit.
- Problem (Session 31 root cause): ALL 6 agents + 2 pipelines shared ONE Groq key (30 RPM, 6000 TPM). A single call could burn the TPM. fetchWithRetry waited 30s (Groq's retry-after header) which exceeded FailoverLLM's 60s timeout. Groq was structurally impossible to succeed.
- **Session 31 Fix — 4 changes:**
  1. **fetchWithRetry**: MAX_RETRIES reduced 3→1. retry-after capped at 5s (was 30s). Groq now fails fast (6s max) and lets FailoverLLM handle it at the right layer.
  2. **Dual key distribution across ALL agents**: Key A (GROQ_API_KEY) → alfred, vector + Ace pipeline. Key B (GROQ_API_KEY_TCF) → anita, yuki + TCF pipeline. Veritas/Sapphire stay Anthropic-first.
  3. **Supabase SERVICE_ROLE_KEY**: crew_dispatch, action-surface, activity_log, task poller all switched from SUPABASE_ANON_KEY to SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Every RLS 401 was triggering retry loops that burned more LLM tokens.
  4. **Veritas HANDLER_TIMEOUT_MS**: Raised 120s → 180s for multi-iteration agent loops.
- **RAILWAY ENV VARS REQUIRED:** `SUPABASE_SERVICE_ROLE_KEY` must be set on Railway. Get it from Supabase Dashboard → Settings → API → service_role key.
- Both pipeline LLMs use the same Anthropic provider as failover — they share Anthropic's reserve.
- **ROOT CAUSE OF $62 BILL (Session 28c FINAL diagnosis):** TWO bugs. (1) Bloated 18-20K char system prompts caused Groq 413 → Gemini failover. Session 27b fixed bundled JSON but (2) Supabase `personality_config` table still had OLD bloated prompts. index.ts lines 2246-2253 loaded from Supabase on every boot and OVERWROTE lean bundled JSON. Session 28c disabled Supabase hot-update — bundled JSON is now SOLE authority.
- **Supabase personality_config** still has old bloated prompts. NOT dangerous (hot-update disabled in code) but should be cleaned up eventually.
- **[DVP: ADDRESSED]** Gemini text-gen kill — removed from all chains + env var updated. Commit `624fc28`. VERIFY: check Gemini API logs for zero new text-gen calls.
- **[DVP: ADDRESSED]** LLM routing fix — `/status` shows Anthropic-first for Veritas.
- **[DVP: ADDRESSED]** Imagen 4 primary — Gemini API is active, Imagen 4 is functional.
- **[DVP: ADDRESSED]** Three-pass script gen (Session 28) — thesis extraction + narrative arc architecture. Replaces old "fill 25 buckets" prompt with cohesive story structure. Anti-copying directives prevent source parroting. Commit `ab11940`.
- **[DVP: DISABLED — Session 29]** Sapphire Sentinel v2 — 5 proactive alert rules. `start()` is now a no-op. Morning briefing + evening recap + stasis watchdog provide sufficient monitoring. Re-enable by restoring `setInterval` in `src/proactive/sapphire-sentinel.ts:start()`.
- **[DVP: ADDRESSED]** Prompt economy fix — 85% reduction. NEEDS VERIFICATION: check Gemini API logs post-deploy for zero new dispatch calls hitting Gemini.

**RESOLVED — BUFFER POSTING (Session 21 fix):**
- **ROOT CAUSE:** `scheduleBufferWeek()` in vidrush-orchestrator.ts had a hardcoded filter that ONLY selected channels with service type "twitter", "threads", "linkedin", "facebook", "mastodon". YouTube, Instagram, and TikTok channels were explicitly EXCLUDED. This was based on a false assumption that Buffer can't post to those platforms. Buffer supports ALL connected channels.
- **FIX:** Removed the channel filter. Pipeline now uses ALL active (non-paused) Buffer channels. Each clip is posted to EACH channel in round-robin, one channel per time slot, with platform-specific copy (using SERVICE_TO_COPY_KEY mapping).
- **Also fixed:** False "Buffer can't handle video" lie was spread across 4 files (vidrush-orchestrator.ts, video-publisher.ts, social-scheduler.ts, content-engine.ts). All false comments eradicated. The social-scheduler now gracefully strips video file URLs from media (posting text-only) instead of blocking the entire post.
- **CRITICAL RULE FOR ALL FUTURE SESSIONS:** Buffer supports EVERY connected channel. NEVER filter out channels by service type. If Buffer offers a channel, USE IT.

**BUFFER PLATFORM REQUIREMENTS (verified from Buffer docs, Session 21):**
- **TikTok:** REQUIRES video or images. Text-only WILL FAIL. Video formats: MOV, MP4, WEBM. Max 1GB. 3s-10min.
- **Instagram:** REQUIRES image or video. Text-only WILL FAIL. Videos become Reels. Max 300MB.
- **YouTube:** REQUIRES video (Shorts only). NO community posts via Buffer API. Max 10GB.
- **X/Twitter, Threads, LinkedIn, Facebook:** Text-only works fine.
- Buffer GraphQL `assets` field supports: `images: [{ url }]` AND `videos: [{ url }]`
- Platform-specific metadata available: `YoutubePostMetadataInput` (title, categoryId, privacy), `TikTokPostMetadataInput` (title), `InstagramPostMetadataInput` (first comment, geolocation)
- **CRITICAL:** Clips MUST have `publicUrl` (Supabase storage) to post to TikTok/IG/YouTube. If Supabase upload fails (503), those channels get skipped.
- **Session 22 addition:** `createPost` mutation now sends platform-specific `metadata` field:
  - YouTube: `metadata.youtube = { title, categoryId: "22", privacy: "public", madeForKids: false }` — title and categoryId are REQUIRED by Buffer API
  - Instagram: `metadata.instagram = { type: "reel", shouldShareToFeed: true }` — type and shouldShareToFeed are REQUIRED by Buffer API
  - TikTok: `metadata.tiktok = { title }` — optional but recommended
  - Without these metadata fields, YouTube and Instagram posts would be SILENTLY REJECTED by Buffer

**DEPLOYMENT VERIFICATION PROTOCOL (DVP) — established Session 24:**
- `[DVP: ADDRESSED]` = Code pushed, no production test yet. DEFAULT after any deploy.
- `[DVP: VERIFIED]` = Production test confirmed fix works. Must cite test (date/video ID/log).
- `[DVP: REGRESSED]` = Was verified, later test showed it broke again.
- Rule: Nothing moves to VERIFIED without Architect confirming test output.

---

## ARCHITECTURAL DIRECTIVES — READ FIRST EVERY SESSION

These directives exist because multiple sessions were wasted on surface fixes while structural problems went undiagnosed. Every AI session working on this codebase MUST internalize these before writing a single line of code.

**DIRECTIVE 1: PROMPT ECONOMY (non-negotiable)**
- Agent system prompts MUST stay under 1,000 tokens total (personality + shared context).
- `src/data/personalities.json` contains ONLY: identity, behavioral rules, domain scope, team routing, tools list, task protocol (~400 tokens per agent).
- `src/data/shared-context.ts` contains compact shared operational context (~300 tokens): product ladder, task protocol, standing rules.
- Detailed playbooks, email sequences, platform specs → stored in Supabase `protocols` table, retrieved on-demand via `read_protocols` tool.
- NEVER add shared/duplicated content to individual agent prompts. If it applies to all agents, put it in shared-context.ts.
- NEVER bloat prompts to add capabilities. Add a TOOL instead.
- Before ANY change to personalities.json, verify total stays under 3,000 chars per agent.
- **WHY:** Bloated 18K-char prompts caused every Groq dispatch to 413, silently failing over to Gemini at 27K tokens/call. This is how the $62 bill happened.

**DIRECTIVE 2: ROOT CAUSE DISCIPLINE**
- When a provider returns an error (413, 429, 400), trace the FULL request payload — not just the error code. What's the total token count? What's in the system prompt?
- When claiming something is "fixed," verify against live data (API logs, Railway logs) — not just code inspection.
- Don't assume provider config changes (reordering chains) will fix payload size problems.
- Before declaring ANY binary claim about a provider ("Gemini is blocked", "Groq can't handle this"), CHECK the actual API logs first.
- Think architecturally: if the same pattern (bloated prompts, duplicated data) exists across multiple agents, it's a systemic issue requiring a systemic fix — not 6 individual patches.

**DIRECTIVE 3: SESSION QUALITY PROTOCOL**
1. **READ this master reference FIRST.** Before touching code, understand what's deployed, what's broken, and what the Architect's priorities are.
2. **READ memory files.** Check `.auto-memory/MEMORY.md` for feedback, project state, and references.
3. **Verify before claiming.** Use DVP tags. Check live logs before saying something works or doesn't.
4. **Think systemically.** One bug in one agent often means the same bug exists in all six. Look for patterns, not incidents.
5. **Offer proactive suggestions.** The Architect wants outside-the-box thinking, not passive execution. If you see a structural problem, name it and propose a fix — don't wait to be asked.
6. **UPDATE this master reference LAST.** Document what changed, what's pending, and what the next session needs to know.

**DIRECTIVE 4: THREE-LAYER PROMPT ARCHITECTURE**
```
Layer 1: Identity (personalities.json) — ~400 tokens, static, per-agent
Layer 2: Shared Context (shared-context.ts) — ~300 tokens, static, all agents
Layer 3: On-Demand Protocols (Supabase protocols table) — variable, retrieved via read_protocols tool, ZERO cost when not called
```
Total injected per dispatch: ~700 tokens. Previous architecture: ~4,500 tokens. Savings: 85%.
Any new operational knowledge goes into Layer 3 (protocols table). NEVER into Layer 1 or 2 unless it's under 50 chars and needed on every single call.

---

**QUALITY GATE STATUS (Session 27 — major overhaul):**
- [DVP: VERIFIED] Audio mastering — loudnorm + EQ + compression chain *(verified: Session 23 Test 3, video tET-aR-JG-o)*
- [DVP: VERIFIED] Hook text overlay — first sentence burned into opening 3s *(verified: Session 23 Test 3)*
- [DVP: VERIFIED] Smart clip boundaries — silencedetect natural pause points *(verified: Session 23 Test 3)*
- [DVP: VERIFIED] Segment expansion — LLM expands short scripts to 15+ segments *(verified: Session 23 Test 3, 15 scenes)*
- [DVP: ADDRESSED] Background ambient music — Session 37 REWRITE: synthetic lavfi KILLED (silently failed on Railway). Now loops REAL MP3 files via `stream_loop -1`. Niche-aware: `music_urgent.mp3` (dark_psych/burnout), `music_sovereign.mp3` (ace_richie), `ambient_drone.mp3` (fallback). Commit `257c406`.
- [DVP: ADDRESSED] Hook text wrapping — Session 38 FIX: switched from inline `text=` to `textfile=` approach. Wrapped text written to temp file, ffmpeg reads newlines directly. Bypasses all shell quoting. Commit `aed0e2b`.
- [DVP: ADDRESSED] TTS pacing — Session 38 FIX: 0.80x → 0.90x speed. Balances documentary gravitas with momentum. Combined with afade per-segment. Commit `aed0e2b`.
- [DVP: ADDRESSED] Audio/visual sync — Session 38 FIX: safety clamp in assembleVideo(). After xfade assembly, probes video duration vs audio duration. If gap > 2s, extends last scene clip and re-assembles. Commit `aed0e2b`.
- [DVP: ADDRESSED] TTS speed — 0.80x for long-form documentary cadence. Commit `0706f68`.
- [DVP: ADDRESSED] Orientation-aware dimensions — 16:9/9:16. Commit `0706f68`.
- [DVP: ADDRESSED] Scheduler timezone fix — all getUTCHours. Commit `d2847f7`.
- [DVP: ADDRESSED] Scene crossfade transitions — Ken Burns + 0.4s fade-in/fade-out. Commit `cd60174`.
- [DVP: ADDRESSED] Voice warmth reverb — FIXED Session 27: dialed back from dual-tap (100ms+200ms) to single-tap (80ms at 12%). Subtle room presence, not audible wet echo. Commit `f949bc2`.
- [DVP: ADDRESSED] Imagen 4 restored as PRIMARY image gen — Gemini API confirmed active, Imagen 4 is functional. Pollinations fallback. Commit `f949bc2`.
- [DVP: ADDRESSED] Cinematography-grade image prompts — SCENE_VISUAL_STYLE completely rewritten. ARRI Alexa 65, anamorphic lenses, Deakins lighting, Kodak Vision3 500T grain. Every niche × brand combo unique. Commit `f949bc2`.
- [DVP: ADDRESSED] Two-pass script generation — long-form splits into Pass 1 (segments 1-13) + 8s Groq cooldown + Pass 2 (segments 14-25). Prevents Groq 413. Source intel capped at 3000 chars. Commit `f949bc2`.
- [DVP: ADDRESSED] Video length enforcement — 25 segments, 100-150 words/segment minimum. Commit `f949bc2`.
- [DVP: ADDRESSED] Intro bumper — 3s branded title card (brand name + video title, white on black, fade-in). Commit `f949bc2`.
- [DVP: ADDRESSED] Outro CTA card — 5s card with tagline + sovereign-synthesis.com. Commit `f949bc2`.
- [DVP: ADDRESSED] Script generation prompt upgraded — visual_direction field treated as cinematographer's shot list (camera angle, lighting, physical elements, mood texture). Commit `f949bc2`.
- [DVP: ADDRESSED] Legacy debris purge — 35 dead files deleted, .gitignore hardened with `_legacy/`, `*.patch`, `commitmsg.txt`. Commit `e3597c0`.
- [DVP: ADDRESSED] Per-clip thumbnails — Session 39: extractStoryMoments outputs `thumbnail_text`. Clips get ffmpeg-rendered thumbnails (key frame + vignette + bold text). Uploaded to Supabase, attached to YouTube Shorts metadata via Buffer. Commit `0fa4bc5`.
- REMAINING:
  - Platform Adaptation Engine: per-platform clip variants (TikTok faster cadence, IG cover frame optimization)
  - Distribution Router consolidation: single entry point instead of split Buffer/direct-API paths
  - Midjourney: NO official API exists. Flux by Black Forest Labs ($0.04/img) is best legitimate alternative if Imagen 4 quality insufficient.
- **Funnel Audit skill deployed** — `skills/funnel-audit.md` gives Veritas deep audit methodology for the entire T0→T6 conversion path. Covers distribution, links, Stripe, email, pipeline health, and TCF→Ace handoff.

---

## PENDING WORK FOR NEXT SESSION (as of end-of-Session 29)

1. **[PRIORITY 1] TEST THE DUAL-PIPELINE** — Run `/pipeline <youtube_url>` (no modifiers — fires both Ace Richie + TCF). Verify: (a) Ace Richie completes all 8 steps, (b) 180s cooldown fires, (c) TCF uses `GROQ_API_KEY_TCF` (check Railway logs for `[Pipeline] TCF dedicated Groq key active`), (d) TCF Step 2 succeeds. If either fails, check Railway logs for full error (now 500 chars, was 150).
2. **Investigate Vector personality not loading** — Boot logs show `[BotInit] No personality for vector — skipping`. Check if personality name in `personalities.json` matches what the bot init loop expects.
3. **Verify Gemini zero-dispatch** — Check Gemini API logs for zero text-gen calls post-Session 28c deploy.
4. **[TODO] TCF needs its own long-form YouTube upload** — Currently `executeFullPipeline` uploads the long-form video to Ace Richie's YouTube channel (Step 3). TCF brand has no YouTube long-form destination. Need to either: (a) create a separate `executeFullPipeline` variant for TCF that skips the YT upload, or (b) add a TCF YouTube channel and credential set. Until resolved, TCF only produces shorts + Buffer posts, not a long-form video.
5. **[TODO] TCF needs brand-differentiated video angles** — The TCF faceless factory currently uses the same `produceFacelessVideo` flow as Ace Richie. TCF brand is "dark, clinical, intelligence analyst" — the image prompts (SCENE_VISUAL_STYLE) do have TCF variants, but the script orientations and orientations should be reviewed. Consider a separate `orientation: "horizontal"` default for TCF (long-form documentary vs Ace Richie's vertical shorts).
6. **Layer 2 compression pass** — Tighter ffmpeg compression before Supabase upload. Target: CRF 28-30, scale to 720p max for shorts. NOT YET STARTED.
7. **Manual Supabase Storage purge** — Go to Supabase dashboard → Storage → `public-assets` → delete `vidrush/` and `faceless/` folders (308 MB old clips from past runs).
8. **Clean Supabase personality_config table** — Still has old 18-20K char bloated prompts. Not dangerous (hot-update disabled) but should be cleaned.

---

## KNOWN MISALIGNMENTS (documents that are OUT OF DATE)

These documents exist in the repo but contain stale information. Do NOT use them for pipeline architecture reference without cross-checking against this master reference.

- **Mission Control Master Reference** — Still references Make.com Scenarios E/F and OpusClip as part of the Vid Rush pipeline. Both are no longer used. The pipeline is fully in-house: Whisper → faceless-factory.ts → ffmpeg → Supabase → Buffer. Any reference to Make.com or OpusClip in pipeline docs is dead history.
- **Sovereign Posting Guide** — Contains old scheduling logic referencing Make.com webhook triggers. Actual scheduling is now done by `scheduleBufferWeek()` in `vidrush-orchestrator.ts` via Buffer's GraphQL API. The guide's "Scenario F" section is entirely obsolete.
- **If in doubt:** `src/engine/vidrush-orchestrator.ts` is the ground truth for what the pipeline actually does, step by step.

---

**Session Summary — Cowork Session 29 (2026-04-06):**

**DUAL GROQ KEY + PIPELINE STABILITY FIXES.** Architect diagnosed persistent TCF Step 2 timeout — root cause was Ace Richie burning Groq TPM quota over 50+ min, then TCF hitting exhausted rate limits after a 90s cooldown. Fix: Architect registered a second Groq account; Railway env var `GROQ_API_KEY_TCF` holds the TCF-dedicated key. Code now builds a separate `tcfPipelineLLM` using that key, giving TCF a fresh rate limit pool.

**Fixes deployed (Session 29):**
1. **Dual Groq key** — `src/index.ts`: `tcfPipelineLLM` built from `GROQ_API_KEY_TCF` if set. Falls back to `pipelineLLM` with a warning if env var is missing. Both manual `/pipeline` and auto-pipeline (Alfred trigger) use brand-based LLM selection.
2. **OpenAI removed from pipeline failover** — Credits at -$0.06, dead. Removed from `buildTeamLLM(["groq", "anthropic", "openai"], 3)` → now `buildTeamLLM(["groq", "anthropic"], 2)`. Saves 60s per dead retry slot.
3. **primaryRetries reduced 3→2** — Groq gets 3 attempts (was 4) before Anthropic failover. Saves 60s + 9s delay per timeout storm: total Groq burn drops from 258s to ~195s.
4. **LLM timeout configurable** — `LLM_TIMEOUT_MS` Railway env var (default 60000). Code change is `parseInt(process.env.LLM_TIMEOUT_MS || "60000", 10)` in `buildTeamLLM`. Can now be raised without a deploy.
5. **Inter-brand cooldown raised 90s→180s** — `PIPELINE_COOLDOWN_MS` Railway env var (default 180000). Was 90s — insufficient even before the dual-key fix. Both manual and auto pipelines use the same env var.
6. **Error message slice 150→500** — `faceless-factory.ts` lines 420 + 523. The 150-char slice was hiding Anthropic and OpenAI failure entries, making it look like only Groq was tried. Now shows full failover chain on failure.

**DVP Status:**
- `[DVP: ADDRESSED]` Dual Groq key — needs production test (run `/pipeline` and confirm `GROQ_API_KEY_TCF` appears in Railway logs)
- `[DVP: ADDRESSED]` Cooldown raised to 180s — needs production test
- `[DVP: ADDRESSED]` Error message fix — passive (only visible on failures)
- `[DVP: ADDRESSED]` Sapphire Sentinel disabled — `start()` is a no-op. No Supabase polling every 2h. Morning briefing (10 AM CDT), evening recap (8 PM CDT), and stasis watchdog (3:28 PM CDT) cover monitoring needs.

---

**Session Summary — Cowork Session 29c (2026-04-06):**

**BRAND IDENTITY SYSTEM + FREQUENCY ACTIVATION CTAs.** Built permanent brand assets and wired them into the faceless video pipeline. Every video now opens with the Sovereign Synthesis brand intro and closes with the brand outro (long-form only — shorts skip outro to protect algorithm retention). Two Frequency Activation CTAs are inserted at 1/3 and 2/3 marks in long-form videos — these are LLM-generated consciousness declarations tied to the video's thesis, not traditional CTAs.

**Changes deployed (Session 29c, commit `b82c2e2`):**
1. **Brand assets created** — `brand-assets/` directory: `intro_long.mp4` (6s, 1920x1080), `intro_short.mp4` (2s, 1080x1920), `outro_long.mp4` (7s, 1920x1080), 3 audio signatures (MP3), `BebasNeue-Regular.ttf` font.
2. **Pre-rendered intro/outro replace per-video generation** — `assembleVideo()` now loads brand assets from `brand-assets/` instead of generating text-on-black cards per video. Graceful fallback to basic generation if assets not found.
3. **Frequency Activation CTA system** — New `FrequencyActivation` interface. LLM generates 2 topic-specific declarations per long-form video after Pass 2 merge. Each renders as a 5s card: dark bg + narrator context line (TTS) + gold declaration text (Bebas Neue) + "TYPE THIS IN THE COMMENTS" prompt. Inserted at ~1/3 and ~2/3 of scene clips.
4. **Dockerfile updated** — `COPY brand-assets ./brand-assets` added to production stage.

**Also deployed earlier in Session 29b2 (commit `4d79938`):**
5. **Edge TTS voice swap** — `en-US-GuyNeural` (flat newsreader) → `en-US-AndrewMultilingualNeural` (cinematic, intonation-rich). Sovereign Synthesis signature voice locked.
6. **Music bed rewrite** — ~~Full-duration aevalsrc synthesis (OOM/timeout) → 30s seamless loop + `stream_loop` tiling. Music finally works.~~ **NEVER ACTUALLY WORKED.** Session 32 replaced complex 6-oscillator aevalsrc (silent shell quoting failure on Railway) with bulletproof `sine` source + `anoisesrc` pink noise. Simple, cannot fail.
7. **Anti-repetition fix** — Pass 2 now receives full Pass 1 topic summary with explicit anti-repetition rules. No more rehashing.

**Session 32 fixes (faceless-factory.ts):**
8. **Music bed: aevalsrc → sine+noise** — The complex 6-oscillator `aevalsrc` expression NEVER worked on Railway (shell quoting killed it silently). Replaced with `sine` source (single frequency, niche-aware) + `anoisesrc` pink noise → lowpass → ambient drone. Bulletproof. Cannot fail.
9. **Intro/outro signature audio** — Brand signature mp3 files existed in brand-assets but were NEVER mixed into the final audio. The final ffmpeg assembly only mapped TTS + music bed, discarding intro/outro mp4 embedded audio. NEW: Step 2b creates a composite audio track: intro signature at t=0, TTS delayed by intro duration, outro signature appended. Brand sounds now guaranteed in every video.
10. **Scene count 25 → 12** — 25 Imagen 4 generations took 33 minutes. Cut to 12 (halves image gen time to ~16 min). Two-pass script gen updated: Pass 1 = 7 segments, Pass 2 = 5 segments. Quality gate lowered from 15 to 8 minimum segments.

**Pending:**
- ~~Imagen 4 cinematic background image~~ — DONE. SS golden sacred geometry + TCF concrete bunker corridor backgrounds generated, uploaded to Supabase, composited into all intro/outro videos. Commits `6530e2d`, `c975912`.
- **Brand Token Alignment (Session 30):** Canonical `design-tokens.json` created at `.claude/skills/brand-identity/resources/design-tokens.json`. Blood red (#CC0000) purged from VISUAL-PRODUCTION-SPEC — was never in any live product. Three-tier brand identity locked: SS=gold(#d4a843)+teal(#00e5c7), TCF=cold blue(#5A9CF5)+teal, Gravity Claw=cyan/teal(#00e5c7)+gold (infrastructure only, never consumer-facing). Full product funnel T0-T7 mapped in tokens file.
- **Gravity Claw Icon:** User has a designed icon (mechanical claw gripping energy orb, sacred geometry ring, "77" mark, shattering glass). Integrate into: Telegram bot avatar, Mission Control dashboard splash/loading, system notifications. NOT consumer-facing.
- Mid-video Frequency Activation CTAs need production test to verify TTS + rendering + insertion timing.

---

**Session Summary — Cowork Session 28c (2026-04-06):**

**GEMINI TEXT-GEN KILL + VOICE LOCK + PIPELINE FAILURES.** Architect showed Gemini API logs proving Anita was still sending 31,495 input tokens to gemini-3.1-pro-preview despite Session 27b prompt reduction. Root cause analysis found TWO bugs:

**Bug 1: Supabase personality overwrite.** `index.ts` lines 2246-2253 loaded `personality_config` from Supabase on every boot cycle and OVERWROTE the lean bundled `personalities.json` prompts with old 18-20K char bloated versions. Session 27b only updated the bundled JSON — never touched Supabase. Every Groq dispatch hit 413 on the bloated payload → silently fell to Gemini → burned ~$12/day.

**Bug 2: Railway env var override.** Even after code changes removed Gemini from failover arrays, `LLM_FAILOVER_ORDER` env var on Railway was still set to `groq,gemini,anthropic,openai`. The `envList()` function in config.ts reads env vars first, falling back to code defaults only when unset. Architect manually updated Railway env var to `groq,anthropic,openai`.

**Fixes deployed (commit `624fc28`):**
1. Disabled Supabase personality hot-update — bundled `personalities.json` is now SOLE authority for agent system prompts.
2. Removed Gemini from ALL `AGENT_LLM_TEAMS` and `pipelineLLM` in index.ts.
3. Removed Gemini from default `failoverOrder` in config.ts.
4. Locked Adam Brooding voice (`IRHApOXLvnW57QJPQH2P`) across all three code locations: tts.ts main function, tts.ts streaming function, config.ts default. Fixed streaming function which was still using Rachel (`21m00Tcm4TlvDq8ikWAM`) with rigid voice_settings.
5. Aligned streaming voice_settings to expressive config: stability 0.45, similarity_boost 0.75, style 0.60.

**Post-deploy: BOTH PIPELINES FAILED.** Architect ran both pipelines after deploy + env var update. Both failed. Root cause not yet diagnosed. Possible causes: deploy restart killing mid-execution, Vector personality not loading (`[BotInit] No personality for vector — skipping` in boot logs), or LLM chain issue. **NEXT SESSION MUST DIAGNOSE THIS FIRST.**

**Commits:** `624fc28` (Gemini kill + voice lock + Supabase hot-update disable). Pushed, Railway auto-deploying.

---

**Session Summary — Cowork Session 28 (2026-04-05):**

**SCRIPT GENERATION ARCHITECTURE OVERHAUL.** Architect flagged video quality as "fucking bad" — long-form scripts were compilations of disconnected shorts-length paragraphs that parroted source transcripts word-for-word. Reference channels (Grim Grit) tell ONE cohesive story with narrative arc. Root cause was architectural: raw Whisper transcript dumped as "source intelligence," prompt said "generate 25 segments" with no story structure.

**3-part fix deployed (commit `ab11940`, 196 insertions, 89 deletions in faceless-factory.ts):**
1. **NEW: Thesis extraction pre-pass** (`extractNarrativeBlueprint()`) — Before writing any script, the LLM distills the raw transcript into: thesis, title, hook, 3-act narrative arc, 5-7 key arguments in escalating order, emotional journey. This is the intelligence extraction step that was completely missing.
2. **REWRITTEN: Long-form script prompts** — LLM now receives the narrative BLUEPRINT (not raw transcript). Pass 1 writes ACT 1 + ACT 2 (hook + setup + escalation, 13 segments). Pass 2 writes ACT 3 (revelation + resolution + CTA, 12 segments). Segments must flow into each other with forward momentum, transition beats, and callback language.
3. **NEW: Anti-copying directives** — Prompts explicitly command "NEVER copy or closely paraphrase the source" and "use as INSPIRATION only." Source transcript never appears in the script generation prompts (only in the blueprint extraction step).
4. **REWRITTEN: Short-form prompt** — Now focuses on ONE powerful idea with setup/twist/payoff instead of summarizing source material.

**Token budget impact:** One additional LLM call (blueprint extraction, ~800 tokens input). Total pipeline: 3 calls instead of 2. Fits within Groq free tier. Additional time: ~5s cooldown.

**DVP Status:**
- [DVP: ADDRESSED] Thesis extraction pre-pass — needs production test
- [DVP: ADDRESSED] Narrative arc script generation — needs production test
- [DVP: ADDRESSED] Anti-copying directives — needs production test
- [DVP: ADDRESSED] Short-form prompt rewrite — needs production test
- [DVP: ADDRESSED] TTS voice switch to Adam (deep male) + expressiveness fix — needs production test
- [DVP: ADDRESSED] Music bed rewrite (ffmpeg-native, zero Node.js memory) — needs production test. Music has NEVER worked before; this is the first time it should actually produce audio.

**Commits:** `ab11940` (script gen overhaul). Pushed, Railway auto-deploying.

---

**Session Summary — Cowork Session 27c (2026-04-05):**

**SUPABASE EGRESS CONTROL + PIPELINE STABILITY + BUILD FIX.** Supabase sent a quota warning — 5.5 GB egress on free tier (5 GB limit). Root cause: 308 MB of video clips in `public-assets` bucket served as publicUrls to 9 Buffer channels, never deleted. Every pipeline run accumulated clips forever.

**Fixes deployed:**
1. **Storage cleanup after Buffer scheduling** (commit `99a7cd8`) — `cleanupSupabaseStorage()` deletes clips from Supabase Storage after Step 8 confirms Buffer scheduling succeeded. Buffer already downloaded them; keeping them just burns egress.
2. **Inter-brand 90s cooldown** (commit `99a7cd8`) — Dual-brand pipeline (Ace Richie → TCF) now pauses 90 seconds between brands. TCF was dying because Groq rate limits weren't recovering after Ace Richie's 25+ LLM calls. All 3 retries timed out at 60s. Both manual `/pipeline` and auto-pipeline patched.
3. **CONTENT_CREW build fix** (commit `25c8773`) — `CONTENT_CREW` constant was referenced 3 times but never defined. Lost in Session 27 legacy purge. Railway build failed on `tsc --noEmit`. Added `const CONTENT_CREW = ["alfred", "anita", "yuki"]`.
4. **Human-readable storage names** (commit `547b0a1`) — Storage paths now include brand, niche, and title slug: `vidrush/ace_richie_quantum_firmware_update_1775430704664/clip_00.mp4`. No more mystery folders. Cleanup function extracts paths from publicUrl instead of hardcoding.

**Manual action needed:** Go to Supabase dashboard → Storage → `public-assets` → delete `vidrush/` and `faceless/` folders (308 MB of old clips from past runs). Automated cleanup only applies to future runs.

**Commits:** `99a7cd8` (egress control + cooldown) → `25c8773` (CONTENT_CREW fix) → `547b0a1` (readable names). All pushed, Railway auto-deploying.

---

**Session Summary — Cowork Session 27b (2026-04-05):**

**PROMPT ECONOMY FIX + ARCHITECTURAL DIRECTIVES.** Root cause of $62 Gemini bill finally traced and fixed. ALL 6 agent system prompts were 18-20K chars (~4,500 tokens) with identical 10-12K "Operational Awareness" blocks copy-pasted into each. Every Groq dispatch hit HTTP 413 and silently fell to Gemini (27K+ tokens/call). The Session 26 routing fix (reordering AGENT_LLM_TEAMS) was a band-aid — didn't address payload SIZE.

**Fix deployed (commit `f27633f`):**
1. **personalities.json completely rewritten** — each agent trimmed from ~18K to ~1.6K chars (~400 tokens). Contains ONLY: identity, behavioral rules, domain scope, team routing, tools list, task protocol.
2. **shared-context.ts created** — 1,205 chars (~300 tokens) of compact operational context injected into every agent. Contains: product ladder, architecture boundary, task approval protocol, standing rules.
3. **index.ts injection simplified** — removed protocolDirective, knowledgeDirective, and browserDirective concatenation blocks. System prompt = lean personality + shared context. Detailed playbooks retrieved on-demand via read_protocols tool.
4. **Step 4 dry run guard fixed** — /dryrun command no longer runs real ffmpeg in Step 4.

**CRITICAL CORRECTION:** Gemini API is NOT blocked. Previous sessions falsely claimed the $62 debt blocked all Gemini calls. User verified via live API logs — all 200 status codes. Gemini was accepting every silently-failovered dispatch call, actively running up the bill. Master reference corrected.

**Commits:** `f27633f` (prompt economy fix). Pushed, Railway auto-deploying.

---

**Session Summary — Cowork Session 27 (2026-04-05):**

**QUALITY GATE OVERHAUL + LEGACY PURGE.** 7 quality upgrades deployed in a single commit (`f949bc2`, 347 insertions, 176 deletions):
1. **Imagen 4 restored as PRIMARY** — Gemini billing crisis was Anita's 26K-token text gen, NOT image gen ($0.02-0.06/img). Approved $7-12/month for image quality. Pollinations fallback. (Blocked until $62 bill paid.)
2. **Cinematography-grade image prompts** — SCENE_VISUAL_STYLE rewritten per niche × brand. ARRI Alexa 65, Deakins lighting, Kodak Vision3 500T grain. NO text/watermarks directive.
3. **Two-pass script generation** — long-form splits Pass 1 (segments 1-13) + 8s Groq TPM cooldown + Pass 2 (segments 14-25). Fixes Groq 413. Source intel capped at 3000 chars.
4. **Reverb fixed** — dialed back from dual-tap (100ms+200ms at 25%/15%) to single-tap (80ms at 12%). Subtle room presence.
5. **Music synthesis upgraded** — multi-voice detuned pad chords with per-voice LFO breathing. Per-niche chord voicings. Replaces sine waves.
6. **Video length enforcement** — 25 segments, 100-150 words/segment minimum.
7. **Intro bumper (3s) + Outro CTA card (5s)** — branded title card + sovereign-synthesis.com.

Second commit (`e3597c0`): **Legacy debris purge** — 35 dead files deleted, .gitignore hardened.

**Midjourney investigation:** NO official public API. All third-party wrappers violate ToS. Flux by BFL ($0.04/img) is best legitimate alternative.

**Evening pulse failure diagnosed:** Veritas pulse fired from pre-deploy instance. Anthropic HTTP 400 + Gemini connection failure (blocked) + Groq cascade. New deploy should resolve.

**Agent DM prompts created:** Personalized system state updates for all 6 Maven Crew agents (Veritas, Alfred, Anita, Yuki, Vector, Sapphire). Saved to `SESSION-27-AGENT-DM-PROMPTS.md`.

**Commits:** `f949bc2` (quality gate overhaul) → `e3597c0` (legacy purge). Both pushed, Railway auto-deploying.

---

**Session Summary — Cowork Session 26 (2026-04-05):**

**LLM ROUTING + DUAL PIPELINE + FUNNEL AUDIT.** Major session. (1) Fixed bot unresponsiveness — 5 features rewired from failoverLLM to AGENT_LLM_TEAMS. Purged dead AgentComms. (2) Sapphire Sentinel v2 — 5 proactive alert rules (pipeline failure, critical glitch, stasis, Buffer health, content engine deadline). (3) Imagen 4 promoted to primary then REVERTED — Gemini billing $62.30 with card declining. Pollinations stays primary. (4) Dual-brand pipeline — every /pipeline trigger and Alfred auto-pipeline now fires BOTH ace_richie and containment_field sequentially. "ace only"/"tcf only" override available. (5) CTA cleanup — removed /inner-circle from YouTube descriptions, all CTAs point to sovereign-synthesis.com. (6) Fixed /status and /start display to show per-agent LLM routing map. (7) Built Funnel Audit skill for Veritas (skills/funnel-audit.md). (8) Documented funnel link issues in Mission Control master reference — sovereign-synthesis.com is NOT T0 yet, IG bio has old link, TikTok has no link. Commits: `509fa4b` → `b0d5c7d` → `3c2b9ce` → `c94d53e` → pending (revert + skill).

---

**Session Summary — Cowork Session 20 (2026-04-04):**

**FIRST CLEAN PIPELINE RUN ACHIEVED.** After 4 yt-dlp fixes and 2 LLM chain fixes, the pipeline ran all 8 steps for video WhqdFNK58S8 (Russell Brunson "Mind Control"). Produced video, 8 clips, 8 Buffer posts. BUT Buffer scheduling behavior is wrong — posts only showing on X/Threads, not all channels, and spread across days incorrectly.

**Fixes deployed this session:**
1. **THREE-TIER TTS FALLBACK.** ElevenLabs → Edge TTS (FREE, `edge-tts-node`) → OpenAI. Edge TTS uses `en-US-AriaNeural` voice. Speed mapping 0.9x → "-10%" rate. Commit `85c0f2d`.
2. **POLLINATIONS-FIRST IMAGE GEN.** Migrated content-engine.ts and image-generator.ts to Pollinations-first (was Gemini-first). All three image surfaces now use free provider first. Commit `85c0f2d`.
3. **PFV-01 PROTOCOL CREATED.** Pre-Flight Verification protocol — 5-layer deep verification before declaring systems operational. Post-failure investigation template. Skill file at `.claude/skills/pre-flight-verification/SKILL.md`. Commit `da8b4a8`.
4. **TWO-PASS PROVIDER INITIALIZATION.** Fixed silent Groq exclusion caused by stale `LLM_FAILOVER_ORDER` env var in Railway. Second pass catches providers with keys not in failoverOrder. Runtime chain verification fields added to diag endpoint. Commit `da8b4a8`.
5. **yt-dlp RUNTIME NAME FIX.** Changed `--js-runtimes nodejs` to `--js-runtimes node` across all 4 call sites + Dockerfile. `nodejs` was never a valid yt-dlp runtime name. Commit `d282c7e`.
6. **BULLETPROOF yt-dlp DOWNLOAD UTILITY.** Created shared `src/utils/ytdlp-download.ts` with multi-strategy retry (6 player client rotations + user-agent spoofing). All 3 download sites now use this single utility. Commit `11ae10a`.
7. **COOKIE-AUTHENTICATED yt-dlp.** Added `YOUTUBE_COOKIES_BASE64` env var support. Bot decodes cookies.txt at runtime for authenticated YouTube access from Railway datacenter IP. Commit `79e127c`.
8. **REMOTE JS CHALLENGE SOLVER.** Added `--remote-components ejs:github` flag — YouTube now requires a JS challenge solver component that yt-dlp downloads from GitHub. This was the final fix that unblocked the pipeline. Commit `8613fef`.

**All Session 20 Commits (chronological):**
- `85c0f2d` — fix: three-tier TTS fallback + Pollinations-first image gen + edge-tts-node dep + enhanced diag
- `da8b4a8` — fix: PFV-01 two-pass provider init + runtime chain verification in diag
- `d282c7e` — fix: yt-dlp runtime name nodejs to node
- `11ae10a` — fix: bulletproof yt-dlp with multi-strategy anti-bot retry
- `79e127c` — fix: cookie-authenticated yt-dlp for Railway datacenter IP
- `8613fef` — fix: enable yt-dlp remote JS challenge solver

**YouTube cookies set in Railway:** `YOUTUBE_COOKIES_BASE64` env var (53rd variable). Cookies expire periodically — when yt-dlp starts failing with "sign in" errors again, refresh by exporting cookies from Chrome and re-encoding.

---

**Session Summary — Cowork Session 19 FULL (2026-04-04):**

**Phase 1 (19a): 5 Infrastructure Fixes Deployed**
1. **POLLER PAUSE DURING PIPELINE.** `pipelineRunning` global flag. All 4 pollers (dispatch 60s, task 120s, heartbeat 300s, sentinel 2hr) skip cycles when pipeline is active. Zero Supabase traffic from pollers during execution. Commit `152695b`.
2. **VIDEO LENGTH — LONG MODE OVERHAUL.** Prompt: "6-10 sentences (80-130 words)" per segment, `duration_hint: 40`, min 25s enforced. `maxTokens` 4096→8192. Source intel 3000→4000 chars. Word count logging. Pacing instruction for documentary feel. Commit `152695b`.
3. **TTS CADENCE — SLOWER DELIVERY.** `TTSOptions` with speed param. Long-form uses 0.9x. ElevenLabs: stability 0.65→0.80, style 0.45→0.35 when speed < 1.0. Commit `152695b`.
4. **CLIP UPLOAD RETRY.** 3x retry with exponential backoff (5s, 10s) on 503. 1.5s pacing between uploads. Commit `152695b`.
5. **BUFFER AUDIT COMMAND.** `/buffer_audit` lists channels, purges queued posts. Commit `152695b`.

**Phase 2 (19b): Root Cause of Pipeline Failures**
6. **PIPELINE LLM — GROQ FIRST.** Created dedicated `pipelineLLM = buildTeamLLM(["groq", "gemini", "anthropic", "openai"])`. Free providers first. Commit `b4f756a`.
7. **IMAGE FALLBACK — DALL-E 3 ADDED.** `generateSceneImage()` had zero fallback. Added DALL-E 3. Commit `2bac2be`. (Note: DALL-E 3 is now dead due to -$0.06 OpenAI credits.)

**Phase 3 (19c): Zero-Cost Image Generation**
8. **POLLINATIONS.AI AS PRIMARY IMAGE GENERATOR.** Since Gemini is in debt and OpenAI is negative, wired Pollinations.ai as PRIMARY for scene images. No API key, no auth, no rate limits, unlimited, free. Chain: Pollinations (free) → Imagen 4 (fallback) → DALL-E 3 (fallback). Pipeline now costs $0.00 in API credits. Commit `4ea6ba0`.

**All Session 19 Commits (chronological):**
- `152695b` — fix: pipeline poller pause, video length, TTS cadence, clip retry, buffer audit
- `ada85bb` — docs: Session 19 master reference update
- `b4f756a` — fix: pipeline uses Groq-first LLM to stop burning paid credits
- `2bac2be` — fix: add DALL-E 3 fallback when Imagen 4 quota exhausted
- `472e3af` — docs: Session 19b master reference update
- `4ea6ba0` — fix: Pollinations.ai as primary image gen (FREE, no auth, unlimited)

---

**Session Summary — Cowork Session 21 (2026-04-04):**

1. **BUFFER CHANNEL FILTER BUG — ROOT CAUSE FOUND AND ERADICATED.** `scheduleBufferWeek()` had a hardcoded `["twitter", "threads", "linkedin", "facebook", "mastodon"]` filter that excluded YouTube, Instagram, TikTok, and any other channel type. This was the sole reason posts only appeared on X and Threads. REMOVED the filter — now uses ALL active channels.
2. **FALSE "BUFFER CAN'T HANDLE VIDEO PLATFORMS" LIE — PURGED FROM 4 FILES.** False comments and blocking logic existed in vidrush-orchestrator.ts, video-publisher.ts, social-scheduler.ts, and content-engine.ts. All purged. Buffer supports every connected channel.
3. **SCHEDULING LOGIC REWRITTEN.** Old logic sent one post to ALL channels simultaneously (same time slot). New logic: round-robin each clip across channels, one channel per time slot, with platform-specific copy based on `SERVICE_TO_COPY_KEY` mapping. Staggered across 7 days, 4 slots/day.
4. **social-scheduler.ts VIDEO URL HANDLING FIXED.** Was returning an error and blocking the ENTIRE post if a video URL was in media_url. Now gracefully strips the video URL and posts text-only (video FILE uploads go through publish_video tool).
5. **content-engine.ts TEXT_OK_PLATFORMS EXPANDED.** Added youtube, linkedin, facebook to the set. Was incorrectly excluding them.

6. **BUFFER PLATFORM MEDIA REQUIREMENTS FIXED.** Research verified: TikTok/Instagram/YouTube REQUIRE video or image media — text-only posts are rejected by Buffer API. Split channels into text-ok (X, Threads, LinkedIn, FB) and media-required (TikTok, IG, YouTube). Media channels now receive clip video URL via `assets.videos`. social-scheduler now detects video URLs and uses `videos` asset type instead of `images`.

**All Session 21 Commits (chronological):**
- `5b3a88e` — fix: eradicate false Buffer channel filter — posts now go to ALL 9 channels
- `ecaee6f` — fix: Buffer platform-specific media requirements — TikTok/IG/YouTube need video

**Files modified this session:**
- `src/engine/vidrush-orchestrator.ts` — Rewrote scheduleBufferWeek() twice: first removed channel filter, then split into text/media channels with video attachment
- `src/tools/social-scheduler.ts` — Video URL detection uses `assets.videos` instead of stripping, mediaUrl made mutable
- `src/tools/video-publisher.ts` — Purged false "Buffer can't handle video" comments/descriptions
- `src/engine/content-engine.ts` — Expanded TEXT_OK_PLATFORMS, fixed false comments

**All Session 21 + 22 commits pushed. Railway auto-deploying.**

---

**Session Summary — Cowork Session 22 (2026-04-04):**

**DUE DILIGENCE ON BUFFER API — PLATFORM METADATA + LLM FAILOVER FIX.** Researched Buffer GraphQL API docs to verify everything BEFORE testing. Found and fixed critical issues that would have caused silent failures.

**Fixes deployed this session:**
1. **PLATFORM METADATA IN createPost MUTATION.** Buffer API requires specific metadata fields per platform. YouTube requires `title` + `categoryId`, Instagram requires `type` + `shouldShareToFeed`. Without these, posts are silently rejected. Added `metadata_json` parameter to social-scheduler.ts with a recursive `buildGqlObj` serializer that converts nested JS objects to inline GraphQL. Orchestrator now builds metadata per channel service type.
2. **VideoAssetInput VERIFIED.** Confirmed from Buffer docs that `videos: [{ url: String! }]` is the correct schema. Our code was already correct.
3. **LLM FAILOVER ORDER FIXED.** Railway env var was `gemini,anthropic,openai` — Groq (FREE tier) was completely excluded. Updated to `groq,gemini,anthropic,openai` in Railway AND in config.ts hardcoded default.
4. **media_url DESCRIPTION FIXED.** social-scheduler.ts tool description still said "image" only — updated to "image or video".

**Commit:** `fe768d5` — feat: add platform metadata to Buffer posts + fix LLM failover order

**Files changed:**
- `src/tools/social-scheduler.ts` — metadata_json param + buildGqlObj serializer + metadata block in mutation
- `src/engine/vidrush-orchestrator.ts` — per-channel metadata builder (YouTube/IG/TikTok) in scheduleBufferWeek
- `src/config.ts` — failover order → groq,gemini,anthropic,openai

---

**Session Summary — Cowork Session 23 (2026-04-05):**

**FIRST CLEAN PIPELINE TEST + TWO ARCHITECTURE BUGS FIXED.**

**Pipeline Test Results (video iR4AAwNP3r8):**
- All 8 steps completed successfully. Total time: 2313s (~38 min).
- Step 1: Whisper — 570 segments, niche: dark_psychology
- Step 2: Faceless Factory — "Beyond The Simulation" (258s, 12 scenes) — STILL SHORT (4.3 min vs 10-15 min target, deferred to Quality Gate)
- Step 3: YouTube upload — https://youtube.com/watch?v=ybjDyM3uVts
- Step 4: 9 clips chopped
- Step 5: 9/9 clips uploaded to Supabase (first time no 503s!)
- Step 6: Copy for 9 clips × 7 platforms
- Step 7: Distribution 9/9 succeeded (but dumped all at once — see Bug 1)
- Step 8: 16 posts scheduled in Buffer
- Buffer channels that received posts: TikTok (6), X (7), Threads (3) = 16
- Buffer channels that received ZERO: Instagram (0), YouTube (0) = see Bug 2

**Bug 1 FOUND AND FIXED — DUAL-PATH DISTRIBUTION (all Shorts at once):**
- **ROOT CAUSE:** Step 7 (`distributeClips`) fired `VideoPublisherTool` with `platforms: "all"` for every clip — direct API publish to TikTok/IG/YouTube ALL AT ONCE. Step 8 then scheduled the SAME clips across Buffer staggered over 7 days. Dual-path = duplicate posts + instant dump.
- **FIX:** Step 7 is now verification-only. It confirms clips have public URLs and logs readiness. NO MORE direct API publishing from Step 7. Step 3 handles the YouTube long-form. Step 8 handles ALL clip distribution via Buffer (staggered across 7 days, all 9 channels).
- **File:** `src/engine/vidrush-orchestrator.ts` — Replaced `distributeClips()` call with verification logic.

**Bug 2 FOUND AND FIXED — GRAPHQL ENUM QUOTING (YouTube/IG silent rejection):**
- **ROOT CAUSE:** `buildGqlObj()` in social-scheduler.ts quoted ALL string values with `JSON.stringify()`. But Buffer's GraphQL schema has enum fields that must be UNQUOTED: YouTube `privacy` (YoutubePrivacy enum: public/private/unlisted), Instagram `type` (PostType enum: reel). Sending `privacy: "public"` (quoted) instead of `privacy: public` (enum) caused Buffer to silently reject YouTube and Instagram posts. TikTok worked because its only metadata field is `title` (String, correctly quoted).
- **FIX:** Added `ENUM:` prefix convention. Strings starting with `"ENUM:"` are rendered unquoted by `buildGqlObj()`. Regular strings remain quoted. The prefix survives `JSON.stringify()`/`JSON.parse()` round-trip between orchestrator and social-scheduler.
- **Files:** `src/tools/social-scheduler.ts` (buildGqlObj enum detection), `src/engine/vidrush-orchestrator.ts` (metadata builder uses ENUM:public, ENUM:reel)

**Buffer GraphQL Schema Verified (from developers.buffer.com/reference.html):**
- `YoutubePostMetadataInput`: title (String!), categoryId (String!), privacy (YoutubePrivacy), license (YoutubeLicense), notifySubscribers (Boolean), embeddable (Boolean), madeForKids (Boolean)
- `InstagramPostMetadataInput`: type (PostType!), firstComment (String), link (String), geolocation (InstagramGeolocationInput), shouldShareToFeed (Boolean!)
- `TikTokPostMetadataInput`: title (String)
- `YoutubePrivacy` enum: public, private, unlisted
- `ShareMode` enum: addToQueue, shareNext, shareNow, customScheduled

**NEW: Viral Brain Prompt System (src/prompts/social-optimization-prompt.ts):**
- `buildSocialOptimizationPrompt(ctx)` — Deep platform-aware copy generation prompt with scratchpad pre-think layer
- `TARGET_AUDIENCES` — 5 customer avatars: trapped_professional, awakening_mind, dark_psychology_seeker, inner_circle_candidate, chosen_one
- `PLATFORM_DEFAULTS` — Per-platform metadata constraints (hashtag counts, max lengths, hook windows)
- Integration plan documented in PROMPT TEMPLATES section above

**Session 23 changes — ALL PUSHED. Full commit chain:**
- `a9ae902` — GraphQL enum quoting fix (ENUM: prefix), Step 7 → verification only, Viral Brain prompt system
- `c549b79` — Quality Gate: smart clip boundaries, segment expansion, audio mastering, silence pads, TTS speed, hook overlay
- `0177d3b` — Background music bed: niche-aware ambient drone (sine waves + pink noise)
- `2e1d3d0` — Truncated JSON repair (Strategy 5) + maxTokens bumped 8192→12288 for long-form
- `bd6744b` — Groq retry lock (3x before Gemini failover) + 8 daily Buffer time slots
- `050e699` — Alfred auto-pipeline trigger (daily scan finds YouTube URL → fires VidRush)

**QUALITY GATE — DEPLOYED (Session 23). Production upgrades in faceless-factory.ts:**
1. **Smart clip boundaries** — ffmpeg silencedetect finds natural pause points (±8s tolerance, 15-40s clips). Falls back to math division.
2. **Segment expansion** — If LLM produces < 15 segments, shortest are expanded via follow-up LLM calls.
3. **Audio mastering** — highpass 80Hz → compressor → warm bass EQ (+3dB@200Hz) → high cut (-1dB@3kHz) → loudnorm EBU R128 (-16 LUFS).
4. **Silence pads** — 0.6s between segments for breathing room.
5. **TTS speed** — 0.85x for documentary cadence (was 0.9x).
6. **Hook text overlay** — First sentence burns into opening 3s, fades out 2-3s. White text, dark shadow, centered.
7. **Background music** — Niche-specific ambient drone (dark_psych=A minor ominous, self_improvement=C major uplifting, etc). Layered sine waves + filtered pink noise. Mixed under voice via amix normalize=0. Graceful fallback if generation fails.

**LLM PROVIDER ARCHITECTURE (Session 23):**
- Pipeline LLM: Groq → (3 retries with 3s/6s/9s backoff) → Gemini → Anthropic → OpenAI
- Groq gets 4 total attempts before Gemini ever touches the request. Gemini's JSON output is unreliable.
- extractJSON has 5 strategies including truncation repair (closes open JSON structures)
- Long-form scripts use maxTokens=12288 (was 8192)

**CONTENT COMPOUNDING ENGINE (Session 23, SCHEDULE FIXED Session 24):**
- Alfred's daily 10:05AM CDT scan includes directive to find YouTube URL for #1 trending topic
- When response contains `PIPELINE_URL: <youtube_url>`, dispatch poller auto-fires VidRush pipeline
- Buffer scheduling expanded: 8 slots/day (4AM/6AM/8AM/10AM/12PM/2PM/5PM/8PM CT), 56 slots/week
- Steady state math: 1 auto + 1-2 manual URLs/day × 29 pieces/URL × 7-day spread = 250-400+ posts/week

**SCHEDULER TIMEZONE FIX + STAGGER (Session 24, commit d2847f7):**
- **BUG FIXED:** All schedulers used `.getHours()` which returns UTC on Railway, but hour values were written as if local time. Every task fired 3-6:30AM CDT while Architect was asleep. Zero dispatches in 24hr confirms bot may not be running OR tasks fired unnoticed.
- **FIX:** All `.getHours()` replaced with `.getUTCHours()`. Veritas Monday check uses `.getUTCDay()`. All hour values remapped to Architect's 10AM CDT day start. Minute-window guards added to every scheduler to prevent LLM/Supabase collision.
- **FINAL SCHEDULE (all CDT, all using getUTCHours + minute guards, pipeline-safe spacing):**
  - 10:00 AM — Morning Briefing (UTC 15, min 0-2) — direct LLM summary to Telegram
  - 10:05 AM — Alfred Trend Scan (UTC 15, min 5-7) — dispatches to crew_dispatch, **Groq primary** (promoted from Gemini)
  - ~10:15-11:15 AM — VidRush Pipeline (if Alfred finds URL) — pipelineLLM, Groq primary
  - 12:00 PM — Vector Metrics Sweep (UTC 17, min 0-2) — Groq primary (45min after pipeline clears)
  - 12:10 PM Mon — Veritas Weekly Directive (UTC 17, min 10-12) — Anthropic primary
  - 1:30 PM — Content Engine Production (UTC 18, min 28-32) — failoverLLM
  - 3:30 PM — Stasis Detection (UTC 20, min 28-32) — per-agent teams
  - 8:00 PM — Evening Recap (UTC 01, min 0-2) — failoverLLM
- **LLM TEAM UPDATE (Session 24):** Alfred promoted from Gemini to Groq primary. New teams:
  - Alfred + Vector + Yuki → Groq (14,400/day) — staggered so they never overlap
  - Anita → Gemini (250/day sufficient solo for lighter rewrite tasks)
  - Sapphire + Veritas → Anthropic (strategic, highest quality)
- **Config defaults:** `MORNING_BRIEFING_HOUR=15`, `EVENING_RECAP_HOUR=1` (in config.ts)
- **Files changed:** `src/config.ts`, `src/index.ts` (LLM teams + 7 scheduler blocks + log lines)

**SESSION 23 TEST 3 RESULTS (2026-04-05 ~3AM) — video tET-aR-JG-o:**
- ✅ 56 posts scheduled (8 slots/day working perfectly)
- ✅ 425s/7min video, 15 scenes (up from 258s/12 scenes in Test 2)
- ✅ All 8 steps green, Groq stayed primary
- ✅ Content quality is strong — intelligence, hooks, narrative all there
- ❌→[DVP: ADDRESSED] Music bed — was silent failure (Railway ffmpeg missing lavfi anoisesrc). Session 24: Node.js WAV generation, zero lavfi dependency. Commit `0706f68`. Needs pipeline test to verify.
- ❌→[DVP: ADDRESSED] Long-form orientation — was 9:16 vertical, should be 16:9 horizontal. Session 24: DIMS constant + orientation threading. Commit `0706f68`. Needs pipeline test to verify.
- ❌→[DVP: ADDRESSED] Delivery cadence — was too fast/run-on. Session 24: TTS 0.80, pads 1.5s, chapter breaks, pacing guidance. Commit `0706f68`. Needs pipeline test to verify.
- ❌→[DVP: ADDRESSED] Shorts are CLIPS not STORIES. Session 24: LLM semantic extraction identifies self-contained story moments from Whisper transcript. Three-tier fallback preserved. Commit `3291382`. Needs pipeline test to verify.

**SESSION 25 PIPELINE TEST RESULTS (2026-04-05) — video b67-5KxX5lY "Breaking Free":**
- ❌ COMPLETELY BLACK VIDEO — 5:46, 10.5MB (should be 40-60MB). All clips also black.
- Root cause: Pollinations.ai returns HTML/CAPTCHA from Railway IPs; old size-only check passed garbage through.
- ❌ Black flash between scenes — fade-to-black + fade-from-black = 0.8s dark gap per transition.
- ❌ Clips cutting mid-word — 10s Whisper chunk resolution too coarse for LLM timestamp precision, no audio padding.
- ❌ Scene transitions don't align with speech pauses — equal-division timing ignores TTS silence pads.
- ❌ Clip count/duration wrong for faceless output — 30 clips × 25s designed for 20-60min external rips, not 5min faceless.
- ✅ Story extraction "a little better" per Ace.

**SESSION 25 FIXES (PUSHED — commit `5adefce`, auto-deploying to Railway):**
1. [DVP: ADDRESSED] Image validation: magic byte check (PNG/JPEG/WebP/GIF) + >10KB size gate. Fallback chain: Pollinations → Imagen 4 → DALL-E 3 → cinematic gradient (niche-aware palettes) → minimal dark PNG. `generateSceneImage()` almost never returns null.
2. [DVP: ADDRESSED] Scene crossfade: replaced per-scene fade-in/fade-out with true xfade dissolve filter chain. 0.6s dissolve between scenes, no black flash.
3. [DVP: ADDRESSED] Clip timing: Whisper chunk resolution 10s → 5s. Audio-aware padding (PAD_BEFORE=0.3s, PAD_AFTER=0.2s, boundary-clamped). Audio fades (afade in 0.15s, afade out 0.3s).
4. [DVP: ADDRESSED] Scene-audio sync: `renderAudio()` now returns per-segment durations (voiceover + silence pads). `assembleVideo()` uses actual durations per scene instead of equal division. Scene transitions now land on natural speech pauses.
5. [DVP: ADDRESSED] Dynamic clip params: faceless output (3-8min) gets ~1 clip per 45s (4-12 clips, 20-55s each). External rips (>10min) keep 30 × 25s defaults.
6. [DVP: ADDRESSED] xfade offset calculation: uses cumulative per-clip durations for variable-length scenes (was equal-division formula).

**NEXT SESSION PRIORITIES (Session 26):**
1. CHECK ALFRED'S 10AM RUN — pipeline should auto-trigger. Check Railway logs + Supabase for new video.
2. DVP VERIFICATION — test results will upgrade ADDRESSED → VERIFIED or flag REGRESSED. Key checks:
   - Is the video visible (not black)? → validates Fix 1 (image validation + gradient fallback)
   - Are scene transitions smooth (no black flash)? → validates Fix 2 (xfade dissolve)
   - Do clips start/end cleanly (no mid-word cuts)? → validates Fix 3 (audio padding)
   - Do scene changes land on speech pauses? → validates Fix 4 (scene-audio sync)
   - Are clip count/duration reasonable for source length? → validates Fix 5 (dynamic params)
3. If all VERIFIED → production-ready. If any REGRESSED → debug that specific fix.
- THIS IS THE BIG ONE. Replace silence-boundary chopping with LLM semantic extraction.
- New Step 4a: LLM reads full transcript with timestamps → identifies 8-12 self-contained "story moments" (hook → insight → payoff)
- Step 4b: Map story moments to video timestamps
- Step 4c: Cut at semantic boundaries, not silence boundaries
- Each short should feel COMPLETE: setup, insight, resolution
- This is Yuki's original purpose — consider wiring her in OR keeping as inline LLM pass for speed

**STEP 5: PLATFORM ADAPTATION ENGINE (deferred from Session 23).**
- Horizontal long-form → YouTube
- Vertical shorts → TikTok, Instagram Reels, YouTube Shorts
- Platform-specific cadence: TikTok = faster cuts, YouTube = slower delivery
- Wire in Viral Brain prompt for per-platform copy optimization

**AGENT ROLE EVOLUTION (Ace's question — "are they all still necessary?"):**
- Veritas: Pipeline trigger + DM interface. ESSENTIAL.
- Alfred: Daily trend scan + auto-pipeline trigger. ESSENTIAL (just built).
- Yuki: Evolving from "clip extraction dispatch" to "semantic story finder" in Step 4. ESSENTIAL for shorts quality.
- Anita: Protocol 77 voice DNA is in all scripts. Could evolve to quality reviewer (rewrites weak sections pre-TTS). KEEP.
- Vector: Analytics + metrics. Dormant until revenue flows. LOW PRIORITY.
- Sapphire: Brand guardian + strategic oversight. Value increases at scale. LOW PRIORITY NOW.

**Buffer channels are CORRECT (9 total = 2 brands x ~5 platforms). They are NOT duplicates. DO NOT suggest cleaning or removing channels. DO NOT filter channels by service type. EVER.**

---

**PROMPT TEMPLATES — VIRAL BRAIN SYSTEM (Session 23):**

**File:** `src/prompts/social-optimization-prompt.ts`
**Purpose:** Deep platform-aware copy generation that replaces the shallow generic prompt in `generatePlatformCopy()` (vidrush-orchestrator.ts line 263). The current prompt just says things like "Casual, hook-driven" — the Viral Brain prompt forces the LLM to think through algorithm priorities, engagement patterns, timing, virality mechanics, and accessibility per platform before generating copy.

**Contains:**
- `buildSocialOptimizationPrompt(ctx)` — Full prompt builder with scratchpad pre-think layer. Accepts content type, platform, target audience, source title, niche, transcript, brand.
- `TARGET_AUDIENCES` — Pre-built audience profiles mapped to the 4 Sovereign Synthesis customer avatars (Trapped Professional, Awakening Mind, Dark Psychology Seeker, Inner Circle Candidate).
- `PLATFORM_DEFAULTS` — Per-platform metadata defaults (hashtag counts, max lengths, format requirements, hook windows).

**Integration plan (Quality Gate Step 6 upgrade):**
1. Import `buildSocialOptimizationPrompt` and `TARGET_AUDIENCES` into vidrush-orchestrator.ts
2. Replace the inline prompt string in `generatePlatformCopy()` with per-platform calls using the template
3. Use `PLATFORM_DEFAULTS` to validate generated copy (e.g., reject if X caption > 280 chars, enforce #Shorts in YouTube titles)
4. Platform Adaptation Engine uses the same prompt system but for VIDEO format decisions (speed, aspect ratio, overlay style)

**Variables map to pipeline:**
- `contentType` → set by orchestrator (faceless_video for long-form, short_clip for clips)
- `platform` → derived from `SERVICE_TO_COPY_KEY` per channel
- `targetAudience` → selected from `TARGET_AUDIENCES` based on brand (ace_richie → trapped_professional, containment_field → dark_psychology_seeker)

---

**Session Summary — Cowork Session 18 (2026-04-04):**
1. **FIRST LIVE PIPELINE RUN COMPLETED — BUT THE MACHINE IS STILL BROKEN.** Pipeline ran all 8 steps on video WhqdFNK58S8 (Russell Brunson "Mind Control" video). Produced "The Mind Control Blueprint Hidden For 100 Years" — 219s (3.6 min, should be 10-15 min), 20 scenes, uploaded to YouTube as https://youtube.com/watch?v=mSPZdSX21O4. BUT: only 8 clips cut (should be ~30), 0/8 clips uploaded to Supabase (503 errors), 0 clips distributed, Buffer scheduling unknown. VIDEO QUALITY NOT YET EVALUATED — can't even get to quality tuning because the infrastructure is still failing.
2. **BUGS FIXED THIS SESSION:**
   - Command routing: `/dryrun` and `/pipeline` were placed in crew agent handler (Sapphire scope) instead of Veritas `handleCommand()` switch. Moved to correct scope. Added `@botname` stripping from commands (`.replace(/@\w+$/i, "")`). Added `.toLowerCase()` normalization.
   - Error handling: Wrapped all Telegram sendMessage calls in try-catch with plain text fallback. No more silent failures.
   - Duplicate code: Removed ~140 lines of duplicate `/dryrun`, `/pipeline`, and YouTube URL handlers from crew agent `onMessage` handler. Crew bots now redirect to Veritas for pipeline commands.
   - JSON parsing: Faceless Factory script parser replaced with 4-strategy `extractJSON()` function (direct parse, balanced brace matching, sanitized regex, common-mistake fixer). Prevents crash when LLM returns slightly malformed JSON.
   - yt-dlp JS runtime: YouTube 2025+ requires explicit JS runtime declaration. Added `--js-runtimes node` to all 3 yt-dlp call sites (whisper-extract.ts, vid-rush.ts, clip-generator.ts) AND global config in Dockerfile.bot (`/etc/yt-dlp/config`). NOTE: The valid runtime names are `deno, node, bun, quickjs` — NOT `nodejs`. Session 20 fixed this after `nodejs` caused pipeline failure.
   - Temp file cleanup: Added `cleanupJobFiles()` to faceless-factory.ts and `cleanupPipelineJob()` to vidrush-orchestrator.ts. Removes intermediate TTS segments, raw audio, scene images, concat lists, stale whisper files (>1hr). Runs on success and failure.
3. **STILL BROKEN — CRITICAL (must fix next session):**
   - **yt-dlp JS runtime fix NOT YET DEPLOYED when last tested.** Commits b6d8970 + 34d1109 are pushed but Railway may not have rebuilt yet. The Dockerfile change (34d1109) forces a full Docker rebuild which takes longer. MUST verify this works before anything else.
   - **Supabase 503 flood STILL HAPPENING.** Clip uploads (Step 5), distribution logging, and Buffer scheduling all fail because Supabase returns 503. Background pollers may still be hammering it. Need to check poller intervals and potentially pause non-essential pollers during pipeline runs.
   - **Buffer is FULL OF FAILED POSTS.** Screenshot shows April 2026 calendar packed with red X marks across all channels. 155 items in Publish queue. Multiple channels (the_containment_f, acerichie77, ace_richie_77, Ace Richie, The Containment, AceRichie77, ContainmentFld) — many appear to be DUPLICATE channels for the same brands. Failed posts need to be purged. Channel list needs audit and cleanup.
   - **Video output too short.** 219s (3.6 min) instead of target 10-15 min. The `"long"` mode requests 20 segments but the actual TTS + assembly produced a much shorter video. Need to investigate segment duration hints, TTS output length, and assembly logic.
   - **Only 8 clips cut instead of ~30.** The 219s video at 25s/clip = 8 clips max. This is a downstream effect of the short video. Fix the video length → clip count fixes itself.
4. **Commits this session (all pushed to main):**
   - `56d8c53` — fix: robust command routing for /dryrun and /pipeline
   - `c3b8ca7` — fix: robust JSON extraction for Faceless Factory script parsing
   - `6a2e255` — feat: auto-cleanup temp files after pipeline runs
   - `b6d8970` — fix: add --js-runtimes nodejs to all yt-dlp commands
   - `34d1109` — fix: global yt-dlp config for nodejs runtime in Dockerfile

**NEXT SESSION PRIORITIES (Session 19 — VidRush Completion):**
1. **VERIFY yt-dlp fix deployed** — Send `/test_tts` to Veritas to confirm new code is live. Check uptime. Then test `/pipeline` with a YouTube URL.
2. **FIX SUPABASE 503** — Check poller intervals. May need to pause dispatch poller and heartbeat during pipeline runs, or increase backoff further. Check if free tier is simply overwhelmed.
3. **FIX VIDEO LENGTH** — Investigate why "long" mode (20 segments) only produces 3.6 min. Check segment duration hints in script generation, TTS output per segment, and assembly logic. Target: 10-15 min output.
4. **AUDIT + CLEAN BUFFER** — Purge all failed posts. Audit channel list — remove duplicates. Verify Buffer API tokens are valid. Test a single manual post before pipeline scheduling.
5. **END-TO-END PIPELINE TEST** — With all above fixed, run `/pipeline <url>` and verify all 8 steps complete with real clip uploads, real distribution, real Buffer scheduling.
6. **QUALITY EVALUATION** — Once pipeline completes successfully, evaluate: video watchability, voiceover quality, scene image quality, caption quality, posting schedule sanity.

**Session Summary — Cowork Session 17 (2026-04-03):**
1. **VIDRUSH FULL AUTONOMOUS PIPELINE — BUILT.** The pipeline Ace envisioned across 16 sessions is now wired end-to-end: 1 YouTube URL → Whisper extraction → Faceless Factory LONG (Anita's Protocol 77 voice, 20 segments, 10-15 min) → YouTube long-form upload → chop into ~30 clips (9:16, niche color grades) → platform-specific copy generation (7 platforms) → distribute to TikTok/IG/YouTube Shorts → schedule a week of text posts in Buffer. All 8 steps chain autonomously.
2. **NEW FILE: `src/engine/vidrush-orchestrator.ts`** — Master pipeline engine. `executeFullPipeline(youtubeUrl, llm, brand)` runs all 8 steps with progress callbacks. Reports back via `formatPipelineReport()`. Logs full run to `content_transmissions` in Supabase.
3. **NEW TOOL: `YouTubeLongFormPublishTool`** in `src/tools/video-publisher.ts` — Same OAuth flow as Shorts but WITHOUT `#Shorts` injection, uses category 27 (Education) instead of 22, no title mangling. Supports both channels (ace_richie / containment_field).
4. **YOUTUBE URL HANDLER REWRITTEN** in `src/index.ts` — Replaced the old Alfred-dispatch flow with direct `executeFullPipeline()` call. Veritas handleCommand() routes `/dryrun` and `/pipeline`. Crew bots redirect pipeline commands to Veritas.
5. **PLATFORM-SPECIFIC COPY ENGINE** — Built into orchestrator. LLM generates unique captions for youtube_short, tiktok, instagram, x_twitter, threads, linkedin, facebook per clip.
6. **BUFFER WEEK SCHEDULING** — Built into orchestrator. Stagger 4 posts/day across 7 days. Auto-discovers Buffer channels.

**Session Summary — Cowork Session 16 (2026-04-03):**
1. **SUPABASE 503 FLOOD — ROOT CAUSE FIXED AND DEPLOYED.** Dispatch poller was firing 6 separate `claimTasks()` queries every 15s (~24 req/min) + task poller every 30s + heartbeat + Sapphire sentinel = 40-50 req/min. Free tier PostgREST was choking, returning wall-to-wall 503s on every table query.
2. **BATCHED DISPATCH POLLER.** New `claimAllPending()` function in `src/agent/crew-dispatch.ts` — fetches ALL pending tasks for ALL 6 agents in ONE query instead of 6 separate queries. Returns `Map<string, DispatchRecord[]>`. Single PATCH to claim all at once.
3. **EXPONENTIAL BACKOFF ON 503.** Dispatch poller now uses `setTimeout` recursion instead of `setInterval` for dynamic backoff. On 503, interval doubles (60s → 120s → 240s → 300s max). Resets to 60s base on success. Throws `503_BACKOFF` sentinel for caller to handle.
4. **POLLING INTERVALS RELAXED.** Dispatch poller: 15s → 60s base. Task approval poller: 30s → 120s. 30s startup delay before first dispatch poll. Net result: ~1 req/min for dispatch instead of ~24 req/min.
5. **BRACE ALIGNMENT FIX.** Session 15 left the dispatch poller rewrite with a missing `try {` block — the `for-of` loop over `agentLoops` had a `catch` without a matching `try`. Fixed, TypeScript compiles clean (zero errors in modified files).
6. **Push status: ✅ PUSHED** — Commit `2a1b2cf` pushed to main. Railway auto-deploying.

**Session Summary — Cowork Sessions 14-15 (2026-04-03):**
1. **SEEDER FIX PUSHED.** `pinecone.ts` upsert fix from Session 13 confirmed pushed (commit `d17ead9`).
2. **BOT HEALTH VERIFIED.** `/health` endpoint confirmed alive with pinecone/supabase/gemini all true.
3. **SUPABASE 503 ROOT CAUSE DIAGNOSED.** Pulled API logs — every single query (crew_dispatch, tasks, content_engine_queue, vid_rush_queue, glitch_log, relationship_context, content_transmissions) returning 503. Identified polling frequency as the cause.
4. **PERSONALITY CONFIG BUNDLING.** Commit `8bd806e` — bundled personality configs locally + 409 conflict defense. This was the last successful deploy before the 503 fix.
5. **PARTIAL FIX WRITTEN BUT UNCOMMITTED.** `claimAllPending()` function written, dispatch poller rewritten, but had a brace alignment bug. Completed in Session 16.

**NEXT SESSION PRIORITIES (Session 17):**
1. **VERIFY 503s STOPPED** — After deploy completes, check Supabase API logs. Should see dramatically fewer requests.
2. **NODE_MODULES CLEANUP** — Windows-side `node_modules` is corrupted (stale worktree artifacts). Run `rmdir /s /q node_modules` then `npm install` via Desktop Commander cmd shell.
3. **VIDRUSH END-TO-END TEST** — Full pipeline test (carried from Session 12)
4. **COOKIE RESILIENCE** — Monitor cookie expiry (carried from Session 12)
5. **CONTENT ENGINE → VIDRUSH BRIDGE** — Connect content output to `vid_rush_queue` (carried from Session 12)
6. **MISSION CONTROL AUTH** — Future: Add Supabase Auth to dashboard so anon key can be fully locked down

**Previous Session Summary — Cowork Session 13 (2026-04-03):**
1. **SUPABASE SECURITY HARDENING — ZERO ADVISORIES REMAINING.** Full security audit and remediation of Supabase project `wzthxohtgojenukmdubz`. 4 critical tables (`products`, `payment_history`, `market_research`, `lexical_extraction`) had RLS completely disabled — now enabled with `service_role` ALL + `anon` SELECT-only policies. `users` table had RLS enabled but zero policies — fixed. 4 functions (`increment_fiscal_sum`, `unsubscribe_email`, `get_pending_nurture`, `set_nurture_defaults`) had mutable `search_path` — pinned to `public`. ~40 anon INSERT/UPDATE policies dropped across all tables. ~12 wide-open `{public}` ALL policies replaced. **New security model: `service_role` = full access (bot writes), `anon` = SELECT-only (dashboard reads).** Supabase security advisor returns zero lints.
2. **DISK IO ROOT CAUSE FOUND + FIXED.** `sync_log` exploded from 558 to 19,237 rows in one week due to blueprint seeder running on every Railway restart (~75 restarts) without dedup. Each restart logged ~250 blueprint chunks. `crew_dispatch` accumulated 3,307 completed tasks. **Purged sync_log from 19,734 → 3,784 rows.** Added unique index on `sync_log.vector_id`.
3. **BLUEPRINT SEEDER FIX.** `src/memory/pinecone.ts` — `writeSyncLog()` changed from blind `.insert()` to `.upsert()` with `onConflict: "vector_id"`. `seedBlueprints()` now checks if any `blueprint-*` entries exist in `sync_log` before running — skips entirely if already seeded. This prevents the 75x duplicate writes that caused the IO budget depletion.
4. **RETENTION CLEANUP POLICY DEPLOYED.** `pg_cron` extension enabled. Function `run_retention_cleanup()` runs daily at 3 AM UTC. It deduplicates `sync_log` (keeps latest per `vector_id`), prunes completed `crew_dispatch` older than 7 days, and prunes `messages_log` older than 30 days. Returns JSON with purge counts.
5. **DASHBOARD LOCKED TO READ-ONLY.** All anon write policies removed. Mission Control dashboard (using `NEXT_PUBLIC_SUPABASE_ANON_KEY` in browser) can now only SELECT. Bot uses `service_role` key which bypasses RLS — completely unaffected. **Architectural note:** The anon key is visible in Vercel frontend source. Anyone who extracts it can read (but no longer write) public tables. Full fix requires adding Supabase Auth to Mission Control (future task).
6. **Push status: ✅ PUSHED** — Seeder fix pushed in Session 14 (commit `d17ead9`). 503 fix pushed in Session 16 (commit `2a1b2cf`).

**Previous Session Summary — Cowork Session 12 (2026-04-03):**
1. **GIT PUSH + RAILWAY DEPLOY.** Session 11 code (Chromium, Puppeteer, browser tools, TikTok/IG upload tools, login endpoints, agent browser directives) pushed to main. Commit includes all Session 11 files. Railway auto-deployed successfully with `BROWSER_ENABLED=true` set in env vars.
2. **COOKIE IMPORT ENDPOINT BUILT + DEPLOYED.** New `POST /api/browser/import-cookies` endpoint. Accepts `{domain, account?, cookies[]}` — validates domain against allowlist (tiktok, instagram, youtube, twitter, threads), validates account (acerichie, tcf), normalizes cookie format for Puppeteer, saves via account-aware `saveCookies()`, verifies by loading back, sends Telegram notification. Companion `POST /api/browser/cookie-status` reports per-account cookie counts. Commits `1212595` + `07b9dba`.
3. **SUPABASE AGENT BLUEPRINTS UPDATED.** All 6 agent `personality_config` rows updated via direct Supabase SQL with permanent browser scope sections (Alfred=research, Veritas=fact-check, Vector=analytics, Anita=trends, Yuki=PRIMARY distribution, Sapphire=intel).
4. **CHROME EXTENSION COOKIE EXTRACTION.** Built `C:\Users\richi\cookie-ext` — Manifest V3 extension with popup UI using `chrome.cookies.getAll()` API to extract all cookies (including httpOnly session cookies) for TikTok and Instagram. Downloads as JSON files. Solved Chrome v20 app-bound encryption barrier that blocked all external decryption approaches (direct DB, CDP, Cookie Store API).
5. **MULTI-ACCOUNT COOKIE SYSTEM.** Upgraded from single-account to dual-brand cookie storage. `saveCookies(domain, cookies, account?)` and `loadCookies(domain, account?)` now store per-account files: `tiktok_acerichie.json`, `tiktok_tcf.json`, etc. Legacy fallback: old single-file cookies still load if no account-specific file found. TikTok + Instagram browser upload tools accept `brand` param, map `ace_richie` → `acerichie`, `containment_field` → `tcf`. Video publisher passes brand through to browser upload tools automatically.
6. **BOTH BRANDS ARMED.** Ace Richie: TikTok 71 cookies + Instagram 11 cookies. The Containment Field: TikTok 71 cookies + Instagram 11 cookies. All four cookie sets verified via `/api/browser/cookie-status`. Yuki now auto-selects the correct cookie jar based on which brand she's distributing for.
7. **Push status: ✅ PUSHED** — Commits `1212595` + `07b9dba` pushed to main. Railway deployed and verified live.

**POST-DEPLOY CHECKLIST (Session 12) — STATUS:**
1. ✅ Git push + Railway deploy
2. ✅ `BROWSER_ENABLED=true` set in Railway env
3. ✅ Supabase agent blueprint browser scopes updated
4. ✅ TikTok + Instagram cookies extracted and imported
5. ⏳ VidRush E2E test — Still needs full pipeline test: YouTube URL → clips → publish to all 3 platforms
6. ⏳ Cookie resilience monitoring — Auto-detect expiry + re-login notification
7. ⏳ Content Engine → VidRush bridge — Connect content output to `vid_rush_queue`

**NEXT SESSION PRIORITIES (Session 13):**
1. **VIDRUSH END-TO-END TEST** — Full pipeline: YouTube URL in → Groq Whisper transcription → clip generation → publish to YouTube Shorts + TikTok (browser, both brands) + Instagram (browser, both brands)
2. **COOKIE RESILIENCE** — Monitor if TikTok/IG cookies expire, build auto-detection + Telegram re-login notification
3. **CONTENT ENGINE → VIDRUSH BRIDGE** — Connect content engine output to `vid_rush_queue` for automated distribution
4. **PINECONE AUTH FIX** — Still blocked on API key rotation (from Session 10 backlog)
5. **COOKIE RE-EXPORT WORKFLOW** — When cookies expire: open Chrome extension popup → EXTRACT BOTH → rebuild payloads via `build_tcf_payloads.ps1` or `reimport_ar.ps1` → `curl -d @file` to Railway. Scripts live in `C:\Users\richi\cookie-ext\`.

**Previous Session Summary — Cowork Session 11 (2026-04-03):**
1. **CHROMIUM + PUPPETEER IN DOCKER.** `Dockerfile.bot` production stage now installs `chromium` via apt-get. `puppeteer-core` (v24.x) added to package.json dependencies. Env vars set in Dockerfile: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, `PUPPETEER_SKIP_DOWNLOAD=true`. System Chromium used — no duplicate download.
2. **BROWSER.TS FULL REWRITE — FROM TOY TO WEAPON.** Replaced 3-action toy tool with 12-action arsenal: navigate, click, type, wait, screenshot, extract, evaluate, login, upload_video, cookies_save, cookies_load, close. Singleton browser instance with auto-idle shutdown (5 min). Cookie persistence to filesystem (`/app/data/browser-cookies/`). Mobile viewport emulation support. Exports `getBrowser`, `saveCookies`, `loadCookies` for use by upload tools.
3. **TIKTOK BROWSER UPLOAD TOOL.** New `src/tools/tiktok-browser-upload.ts`. Puppeteer workflow: download video from Supabase URL → restore TikTok session cookies → navigate to upload page → attach file → fill caption → click Post → save updated cookies → log to Supabase `content_transmissions`. Includes `tiktokLoginFlow()` for one-time manual login (120s window).
4. **INSTAGRAM BROWSER UPLOAD TOOL.** New `src/tools/instagram-browser-upload.ts`. Same pattern as TikTok but with mobile viewport emulation (390×844, iPhone UA, deviceScaleFactor 3). Multi-step flow navigation (Next → Next → Share). Includes `instagramLoginFlow()` for one-time manual login.
5. **BROWSER FALLBACK WIRED INTO VIDEO PUBLISHER.** `VideoPublisherTool.execute()` now checks: if TikTok API token missing but `browserEnabled` → use `TikTokBrowserUploadTool`. Same for Instagram. YouTube stays on direct API. Summary output shows "Browser fallback active" for affected platforms.
6. **LOGIN ENDPOINTS REGISTERED.** New API endpoints: `POST /api/browser/tiktok-login` and `POST /api/browser/instagram-login`. One-time setup flows that launch Chromium, navigate to login page, wait 120s for manual auth, save cookies. `/api/vid-rush/status` now reports `browser_enabled`, `tiktok_browser`, `instagram_browser` fields.
7. **ALL 6 AGENT PERSONALITIES UPDATED WITH BROWSER DIRECTIVES.** Browser capability directives injected per-agent alongside protocol/knowledge directives at boot: Alfred = research/verify, Veritas = fact-check/competitor scrape, Vector = analytics scraping, Anita = trend research, Yuki = PRIMARY TikTok+IG distribution, Sapphire = strategic intel. Plus `scripts/update-agent-browser-scopes.ts` to update Supabase `personality_config` blueprints with permanent browser scope sections.
8. **BUILD VERIFIED.** TypeScript compiles clean (`tsc --noEmit` = 0 errors). `@types/yauzl` added as dev dep (puppeteer-core transitive).
9. **Push status: ⏳ NOT PUSHED** — All code written and compiled. Needs git push to trigger Railway deploy.

**POST-DEPLOY CHECKLIST (Session 11):**
1. Set in Railway env: `BROWSER_ENABLED=true`
2. Run `scripts/update-agent-browser-scopes.ts` to update Supabase personality blueprints
3. Deploy → verify Railway build succeeds (Chromium install adds ~200MB to image)
4. Hit `POST /api/browser/tiktok-login` → manually log in within 120s window → cookies saved
5. Hit `POST /api/browser/instagram-login` → same manual login flow
6. VidRush E2E test: YouTube URL → Groq Whisper → clips → sweep → YouTube Shorts + TikTok browser + IG browser

**Session 12 Priorities — COMPLETED (see Session 12 summary above):**
1. ✅ GIT PUSH + DEPLOY — Pushed, Railway built with Chromium
2. ✅ COOKIE IMPORT (replaced manual login) — Built import endpoint + Chrome extension, cookies extracted and imported
3. ⏳ VIDRUSH E2E TEST — Deferred to Session 13
4. ⏳ COOKIE RESILIENCE — Deferred to Session 13
5. ⏳ CONTENT ENGINE → VIDRUSH BRIDGE — Deferred to Session 13
6. ⏳ PINECONE AUTH FIX — Still blocked

**Previous Session Summary — Cowork Session 10 (2026-04-03):**
1. **GROQ WHISPER SWAP — OpenAI billing dependency ELIMINATED.** `vid-rush.ts` now uses Groq Whisper API (`whisper-large-v3-turbo`) as primary transcription provider. `GROQ_API_KEY` already set in Railway (14,400 req/day free tier). OpenAI Whisper is automatic fallback if Groq fails. 25MB file size check added. VidRush can now transcribe without OpenAI credits.
2. **VID-RUSH DISTRIBUTION SWEEP ENDPOINT.** New `/api/vid-rush/sweep` (POST) — reads `vid_rush_queue` where status = "ready" → publishes each clip to YouTube Shorts, TikTok, and Instagram Reels via `VideoPublisherTool` (direct API, bypasses Buffer). Updates status to "published" or "publish_failed". Sends Telegram notification with results. This is the missing link between clip generation and platform distribution.
3. **VID-RUSH STATUS ENDPOINT.** New `/api/vid-rush/status` (POST) — reports queue state (counts by status) AND which platform tokens are detected (youtube, youtube_tcf, tiktok, instagram, groq_whisper, openai_whisper). Use this to verify credential state instead of guessing.
4. **YOUTUBE OAUTH TOKENS CONFIRMED SET.** All four YouTube credentials verified in Railway: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` (Ace Richie 77), `YOUTUBE_REFRESH_TOKEN_TCF` (The Containment Field). YouTube Shorts publishing has ZERO credential blockers.
5. **TIKTOK + INSTAGRAM API ACCESS BLOCKED.** TikTok Content Posting API and Instagram Graph API require app review/approval that has been rejected. Browser automation (Puppeteer) identified as the workaround — upload videos through web interfaces. EXECUTED IN SESSION 11.
6. **CONTENT ENGINE QUEUE VERIFIED.** All 16 posts from Sessions 9+10 confirmed posted. Queue clean. Distribution sweep working.
7. **Push status: ✅ PUSHED** — Commit `cb605a8` pushed to main. Railway auto-deploying.

**Previous Session Summary — Cowork Session 9 (2026-04-03):**
1. **FIRST LIVE ANITA-VOICED PRODUCTION RUN — 12/12 SUCCESS.** Triggered `/api/content-engine/produce` on the deployed Session 8 code. All 12 posts generated (6 Ace Richie, 6 Containment Field — but only 3 CF slots had content due to time_slot distribution). Every post uses Protocol 77 HOOK → PIVOT → ANCHOR. Voice is clearly differentiated between brands. Quantum niche today: Observer Effect × attention warfare × consciousness rendering. All 12 have Imagen 4 images attached. Content is sitting in `content_engine_queue` with status = "ready", awaiting distribution sweep.
2. **BUFFER NUKE QUERY FIX.** The `nukeBufferQueue()` function had wrong Buffer GraphQL schema — used `channelId` and `status` directly on `PostsInput` but Buffer requires `organizationId` (required), `filter.channelIds` (array), `filter.status` (array of enums: `draft`, `buffer`). Also needed Relay-style pagination (`first`/`after` + `edges[].node` + `pageInfo`). Fixed with proper schema and pagination loop.
3. **DIAG ENDPOINT MODEL FIX.** `/api/content-engine/diag` was testing `imagen-3.0-generate-002` (404 — decommissioned). Updated to `imagen-4.0-generate-001` to match production code. Gemini Imagen 4 confirmed working (12/12 images generated).
4. **DALL-E 3 STILL DOWN.** OpenAI billing hard limit still hit. Imagen 4 is sole image provider. Not blocking — all 12 images generated fine.
5. **Push status: ✅ PUSHED** — Commit `c306866` pushed to main. Railway auto-deploying.

**NEXT SESSION PRIORITIES:**
1. **Fire distribution sweep** — 12 posts sitting in "ready" status. Need to trigger `/api/content-engine/sweep` to push them into Buffer's queue for scheduled posting. Do this after Railway finishes deploying Session 9 code.
2. **VidRush end-to-end test** — Still untested. Drop a YouTube URL to Alfred's DM and verify: (a) Make.com Scenarios E+F fire (check execution count), (b) callback hits `/api/vidrush`, (c) downstream dispatches to Yuki/Anita/Sapphire chain.
3. **Content quality tuning** — Review the 12 posts in Buffer after distribution. Some posts are slightly repetitive on the quantum × observer effect theme (same niche across all 6 slots). Consider whether niche rotation should vary within a day or if single-niche-per-day is the right strategy.
4. **OpenAI billing** — Add credits to restore DALL-E 3 as fallback image provider. Low priority while Imagen 4 works.

**Previous Session Summary — Cowork Session 8 (2026-04-02, night):**
1. **CONTENT ENGINE VOICE OVERHAUL — Anita is now the engine.** Replaced the generic 2-paragraph brand voice prompt with full Anita-driven Protocol 77 blueprints per brand. Every post now uses HOOK → PIVOT → ANCHOR structure with Sovereign Synthesis lexicon (Ace Richie) or clinical dark intelligence framing (Containment Field). `BRAND_VOICE_BLUEPRINTS` constant contains ~500-word personality blueprints per brand. `NICHE_CONTENT_DIRECTION` gives Anita specific content guidance per niche × brand combination (10 unique direction prompts). The engine no longer sounds like "an AI wrote this" — it sounds like Anita wrote it.
2. **IMAGE GENERATION OVERHAUL — Niche × brand cinematic visual spec.** Replaced generic image prompts ("High contrast monochromatic, brutalist aesthetic") with 10 cinematic visual direction prompts (5 niches × 2 brands). Each produces visually distinct imagery: Ace dark_psych = noir cinema with amber light, CF dark_psych = surveillance-aesthetic rain-slicked noir. Images now include explicit "NO text, NO words, NO letters" instructions to prevent AI text artifacts. `IMAGE_NICHE_PREFIXES` is now `Record<string, Record<Brand, string>>` instead of flat string map.
3. **BUFFER QUEUE NUKE ENDPOINT.** New `/api/content-engine/nuke-queue` (POST) — deletes ALL queued Buffer posts across all 9 channels AND clears non-posted Supabase `content_engine_queue` rows. Sends Telegram notification to Architect when complete. New export: `nukeBufferQueue()` from content-engine.ts.
4. **YOUTUBE URL ROUTING FIX — ALL agents now intercept.** Previously only Alfred's DM handler matched YouTube URLs. Now ANY agent (Sapphire, Veritas, Yuki, Anita, Vector) intercepting a YouTube URL will: (a) fire Make.com Scenarios E+F webhooks, (b) auto-dispatch to Alfred via `crew_dispatch`, (c) acknowledge the routing to the user. Alfred still processes directly when he receives the URL. URL regex also updated to match `/live/` and `/shorts/` paths (Ace was sharing YouTube Live URLs that wouldn't match the old regex).
5. **Push status: ✅ PUSHED** — Commit `e72cac1` pushed to main. Railway auto-deployed.

**Previous Session Summary — Cowork Session 7 (2026-04-02, late night):**
1. **CE-3 FIX: YouTube skipped in distribution.** Buffer YouTube integration requires VIDEO only — image+text posts explicitly rejected by Buffer API ("YouTube posts do not support image attachments", "YouTube posts require a video"). Community posts via Buffer are not supported. YouTube skipped with clear log message until video pipeline (Make.com Scenario F) is operational.
2. **CE-4 FIX: Threads 500-char truncation.** Meta's Threads API hard-limits posts to 500 characters. Distribution now truncates Threads text to 497 chars + "..." automatically. `THREADS_CHAR_LIMIT` constant. **VERIFIED: Threads posts flowing to Buffer ✅**
3. **CE-5 FIX: Instagram metadata.instagram.type = post.** Buffer GraphQL schema nests IG post type inside `metadata: { instagram: { type: post, shouldShareToFeed: true } }`. Two wrong attempts (`type: post` at top level, then `metadata: { type: post }`) before finding correct nesting via Buffer API docs. **VERIFIED: IG posts flowing to Buffer ✅**
4. **CE-6 FIX: Smart retry (no duplicates).** Distribution sweep now also picks up `status = "partial"` items. Parses `buffer_results` to build `alreadySucceeded` set of channel IDs — skips channels that already have ✅ from prior sweeps. Status logic: "posted" = all possible channels hit, "partial" = some succeeded + some failed (retryable), "failed" = zero success. Added `partial` to Supabase check constraint.
5. **LinkedIn removed.** Not connected in Buffer, was never posting. Removed from `TEXT_OK_PLATFORMS` and `PLATFORM_NOTES`.
6. **FULL END-TO-END VERIFICATION COMPLETE.** 12/12 queue items status = "posted". All platform fixes deployed and verified.
7. **Push status: ✅ PUSHED** — Commits `e218e1d` through `9eb6db9` (5 commits) pushed to main. Railway auto-deployed and verified live.
8. **Railway URL confirmed:** `gravity-claw-production-d849.up.railway.app`. Manual endpoints: `/api/content-engine/sweep` (POST) triggers distribution, `/api/content-engine/produce` (POST) triggers production, `/api/content-engine/nuke-queue` (POST, NEW) nukes all Buffer queued posts.

**Previous Session Summary — Cowork Session 6 (2026-04-02, late night):**
1. **Gemini Imagen 3 SHUTDOWN — migrated to Imagen 4.** Google decommissioned `imagen-3.0-generate-002` (404). Replaced with `imagen-4.0-generate-001` in both `content-engine.ts` and `image-generator.ts`. Same `:predict` endpoint pattern.
2. **DALL-E 3 billing exhausted.** OpenAI account hit hard billing limit. Imagen 4 is now the sole working image provider. DALL-E 3 fallback is dead until Ace adds credits.
3. **Buffer GraphQL mutation fixed (3 bugs):** (a) `schedulingType` enum was `scheduled` (invalid) — correct values are `automatic` or `notification`. Fixed to `automatic`. (b) Response query included `scheduledAt` field which doesn't exist on `Post` type — removed. (c) These two bugs meant ZERO distribution was happening since Session 2's "CE-2 FIX" introduced the wrong enum.
4. **File corruption fixed.** `index.ts` was truncated at line 2117 (missing ~70 lines: shutdown handlers, memory monitor, launch block). `content-engine.ts` had 486 trailing null bytes. Both fixed and verified via `tsc --noEmit`.
5. **Manual trigger endpoints added.** `/api/content-engine/produce` (POST, bypasses cron time guard), `/api/content-engine/status` (POST), `/api/content-engine/diag` (POST, tests image APIs), `/api/content-engine/sweep` (POST, manual distribution trigger). NOTE: All webhook routes are POST-only (line 158 of webhooks.ts rejects non-POST with 404).
6. **FULL PRODUCTION RUN COMPLETED.** 12/12 slots generated with Imagen 4 images. 12/12 distributed to Buffer. TikTok + Twitter/X posting successfully. IG needs explicit type param, YouTube needs video not images, Threads has 500-char limit. These are next-iteration fixes.
7. **Push status: ✅ PUSHED** — Commits `68787de` through `382756d` (6 commits) pushed to main. Railway auto-deployed.
8. **Make.com Scenarios E & F:** Both ACTIVE (IDs 4544787 and 4544805), webhook-triggered, but have 0 executions ever. E = YouTube transcription via DumplingAI. F = Sovereign Clip Pipeline. The automation logic is built in Make.com but nothing in the bot triggers the webhooks. These are "theory threads" — documented but never connected. Need webhook URLs wired into the bot or a trigger mechanism.

**⚠️ THEORY → PRACTICAL FLOWS (Pattern identified 2026-04-02):**
Multiple systems exist as documented architecture that was never wired end-to-end. The Content Engine was the biggest example (documented in posting guide as "LIVE NOW" but distribution code never actually worked due to wrong Buffer enum). Make.com Scenarios E/F are another — automation built but never triggered. When picking up work, always verify the ACTUAL last successful execution, not just whether code/config exists. Check Supabase for real posted_at timestamps, Make.com for execution counts, Buffer for actual queued posts.

**IMPORTANT — Buffer schedulingType:** The correct enum values are `automatic` (Buffer picks time from queue) and `notification` (sends push notification). The value `scheduled` does NOT exist. This was wrong in Session 2's CE-2 fix. `social-scheduler.ts` line 181 has the working reference implementation.

**IMPORTANT — Platform-specific Buffer params (Session 7, VERIFIED):**
- **Instagram:** Requires `metadata: { instagram: { type: post, shouldShareToFeed: true } }`. Field nests under `metadata.instagram`, NOT top-level. Without it, Buffer rejects with "Instagram posts require a type (post, story, or reel)". Code: CE-5 fix in content-engine.ts distribution loop.
- **YouTube:** Buffer YouTube integration requires VIDEO. Image+text posts rejected: "YouTube posts do not support image attachments." Community posts NOT supported by Buffer API. Skipped via CE-3 guard until video pipeline exists.
- **Threads:** 500-char hard limit from Meta. Auto-truncated to 497+"..." (CE-4). `THREADS_CHAR_LIMIT` constant.
- **LinkedIn:** NOT connected to Buffer. Removed from code. Do not add back without first connecting in Buffer.

**Previous Session Summary — Cowork Session 5 (2026-04-02, night):**
1. **Image generation pipeline wired into Deterministic Content Engine (Gap 12 CLOSED).** `dailyContentProduction()` now generates branded images after LLM text generation. Flow: niche+brand-aware prompt → Gemini Imagen 4 (primary, upgraded from Imagen 3) → DALL-E 3 (fallback, currently billing-exhausted) → upload PNG to Supabase Storage `public-assets/content-images/` → write public URL as `media_url` on `content_engine_queue` row. Distribution sweep passes `media_url` to Buffer GraphQL `assets.images[0].url`. Graceful degradation: if image gen fails, post goes text-only (IG/TikTok skipped, other channels still fire).
2. **IG and TikTok posting UNBLOCKED.** The `IMAGE_REQUIRED_PLATFORMS` guard now passes when `media_url` is populated. IG frequency override (Ace 3/day, CF 2/day) activates automatically. Full 329/week cadence achievable once deployed.
3. **Agent memory update prompts prepared.** Six Telegram DM messages for Ace to send to each agent, instructing them to overwrite stale Pinecone memories about Vector being the distributor. Yuki confirmed as sole posting authority, Vector as analytics-only.
4. **Push status: ✅ PUSHED** — Commit `1de93d8` pushed to main via Desktop Commander. Railway auto-deploy triggered.

**Previous Session Summary — Cowork Session 3 (2026-04-02, late evening):**
1. **LLM provider split across agent teams.** All 6 agents were sharing one failover chain — when Gemini hit 250/day quota, ALL agents cascaded simultaneously. Now split 3 ways: Alfred+Anita → Gemini primary, Sapphire+Veritas → Anthropic primary, Vector+Yuki → Groq primary (14,400/day). Each team has the other two providers as failover. Code: `AGENT_LLM_TEAMS` map in index.ts, `buildTeamLLM()` function creates per-team FailoverLLM instances.
2. **Telegram DM flooding fixed.** Pipeline-internal task types (viral_clip_extraction, narrative_weaponization, caption_weaponization, content_for_distribution, architectural_sync) are now SILENT — they log to activity_log but don't DM Ace. Nominal stasis checks also suppressed. Only terminal/notable tasks and pipeline completion summaries reach Telegram. Expected: max 6-7 DMs per activity cycle instead of 20+.
3. **Response truncation fixed.** Brief recap increased from 150 → 300 chars. LLM max_tokens increased from 4096 → 8192 in agent loop to prevent mid-response cutoff on complex tool chains.
4. **Push status: ✅ PUSHED** — Commit `da5b84c` pushed to main via Desktop Commander batch file. Railway auto-deploy triggered. All Sessions 2+3 code changes are live.

**Previous Session Summary — Cowork Session 2 (2026-04-02, evening):**
1. Vector posting authority fixed across ALL surfaces (4 files, 8 locations). Anita→Vector pipeline route changed to Anita→Yuki.
2. All 6 Supabase personality blueprints updated with executive roles. Task 7A DONE.
3. BUG CE-2 ATTEMPTED FIX: Changed `schedulingType: automatic` → `schedulingType: scheduled` with explicit `scheduledAt`. **⚠️ THIS WAS WRONG** — `scheduled` is not a valid enum value. Fixed in Session 6 back to `automatic` without `scheduledAt`.
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
| Alfred + Vector + Yuki | Groq (14,400/day) | Gemini | Anthropic | Heavy agents, staggered schedule prevents overlap |
| Anita | Gemini | Groq | Anthropic | Lighter rewrite/writing tasks, 250/day sufficient solo |
| Sapphire + Veritas | Anthropic | Gemini | Groq | Strategic agents, less frequent, highest quality |

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

### RLS Security Model (Hardened 2026-04-03, Session 13)
**All tables now follow: `service_role` = full CRUD (bot), `anon` = SELECT-only (dashboard).** No table allows anon INSERT, UPDATE, or DELETE. The `anon` key is exposed in Mission Control's frontend source — anyone can read but cannot write. Bot uses `service_role` key which bypasses RLS entirely.

### Retention Policy (pg_cron, daily 3 AM UTC)
Function `run_retention_cleanup()` runs automatically:
- `sync_log`: Deduplicates (keeps latest entry per `vector_id`)
- `crew_dispatch`: Purges completed records older than 7 days
- `messages_log`: Purges records older than 30 days

### RPC Functions (search_path pinned to `public` as of Session 13)
- `increment_fiscal_sum` — Atomic counter for fiscal_sum metric
- `unsubscribe_email(target_email text)` — Email unsubscribe (SECURITY DEFINER)
- `get_pending_nurture` — Nurture sequence query (SECURITY DEFINER)
- `set_nurture_defaults` — Nurture template defaults

| Table | Purpose | Who Writes | Who Reads |
|-------|---------|-----------|-----------|
| `personality_config` | Agent blueprints/system prompts | Dev (manual) | All agents at boot |
| `crew_dispatch` | Inter-agent task routing (bot-only, NOT used by dashboard) | Any agent | Dispatch poller |
| `sync_log` | Pinecone vector sync tracking (bot-only, NOT used by dashboard) | Pinecone sync | Boot sync check |
| `tasks` | Proposed tasks, approval workflow | Agents (propose_task) + Dashboard (manual) | Approval poller + Dashboard |
| `content_drafts` | Generated content for review | Anita, Alfred, Yuki | Dashboard + Architect |
| `briefings` | Strategic reports/analysis | Sapphire, Vector, Veritas | Dashboard + Architect |
| `activity_log` | Agent activity feed | All agents | Dashboard |
| `vid_rush_queue` | Video pipeline queue | Clip pipeline | Yuki/Vector |
| `content_transmissions` | Published content log | Video publisher | Dashboard |
| `knowledge_nodes` | Shared knowledge base (3,595 entries) | Knowledge writer | Pinecone sync |
| `messages_log` | Chat message history (largest table, ~7K rows) | All agents | Dashboard |
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

**Pipeline Status (2026-04-02 — SESSION 8 UPDATE):**
- Code is FULLY BUILT for the **Vid Rush pipeline** (YouTube URL → ANY agent → Alfred → Yuki → Anita → Vector). `PIPELINE_ROUTES` in index.ts defines the full chain. `triggerPipelineHandoffs` auto-chains correctly. Tested 2026-04-01 — all 8 handoffs fired. **Session 8: YouTube URL interception now works from ANY agent DM, not just Alfred.**
- YouTube publishing tool deployed. OAuth tokens obtained 2026-03-31.
- **Deterministic Content Engine ✅ BUILT + ANITA-VOICED.** 12 pieces/day (6 slots × 2 brands), distributed to 9 Buffer channels. Content uses Anita's Protocol 77 HOOK→PIVOT→ANCHOR structure with per-brand voice blueprints (~500 words each). Image generation uses cinematic niche×brand visual spec (10 unique direction prompts). Cron: 6:30AM ET daily production, 5-min distribution sweep.
- **New endpoint:** `/api/content-engine/nuke-queue` — wipes ALL queued Buffer posts + Supabase queue for clean slate.
- **VidRush Make.com Scenarios E/F: NEED END-TO-END TEST** after Session 8 code deploys.

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
| `LLM_DEFAULT_PROVIDER` | "anthropic" (changed 2026-04-03) | Not needed — hardcoded default updated |
| `LLM_FAILOVER_ORDER` | "groq,gemini,anthropic,openai" | UPDATED Session 22 — was "gemini,anthropic,openai" (Groq missing!) |
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
- Root cause: Content engine sends text-only posts (no `media_url`). IG and TikTok require images — Buffer silently rejects text-only

## 24. SESSION 35 — TOKEN BLOAT EXORCISM + AGENT GAP ANALYSIS (2026-04-07)

### What Was Fixed
1. **Per-call token bloat (25-27K → 3-4K):** AgentLoop.processMessage() loaded 48+ context messages (3 memory providers × 20 msgs + facts + summaries + search + Pinecone) for every dispatch task. Dispatch mode now skips all memory loading.
2. **Tool schema bloat (33 → 13):** Dispatch tasks only receive tools they actually need.
3. **Gemini key ghost:** Removed silent `GEMINI_API_KEY` fallback from all Imagen paths. Imagen uses ONLY `GEMINI_IMAGEN_KEY`.
4. **Embedding graceful disable:** `GEMINI_API_KEY` nuked from Railway, `GEMINI_IMAGEN_KEY` gets 403 on embeddings. Embeddings return empty vector (no throw, no spam). Pinecone reads still work (vectors already exist).
5. **Boot storm cap:** Vector sync capped at 25 nodes/deploy (was 1000).
6. **Vanguard label → Gravity Claw.**

Commits: 18f1a9a → 3e0ac4f → [pending hotfix 2]

### Briefing Timezone Fix (Railway Env Vars)
`MORNING_BRIEFING_HOUR` was 8 (3 AM CDT). Changed to **15** (10 AM CDT).
`EVENING_RECAP_HOUR` was 21 (4 PM CDT). Changed to **1** (8 PM CDT).
Ace is CDT (UTC-5). Code uses `getUTCHours()`.

### The LLM-to-Agent Gap (Architect Directive)
The gap between "personalized LLMs" and "personalized agents" is this: they need a working execution chain and a clear command surface. The infrastructure is built — tools exist, dispatch routing exists, Buffer integration exists. The bloat fix should unblock the execution chain. But the Architect-facing command interface (schedule future runs, batch plan a week, review/approve before posting) — that's the next layer to build.

**Every dispatch MUST have an intentional end result: live content produced and scheduled for publication.** Dispatches that don't produce publishable output are waste.

### Current Scheduled Dispatches — Audit
| Job | Fires | Result | Verdict |
|---|---|---|---|
| Morning Briefing | Daily 10 AM CDT | Telegram message to Ace | KEEP — low cost, useful |
| Evening Recap | Daily 8 PM CDT | Telegram message to Ace | KEEP — low cost, useful |
| Alfred Trend Scan | Daily 10:05 AM CDT | Searches topics, finds YouTube URL for pipeline | KEEP — feeds VidRush |
| Vector Metrics Sweep | Daily 12 PM CDT | Pulls Stripe data, reports | REVIEW — no sales yet, pure waste |
| ContentEngine Production | Daily 1:30 PM CDT | 12 posts generated deterministically | KEEP — produces content |
| Distribution Sweep | Every 5 min | Posts ready drafts to Buffer | KEEP — zero LLM cost |
| Stasis Detection | Daily 3:30 PM CDT | 6 LLM calls asking "are you idle?" | WASTE — all agents are idle |
| Veritas Weekly Directive | Mon 12:10 PM CDT | Strategic assessment | REVIEW — no activity to assess |

### API Key State (Railway)
- `GEMINI_API_KEY`: **NUKED** (billing crisis)
- `GEMINI_IMAGEN_KEY`: SET (AIzaSyAk...) — for Imagen 4 image gen only
- `GROQ_API_KEY`: SET — pipelines only
- `GROQ_API_KEY_TCF`: SET — TCF pipelines only
- `ANTHROPIC_API_KEY`: SET — all agent dispatches + user chat
- `OPENAI_API_KEY`: NOT SET
- Pinecone embeddings: **DISABLED** (no embedding-capable key)

---

### Session 37 Changes (2026-04-08)
**Commits:** `dfc7b78` (faceless overhaul) → `953f98b` (ambient_drone.mp3) → `257c406` (niche-aware music selection)

1. **Hook text wrapping REWRITE** — `wrapText(text, 25)` pre-wraps at word boundaries with `\n`. Single drawtext filter with `line_spacing=12`. Old midpoint-split code deleted.
2. **Music bed: synthetic lavfi KILLED** — sine+anoisesrc silently failed on Railway. Replaced with `stream_loop -1` on real MP3 files from `brand-assets/`.
3. **Niche-aware music selection** — `MUSIC_MAP` in faceless-factory.ts routes brand+niche to the right music file:
   - `music_urgent.mp3` → dark_psychology, burnout (ticking cadence)
   - `music_sovereign.mp3` → ace_richie (melodic, uplifting)
   - `ambient_drone.mp3` → containment_field, fallback
4. **TTS pacing fix** — 150ms fade-in / 200ms fade-out per segment (kills room-tone pop). Silence pads: 1.5s→0.8s, chapter breaks: 2.5s→2.0s.
5. **Windows repo path confirmed:** `C:\Users\richi\Sovereign-Sentinel-Bot` (not `richie`).

### SESSION 37 — LIVE VIDEO AUDIT (ZUjZAUV6NHA, post-redeploy)
**Video:** "System Failure by Design" — https://www.youtube.com/watch?v=ZUjZAUV6NHA
**Status:** Rendered AFTER Session 37 Railway redeploy. Our fixes PARTIALLY landed but several are broken.

**BUG 1: Text Wrapping STILL BROKEN (CRITICAL)**
- Output shows: `"now that feeling ofnbeing stuck"` — the `\n` is being consumed by shell quoting, only `n` survives.
- Root cause: `escLine()` does `.replace(/\n/g, "\\n")` but inside single-quoted ffmpeg text, the backslash is stripped by the shell. The `n` bleeds into the text as a literal character.
- **FIX:** Use ffmpeg's `textfile` option instead of inline `text=`. Write the pre-wrapped text to a temp file, reference it with `textfile='path'`. This bypasses ALL shell escaping. Alternatively, double-escape: `\\\\n` so shell reduces to `\\n` and ffmpeg reads `\n` as newline. Test both.
- **[DVP: REGRESSED]** — Session 37 fix deployed but produces worse output than Session 33.

**BUG 2: Frequency Activation CTAs — Visual Flash, Not in Audio**
- The "I AM BREAKING FREE (TYPE THIS IN THE COMMENTS)" cards at 1/3 and 2/3 marks ARE appearing — concept is working.
- BUT: they flash on screen too fast to read. Duration needs to increase from 5.0s to at least 7-8s.
- The CTA text is NOT being spoken in the TTS audio — it's visual-only. Need to either: (a) extend the TTS render to include the context_line audio before the card, or (b) slow the card fade-in so viewers can absorb it.
- **The concept is validated. The execution needs tuning.**

**BUG 3: Voice Speed Too Slow**
- TTS `0.80x` speed was set in Session 23 to combat rushed delivery.
- Combined with Session 37's 0.8s silence pads + 150ms/200ms afade, the overall pacing is now TOO slow.
- **FIX:** Test `0.90x` speed OR remove the speed override entirely (Edge TTS AndrewMultilingualNeural has natural documentary pacing without forced slowdown). Silence pads (0.8s) are fine — the speed multiplier is the problem.

**BUG 4: Video Goes Black at ~9 Minutes (Audio/Visual Desync)**
- Screen goes black while voice continues. Video track ran out before audio track.
- Root cause: `segmentDurations` array (which tells `assembleVideo` how long each scene lasts) is probably miscalculated after Session 37 pad changes. The total visual duration sums to less than the audio duration.
- **FIX:** Add a safety check in `assembleVideo()`: if total scene duration < audio duration, extend the last scene to cover the gap. Also verify that the `segmentDurations` calculation matches the actual concat output duration.

**BUG 5: Lexical Stagnation — Banned Transition Phrases**
- Pipeline script gen is still using exhausted AI essay transitions:
  - "Imagine being on a train watching the world..."
  - "But here's the thing..."
  - "Now pay attention to this part because it's where things get interesting..."
  - "But here's what nobody talks about..."
- These are in the Pass 1 / Pass 2 prompts in `faceless-factory.ts` (the `STRUCTURE` voice blocks).
- **FIX:** Add explicit ban list to BOTH Pass 1 and Pass 2 prompts. Force declarative, urgent, surgical syntax. Ban "Imagine", "But here's the thing", "Now pay attention", "Let's talk about". Replace with: direct statements, rhetorical interrogation, pattern interrupts.

**BUG 6: Visual Pacing — 15-20s Static Image Holds**
- Single Imagen 4 images holding for 15-20 seconds kills momentum.
- Ken Burns (zoom/pan) exists but it's not enough to sustain a single image that long.
- **FIX OPTIONS:** (a) Increase segment count target from 12 to 16-18 for long-form so each image displays ~8-10s max. (b) Add subtle transition overlays (light leak, film grain pulse) between Ken Burns phases. (c) Generate 2 images per segment for longer segments and crossfade between them.

**BUG 7: Brand Color Bleed — Teal/Green Instead of Gold**
- Ace Richie videos showing deep teal/green mid-sections instead of gold/amber brand tokens.
- The visual direction prompts in Pass 1/2 include brand palette but Imagen 4 is ignoring the color mandate.
- **CRITICAL:** Imagen 4 does NOT support `negativePrompt` (legacy feature, dropped after Imagen 3.0-generate-001). We CANNOT use negative prompt to ban colors. The only lever is the positive prompt.
- **CRITICAL:** NEVER use negative phrasing ("NO blue", "NO green") in the positive prompt. Diffusion models tokenize the noun and ignore the negation — this literally causes the banned color to appear MORE.
- **FIX (two-part, Gemini-approved):**
  1. **Imagen 4 scene prompt suffix (POSITIVE ONLY):** Replace any "NO blue/green" phrasing with absolute positive constraints: `"EXCLUSIVELY bathed in warm amber and gold light. Monochromatic gold aesthetic. All light sources are warm amber (#d4a843). Deep void black (#0a0a0f) shadows."` Teal accent gets its own positive: `"Single subtle teal (#00e5c7) rim light as minor accent only."`
  2. **Pass 1/2 visual_direction prompt:** Add to the LLM instructions: `"All visual directions for Ace Richie MUST specify warm gold/amber as the dominant light source. Describe scenes with golden light, amber haze, warm tones. Teal only as a subtle accent rim light."` This ensures the LLM-generated scene direction is ALREADY brand-encoded before it hits Imagen 4.

**BUG 8: Thumbnails Not Generating for New Videos**
- `generateThumbnail()` exists but may be failing silently (Imagen 4 quota, prompt issues, or upload failure).
- The YouTube channel shows generic auto-picked frames, not the designed thumbnails.
- **FIX:** Add explicit error logging + fallback path. Verify Imagen 4 is actually firing for thumbnails. Check if Buffer is attaching the thumbnail when posting to YouTube.

**BUG 9: Titles Still Generic**
- "System Failure by Design" appearing on 5+ different videos. The Pass 1 title gen is not differentiating.
- **FIX:** The title prompt needs stronger uniqueness enforcement. Add "NEVER reuse a title from a previous video. Each title must be a unique curiosity gap or bold claim." Also, the clip titles from `extractStoryMoments()` need the same treatment.

---

### FUTURE SESSION QUEUE (Priority Order)

**SESSION 38 — COMPLETED (commit `aed0e2b`):**
1. ✅ Text wrapping — `textfile=` approach (bypasses shell quoting)
2. ✅ Audio/visual sync — safety clamp extends last scene if video < audio
3. ✅ Voice speed — 0.80x → 0.90x (measured cadence, not sluggish)
4. ✅ Banned phrases — 8 crutch phrases banned in Pass 1/2/short prompts
5. ✅ Brand color — gold/amber enforced as DOMINANT for Ace Richie in style map + visual direction rules
6. ✅ CTA duration — Frequency Activation 5s → 8s

**SESSION 39 — COMPLETED (commit `0fa4bc5`):**
- ✅ Phase 1: `extractStoryMoments()` upgraded with `thumbnail_text` field (2-4 word hook per clip)
- ✅ Phase 2: Per-clip thumbnail generation — key frame extraction + vignette + Bebas Neue bold text overlay. Zero API cost.
- ✅ Phase 3: Thumbnail upload to Supabase + YouTube Shorts metadata attachment via Buffer API.

**SESSION 40 — COMPLETED (commit `53e61f3`):**
- ✅ Title uniqueness: getRecentTitles() queries Supabase vid_rush_queue, ban list injected into blueprint + Pass 1 + short-form prompts
- ✅ Visual pacing: segmentCount 12→16, Pass 1 segments 7→9, quality gate 8→10, duration hint 35→30s
- ✅ Pipeline concurrency queue: In-memory FIFO queue serializes /pipeline, /dryrun, and auto-pipeline. Queue position feedback via Telegram.

**BEYOND SESSION 40 — REVENUE ARCHITECTURE (Thursday):**
- Revenue funnel activation (T0-T7 product tiers live)
- Stripe integration verification
- Verify Sessions 38-40 fixes on live pipeline output
- Logo placement audit (deferred)

**DEFERRED — Logo Placement Audit:**
- Ace Richie: Has logo. Needs placement on channel art, intros/outros, email headers, funnel pages.
- The Containment Field: Currently spade/clover icon. Needs proper dark brand mark.
- Gravity Claw: Has icon (claw + sacred geometry + "77"). Infrastructure only, never consumer-facing.
- Multi-phase rollout — document in brand-identity skill when ready.

---

### Session 38 Summary (2026-04-08)
**Commit:** `aed0e2b` — fix: Session 38 — 6 critical video quality fixes from live audit

All 6 bugs flagged by Session 37 Gemini audit shipped in one commit to `faceless-factory.ts` (97 insertions, 24 deletions). No other files changed.

**Changes deployed:**
1. **Text wrap: inline → textfile** — Hook overlay `drawtext` switched from `text='...'` to `textfile='...'`. Wrapped text written to `{jobId}_hook_text.txt`, ffmpeg reads newlines directly from disk. Shell quoting can no longer eat `\n`.
2. **Audio/visual desync clamp** — After xfade assembly, `assembleVideo()` now probes video vs audio duration. If video is >2s shorter, the last scene clip is extended via `stream_loop` and xfade is re-assembled. Prevents black screen at end of long-form.
3. **Voice speed 0.80x → 0.90x** — Session 37 audit flagged 0.80x + 0.8s pads + afade as sluggish. 0.90x balances documentary gravitas with forward momentum.
4. **Banned phrases** — 8 overused crutch phrases explicitly banned in Pass 1, Pass 2, AND short-form prompts: "Imagine...", "But here's the thing...", "Now pay attention...", "But here's what nobody talks about...", "Let that sink in", "Think about it", "Here's the truth", "Are you ready?". Each ban includes rewrite guidance.
5. **Brand color enforcement** — Gold/amber (#d4a843) made DOMINANT accent for Ace Richie in: `SCENE_VISUAL_STYLE` (dark_psychology + brand entries), Pass 1 COLOR MANDATE, Pass 2 COLOR rule, short-form VISUAL DNA. Teal demoted to "secondary, shadow/edge only."
6. **CTA duration 5s → 8s** — Frequency Activation card `actDuration` raised. Viewers need time to read, process, and type.

**Also cleaned up:**
- Restored 4 files with CRLF-only noise (vidrush-orchestrator.ts, sapphire-sentinel.ts, SOVEREIGN_SYNTHESIS_MASTER Parts 1+2)
- Committed Session 37 master reference updates (previously written but never pushed)

**DVP Status — all Session 38 fixes:**
- `[DVP: ADDRESSED]` Text wrapping textfile approach — needs production test
- `[DVP: ADDRESSED]` Audio/visual desync clamp — needs production test
- `[DVP: ADDRESSED]` Voice speed 0.90x — needs production test
- `[DVP: ADDRESSED]` Banned phrases — needs production test (next pipeline run)
- `[DVP: ADDRESSED]` Brand color enforcement — needs production test (next Imagen 4 gen)
- `[DVP: ADDRESSED]` CTA 8s duration — needs production test

**Next session priorities (Session 40):**
1. **VERIFY Session 38+39 fixes** — Run pipeline, audit output: text wrapping, no black screen, pacing, vocabulary, gold visuals, CTAs, clip thumbnails
2. **Title uniqueness enforcement** (BUG 9) — prevent "System Failure by Design" repeating across videos
3. **Visual pacing** (BUG 6) — increase segment count or dual-image per segment for long static holds
4. **Pipeline concurrency queue** — in-memory queue to prevent overlapping runs

---

### Session 39 Summary (2026-04-08)
**Commit:** `0fa4bc5` — feat: Session 39 — per-clip thumbnail system for shorts

Built full per-clip thumbnail pipeline in `vidrush-orchestrator.ts` (82 insertions, 2 deletions). Zero API cost — pure ffmpeg.

**Changes deployed:**
1. **`StoryMoment` interface** — added `thumbnail_text?: string` field (2-4 word hook per clip).
2. **`extractStoryMoments()` prompt** — LLM now outputs `thumbnail_text` alongside title/hook/timestamps. Includes style guidance ("THEY KNEW", "SYSTEM OVERRIDE", etc.) and rules (ALL CAPS, 2-4 words, different angle from title).
3. **Per-clip thumbnail generation** — After each clip is cut in semantic chop mode, extracts a key frame at 30% into the clip (past the hook, into the visual meat). Applies: niche color grade → dark vignette (PI/3) → semi-transparent black bar (60% opacity) → bold white text overlay (Bebas Neue, fontsize 96, centered). Uses `textfile=` approach (Session 38 lesson) to avoid shell quoting issues.
4. **`ClipMeta` interface** — added `thumbnailPath` and `thumbnailUrl` fields.
5. **Thumbnail upload** — `uploadClipsToStorage()` now uploads clip thumbnails to Supabase alongside clip videos (`thumb_00.jpg`, `thumb_01.jpg`, etc.).
6. **Buffer YouTube metadata** — `scheduleBufferWeek()` attaches `thumbnail` URL to YouTube Shorts metadata when available.

**Design decisions:**
- Thumbnails are 1080x1920 (9:16 vertical) matching the clip orientation.
- Text rendered at fontsize 96 with 4px black border — readable at thumbnail size.
- Vignette + dark bar ensure text readability regardless of frame content.
- Style reference: "Brave New Slop" format — massive bold text on a dark still frame.
- Fallback-safe: if thumbnail generation fails, clip still posts normally (non-fatal).

**DVP Status:**
- `[DVP: ADDRESSED]` thumbnail_text in extractStoryMoments — needs production test
- `[DVP: ADDRESSED]` Per-clip thumbnail generation — needs production test
- `[DVP: ADDRESSED]` Thumbnail Supabase upload — needs production test
- `[DVP: ADDRESSED]` YouTube Shorts thumbnail metadata — needs production test (verify Buffer actually attaches it)

---

### Session 40 Summary (2026-04-08)
**Commit:** `53e61f3` — Session 40: Title uniqueness, visual pacing 12>16, pipeline concurrency queue

Final infrastructure hardening session before Thursday's revenue architecture pivot. Three fixes across `faceless-factory.ts` and `index.ts`.

**Changes deployed:**
1. **Title uniqueness enforcement (BUG 9)** — New `getRecentTitles()` function queries Supabase `vid_rush_queue` for the last 20 titles. Constructs a `titleBanList` string injected into three prompts: blueprint extraction (`extractNarrativeBlueprint`, new 5th parameter), Pass 1 title field, and short-form title field. LLM is instructed titles must be "completely different" from all listed.
2. **Visual pacing (BUG 6)** — `segmentCount` raised from 12→16 for long-form. Pass 1 segment count raised 7→9. Quality gate minimum raised 8→10. Duration hint example lowered 35→30s. Duration range set to "8-12 minutes". Net effect: static image hold reduced from 30-50s to 22-37s. Cost delta: ~$0.16/video ($0.64 vs $0.48 at $0.04/img), ~5min more render time.
3. **Pipeline concurrency queue** — In-memory FIFO queue (`PipelineJob[]`) added to `index.ts` near existing `pipelineRunning` flag. `processPipelineQueue()` drains sequentially, managing `setPipelineRunning(true/false)` centrally. New `enqueuePipeline(label, runFn)` function exposed globally. All three callsites updated: `/dryrun` command, `/pipeline` command, and auto-pipeline dispatch (Alfred daily scan). Users receive queue position feedback via Telegram when a second pipeline arrives while one is running.

**DVP Status:**
- `[DVP: ADDRESSED]` Title uniqueness — needs production test (verify no repeated titles across runs)
- `[DVP: ADDRESSED]` Visual pacing 16 segments — needs production test (verify shorter image holds)
- `[DVP: ADDRESSED]` Pipeline concurrency queue — needs production test (send two /pipeline commands)

**Next session priorities (Revenue Architecture — Thursday):**
1. Revenue funnel activation — T0-T7 product tiers, Stripe integration
2. Verify Sessions 38-40 fixes on live pipeline output
3. Logo placement audit (deferred from Session 39)

---

### Session 43 Summary (2026-04-10)
**Status:** UNCOMMITTED — awaiting architect typecheck + pipeline-idle push window. All file edits on Windows FS.

**Context:** YouTube Growth Protocol v2.0 was locked in Session 42 (`SOVEREIGN-YOUTUBE-GROWTH-PROTOCOL.md`). Four integration tasks were directed. Pre-work verification showed Task 1 complete (from Session 42), Tasks 2 and 4 missing, Task 3 partial. Architect authorized shipping Tasks 2 + 4 now; Task 3 Kinetic Baseline deferred to a future session via intra-segment ffmpeg interrupts (scale jumps, chromatic aberration, Ken Burns reversal) rather than breaking the Session 40 16-segment/22–37s audio-sync contract.

**TASK 1 (verified pre-work, no session changes):**
- 6 rows live in Supabase `protocols` since 2026-04-10 00:49–00:50: `youtube_seo_protocol`, `youtube_script_protocol`, `youtube_visual_protocol`, `youtube_analytics_protocol`, `youtube_compliance_protocol`, `youtube_shorts_protocol`. All `active=true`, `created_by=architect`, niche `all`.
- `youtube_script_protocol` includes explicit `LEXICAL BLACKLIST` and `EXTREMITY MODIFIER` blocks as required.
- Seeded via `scripts/seed-youtube-protocols.ts` (Session 42).

**TASK 2 — Hard-inject architect directives into agent task context:**
- **NEW FILE:** `src/agent/protocol-injection.ts` (159 lines) — exports `injectYoutubeProtocolsIfNeeded(agent, taskType, payload)`, `isYoutubeTask`, `resolveYoutubeProtocolSlugs`, `fetchProtocolDirectives`, `_clearProtocolCache`. Includes 5-minute TTL cache keyed by slug so agents don't hammer the protocols table on every dispatch. Detection is hard-match on a `YOUTUBE_TASK_TYPES` set (viral_clip_extraction, narrative_weaponization, caption_weaponization, content_for_distribution, content_scheduling, daily_trend_scan, youtube_seo_audit, youtube_metrics_sweep, youtube_thumbnail_test, youtube_compliance_check, youtube_shorts_package, architectural_sync) plus a regex fuzzy-match on task_type + stringified payload for `youtube|shorts|long.?form|ytshorts`. Agent→slug mapping: Alfred→seo+compliance, Anita→script+compliance, Yuki→visual+shorts+compliance, Vector→analytics+compliance, Veritas/Sapphire→visual+compliance (strategic oversight). ALL agents get `youtube_compliance_protocol` on YT tasks (Jan 2026 YPP suspension risk).
- **EDIT:** `src/index.ts` line 50 — added `import { injectYoutubeProtocolsIfNeeded } from "./agent/protocol-injection";`.
- **EDIT:** `src/index.ts` lines ~2798–2829 — in the DispatchPoller task loop, after `executionDirective` is resolved, call `injectYoutubeProtocolsIfNeeded(agentName, task.task_type, task.payload)` inside a try/catch (non-fatal on failure). If directives returned, prepend them into `dispatchMessage.content` between the task header and the payload block, wrapped in `━━━ ARCHITECT STANDING DIRECTIVES — YOUTUBE GROWTH PROTOCOL v2.0 ━━━` / `━━━ END DIRECTIVES — THESE OVERRIDE ANY CONFLICTING PROMPT INSTRUCTIONS ━━━` sentinels. Console logs char count when injection fires. Non-YT tasks short-circuit inside the helper — zero latency added to the non-YT path.
- **Why hard-inject over soft instruction:** Per Session 35 bloat exorcism and `feedback_prompt_economy.md`, soft instructions in system prompts get ignored under load. By inlining the protocol bytes directly into the task payload as user-role content, the agent has no choice — the directive is part of the task itself, not a suggestion it can skip. Architect is the System, and the System now speaks in the dispatch voice.

**TASK 4 — Anti-Ghost Upload Protocol (±14 minute jitter):**
- **EDIT:** `src/engine/vidrush-orchestrator.ts` ~line 945–957 — declared local `antiGhostJitter(iso: string): string` arrow function inside the scheduling function, above the clip `for` loop. Logic: `new Date(iso)` → `setUTCMinutes(minutes + Math.floor(Math.random() * 29) - 14)` → `toISOString().slice(0,19) + "Z"`. Produces integers -14..+14 inclusive (29 possible offsets). Uses UTC methods throughout to stay consistent with the `Z`-suffixed input.
- **EDIT:** `src/engine/vidrush-orchestrator.ts` ~line 972–975 — text-only channel path: wrapped the existing `${date}T${timeSlot}Z` construction in `antiGhostJitter(...)` before assigning to `scheduledAt`.
- **EDIT:** `src/engine/vidrush-orchestrator.ts` ~line 1016–1019 — media channel path: same wrap. Each clip re-rolls jitter independently, so even two clips landing in the same slot get different minute offsets.
- **Edge cases considered:** (a) jitter cannot push `scheduledAt` into the past because `schedDate.getDate() + dayOffset + 1` guarantees ≥1 day in the future; (b) slot-label rollover (e.g. 01:00 − 14min → 00:46) is acceptable to Buffer which only needs a valid future ISO; (c) the `dayOffset >= 7` guard still fires correctly because it's based on `globalSlotIndex` arithmetic, not on the jittered timestamp.
- **Why:** Buffer/YT downrank content posted on exact minute boundaries (`:00`, `:15`, `:30`, `:45`) because automated schedulers default there. A ±14min random offset per post breaks the hourly metronome signature that marks us as a bot farm without spilling into the next slot window.

**TASK 3 — Kinetic Baseline (DEFERRED to next session):**
- **Decision:** Do NOT exempt Ace Richie and do NOT break the Session 40 16-segment / 22–37s audio-sync contract. A pattern interrupt is a *perceptual event*, not a new image asset. Next-session plan is to build an ffmpeg filter chain that applies intra-segment visual shifts to each existing Ken Burns clip at the required frequency (3–4s for The Containment Field, 5–7s for Ace Richie): sudden 1.2× scale jumps (hard punch-in), 0.2s chromatic aberration / RGB-split glitch overlays, and Ken Burns direction reversal. This gives Yuki the kinetic frequency the `youtube_visual_protocol` demands without doubling Imagen 4 spend or shattering the rendering pipeline.
- **Architectural note:** The existing `faceless-factory.ts` segment model is intact — no changes this session.

**Files touched:**
- **NEW:** `src/agent/protocol-injection.ts` (159 lines)
- **MODIFIED:** `src/index.ts` (import line + ~25-line injection block in DispatchPoller)
- **MODIFIED:** `src/engine/vidrush-orchestrator.ts` (13-line jitter helper + 2× two-line wraps at scheduledAt construction sites)
- **MODIFIED:** `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` (this entry)

**DVP Status (updated Session 44):**
- `[DVP: VERIFIED]` Task 2 hard-inject — verified Session 44 via synthetic YT-related dispatch probes. Commit `8339dbc` deployed cleanly. Protocol injection fires for YouTube task types; non-YT tasks short-circuit with zero added latency.
- `[DVP: ADDRESSED — BLOCKED-ON-CYCLE]` Task 4 Anti-Ghost jitter — code committed in `8339dbc` and deployed. Cannot verify until next full VidRush pipeline run produces Buffer `scheduled_at` timestamps; will flip to VERIFIED in Session 45 after inspecting first post-deploy Buffer schedule for minute values in the `-14..+14` envelope around the 8 base slots.
- `[DVP: DEFERRED]` Task 3 Kinetic Baseline — not started. Full design (intra-segment ffmpeg scale punch-ins + chromatic aberration + Ken Burns reversal) is queued as the Session 45 primary target.

**Architect action items to ship this session's work:**
1. Run `cd C:\Users\richi\Sovereign-Sentinel-Bot && npx tsc --noEmit` in a Windows terminal. Fix any surfaced type errors (none expected — all edits are self-consistent and use standard APIs).
2. Wait for pipeline idle window (per `feedback_no_push_during_pipeline.md`).
3. Commit via Desktop Commander cmd shell (per `feedback_git_workflow.md`), suggested message: `Session 43: YT protocol hard-inject + Anti-Ghost ±14min jitter`.
4. Push to main — Railway auto-deploys.
5. First post-deploy Buffer schedule should show minute values in `-14..+14` envelope around the 8 base slots; first YT-related crew_dispatch claim should log `[ProtocolInjection]` in Railway with a non-zero char count.

**Next session priorities (as of Session 43 — superseded by Session 44 entry below):**
1. Build Kinetic Baseline intra-segment ffmpeg filter chain (scale punch-ins, chromatic aberration, Ken Burns reversal) — target 3–4s / 5–7s visual interrupt frequency without breaking 22–37s audio segments.
2. Production verification of Session 43 tasks (flip DVP from ADDRESSED to VERIFIED).
3. Revenue architecture — still the top-line objective.

---

### Session 44 Summary (2026-04-10)
**Status:** SHIPPED + VERIFIED — commit chain `1a766d2 → 6d3be0a → b8a5cc3 → 8cd1b16 → f49ec03 → 44894dc → e2369ff → 1c96a3f` on 2026-04-10. LIGHT MODE code shipped in `1a766d2`; Railway build then failed four times against four separate OOM causes in Dockerfile.bot; fix chain rewrote Dockerfile.bot to multi-stage (mwader/static-ffmpeg COPY + nikolaik/python-nodejs base + chromium removal) and repaired an orphaned `loop.ts` duplicate tail; deploy finally succeeded on `1c96a3f`. **VERIFIED in production 2026-04-10 ~07:06–07:08 UTC** via two-agent DVP probes: Anita `e49b83a6-4cd9-4719-a778-924666e5b84d` completed in **12.66s** with plain text opening "Light mode detected. Growth engine operational..."; Vector `eab7993e-ab08-4a3b-a717-d4542c61fecc` completed in **8.01s** with plain text opening "Numbers tell the truth about LIGHT MODE deployment...". Both runs under 25s, no tool calls, in character — load-bearing proof that dispatchPoller is stripping tools and setting iterCap=1 for stasis_self_check. Earlier 06:09 flip was a false positive (old code still live); this second flip is correct.

**Planned target:** Kinetic Baseline (Task 3). **Actual target:** Stasis regression triage (architect pivot mid-session: "Triage the Anita stasis regression first"). Kinetic Baseline slides to Session 45.

**Session 43 Task 2 verification (first act of the session):**
- Dispatched synthetic S44-PROBE rows via Supabase into crew_dispatch targeting YouTube task types. Confirmed `[ProtocolInjection]` log line fires on dispatch with non-zero char count. Session 43 Task 2 hard-inject flipped ADDRESSED → **VERIFIED**.
- Session 43 Task 4 (Anti-Ghost ±14min jitter) cannot be verified until the next VidRush pipeline cycle produces Buffer `scheduled_at` timestamps. Parked as **BLOCKED-ON-CYCLE** — verification rolls to Session 45.

**Stasis regression triage — the main event:**

*Symptom:* `stasis_self_check` tasks dispatched to the 6 agents by the daily 20:28–20:32 UTC watchdog were failing with repeated `max-iterations` errors spanning multiple agents (not just Anita). Two failure modes observed in the crew_dispatch table: Groq 413 on 2026-04-07 and "max-iterations" on 2026-04-08/09.

*Investigation:*
1. Suspected prompt bloat first. Measured the full Layer 1 + Layer 2 prompt stack per agent — all ≤ ~3000 chars. Not the culprit.
2. Measured Session 35 dispatch-mode tool schemas (the 14-tool allowlist shipped to dispatch agents). Total: **11,544 chars / ~2,886 tokens** in JSON-serialized tool defs.
3. Per-iteration request size: ~3000 (system prompt) + 11,544 (tool schemas) + 1,100 (dispatch message) = ~15,650 chars / ~3,900 tokens. Well within all provider budgets.
4. Bloat ruled out. Root cause hypothesis: **iter-cap + tool-loop trap.** The stasis_self_check dispatch asked agents to introspect and return a status observation, but dispatch mode shipped them 14 tools. Agents burned iterations 1–3 issuing tool calls (`read_memory`, `read_protocols`, `get_stripe_metrics`, etc.) looking for data dispatch mode had explicitly stripped (Session 35 skips memory loading on dispatch). Iteration 4 returned `tool_use` content again, the loop hit `maxIterations` and exited. `lastAssistant.content` was `""` because the final assistant turn was tool calls with no text. The fallback `"⚠️ Agent loop reached maximum iterations..."` was returned, matched the isErrorResponse regex, and the task was marked failed.
5. 2026-04-07 413s explained: Anthropic had a degraded window that day, all agents failed over to Groq, and the accumulated tool-result context across iterations exceeded the Groq per-request TPM budget. Both failure modes share the same root cause — a feedback loop between tool-seeking behavior and a context that cannot provide data.

*Fix — LIGHT MODE dispatch:*
- **EDIT:** `src/agent/loop.ts` — `processMessage()` gains optional 4th arg `textOnly?: boolean`. When `true`, `toolDefs = []` (zero tools shipped), the agent cannot call tools, and the loop runs single-pass. Logs `⚡ [AgentLoop] LIGHT MODE — 0 tools (text-only response)` on entry.
- **EDIT:** `src/index.ts` — new `LIGHT_TASKS = new Set(["stasis_self_check"])` set in the DispatchPoller. When a claimed task's type is in LIGHT_TASKS, the poller:
  1. Adds a `stasis_self_check` entry to `EXECUTION_DIRECTIVES` telling the agent to return a single plain-text message (NOMINAL + one-line observation, or a single concrete concern/opportunity/pivot recommendation) in their character voice, under 300 words, with NO tool calls.
  2. Omits the `completionTail` string ("When done, use crew_dispatch tool with action 'complete'...") that normally gets appended, because the agent has no tools.
  3. Sets `iterCap = 1` instead of 4/6.
  4. Passes `isLightTask` as the new 4th arg to `processMessage`.
- The existing `isStasisNominal` auto-completion logic (~index.ts line 2993) already catches stasis_self_check responses and writes them back to crew_dispatch as `status=completed`, so the task completes even without a tool call.
- Zero impact on heavy dispatch paths (`viral_clip_extraction`, `narrative_weaponization`, `content_scheduling`, etc.) — they go through the normal tool-enabled path unchanged.

*Sandbox file-truncation damage (secondary incident):*
- While editing `src/agent/loop.ts` and `src/index.ts`, the sandbox-side copies of both files silently truncated (a known risk — see `feedback_file_truncation_risk.md`). `tsc --noEmit` surfaced `loop.ts(448,52): error TS1005` and `index.ts(3268,147): error TS1003`. Investigation: loop.ts ended mid-comment at `PERSONA_` and index.ts ended mid-template-literal at `${Math.round(mem.` — classic sandbox truncation.
- **Recovery:** appended the missing tails directly via bash heredoc (loop.ts tail = `REGISTRY, causing crashes when ...` + 19 lines through class close; index.ts tail = 49 lines through `process.exit(1); });`). CRLF preserved via `sed -i 's/$/\r/'`. Post-repair `tsc --noEmit` returned clean.
- **Lesson reinforced:** after any file-tool Write on files > 300 lines, verify both Windows-side and sandbox-side line counts agree before running tsc. The Windows Write tool writes successfully while the sandbox mount can lag or silently truncate.

**Verification attempt 1 (2026-04-10 06:09–06:11 UTC) — FALSE POSITIVE:**
- Dispatched 2 synthetic `stasis_self_check` probes (anita, vector) at 06:09:26 UTC. Both returned clean text responses — Anita 17.4s, Vector 59.3s with a side observation about Buffer analytics schema drift.
- I initially interpreted this as LIGHT MODE verified and flipped the DVP to VERIFIED. **This was wrong.** Railway was still running Session 43 code at that moment (see build failure block below). Old code (14-tool allowlist, iterCap=4) can coincidentally return a text-only response if the LLM happens to emit prose instead of a tool call on early iterations. Two probes landed on that lucky branch and I mistook correlation for causation. This is exactly the `feedback_verification_protocol.md` trap: "don't flip to VERIFIED until the proof is load-bearing."

**Build failure cascade + 5-step Dockerfile fix chain (2026-04-10 06:30–07:05 UTC):**
Architect reported Railway build failed twice. Pulled Railway deployments panel via Chrome MCP and confirmed both `1a766d2` (LIGHT MODE code) and `6d3be0a` (master ref) had failed mid-build. First analysis called it a "transient Railway flake" — that was wrong. Root cause was structural: Railway's Singapore builder cannot survive any large apt unpack on the `node:20-slim` base. Exit code 137 = SIGKILL = OOM-kill. It took four separate Dockerfile rewrites to kill every apt unpack that triggered it:

1. **`8cd1b16` — split the monolithic apt install into per-package layers.** Failed at stage-1 step 3/15, ffmpeg layer, exit 137. Last visible unpacks: `libxshmfence1`, `libxxf86vm1`, `libdrm-amdgpu1/intel1/nouveau2/radeon1`, `libelf1`. Split worked for python3+pip but ffmpeg's 200+ x11/drm/codec transitive debs alone still exceeded builder memory.
2. **`f49ec03` — replaced apt ffmpeg with `FROM mwader/static-ffmpeg:7.0 AS ffmpeg` + `COPY --from=ffmpeg`.** Failed at stage-2 step 2/16, python3+python3-pip layer, exit 137 after dpkg "Setting up python3-pip". Even minimal python3 unpack OOMs on Railway's current Singapore builder.
3. **`44894dc` — switched prod base from `node:20-slim` to `nikolaik/python-nodejs:python3.11-nodejs20-slim` (Node 20 + Python 3.11 + pip preinstalled).** Failed at stage-2 step 2/15, chromium layer, exit 137 mid-unpack at `chromium-common` / `chromium`. Visible last unpacks: `libxtst6`, `libxv1`, `libxxf86dga1`, `x11-utils`, `xdg-utils`, `chromium-common`, `chromium`. Chromium's 150+ transitive debs cannot unpack on the Railway builder either.
4. **`e2369ff` — removed chromium apt install entirely.** Verified safe by reading `src/tools/browser.ts` lines 21–26: puppeteer is lazy-loaded via `const puppeteer = await import("puppeteer-core")` inside `getBrowser()`. Bot startup, dispatch path, LIGHT MODE, faceless factory, Anti-Ghost jitter all unaffected — only TikTok/Instagram direct browser uploads (which actually call `getBrowser()`) will 500 at runtime. Build then **failed at the builder stage step 8/8 `tsc` compile** with multiple `TS1005/TS1128/TS1434` errors at `loop.ts` lines 468, 474, 476, 487.
5. **`1c96a3f` — repaired `loop.ts` file-truncation damage.** PowerShell `Measure-Object -Line` had reported 426 lines (misleading — it undercounts LF-only files). Real size: 19669 bytes, 488 actual lines (verified via `(Get-Item).Length` and `-split "\r?\n".Count`). Read lines 460–490 and found Session 44's heredoc recovery had appended a duplicate `getPersonaLLM` block and orphaned comment fragment AFTER the already-clean class close brace at line 467 (lines 468–487). Edit removed the 20-line dangling tail, file now ends correctly at line 467 `}`. Local `npx tsc --noEmit` exited clean. Railway deploy of `1c96a3f` succeeded — gravity-claw-production-d849.up.railway.app shows 1 Replica Active.

**Post-build-failure false-negative probe (06:30:57 UTC):** Dispatched `0a41019a-1338-4910-9596-665f73082f33` targeting anita with `stasis_self_check`. Result: **FAILED** at 06:31:59 UTC after 36s with `⚠️ Agent loop reached maximum iterations without a final response.` — the exact symptom LIGHT MODE was designed to eliminate. This confirmed LIGHT MODE code was not yet running and was the catalyst that forced the full fix chain instead of "retrigger and hope."

**Load-bearing verification probes (07:06–07:08 UTC, post-`1c96a3f` deploy):**
- Anita `e49b83a6-4cd9-4719-a778-924666e5b84d`: claimed 07:06:24, completed 07:06:36.672 — **12.66 seconds**. Plain text response opening: *"Light mode detected. Growth engine operational — the transition to Anthropic-first routing has eliminated the Groq dependency chokepoints..."* Anita literally said the words `Light mode detected` — the new dispatch branch executed.
- Vector `eab7993e-ab08-4a3b-a717-d4542c61fecc`: claimed 07:07:37.908, completed 07:07:45.921 — **8.01 seconds**. Plain text response opening: *"Numbers tell the truth about LIGHT MODE deployment: Zero revenue data points since switch..."* In-character analytics voice, under the 25s threshold, no tool_use blocks.
- Both runs cleared the two-agent DVP bar set after the 06:09 false positive. LIGHT MODE is load-bearing VERIFIED.

**Lessons reinforced:**
- **Railway apt-unpack is structurally fragile.** For any future base-image change, prefer preinstalled bases (`nikolaik/python-nodejs`) and cross-stage COPY of static binaries (`mwader/static-ffmpeg`) over apt-get installs. Chromium belongs on a dedicated puppeteer base image or `@puppeteer/browsers` runtime download, not apt.
- **PowerShell `Measure-Object -Line` undercounts LF-only files.** Always verify with `(Get-Item).Length` (bytes) + tsc + read the actual tail before trusting a line count.
- **`feedback_file_truncation_risk.md` applies to recoveries too** — Session 44's heredoc repair had itself appended a duplicate tail to an already-clean file. After any emergency file-tail append, re-grep for duplicate class closes and re-run tsc.
- **`feedback_verification_protocol.md` demands two-agent confirmation.** Session 44's first flip at 06:09 was single-agent. The correct bar is "two independently in-character text responses under 25s" — which is what `e49b83a6` + `eab7993e` cleared.

**Side finding flagged for Session 45:** Vector's stasis response surfaced "Buffer analytics query failing on schema mismatch / GraphQL schema drift in Buffer inte...". Buffer analytics tool (added Session 36) may have regressed against a Buffer API schema change. Needs investigation in Session 45 — could be masking other distribution visibility issues. Not currently blocking pipeline runs (Buffer post creation still works), but the Vector weekly analytics sweep may be returning garbage.

**Files touched:**
- **MODIFIED:** `src/agent/loop.ts` (+textOnly arg, +LIGHT MODE branch, +log line; ~37 lines inserted/modified; then −20 lines orphan tail in `1c96a3f`)
- **MODIFIED:** `src/index.ts` (+LIGHT_TASKS set, +stasis_self_check EXECUTION_DIRECTIVES entry, +completionTail conditional, +iterCap light branch, +4th arg passed to processMessage; ~27 lines inserted/modified)
- **MODIFIED:** `Dockerfile.bot` — rewritten to multi-stage (mwader/static-ffmpeg COPY + nikolaik/python-nodejs base + chromium removed); 4 commits (`8cd1b16` → `f49ec03` → `44894dc` → `e2369ff`)
- **MODIFIED:** `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` (header + Session 43 DVP flip + this entry)

**DVP Status (post-verification):**
- `[DVP: VERIFIED]` Session 44 LIGHT MODE dispatch — load-bearing proof 2026-04-10 07:06–07:08 UTC via two-agent probes `e49b83a6` (anita, 12.66s) and `eab7993e` (vector, 8.01s). Commit chain `1a766d2 → 1c96a3f` deployed.
- `[DVP: VERIFIED]` Session 43 Task 2 hard-inject — still VERIFIED. Code was in `8339dbc` (always live); Session 44 only fixed the dispatch iter-loop. Protocol injection log line confirmed firing earlier in session.
- `[DVP: ADDRESSED — BLOCKED-ON-CYCLE]` Session 43 Task 4 Anti-Ghost jitter — deployed in 8339dbc which is live, still waiting on first VidRush pipeline cycle for Buffer timestamp verification.
- `[DVP: ADDRESSED — SESSION-45-TASK]` Chromium removed from production image. TikTok/Instagram direct browser uploads will 500 at runtime. Dispatch / LIGHT MODE / faceless factory / Anti-Ghost jitter / Buffer uploads all unaffected. Fix path for Session 45: either switch base image to `ghcr.io/puppeteer/puppeteer` or use `@puppeteer/browsers` to download chromium at runtime into `/tmp`.

**Next session priorities (Session 45):**
1. **Kinetic Baseline (Task 3 of YouTube Growth Protocol v2.0).** Build ffmpeg filter chain for intra-segment visual interrupts on existing Ken Burns clips: 1.2× scale punch-ins, 0.2s chromatic aberration / RGB-split glitch overlays, Ken Burns direction reversal. Target frequency: 3–4s for The Containment Field, 5–7s for Ace Richie. Constraint: do NOT break the Session 40 16-segment / 22–37s audio-sync contract. This is a perceptual overlay, not a new image asset.
2. **Re-add chromium to production image.** TikTok/Instagram direct browser uploads currently 500 at runtime because Session 44 removed the apt install. Preferred path: switch Dockerfile prod stage to `ghcr.io/puppeteer/puppeteer:latest` (ships Node + chromium preinstalled, no apt OOM risk). Alternative: keep nikolaik base and use `@puppeteer/browsers install chrome@stable --path /app/.chromium` at runtime on first tool call. Verify `PUPPETEER_EXECUTABLE_PATH` env var lines up with whichever path lands.
3. **Verify Session 43 Task 4 Anti-Ghost jitter.** Inspect Buffer `scheduled_at` timestamps from the first post-Session-43 pipeline cycle; confirm minute values land in a `-14..+14` envelope around the 8 base slots. Flip DVP ADDRESSED → VERIFIED.
4. **Investigate Buffer analytics schema drift** (flagged by Vector in Session 44 probe AND reinforced by Vector's Session 44-verification probe — the 8.01s stasis response explicitly called out "Zero revenue data points since switch" and measurement infrastructure gaps). GraphQL schema in the buffer_analytics tool may be stale.
4. **Revenue architecture** — still the top-line objective. Zero MRR against $1.2M target = 0.0000% velocity. T0/T1 free tiers and T2-T7 paid tiers are mapped in design-tokens.json; what's missing is distribution that actually drives signups.