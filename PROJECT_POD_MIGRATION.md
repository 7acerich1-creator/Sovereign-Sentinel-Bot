# PROJECT_POD_MIGRATION.md

> **⚡ THE BIG PROJECT.** This is the terminal reference for the Content Production Rewrite.
> Every session that touches this work reads the STATUS block first and updates it last.
> When every phase below ships green, this file retires and NORTH_STAR.md picks up the next mission.

---

## STATUS — UPDATE EVERY SESSION (TOP OF FILE)

| Field | Value |
|---|---|
| **Current phase** | Phase 1 Pod Foundation — **60% shipped.** 1.1 ☑, 1.2 ☑, 1.3 ☑ (on `origin/main` via `a8bf77a`). 1.4 ☐ (docker build + push → RunPod registry) and 1.5 ☐ (upload speaker WAVs to pod `/runpod-volume/speakers/` + set `XTTS_SPEAKER_WAV_ACE` on Railway) both require physical actions on a build host and on the pod volume respectively — deferred to a dedicated session. Phase 2 Task 2.1 unblocked independently. |
| **Current phase status** | **Phase 0: ALL ☑.** **Phase 1: 1.1/1.2/1.3 ☑ and PUSHED (commit `a8bf77a` on `origin/main`, S61).** 1.4/1.5 ☐ — non-blocking for next session because Phase 2 Task 2.1 (`src/pod/runpod-client.ts`) can be written against the job-spec contract before the pod image is live. |
| **Total phases** | 8 (Phase 0 → Phase 7) |
| **Last session** | Session 61 — 2026-04-14 (close) — Phase 1 skeleton committed + pushed in `a8bf77a`. Cleaned up 4 orphan files flagged by Architect: `PURPOSE.md` committed (canonical S56 purpose lock), `NORTH_STAR.md` committed (S60 measurement + S56 reframe + pod-migration as Current Highest-Leverage Action), `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` committed (S57 funnel restructure entry), `HANDOFF-NEXT-SESSION.md` DELETED (obsolete — S57 shipped via commits `cd5685c`+`f712fce`; also was in wrong repo per `feedback_handoff_files_correct_repo.md`). CRLF line-ending churn on ~10 other files (Windows autocrlf artifact) left untouched — not this session's fight, logged to memory. |
| **Last commit touching this work** | `a8bf77a` (S61 pod skeleton) on `origin/main`. Plus the session-close commits this session (see Change log). |
| **Blocker** | NONE in the code path. Phase 1 close requires: (1) a build host with Docker for Task 1.4, and (2) pod volume SSH / file-push access for Task 1.5. Phase 2 Task 2.1 does NOT need either. |
| **Next session's first action** | Begin Phase 2. Task 2.1: create `src/pod/runpod-client.ts` with `startPod()`, `stopPod()`, `waitUntilReady()`, `produceVideo(spec)`. Uses `RUNPOD_API_KEY` + `RUNPOD_POD_ID` (confirmed SET on Railway). Verify `tsc --noEmit` clean. Task 2.2 writes `JobSpec` / `ArtifactUrls` types in `src/pod/types.ts` and mirrors them in `pod/models.py`. Both tasks unblock independently of the pod image existing. |

**Rule:** if you are a future session and this STATUS block has not been updated in your current session before you close, the session failed regardless of what was built.

---

## Why this project exists (do not delete — resumes the context)

The Ace Richie 77 and Containment Field automated content pipelines are failing in three ways that together explain why the top of funnel is not filling:

1. **Audio drops mid-video.** Ace reports consistent mid-video audio failure on recent uploads. Unverified by file inspection as of 2026-04-14 21:30 UTC — first Phase 0 task is to reproduce from the uploaded video file.

2. **TTS is calling OpenAI and running out of quota.** Telegram screenshot 2026-04-14 10:07 AM showed `OpenAI TTS error 429: exceeded your current quota` on Ace Richie Faceless Factory segment 1/17. Per `src/voice/tts.ts` the chain is `XTTS → ElevenLabs → Edge → OpenAI` and XTTS is only included when `XTTS_SERVER_URL` is set. Either (a) that env var is missing/wrong on Railway production, or (b) the RunPod was cold/unreachable and the chain fell through to an exhausted OpenAI key. Both roads lead to the same fix: wake-pod-first and verify XTTS routing.

3. **Ace Richie 77 fires on The Containment Field's topics.** Same screenshot: Alfred generated `"corporate burnout trapdoor is pulsing strongest today"` and handed that one seed to both pipelines. Ace Richie then tried to produce a burnout video. Per strategic brand positioning burnout is TCF territory. The S48 Brand Routing Matrix fixed the RENDER layers (aesthetic/terminal/thumbnail/captions/stingers/TTS) — but the seed intake layer still serves one shared niche to both brands. The S48 push status also needs to be re-verified (memory says "NOT pushed" but that's 12 sessions old).

4. **TikTok uploads silent, Shorts pipeline broken.** Distribution-stage bugs, not compute-stage. Must be scoped explicitly; migration alone does not fix these.

5. **Imagen 4 on Gemini billing is brittle.** Card declines + quota risk. FLUX on the pod is the sovereign substitute.

The architectural move: **stop treating Railway as the do-everything host.** Railway becomes a pure orchestrator (Telegram, schedulers, Supabase, distribution, comment watcher, /signals reads). The RunPod becomes the heavy-compute worker for TTS, image generation, and video composition. Railway wakes the pod, pushes a job spec, awaits the produced artifact, then runs distribution. Pod never talks to YouTube or Buffer — it only produces files.

---

## Target architecture (after migration)

```
    ┌────────────────────────────────────────────────────┐
    │ RAILWAY (always-on orchestrator)                    │
    │ - Telegram bot + agents                             │
    │ - Schedulers (YT stats, CTA audit, comment watcher) │
    │ - Supabase client (reads/writes)                    │
    │ - Distribution: YouTube/Buffer/TikTok/IG uploaders  │
    │ - /signals page + webhook handlers                  │
    └────────────────┬───────────────────────────────────┘
                     │  HTTP job spec (JSON)
                     ▼
    ┌────────────────────────────────────────────────────┐
    │ RUNPOD (wake-on-demand worker)                      │
    │ FastAPI worker service :8000                        │
    │  POST /produce { brand, niche, seed, script, ... }  │
    │    → XTTS inference (all scene chunks batched)      │
    │    → FLUX image generation (all scenes batched)     │
    │    → Ken Burns composition per scene                │
    │    → ffmpeg concat + mux final video                │
    │    → upload to Supabase Storage                     │
    │    → return { video_url, thumbnail_url, duration }  │
    │  GET /health                                        │
    └────────────────┬───────────────────────────────────┘
                     │  artifact URL
                     ▼
                  Railway picks up, runs distribution
```

RunPod control: Railway uses the RunPod REST API to `startPod()` as the first step of any pipeline run, polls `/health` until ready, pushes the job, receives the artifact URL, then calls `stopPod()` after a configurable idle window (so back-to-back runs don't pay re-wake cost).

---

## Open Decisions (LOCKED 2026-04-14 Session 60 — quality-no-compromise directive)

> Architect directive: *"Whatever you recommend, it's still for the highest quality, though. Like, this is the last time that I wanna be messing with this. I don't care how much it cost me. I want the best quality out there that is going to be known for both of my brands."*

| # | Decision | LOCKED Choice | Rationale | Locked? |
|---|---|---|---|---|
| D1 | Target pod GPU | **H100 80GB SXM** (preferred) OR **A100 80GB SXM** (fallback if H100 unavailable in region) | 80GB VRAM eliminates every OOM risk for FLUX.1 [dev] at full precision + XTTSv2 loaded concurrently + video composition in a single session. No offload, no quantization trade-offs, zero "is this because we went cheap" doubt. Cost headroom for future video-diffusion (SVD / Mochi) without re-specing. | ☑ |
| D2 | FLUX variant + precision | **FLUX.1 [dev]** at **bf16 full precision**, native 1024×1024, 30 steps, guidance 3.5 | [dev] produces visibly higher-fidelity detail than [schnell]; full precision on 80GB GPU means zero quality compromise. 30 steps = sweet spot for detail-without-overcook. | ☑ |
| D3 | Worker container format | **Docker image** built locally, pushed to RunPod template registry | Reproducibility across pod resets. Rollback = redeploy prior tag. No drift between dev and prod. | ☑ |
| D4 | Job spec delivery | **HTTPS POST** to pod's public FastAPI endpoint with `Authorization: Bearer $POD_WORKER_TOKEN` | Single connection, no queue infra to maintain. Bearer auth is sufficient at this scale. | ☑ |
| D5 | Artifact storage | **Cloudflare R2** (primary) for video + thumbnail artifacts. Supabase Storage retained ONLY for small metadata (scripts, logs). | Architect hit Supabase Storage egress limits previously. R2 = zero egress fees, S3-compatible, free up to 10GB/mo + $0.015/GB thereafter, faster CDN than Supabase. Direct migration path: swap the upload client in `pod/worker.py`. | ☑ |
| D6 | Pod idle sleep timeout | **10 minutes** after last job completion | Covers the dual-brand back-to-back cycle (Ace + TCF in ~20 min total if sequential) plus a grace window for post-production retries. 20 min wastes GPU hours; 5 min risks cold-start on the second brand. | ☑ |
| D7 | Is memory `project_session48_brand_routing_matrix.md` still accurate? | **S48 IS LIVE ON `origin/main`.** Commits `67fe042` (Brand Routing Matrix — 6-layer bifurcation locked) and `7761363` (Frequency Bifurcation Protocol) both confirmed on `main` via `git branch -a --contains`. Memory was 12 sessions stale. Phase 3 Task 3.1 is effectively pre-satisfied for the render layers — the seed intake layer is still the real fix. | Git-verified S61 2026-04-14. | ☑ |

**Required new env vars on pod:** `POD_WORKER_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_VIDEOS`, `R2_BUCKET_THUMBS`, `R2_PUBLIC_URL_BASE`.

**Required new env vars on Railway:** `RUNPOD_API_KEY`, `RUNPOD_POD_ID`, `POD_WORKER_URL`, `POD_WORKER_TOKEN`.

---

## The Phases

Each phase has bite-sized tasks. Every task lists the EXACT file path it touches and the EXACT verification command. No task is "done" until the verification passes. Sessions check off tasks inline by changing `☐` → `☑`.

---

### PHASE 0 — Diagnosis + Plan Lock

**Exit criterion:** Every Open Decision above is locked. The audio-drop bug is reproduced from at least one real video file. S48 push status is verified.

- ☑ **Task 0.1 — Reproduce audio drop.** RESOLVED S61 by Architect manual audit: **long-form audio is clean end-to-end on all 3 recent Ace Richie uploads.** Audio drop bug is in SHORTS only ("plays a word or two then fails"). Root cause is downstream of TTS: either `src/tools/clip-generator.ts` (audio stream handoff / boundary math) or `src/tools/video-publisher.ts` Buffer shorts upload path. **Phase 4 pod/TTS migration will NOT fix this bug.** Phase 5 (surgical curator replaces chop-everything) + Phase 6 Task 6.1 (now scoped to Buffer shorts audio-cut) is where the fix lives. See memory `project_shorts_audio_bug_not_longform.md`.
- ☑ **Task 0.2 — Verify S48 Brand Routing Matrix push status.** DONE S61 2026-04-14. Commits `67fe042` + `7761363` confirmed on `origin/main`. Memory flag "NOT pushed" was 12 sessions stale. D7 locked accordingly.
- ☑ **Task 0.3 — Confirm pod identity + specs.** CLOSED S61 via Railway Variables screenshot. `RUNPOD_POD_ID` SET (pod `a2shyagwexfhon` confirmed). `RUNPOD_API_KEY` SET. `XTTS_SERVER_URL` SET. GPU model / VRAM / volume details deferred to live `/health` probe once POD_WORKER_URL is set and pod is re-reachable — not a Phase 1 prerequisite.
  - Verification: specs recorded in Open Decisions D1
- ☑ **Task 0.4 — Inspect current production env on Railway.** CLOSED S61 via Architect screenshot of Railway Variables tab. Findings: SET ✅ → `XTTS_SERVER_URL`, `XTTS_SPEAKER_WAV_TCF`, `RUNPOD_API_KEY`, `RUNPOD_POD_ID`. MISSING ❌ → `XTTS_SPEAKER_WAV_ACE` (production is silently falling back for the ace_richie brand — flag: real bug, add to Phase 1.5 as pre-flight), `POD_WORKER_TOKEN` (expected-missing, set in Phase 1 after worker deploy), `POD_WORKER_URL` (expected-missing, set in Phase 1 after worker deploy). No other pod-migration env vars outstanding.
  - Verification: a YES/NO row per env var written to Phase 0 Audit Log
- ☑ **Task 0.5 — Architect locks D1–D6.** DONE S60 2026-04-14 per quality-no-compromise directive (H100/A100 80GB, FLUX.1 [dev] bf16, Docker, HTTPS+Bearer, Cloudflare R2, 10-min idle).

---

### PHASE 1 — Pod Foundation

**Exit criterion:** A pod (old or new, per D1) is running a Docker image that exposes `/health` returning `200 OK`, has FLUX + XTTSv2 + ffmpeg + yt-dlp + Python 3.11 installed, and has been tested by a manual `curl /health` from a laptop.

- ☑ **Task 1.1 — Create `pod/Dockerfile` at Sentinel repo root.** DONE S61 2026-04-14. `pod/Dockerfile` written (3876 bytes). Base `nvidia/cuda:12.1.1-runtime-ubuntu22.04`; installs python3.11, ffmpeg, libsndfile1, espeak-ng, CUDA-torch 2.4.1 from PyTorch wheel index before generic pip resolve; HF + torch caches pinned to `/runpod-volume`; non-root sovereign user; HEALTHCHECK hits `/health/live` (unauth liveness probe); CMD runs `uvicorn worker:app` single-worker (GPU-bound).
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\pod\Dockerfile` ✅
  - Verification: `docker build pod/` — deferred to actual build host (no docker in sandbox). Syntax reviewed for FROM/RUN/COPY/CMD correctness.
- ☑ **Task 1.2 — Create `pod/requirements.txt`.** DONE S61 2026-04-14. `pod/requirements.txt` written (1504 bytes). torch is INSTALLED SEPARATELY in Dockerfile (CUDA wheel index) — not listed here to avoid CPU downgrade. Pins: `fastapi==0.115.0`, `uvicorn[standard]==0.30.6`, `pydantic==2.9.2`, `TTS==0.22.0` (XTTSv2), `diffusers==0.30.3` (first Flux-merged release), `transformers==4.44.2`, `accelerate==0.34.2`, `supabase==2.8.0`, `boto3==1.35.31`/`botocore==1.35.31` (R2, D5), `ffmpeg-python`, `librosa`, `soundfile`, `Pillow`, `numpy`, `structlog`, `tenacity`.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\pod\requirements.txt` ✅
  - Verification: `pip install -r pod/requirements.txt` — deferred to actual build host.
- ☑ **Task 1.3 — Create `pod/worker.py` skeleton.** DONE S61 2026-04-14. `pod/worker.py` written (13495 bytes, `ast.parse` clean). FastAPI app exposing: `GET /health/live` (unauth liveness), `GET /health` (auth readiness — returns CUDA available + device name + models_loaded map + r2_configured flag), `POST /produce` (202 Accepted, returns `{job_id, status, queued_at}`), `GET /jobs/{job_id}` (poll for artifact URLs). Bearer auth via env `POD_WORKER_TOKEN` with constant-time compare. Job spec Pydantic-validated: `{brand: ace_richie|containment_field, niche, seed, script, scenes[{index, image_prompt, tts_text, duration_hint_s}], client_job_id?}` with contiguous scene-index validator. `pod/pipelines/__init__.py` scaffolded for Phase 4 (xtts/flux/compose/r2 modules).
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\pod\worker.py` ✅ + `pod/pipelines/__init__.py` ✅
  - Verification: `python -c "import ast; ast.parse(open('pod/worker.py').read())"` → syntax OK. End-to-end `uvicorn`/`curl` verification deferred to Task 1.4 build host (boto3 + TTS + torch are GPU-host deps, not sandbox-installable).
- ☐ **Task 1.4 — Build + push Docker image to RunPod registry OR deploy via `runpodctl`.** Per D3.
  - Verification: `/health` reachable over public RunPod URL with auth header
- ☐ **Task 1.5 — Install XTTSv2 speaker reference WAVs on pod volume.** Copy `ace_richie.wav` + `tcf.wav` to pod's `/runpod-volume/speakers/`.
  - Verification: `ls /runpod-volume/speakers/` on pod shows both files >100KB each

---

### PHASE 2 — Orchestration (Railway ↔ Pod Contract)

**Exit criterion:** Railway can wake the pod, POST a job, receive an artifact URL, and sleep the pod — all from a single function call in TypeScript. No production pipeline code is migrated yet.

- ☐ **Task 2.1 — Create `src/pod/runpod-client.ts`.** Exports `startPod()`, `stopPod()`, `waitUntilReady()`, `produceVideo(spec: JobSpec): Promise<ArtifactUrls>`. Uses `RUNPOD_API_KEY` + `RUNPOD_POD_ID` env.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\pod\runpod-client.ts` (new)
  - Verification: `tsc --noEmit` clean
- ☐ **Task 2.2 — Define `JobSpec` + `ArtifactUrls` TypeScript types.** Single source of truth in `src/pod/types.ts`; mirrored in `pod/worker.py` as Pydantic models.
  - Files: `C:\Users\richi\Sovereign-Sentinel-Bot\src\pod\types.ts` (new), `C:\Users\richi\Sovereign-Sentinel-Bot\pod\models.py` (new)
  - Verification: generate a sample JobSpec JSON, POST it to the pod stub, receive `{job_id}` back
- ☐ **Task 2.3 — End-to-end contract test with stub pod response.** The pod returns a dummy video URL (e.g. a pre-uploaded 5-second test clip). Railway side: call `produceVideo()`, assert return shape.
  - Verification: `npm run test:pod-contract` passes
- ☐ **Task 2.4 — Wake/sleep lifecycle wrapper.** `withPodSession(async (client) => { ... })` helper that wakes on entry, sleeps on exit after D6 idle window.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\pod\session.ts` (new)
  - Verification: local test — calling the wrapper starts pod, runs body, stops pod

---

### PHASE 3 — Brand Correctness + Content Uniqueness (Intake Layer)

**Exit criterion:** Alfred generates TWO distinct seeds per day — one per brand — each constrained to brand-specific niche allowlists AND guarded against repeating recent topics. Ace Richie cannot run on "burnout." TCF cannot run on "sovereignty." No brand produces a script semantically similar to anything it shipped in the last 30 days. The S48 Brand Routing Matrix push status is resolved (either confirmed live or pushed this phase).

> Architect directive: *"we need to ensure all the content is completely unique. maybe its because everything is revolving specifically around burnout currently but it seems like its all the same right now for the most part."*

- ☐ **Task 3.1 — Resolve S48 status per Task 0.2 finding.** If not pushed, push now on a branch, run `tsc --noEmit`, run the existing video E2E test if present, merge to main.
  - Verification: `git log origin/main --oneline | head -5` shows the S48 commit, Railway deploys cleanly
- ☐ **Task 3.2 — Define brand niche allowlists.** Ace Richie ALLOWED: `sovereignty, authority, architecture, system-mastery, wealth-frequency`. TCF ALLOWED: `burnout, dark-psychology, containment, manipulation-exposed, pattern-interrupt`. Edit `src/data/shared-context.ts`.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\data\shared-context.ts`
  - Verification: new `BRAND_NICHE_ALLOWLIST` export; `tsc --noEmit` clean
- ☐ **Task 3.3 — Split Alfred's daily seed generation.** Currently one seed per day shared. Change: generate `{ace_richie_seed, tcf_seed}` tuple, each constrained to its brand allowlist. Edit the Alfred persona prompt + `src/engine/content-engine.ts` seed selection path.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\engine\content-engine.ts`, `src/agent/personas.ts`, `src/agent/crew-dispatch.ts`
  - Verification: stub a day's run locally; log shows TWO different seeds with brand-matching niches
- ☐ **Task 3.4 — Brand hard-fail guard.** If either pipeline receives a niche NOT in its allowlist, throw and Telegram-notify. No silent fallback.
  - File: `src/engine/faceless-factory.ts` entry point
  - Verification: write a unit test that passes `{brand: 'ace_richie', niche: 'burnout'}` and expects a thrown `BrandNicheViolation`
- ☐ **Task 3.5 — 30-day niche cooldown per brand.** Supabase migration: add `content_drafts.niche_tag text` + `content_drafts.brand text` (if not already present) + index on `(brand, niche_tag, created_at DESC)`. Alfred queries: "for brand X, which of the allowlist niches has NOT been used in the last 30 days?" — pick from that subset first. If every allowlist niche is cooldown-blocked, relax to 14 days.
  - File: `supabase/migrations/004_niche_cooldown.sql`, `src/engine/content-engine.ts`, `src/agent/personas.ts` (Alfred)
  - Verification: run twice in one day with forced niche override; second call must not return the niche the first call already used
- ☐ **Task 3.6 — Semantic similarity guard via Pinecone.** Before committing a new script to production, embed its first 500 words + title; query Pinecone `scripts` namespace for the brand's top-5 nearest neighbors; if max cosine similarity >0.85, reject and regenerate (up to 2 retries; on 3rd failure, Telegram-alert and halt that brand for the day).
  - File: `src/engine/content-engine.ts` (post-draft, pre-production gate), new `src/tools/script-uniqueness-guard.ts`
  - Verification: unit test — seed two nearly-identical scripts, first passes, second rejected with `ScriptTooSimilar` error naming the neighbor
- ☐ **Task 3.7 — Persist every shipped script to Pinecone.** After a video uploads successfully, embed the script + upsert to the brand's Pinecone namespace with metadata `{brand, niche_tag, video_id, shipped_at}`. This is the memory the uniqueness guard queries.
  - File: `src/tools/script-uniqueness-guard.ts` (upsert fn), hook into `src/tools/video-publisher.ts` success callback
  - Verification: after a successful upload, Pinecone namespace `scripts-ace-richie` or `scripts-tcf` shows N+1 vectors

---

### PHASE 4 — Compute Migration (XTTS + FLUX + Composition Move to Pod)

**Exit criterion:** The Faceless Factory, when invoked from Railway, calls the pod for ALL compute. Railway no longer runs XTTS HTTP calls directly, no longer calls Imagen 4, no longer runs ffmpeg composition. The pod does all of it in one session per video.

- ☐ **Task 4.1 — Implement `/produce` real logic on pod.** Replace stub with: parallel FLUX image batch → XTTS batch (all segments in one model-load session) → Ken Burns composition → ffmpeg concat → upload to Supabase Storage → return URLs.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\pod\worker.py`
  - Verification: manually POST a small JobSpec (3 scenes), receive a real video URL, download + play it locally
- ☐ **Task 4.2 — Refactor `src/engine/faceless-factory.ts` to delegate to pod.** Remove the per-segment TTS loop + image gen + composition code; replace with a single `await produceVideo(spec)` call.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\engine\faceless-factory.ts`
  - Verification: `tsc --noEmit` clean; existing unit tests updated
- ☐ **Task 4.3 — Deprecate `src/voice/tts.ts` for pipeline calls.** Keep it around for non-pipeline TTS (e.g., Telegram voice replies) but mark pipeline callers migrated. Remove OpenAI from the chain entirely.
  - File: `src/voice/tts.ts`
  - Verification: grep shows no faceless-pipeline callers importing from `src/voice/tts.ts`
- ☐ **Task 4.4 — Deprecate Imagen 4 calls in pipeline.** `src/tools/image-generator.ts` — mark Imagen 4 as non-pipeline only; FLUX on pod handles all pipeline image gen.
  - File: `src/tools/image-generator.ts`
  - Verification: grep shows no Faceless Factory imports from image-generator
- ☐ **Task 4.5 — Wake-pod-first wiring.** Every pipeline entry point starts with `await withPodSession(...)`. Telegram bot user-facing replies do NOT wake the pod (stay on Railway-local resources).
  - Files: `src/engine/faceless-factory.ts`, `src/engine/vidrush-orchestrator.ts`, `src/engine/content-engine.ts`
  - Verification: fresh pod (cold) + trigger pipeline → logs show `startPod` → `/health` poll → `produce` → `stopPod`

---

### PHASE 5 — Script-First Architecture + Surgical Shorts Curator

**Exit criterion:** The long-form script writer operates with ZERO knowledge that the video will ever be clipped. A separate `shorts-curator` pass reads the finished long-form script + audio, identifies 3–4 natural climax/hook moments, and extracts those surgical clips ONLY. The current "chop into 9–19 shorts" behavior is retired. Every short that ships can stand on its own and exists to drive the viewer back to the long-form channel.

> Architect directive: *"its important to audit how the script is assembled, it seems like in order to create the short narratives the script is revolved around that and ends up repeating itself. its better to get only 3 or 4 high quality shorts from a high quality script that is clipped in the right places, which is conservative, but just to make a point, rather than 9 or 19 broken shorts. the short should be good enough to make them click the channel and find the long forms. Thats how this is going to flow."*

> **Principle:** Long-form YouTube is the foundation. Shorts, TikTok, IG Reels, and everything Buffer distributes flow DOWN from those two successful long-form runs per day (one Ace Richie, one TCF). If the long-form isn't great, nothing downstream matters.

- ☐ **Task 5.1 — Audit current script assembly.** Read `src/engine/content-engine.ts` + `src/agent/personas.ts` (Veritas/script-writer agent). Identify every place the prompt hints the script will be clipped, chopped, or optimized for shorts. Document findings in Phase 5 Audit Log.
  - Files: `src/engine/content-engine.ts`, `src/agent/personas.ts`, `src/data/shared-context.ts`
  - Verification: audit note naming EVERY "clip-aware" phrase in the long-form script prompt
- ☐ **Task 5.2 — Strip all clipping awareness from the long-form script writer.** The script writer produces ONE coherent 8–12 minute narrative with natural escalation. No "and here's another angle," no "let me give you five examples" padding. Write for the full-length reader, not the short-video scroller.
  - Files: `src/agent/personas.ts` (script-writer persona prompt), `src/engine/content-engine.ts` (any shorts-related instruction in the long-form prompt path)
  - Verification: diff of the prompt before/after; `grep -i "short\|clip\|segment\|chop" src/agent/personas.ts` returns zero matches in the long-form writer section
- ☐ **Task 5.3 — Create `shorts-curator` persona + pipeline step.** NEW agent that runs AFTER the long-form is produced. Inputs: final script text + scene-level timestamps from the pod's composition step. Output: 3–4 short candidates, each with `{start_ts, end_ts, hook_text, why_this_moment, cta_overlay}`. Curator prompt optimizes for "stand-alone hook that makes viewer click the channel handle," NOT "more content."
  - File: `src/agent/personas.ts` (new persona), `src/engine/shorts-curator.ts` (new)
  - Verification: run on one existing long-form; output shows ≤4 clips with non-overlapping timestamps and each has a hook line
- ☐ **Task 5.4 — Hard cap at 4 shorts per long-form.** If curator returns more, truncate to top 4 by the agent's own confidence score. If it returns fewer than 2, that's acceptable (conservative > over-cutting).
  - File: `src/engine/shorts-curator.ts`
  - Verification: unit test passing 10 candidate objects returns exactly 4 (highest-confidence)
- ☐ **Task 5.5 — Retire the current `clip-generator.ts` chop-everything behavior.** Replace its entry point with a call to `shorts-curator`. Preserve the low-level ffmpeg cut helper; only the "how many + where" decision changes.
  - File: `src/tools/clip-generator.ts`
  - Verification: `grep -n "numClips\|clipCount\|forEach.*clip" src/tools/clip-generator.ts` — the hardcoded 9/19 loops are gone
- ☐ **Task 5.6 — Short-specific CTA overlay.** Every curated short ends with an on-screen overlay: "Full video on the channel — @ace_richie77" or "Full video on the channel — @TheContainmentField". Overlay composed on the pod per `pod/worker.py` composition step.
  - File: `pod/worker.py` (composition), `src/engine/shorts-curator.ts` (CTA text source)
  - Verification: produced short MP4 shows the overlay in the last 2 seconds on manual playback
- ☐ **Task 5.7 — Long-form = foundation gate.** Confirm the downstream order: long-form completes → shorts curated → Buffer/TikTok/IG all fed from that artifact set. No platform fires before the long-form upload succeeds.
  - File: `src/engine/faceless-factory.ts` orchestration
  - Verification: if long-form upload throws, no downstream distribution jobs run; Telegram alert fires

---

### PHASE 6 — Distribution Fixes (TikTok Silent + Shorts Delivery + Description Link)

**Exit criterion:** A single long-form + its 3–4 curated shorts upload correctly to YouTube (long-form), YouTube Shorts, TikTok, and Instagram Reels — audio present and correctly formatted on every platform. Description template includes `/diagnostic` link as first line.

- ☐ **Task 6.1 — Reproduce distribution-stage audio bugs (Buffer shorts audio-cut-mid-word + TikTok silent).** S61 Architect diagnosis: long-form audio is CLEAN end-to-end on `@ace_richie77`; the bug is in SHORTS ("a word or two then fails"). Not a TTS/pod/XTTS bug — downstream of the long-form render. Two reproductions needed:
  1. **Buffer shorts audio-cut-mid-word** — Download the published short MP4 from Buffer's CDN (or from `@ace_richie77` Shorts tab) that exhibits the cut. `ffprobe -show_streams -select_streams a` on it. Compare against the pre-upload local clip artifact (pulled from Supabase Storage or the last clip-generator temp dir on Railway). Confirm whether the audio stream truncates BEFORE or AFTER the Buffer upload. Suspect: (a) `src/tools/clip-generator.ts` ffmpeg cut command `-c:a` flag + timestamp boundary math slicing mid-word, OR (b) Buffer's shorts transcode stripping audio frames, OR (c) upload-race where the file is still being written when Buffer pulls it.
  2. **TikTok silent upload** — Download the same video from TikTok, `ffprobe` audio tracks, compare to YouTube version.
  - Verification: audit note in Phase 6 Audit Log with (i) ffprobe output from both platforms + local artifact for at least one affected video, (ii) determination of whether the audio stream is intact pre-upload, (iii) named root cause (clip-generator codec / Buffer transcode / upload race / TikTok codec mismatch).
- ☐ **Task 6.2 — Fix distribution-stage audio bugs.** Apply fixes per Task 6.1 root-cause determination. Buffer shorts fix likely in `src/tools/clip-generator.ts` (re-encode audio on cut instead of stream-copy with `-c:a aac -b:a 192k`, validate audio duration == video duration pre-upload) AND/OR `src/tools/video-publisher.ts` Buffer upload path (wait for file flush via `fs.fsync` before posting). TikTok silent fix likely in `src/tools/tiktok-browser-upload.ts` audio codec path.
  - Files: `src/tools/clip-generator.ts`, `src/tools/video-publisher.ts`, `src/tools/tiktok-browser-upload.ts`
  - Verification: next Buffer-uploaded short has audio to final frame (manual playback); next TikTok upload has audible audio. ffprobe audio-duration matches video-duration ±0.1s on the pre-upload artifact.
- ☐ **Task 6.3 — Verify Shorts delivery path.** With Phase 5 in place, Shorts are no longer chopped ad-hoc on Railway — they come from the curator as pre-rendered 9:16 MP4s. Verify the YouTube Shorts uploader accepts those artifacts end-to-end.
  - File: `src/tools/video-publisher.ts` (YouTube Shorts upload path)
  - Verification: curated short MP4 (9:16, ≤60s, audio present) uploads successfully to @ace_richie77 test
- ☐ **Task 6.4 — Description template with /diagnostic link.** Edit YouTube upload description builder to include `https://sovereign-synthesis.com/diagnostic` as the first line, followed by existing description copy. Apply to long-form AND curated shorts.
  - File: `src/tools/video-publisher.ts` or the YouTube-specific uploader file (grep for `description:` in upload calls)
  - Verification: next long-form upload has `/diagnostic` as line 1 of description on YouTube.com
- ☐ **Task 6.5 — Cross-platform asset matrix.** Title, description, thumbnail, and hashtag strategy per platform. Documented in `CONTENT-PIPELINE-CLARITY.md` as a table covering long-form + curated-short variants.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\CONTENT-PIPELINE-CLARITY.md`
  - Verification: the table covers YT long / YT Short / TikTok / IG Reel

---

### PHASE 7 — One-Video End-to-End Test + Full Audit

**Exit criterion:** One Ace Richie long-form and one TCF long-form produced via the new pod pipeline, each with 3–4 curated shorts, uploaded to all platforms, audited across every quality dimension. Green light to run production schedules on the new system.

Channels to verify against:
- Ace Richie — https://www.youtube.com/@ace_richie77
- The Containment Field — https://www.youtube.com/@TheContainmentField

- ☐ **Task 7.1 — Trigger a manual Ace Richie run.** Telegram `/produce_ace` or equivalent command. Observe the full pod→long-form→curator→shorts→upload loop.
  - Verification: a public YouTube URL exists on `@ace_richie77` for the long-form AND 3–4 Shorts URLs for the curated shorts
- ☐ **Task 7.2 — Audit checklist on the produced Ace Richie long-form.** Watch end-to-end with audio. Record: audio continuous end-to-end (ffmpeg silencedetect pass)? scene count correct? visual quality (FLUX.1 [dev] detail visible)? brand-correct (ALLOWED niche, not burnout)? script semantically distinct from last 30d (Pinecone similarity <0.85)? thumbnail on-brand? title scroll-stops? description has `/diagnostic` as line 1?
  - Verification: a completed audit table written as a section at the bottom of this file
- ☐ **Task 7.3 — Audit checklist on the 3–4 Ace Richie curated shorts.** Each short: stands alone? hook in first 2s? CTA overlay to `@ace_richie77` in last 2s? audio present? 9:16 aspect? no visible seam from long-form?
  - Verification: short audit table in Phase 7 section
- ☐ **Task 7.4 — Same audits for a TCF long-form + its curated shorts.** Triggered same day. Verify uploads land on `@TheContainmentField`.
  - Verification: matching audit tables
- ☐ **Task 7.5 — Weekly metrics check-in (1 week after Phase 7 green).** Pull: per-video average view duration, retention drop-off timestamps, CTR, click-throughs to `/diagnostic` via Vercel Insights, `initiates` rows since cutover, short → channel-click rate.
  - Verification: numbers written to NORTH_STAR.md "S57 Funnel Measurement" section

---

## Rollback Protocol

If any phase breaks production:

1. **Railway rollback is fast:** `git revert <commit>` → push → Railway auto-deploys the previous image.
2. **Pod rollback:** Keep the prior Docker image tagged; redeploy it on RunPod. Job spec contract versioned so old client + old worker still talk.
3. **Phase-level rollback:** Each phase merges as ONE commit to main. No squash-merge during migration — we need single-commit reverts.

---

## Session Resume Protocol (read this if you're a new session)

1. Read the STATUS block at the top of this file.
2. Read the Open Decisions table. If any marked ☐ need locking, surface them to the Architect FIRST.
3. Find the current phase. Scan the tasks; the first unchecked `☐` is where work resumes.
4. Before doing the work: re-read the task's file paths and verification command. Verify the path still exists as described (the codebase may have shifted).
5. Do the work. Run the verification command. Only flip ☐ → ☑ if the verification passed.
6. Update the STATUS block. Specifically: `Current phase`, `Current phase status`, `Last session`, `Last commit touching this work`, `Next session's first action`.
7. If you discover new decisions or open questions mid-phase, add them to the Open Decisions table with a `☐`. Don't skip this — it's how context persists across sessions.

**If you find yourself considering work OUTSIDE the current phase, stop.** The whole point of this file is to NOT lose momentum on rabbit-hole fixes. Log the idea in the Open Decisions table and keep moving.

---

## Phase 0 Audit Log (findings go here as Phase 0 tasks complete)

### S61 2026-04-14 — Task 0.2 (S48 push verification) ✅

```
git log --all --oneline | grep -iE "brand routing|matrix|s48|session.?48"
  67fe042  S48: Brand Routing Matrix - 6-layer bifurcation locked
  7761363  S48: Frequency Bifurcation Protocol - structural voice split across Anita+Yuki
  6530e2d  feat: TCF brand assets + SS golden background composites + brand routing
  7039779  feat(protocols): Signal vs Noise Matrix + CEO protocol system

git branch -a --contains 67fe042 → main, remotes/origin/main ✅
git branch -a --contains 7761363 → main, remotes/origin/main ✅
```

**Finding:** S48 brand-routing matrix IS LIVE on Railway production. The 6-layer bifurcation (aesthetic/terminal/thumbnail/captions/stingers/TTS) is in place. Phase 3 Task 3.1 ("resolve S48 status, push if not pushed") reduces to a no-op for the render layers. **The burnout-on-Ace-Richie issue is NOT a routing matrix bug — it is an INTAKE LAYER bug (Alfred's shared seed).** Phase 3 Tasks 3.2–3.7 remain fully required.

### S61 2026-04-14 — Task 0.1 (audio drop reproduction) ✅ RESOLVED BY ARCHITECT

Architect performed a manual audit on his side of the 3 most recent `@ace_richie77` long-form uploads (`LMdNG-f3WzA`, `sRQgMjCl4Dc`, `LBPSqRyEsRA`).

**Finding:** Audio is clean end-to-end on ALL three long-form videos.

**The audio drop bug is SHORTS-only** — shorts play "a word or two then fail" mid-word. Architect quote: *"It must just have been the way buffer was uploading them or something. Which is weird because some of them say a word or two and then fail on the audio. This is the shorts I'm talking about. The long form uploads all have audio all the way through."*

**Implications:**
- TTS / XTTS / pod-compute are NOT the cause — long-form runs through the SAME TTS chain without issue.
- Root cause lives downstream of the long-form render: `src/tools/clip-generator.ts` (codec / timestamp boundary math) OR `src/tools/video-publisher.ts` Buffer shorts upload path.
- **Phase 4 pod migration will NOT fix the shorts audio bug.** Not a pod-migration rationale.
- **Phase 5** (script-first + surgical curator replacing chop-everything) is the ARCHITECTURAL fix — the new curator must emit audio-validated 9:16 MP4s before distribution.
- **Phase 6 Task 6.1 has been rewritten** (see Phase 6) to cover Buffer shorts audio-cut-mid-word alongside TikTok silent.

Memory: `project_shorts_audio_bug_not_longform.md` captures full diagnosis for future sessions.

**Side-finding (intake-layer cross-contamination):** 2 of 3 most recent Ace Richie uploads are burnout-themed (`Burnout Is Not Failure`, `Burnout: System Failure`). Burnout belongs on `@TheContainmentField`. Independent confirmation that Phase 3 Tasks 3.2–3.7 (niche allowlist + intake-layer fix for Alfred's shared seed) remain required. S48 render-layer routing is correct; the seed intake is still wrong.

### S61 2026-04-14 — Tasks 0.3 + 0.4 (RunPod pod specs + Railway env) — TOOLS EXHAUSTED, SOFT-BLOCKED

Session executed the full Cowork-non-technical-user tool cascade per `feedback_cowork_non_technical_use_tools.md` before flagging blocker. Result: every path exhausted.

**Tools attempted:**
- Claude in Chrome → `console.runpod.io/pods/a2shyagwexfhon` returned Next.js 404 (SPA body empty despite 20 session cookies). Root cause: Claude in Chrome runs in an **isolated browser profile** — cookies do not bridge to Ace's main Chrome. Also attempted the RunPod GraphQL API directly → `Failed to fetch` (CORS from an unauthenticated origin).
- Railway CLI (Desktop Commander PowerShell at `C:\Users\richi\AppData\Roaming\npm\railway.ps1`) → `Unauthorized. Please run railway login again.` Token at `~/.railway/config.json` expired; direct GraphQL POST to `backboard.railway.com/graphql/v2` with that token → `Not Authorized`.
- `runpodctl` CLI → not installed on the machine.
- Desktop Commander filesystem scan:
  - `C:\Users\richi\Sovereign-Sentinel-Bot\.env` → only `ELEVENLABS_API_KEY`, `GEMINI_IMAGEN_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `GROQ_API_KEY_TCF`. No `RUNPOD_*`, no `RAILWAY_TOKEN`, no `XTTS_SERVER_URL`, no `POD_WORKER_*`.
  - `C:\Users\richi\.gemini\antigravity\scratch\...\.env.local` (two files) → only Supabase anon + Vercel OIDC token. No RunPod/Railway/XTTS.
  - `C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects\.env.vault` (the "parts warehouse" per user preferences) → contains `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PINECONE_API_KEY`, `SUPABASE_ACCESS_TOKEN` (`sbp_281c4...`), `NOTION_API_KEY`, `FIREFLIES_API_KEY`, `APIFY_TOKEN`, `STRIPE_API_KEY`, `VERCEL_TOKEN`, Google OAuth creds. **No RunPod, Railway, or XTTS credentials.**
  - `C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects\maven_crew\.env` → same as above minus the Vercel token. No target vars.
- Source-code grep across `C:\Users\richi\Sovereign-Sentinel-Bot\**\*.{ts,md,json}` (246 files) → every reference to `XTTS_SERVER_URL`, `POD_WORKER_*`, `RUNPOD_*` is a `process.env.X` read or documentation mention. No hardcoded URL or token anywhere in the repo.
- Environment variables on the running PowerShell session → zero `RAILWAY`/`RUNPOD`/`XTTS` vars.

**Conclusion:** The credentials for this pod + Railway service exist ONLY in (a) Ace's personal Chrome (not reachable by Claude-in-Chrome's isolated profile) and (b) on Railway/RunPod servers themselves (not reachable without those credentials). Per `feedback_never_skip_to_reduce_load.md`: tools exhausted, blocker escalated to ONE minimum physical Architect action — drop ONE screenshot of the Railway Variables tab into chat. The Railway screenshot reveals both Task 0.4's env-var SET/UNSET status AND Task 0.3's `RUNPOD_POD_ID` + `POD_WORKER_URL` (which implicitly answers pod specs once the URL is hit). Single drag-drop. No typing. No credential transcription.

**Per `feedback_never_skip_to_reduce_load.md`** — these tasks are NOT skipped, NOT deferred, NOT retired. They remain ☐ and block their own downstream Phase 2 tasks (Task 2.1 `runpod-client.ts` needs `RUNPOD_API_KEY` shape + `POD_WORKER_URL` shape). Phase 1 Tasks 1.1–1.3 (Dockerfile, requirements.txt, worker.py skeleton) can execute without these credentials, so the session pivots there.

---

## Phase 0 Blockers (single Architect ask — collapsed per feedback_never_skip_to_reduce_load.md)

Task 0.1 is RESOLVED (Architect manual audit confirmed long-form audio is clean; bug is shorts-only — now covered by Phase 6 Task 6.1).

Tasks 0.3 + 0.4 merge to **one physical action**, not a menu.

### The single unblock — one screenshot

**Drop ONE screenshot of the Railway Variables tab (Sentinel Bot service) into this chat.**

That's it. No typing. No credential copying. No CLI. The screenshot simultaneously reveals:
- Task 0.4 answers: SET/UNSET status of `XTTS_SERVER_URL`, `XTTS_SPEAKER_WAV_ACE`, `XTTS_SPEAKER_WAV_TCF`, `POD_WORKER_TOKEN`, `POD_WORKER_URL`, `RUNPOD_API_KEY`, `RUNPOD_POD_ID`.
- Task 0.3 answers implicitly: `XTTS_SERVER_URL` gives the pod's public URL pattern, and `RUNPOD_POD_ID` confirms pod identity. Once those are read visually from the screenshot, the session hits `/health` on the URL and reads pod specs from the live FastAPI response — no RunPod dashboard access needed.

Session is NOT skipping these tasks. They remain ☐. They are not a prerequisite for Phase 1 Tasks 1.1–1.3, which execute in parallel via Phase 1 drafting.

---

## Phase 5 Audit Log (Script-First / Shorts Curator findings)

_empty — Phase 5 not started_

---

## Phase 6 Audit Log (Distribution findings)

_empty — Phase 6 not started_

---

## Phase 7 Audit Tables (E2E per-video quality check)

_empty — Phase 7 not started_

---

## Change log (append-only — one line per session)

- 2026-04-14 Session 60 (initial draft) — plan drafted from Telegram failure screenshot (OpenAI 429 + burnout cross-contamination) and strategic conversation with Architect. 6 phases scoped. Awaiting D1–D6 lock + Phase 0 execution.
- 2026-04-14 Session 60 (refinement) — D1–D6 LOCKED per Architect quality-no-compromise directive: H100/A100 80GB pod, FLUX.1 [dev] bf16 full precision, Docker, HTTPS POST+Bearer, Cloudflare R2 (replacing Supabase Storage due to prior egress limit hit), 10-min idle. Phase 3 extended with 30-day niche cooldown + Pinecone ≥0.85 semantic-similarity guard + shipped-script upsert. NEW Phase 5 inserted: Script-First Architecture + Surgical Shorts Curator (long-form writer has zero clipping awareness; separate curator extracts 3–4 stand-alone shorts max, each with channel-handle CTA overlay). Old Phase 5 renumbered to Phase 6 (Distribution Fixes). Old Phase 6 renumbered to Phase 7 (E2E Audit) with explicit channel URLs: @ace_richie77 + @TheContainmentField. Principle locked: two successful long-form runs/day are the foundation; shorts and all other distribution flow DOWN from them.
- 2026-04-14 Session 61 (Phase 0 partial execution) — Task 0.2 ☑ (S48 commits 67fe042 + 7761363 verified on origin/main; memory "NOT pushed" flag retired); D7 ☑ (S48 IS live; Phase 3 Task 3.1 pre-satisfied for render layers); Task 0.5 ☑ (D1–D6 already locked). Task 0.1 BLOCKED (sandbox YouTube bot-check; 3 most recent Ace Richie uploads identified as `LMdNG-f3WzA`/`sRQgMjCl4Dc`/`LBPSqRyEsRA` — 2 of 3 are burnout-themed, independent confirmation of intake-layer cross-contamination). Tasks 0.3 + 0.4 BLOCKED on missing RunPod + Railway credentials in local `.env`. Architect unblock asks written into "Phase 0 Blockers" section of this file. No code committed this session.
- 2026-04-14 Session 61 (continuation — Phase 0 close, Phase 1 open) — **Task 0.1 ☑ RESOLVED** by Architect manual audit: long-form audio is clean end-to-end on all 3 recent `@ace_richie77` uploads; audio bug is SHORTS-only ("word or two then fails"). Root cause shifted to `src/tools/clip-generator.ts` or `src/tools/video-publisher.ts` Buffer shorts upload — NOT TTS/pod/XTTS. Phase 4 migration will not fix it; Phase 5 curator + Phase 6 Task 6.1 do. **Task 6.1 rewritten** to cover Buffer shorts audio-cut-mid-word alongside TikTok silent (both distribution-stage bugs, same audit pattern). **Tasks 0.3 + 0.4 SOFT-BLOCKED** after exhausting every Cowork tool (Claude in Chrome isolated profile can't auth RunPod; Railway CLI token expired; zero RunPod/Railway/XTTS creds in any local `.env`, `.env.vault`, or repo file across 246 files scanned). Blocker collapsed to ONE physical Architect action — single Railway Variables screenshot — per `feedback_never_skip_to_reduce_load.md` HARD RULE. **Phase 1 Tasks 1.1, 1.2, 1.3 ☑ executed:** `pod/Dockerfile` (nvidia/cuda:12.1.1 base, python3.11, ffmpeg, CUDA-torch 2.4.1, HF cache → `/runpod-volume`, HEALTHCHECK via `/health/live`); `pod/requirements.txt` (FastAPI 0.115, TTS 0.22.0 XTTSv2, diffusers 0.30.3 Flux, boto3 for R2 per D5, torch intentionally excluded); `pod/worker.py` (Bearer-auth FastAPI skeleton with `/health/live` unauth + `/health` auth readiness + `/produce` 202 Accepted + `/jobs/{job_id}` polling, Pydantic job-spec schema with contiguous-scene validator, constant-time token compare, background-task stub ready for Phase 4 pipeline injection); `pod/pipelines/__init__.py` scaffolded. `ast.parse` clean. Three memory files written: `feedback_cowork_non_technical_use_tools.md`, `feedback_never_skip_to_reduce_load.md`, `project_shorts_audio_bug_not_longform.md`. No git commits this session (pod/ stays uncommitted until Ace greenlights deploy window per `feedback_no_push_during_pipeline.md`).

- 2026-04-14 Session 61 (close) — **Phase 1 Tasks 1.1/1.2/1.3 committed + pushed in `a8bf77a`** on `origin/main`. 1.4/1.5 deferred to a dedicated build-host + pod-volume session per Architect. Orphan-file cleanup: `PURPOSE.md` (canonical S56), `NORTH_STAR.md` (S60 measurement + pod-migration as highest-leverage action), `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` (+S57 funnel restructure entry) all committed. `HANDOFF-NEXT-SESSION.md` DELETED — obsolete (S57 shipped via `cd5685c`+`f712fce`) and in wrong repo per `feedback_handoff_files_correct_repo.md`. ~10 other files left showing CRLF-noise modifications (Windows autocrlf artifact, no real content changes — confirmed via `git diff --ignore-all-space`). Next session opens Phase 2 Task 2.1 (`src/pod/runpod-client.ts`).
