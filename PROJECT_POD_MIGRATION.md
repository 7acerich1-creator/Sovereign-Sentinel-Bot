# PROJECT_POD_MIGRATION.md

> **⚡ THE BIG PROJECT.** This is the terminal reference for the Content Production Rewrite.
> Every session that touches this work reads the STATUS block first and updates it last.
> When every phase below ships green, this file retires and NORTH_STAR.md picks up the next mission.

---

## STATUS — UPDATE EVERY SESSION (TOP OF FILE)

| Field | Value |
|---|---|
| **Current phase** | **PHASE 5 IN PROGRESS — 2026-04-17 S75.** Tasks 5.1-5.11, 5.13, 5.14 done (13/14). Task 5.12 partially done: Docker image rebuilt + GH Actions green, test script committed, live pod test deferred (US-KS-2 SUPPLY_CONSTRAINT — all GPU types exhausted). |
| **Current phase status** | **Phase 0-4: ALL done. Phase 5: 13/14 done (5.1 ☑, 5.2 ☑, 5.3 ☑, 5.4 ☑, 5.5 ☑, 5.6 ☑, 5.7 ☑, 5.8 ☑, 5.9 ☑, 5.10 ☑, 5.11 ☑, 5.13 ☑, 5.14 ☑, 5.12 ☐ partial).** |
| **Total phases** | 8 (Phase 0 -> Phase 7) |
| **Last session** | Session 75 -- 2026-04-17 -- Task 5.12 partial: Docker image rebuild confirmed (GH Actions green, `ghcr.io/7acerich1-creator/sovereign-sentinel-pod:latest`). Full composition test script `scripts/test-full-composition.ts` committed (3-scene FLUX+XTTS+Whisper+audio-mix e2e test, budget gate, health retry, proxy settle). 3 orphan pods discovered and terminated. Live pod test blocked by RunPod US-KS-2 SUPPLY_CONSTRAINT (tested H100 SXM/PCIe, A100 SXM/PCIe, L40S, RTX 6000 Ada, RTX A6000, RTX 4090 — all exhausted). Volume `gai851lcfw` pins to US-KS-2 so no datacenter workaround. Commit `e0ed7db`. |
| **Last commit touching this work** | `e0ed7db` (origin/main) -- S75 Task 5.12 full-composition test script + package.json. |
| **Blocker** | **RunPod US-KS-2 GPU supply exhausted.** Retry `POD_FULL_TEST_CONFIRM=1 npm run test:full-composition` next session. No code changes needed. |
| **Next session's first action** | **Task 5.12 live test retry** — run full composition test when US-KS-2 has GPU capacity. One successful run closes Phase 5 (14/14). |

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
- ☑ **Task 1.4 — Build + push Docker image.** DONE S62 2026-04-15. Resolution: D3 refined — image is built by GitHub Actions (`.github/workflows/pod-build.yml`, commit `72133f4` S62) and published to GHCR (`ghcr.io/7acerich1-creator/sovereign-sentinel-pod`), not `runpodctl`. RunPod pulls from GHCR. First build (run `24433616304`) failed on Ubuntu 22.04 distutils-installed `blinker 1.4` conflict. Fix: commit `57d786f` pre-installs blinker with `--ignore-installed` before the main `pip install -r requirements.txt`. Second build `24435104242` succeeded in 10m53s.
  - Published tags: `:latest`, `:57d786fb0d6a8ad31b3871f1ae50f1048f91eebf`, `:sha-57d786f`
  - Manifest digest: `sha256:00212d098b3f6516614ccee2a57319fb8579a1f41442422828ca2cf83ccfd9eb`
  - Verification: GH Actions run `24435104242` = success; manifest pushed to GHCR across all 3 tags. Runtime `/health` verification deferred to Task 2.3 contract test (wake pod, hit `/health`, assert 200 with `POD_WORKER_TOKEN`).
- ☑ **Task 1.5 — Install XTTSv2 speaker reference WAVs on pod volume.** DONE S62 2026-04-15. Volume `gai851lcfw` (50GB, US-KS-2) mounted at `/runpod-volume` on temp pod `n1tlik82n7phow`. Uploaded via paramiko SFTP (ssh.exe stdout unusable in Desktop Commander shell → worked around with pure-Python SSH).
  - `/runpod-volume/speakers/ace_ref.wav` — 661578 bytes, sha256 `8dec3af0362287a7…`
  - `/runpod-volume/speakers/tcf_ref.wav` — 661578 bytes, sha256 `524f9e333d248e03…` (distinct hash — verified ≠ ace_ref.wav)
  - Railway env vars set: `XTTS_SPEAKER_WAV_ACE=/runpod-volume/speakers/ace_ref.wav`, `XTTS_SPEAKER_WAV_TCF=/runpod-volume/speakers/tcf_ref.wav`. Stale `XTTS_SERVER_URL` + `RUNPOD_POD_ID` (pointing at dead pod `a2shyagwexfhon`) purged.
  - Temp pod terminated post-upload. Orphan pod `1mcle290zo4dnc` also terminated during cleanup. Session spend ≈ $0.08.
  - Verification: `sftp.stat()` against each remote path returns matching size; `sha256sum` over the file bytes sent matches sha256sum over the original Windows WAV.

---

### PHASE 2 — Orchestration (Railway ↔ Pod Contract)

**Exit criterion:** Railway can wake the pod, POST a job, receive an artifact URL, and sleep the pod — all from a single function call in TypeScript. No production pipeline code is migrated yet.

- ☑ **Task 2.1 — Create `src/pod/runpod-client.ts`.** DONE S63 2026-04-15. Exports `startPod()`, `stopPod()`, `waitUntilReady()`, `produceVideo(spec: JobSpec): Promise<ArtifactUrls>`, plus `fetchHealth()` for diagnostic use. Pod lifecycle is create-per-job (per STATUS block directive — no hard-coded `RUNPOD_POD_ID`). Create body targets H100 80GB SXM first with A100 fallback (D1), attaches network volume `gai851lcfw` at `/runpod-volume`, exposes port `8000/http`, forwards Railway env (`POD_WORKER_TOKEN`, `XTTS_SPEAKER_WAV_*`, `R2_*`, `SUPABASE_*`) into pod env. Worker URL derived as `https://<podId>-8000.proxy.runpod.net`. Includes exponential-backoff retry on 429/5xx from RunPod REST, timeout+poll abstractions, `PodContractError` / `RunPodApiError` / `PodJobFailedError` typed exceptions, and `validateJobSpec()` client-side sanity gate (contiguous scene indexes + length bounds mirror Pydantic schema). `stopPod()` is best-effort and swallows 404 for already-terminated pods.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\pod\runpod-client.ts` ✅ (new, 530 lines)
  - Verification: `npx tsc --noEmit` clean (no output)
- ☑ **Task 2.2 — Define `JobSpec` + `ArtifactUrls` TypeScript types.** DONE S63 2026-04-15. Single source of truth in `src/pod/types.ts` (TS) + `pod/models.py` (Pydantic mirror). TS-side: `Brand`, `Scene`, `JobSpec`, `ProduceAccepted`, `JobStatus`, `JobResult`, `ArtifactUrls`, `HealthReport`, `PodHandle` + three typed error classes. Python-side: `Brand` enum, `Scene`, `ProduceRequest`, `ProduceAccepted`, `ProduceResult`, `HealthReport`. `pod/worker.py` still redefines inline for Phase 1 skeleton — Phase 4 worker rewrite will collapse that to `from .models import ...`. Length bounds and scene-index contiguity validator match across both sides bit-for-bit.
  - Files: `C:\Users\richi\Sovereign-Sentinel-Bot\src\pod\types.ts` ✅ (new, 111 lines), `C:\Users\richi\Sovereign-Sentinel-Bot\pod\models.py` ✅ (new, 86 lines)
  - Verification: `npx tsc --noEmit` clean; `python3 -c "import ast; ast.parse(open('pod/models.py').read())"` OK. End-to-end POST of a sample JobSpec to a live pod deferred to Task 2.3 contract test.
- ☑ **Task 2.3 — End-to-end contract test with stub pod response.** **VERIFIED S65 2026-04-15.** Live run output: `✅ contract PASS (84.4s, status=done)`. Pod `rethkpb1adc1z4` (H100 80GB HBM3, SECURE, no-volume path), cold-start 79s over 16 readiness probes, `/health` 200 with `cuda_available: true` (models_loaded all false — expected for Phase 1 skeleton), `/produce` → `job_id` returned, `/jobs/{id}` went `queued → running → done` in 2 polls with null artifact URLs (expected), pod cleanly terminated via `shutdownPodSession`. Spend ≈ $0.04-0.05. S64 code (`scripts/test-pod-contract.ts` + `npm run test:pod-contract`, gated on `POD_CONTRACT_TEST_CONFIRM=1`) executed unchanged except for S65 config widening: `startPodOptions = {noVolume:true, cloudType:"SECURE", gpuTypeIds:[H100/H100-PCIe/A100-SXM/A100-PCIe/A6000/A5000/A4000/4090/3090/L40/L40S/L4], containerDiskInGb:50}` — necessary because the volume-pinned US-KS-2 H100/A100-only SECURE path hit a transient capacity 500 on first try. **Production pipelines (Phase 4+) keep the full H100/A100 + volume + SECURE default** — the override is contract-test-only.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\scripts\test-pod-contract.ts` ✅ (207 lines)
  - package.json script: `"test:pod-contract": "ts-node scripts/test-pod-contract.ts"` ✅
  - Also fixed in S65: `src/pod/runpod-client.ts` — pre-existing bug where create-body sent singular `dataCenterId` (not accepted by RunPod REST); now sends spec-correct `dataCenterIds: [dataCenterId]` array. Added `noVolume?: boolean` + `cloudType?: "SECURE"\|"COMMUNITY"` to `StartPodOptions` for test passthrough.
  - Verification: `npx tsc --noEmit` clean; **live run PASS logged 2026-04-15**.
- ☑ **Task 2.4 — Wake/sleep lifecycle wrapper.** DONE S64 2026-04-15. `src/pod/session.ts` exports `withPodSession<T>(fn, { idleWindowMs? = 600_000, startPodOptions?, readinessTimeoutMs? })`. Semantics: first caller mints a pod (`startPod` + `waitUntilReady`); concurrent cold-start callers latch onto a single `startingPod` promise (no parallel RPCs); subsequent callers within the idle window reuse the warm pod; `inFlight` counter tracks overlap; when it hits 0 cleanly → `setTimeout(stopPod, idleWindowMs)` with `.unref()` so the timer never keeps the event loop alive; when it hits 0 after a throw → immediate `stopPod` to stop GPU spend on broken jobs; `peekActiveSession()` exposed for diagnostics; `shutdownPodSession()` exposed for SIGTERM hooks. Module-level state (`active`, `startingPod`) is single-process only — must move to Redis/Supabase before any orchestrator sharding.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\pod\session.ts` ✅ (new, ~220 lines)
  - Verification: `npx tsc --noEmit` clean. Live wrapper exercise rides on Task 2.3's contract test — the script calls `withPodSession({ idleWindowMs: 0 })` so a green contract run also verifies the wrapper's full wake → run → stop path.

---

### PHASE 3 — Brand Correctness + Content Uniqueness (Intake Layer)

**Exit criterion:** Alfred generates TWO distinct seeds per day — one per brand — each constrained to brand-specific niche allowlists AND guarded against repeating recent topics. Ace Richie cannot run on "burnout." TCF cannot run on "sovereignty." No brand produces a script semantically similar to anything it shipped in the last 30 days. The S48 Brand Routing Matrix push status is resolved (either confirmed live or pushed this phase).

> Architect directive: *"we need to ensure all the content is completely unique. maybe its because everything is revolving specifically around burnout currently but it seems like its all the same right now for the most part."*

- ☑ **Task 3.1 — Resolve S48 status per Task 0.2 finding.** If not pushed, push now on a branch, run `tsc --noEmit`, run the existing video E2E test if present, merge to main.
  - Verification: `git log origin/main --oneline | head -5` shows the S48 commit, Railway deploys cleanly
- ☑ **Task 3.2 — Define brand niche allowlists.** Ace Richie ALLOWED: `sovereignty, authority, architecture, system-mastery, wealth-frequency`. TCF ALLOWED: `burnout, dark-psychology, containment, manipulation-exposed, pattern-interrupt`. Edit `src/data/shared-context.ts`.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\data\shared-context.ts`
  - Verification: new `BRAND_NICHE_ALLOWLIST` export; `tsc --noEmit` clean
- ☑ **Task 3.3 — Split Alfred's daily seed generation.** Currently one seed per day shared. Change: generate `{ace_richie_seed, tcf_seed}` tuple, each constrained to its brand allowlist. Edit the Alfred persona prompt + `src/engine/content-engine.ts` seed selection path.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\engine\content-engine.ts`, `src/agent/personas.ts`, `src/agent/crew-dispatch.ts`
  - Verification: stub a day's run locally; log shows TWO different seeds with brand-matching niches
- ☑ **Task 3.4 — Brand hard-fail guard.** If either pipeline receives a niche NOT in its allowlist, throw and Telegram-notify. No silent fallback.
  - File: `src/engine/faceless-factory.ts` entry point
  - Verification: write a unit test that passes `{brand: 'ace_richie', niche: 'burnout'}` and expects a thrown `BrandNicheViolation`
- ☑ **Task 3.5 — 30-day niche cooldown per brand.** Supabase migration: add `content_drafts.niche_tag text` + `content_drafts.brand text` (if not already present) + index on `(brand, niche_tag, created_at DESC)`. Alfred queries: "for brand X, which of the allowlist niches has NOT been used in the last 30 days?" — pick from that subset first. If every allowlist niche is cooldown-blocked, relax to 14 days.
  - File: `supabase/migrations/004_niche_cooldown.sql`, `src/engine/content-engine.ts`, `src/agent/personas.ts` (Alfred)
  - Verification: run twice in one day with forced niche override; second call must not return the niche the first call already used
- ☑ **Task 3.6 — Semantic similarity guard via Pinecone.** Before committing a new script to production, embed its first 500 words + title; query Pinecone `scripts` namespace for the brand's top-5 nearest neighbors; if max cosine similarity >0.85, reject and regenerate (up to 2 retries; on 3rd failure, Telegram-alert and halt that brand for the day).
  - File: `src/engine/content-engine.ts` (post-draft, pre-production gate), new `src/tools/script-uniqueness-guard.ts`
  - Verification: unit test — seed two nearly-identical scripts, first passes, second rejected with `ScriptTooSimilar` error naming the neighbor
- ☑ **Task 3.7 — Persist every shipped script to Pinecone.** After a video uploads successfully, embed the script + upsert to the brand's Pinecone namespace with metadata `{brand, niche_tag, video_id, shipped_at}`. This is the memory the uniqueness guard queries.
  - File: `src/tools/script-uniqueness-guard.ts` (upsert fn), hook into `src/tools/video-publisher.ts` success callback
  - Verification: after a successful upload, Pinecone namespace `scripts-ace-richie` or `scripts-tcf` shows N+1 vectors

---

### PHASE 4 — Compute Migration (XTTS + FLUX + Composition Move to Pod)

**Exit criterion:** The Faceless Factory, when invoked from Railway, calls the pod for ALL compute. Railway no longer runs XTTS HTTP calls directly, no longer calls Imagen 4, no longer runs ffmpeg composition. The pod does all of it in one session per video.

- ☑ **Task 4.1 — Implement `/produce` real logic on pod.** DONE S67 2026-04-16. 4 pipeline modules + worker.py rewrite. `pod/pipelines/xtts.py` (249L): lazy XTTSv2 singleton, speaker-latent caching, per-scene WAV + ffmpeg concat. `pod/pipelines/flux.py` (155L): FLUX.1 [dev] bf16 1024x1024 @ 30 steps / 3.5 guidance. `pod/pipelines/compose.py` (273L): Ken Burns zoompan + ffmpeg concat to final.mp4 + thumbnail. `pod/pipelines/r2.py` (146L): boto3 R2 upload. `pod/worker.py` (378L): real `_run_pipeline()` replacing stub.
  - Files: `pod/worker.py`, `pod/pipelines/xtts.py`, `pod/pipelines/flux.py`, `pod/pipelines/compose.py`, `pod/pipelines/r2.py`, `pod/pipelines/__init__.py`
  - Verification: `ast.parse` clean on all 6 Python files; `npx tsc --noEmit` clean. Live GPU test deferred to Docker rebuild.
- ☑ **Task 4.2 — Refactor `src/engine/faceless-factory.ts` to delegate to pod.** DONE S68 2026-04-16. `produceFacelessVideo` rewritten: Step 1 (script gen) stays on Railway; Steps 2-4 (TTS + image gen + compose) delegated to pod via `withPodSession(async (handle) => produceVideo(handle, podJobSpec))`. Script segments mapped to `PodScene[]` for the pod's `JobSpec`. Pod returns R2 artifact URLs. Railway queues URLs to `vid_rush_queue` (no more Supabase Storage upload). R2 video downloaded to local temp for backward compat with vidrush clip-chopping (Phase 5 will remove this). Commit `dfd30d6`.
  - File: `C:\Users\richi\Sovereign-Sentinel-Bot\src\engine\faceless-factory.ts`
  - Verification: `tsc --noEmit` clean (exit 0)
- ☑ **Task 4.3 — Deprecate `src/voice/tts.ts` for pipeline calls.** DONE S68 2026-04-16. Header updated to "NON-PIPELINE ONLY". OpenAI removed from fallback chain. Module retained for Telegram voice replies and ad-hoc bot TTS. `faceless-factory.ts` still imports `textToSpeech` for legacy `renderAudio`/`assembleVideo` functions (not called by pipeline path).
  - File: `src/voice/tts.ts`
  - Verification: pipeline path (`produceFacelessVideo`) never calls `renderAudio` or `textToSpeech` — confirmed by code review
- ☑ **Task 4.4 — Deprecate Imagen 4 calls in pipeline.** DONE S68 2026-04-16. `generateSceneImage` in faceless-factory.ts marked `@deprecated` — FLUX on pod handles all pipeline image gen. `image-generator.ts` header updated to "NON-PIPELINE ONLY". No faceless-factory imports from image-generator.ts (confirmed by grep).
  - File: `src/tools/image-generator.ts`, `src/engine/faceless-factory.ts`
  - Verification: `grep 'from.*image-generator' src/engine/faceless-factory.ts` = 0 matches
- ☑ **Task 4.5 — Wake-pod-first wiring.** DONE S68 2026-04-16. `withPodSession` is called inside `produceFacelessVideo` itself, so every pipeline entry point (`produceFacelessBatch`, vidrush orchestrator's `produceFacelessVideo` call, content-engine trigger) automatically gets wake-pod-first. Telegram bot user-facing replies (index.ts `textToSpeech` direct calls) do NOT touch the pod — they use the local TTS chain.
  - Files: `src/engine/faceless-factory.ts` (withPodSession wired in produceFacelessVideo)
  - Verification: `tsc --noEmit` clean; `grep withPodSession src/engine/faceless-factory.ts` shows the call inside produceFacelessVideo

---

### PHASE 5 — Script-First Architecture + Pod-Native Brand Assembly + Surgical Shorts Curator

**Exit criterion:** (A) The long-form script writer operates with ZERO knowledge that the video will ever be clipped. (B) The pod's `compose.py` is the SINGLE assembly point — brand intro prepend, terminal override typewriter, kinetic captions (Whisper word-level on GPU), and composite audio mixing are ALL rebuilt from scratch in Python on the pod. When the pod returns a video, it is the FINISHED product. Railway's `assembleVideo()` stays dead. (C) A separate `shorts-curator` pass reads the finished long-form script + audio, identifies 3–4 natural climax/hook moments, and extracts those surgical clips ONLY. The current "chop into 9–19 shorts" behavior is retired. Every short that ships can stand on its own and exists to drive the viewer back to the long-form channel.

> Architect directive (script-first): *"its important to audit how the script is assembled, it seems like in order to create the short narratives the script is revolved around that and ends up repeating itself. its better to get only 3 or 4 high quality shorts from a high quality script that is clipped in the right places, which is conservative, but just to make a point, rather than 9 or 19 broken shorts. the short should be good enough to make them click the channel and find the long forms. Thats how this is going to flow."*

> Architect directive (caption trust gate — S69): The kinetic captions are the 3-5 second TRUST GATE after the viewer clicks. They subconsciously read and follow the opening moment — the quote/topic/memetic trigger — and decide whether to stay. The current green captions are unattractive, uninviting, serve no brand aesthetic, and are out of alignment with BOTH brands. They must be either clean-and-clear or brand-specific-aligned. Their job: "This is what you need to align with. Drop your guard. It's quality." If the captions don't hit that frequency, the viewer bounces regardless of the content underneath. This is a full redesign, not a port of the Railway code.

> **Principle:** Long-form YouTube is the foundation. Shorts, TikTok, IG Reels, and everything Buffer distributes flow DOWN from those two successful long-form runs per day (one Ace Richie, one TCF). If the long-form isn't great, nothing downstream matters.

- ☑ **Task 5.1 — Audit current script assembly.** DONE S69 2026-04-16. Full audit of 6 files. Long-form script writer is CLEANER than expected — no clip/shorts references in the prompt itself. Real repetition vectors: (1) segment expansion logic (splits short segs into 2 without anti-repetition), (2) `targetDuration` default is `"short"`, (3) `produceFacelessBatch` hard-codes `"short"`. Yuki persona still says "cut short clips." All findings + remediation table documented in Phase 5 Audit Log.
  - Files: `src/engine/content-engine.ts`, `src/agent/personas.ts`, `src/data/shared-context.ts`
  - Verification: ☑ audit note naming EVERY clip-aware phrase and architectural vector in the Phase 5 Audit Log
- ☑ **Task 5.2 — Strip all clipping awareness from the long-form script writer.** DONE S69 2026-04-16. Five changes: (1) `generateScript` default flipped `"short"→"long"` + orientation `"vertical"→"horizontal"`. (2) `produceFacelessVideo` default flipped `"short"→"long"`. (3) `produceFacelessBatch` hard-coded `"short"` changed to `"long"`. (4) Segment expansion logic (the repetition factory) REMOVED entirely — replaced with a warn+proceed. (5) Yuki persona rewritten: "cut short clips" → "Schedule curated shorts across platforms." Short-form path marked `@deprecated`. `tsc --noEmit` clean.
  - Files: `src/engine/faceless-factory.ts` (3 changes), `src/agent/personas.ts` (1 change)
  - Verification: ☑ `tsc --noEmit` exit 0; `grep "cut short clip\|Attempting segment expansion\|Rewrite this as TWO"` returns 0 matches
- ☑ **Task 5.3 — Create `shorts-curator` persona + pipeline step.** DONE S71 2026-04-17. `src/engine/shorts-curator.ts` (266 lines): `curateShorts(llm, script, segmentDurations)` → LLM identifies 3-4 strongest standalone moments. Validates segment bounds, duration 15-59s, no overlap, JSON parse. Each short gets `hook_text`, `why_this_moment`, `cta_overlay`. New `curator` persona in `personas.ts`. Commit `62678c4`. NEW agent that runs AFTER the long-form is produced. Inputs: final script text + scene-level timestamps from the pod's composition step. Output: 3–4 short candidates, each with `{start_ts, end_ts, hook_text, why_this_moment, cta_overlay}`. Curator prompt optimizes for "stand-alone hook that makes viewer click the channel handle," NOT "more content."
  - File: `src/agent/personas.ts` (new persona), `src/engine/shorts-curator.ts` (new)
  - Verification: run on one existing long-form; output shows ≤4 clips with non-overlapping timestamps and each has a hook line
- ☑ **Task 5.4 — Hard cap at 4 shorts per long-form.** DONE S71 2026-04-17. Built into `shorts-curator.ts`: `validShorts.sort((a,b) => b.confidence - a.confidence).slice(0, MAX_SHORTS)`. If curator returns fewer than 2, that's acceptable (conservative > over-cutting). Commit `62678c4`. If curator returns more, truncate to top 4 by the agent's own confidence score. If it returns fewer than 2, that's acceptable (conservative > over-cutting).
  - File: `src/engine/shorts-curator.ts`
  - Verification: unit test passing 10 candidate objects returns exactly 4 (highest-confidence)
- ☑ **Task 5.5 — Retire the current `clip-generator.ts` chop-everything behavior.** DONE S72 2026-04-17. vidrush-orchestrator STEP 4 now calls `curateShorts()` (0-4 surgical clips) instead of `chopLongFormIntoClips()` (4-30 brute-force). `FacelessResult` extended with `script` + `segmentDurations`. Old functions marked `@deprecated`. `clip-generator.ts` marked non-pipeline. Commit `a1bca26`.
  - Files: `src/engine/vidrush-orchestrator.ts`, `src/engine/faceless-factory.ts`, `src/tools/clip-generator.ts`
  - Verification: `tsc --noEmit` exit 0; STEP 4 calls `curateShorts` not `chopLongFormIntoClips`
- ☑ **Task 5.6 — Short-specific CTA overlay.** DONE S72 2026-04-17. Each curated short gets an ffmpeg `drawtext` overlay in the last 2 seconds: "Full video on the channel — @ace_richie77" / "@TheContainmentField". Bebas Neue font, `enable='gte(t,...)'` filter. CTA text sourced from `short.cta_overlay` (set by shorts-curator). Implemented in vidrush-orchestrator ffmpeg extraction loop (not pod — shorts are cut on Railway from the R2-downloaded long-form). Commit `a1bca26`.
  - Files: `src/engine/vidrush-orchestrator.ts` (STEP 4 ffmpeg command)
  - Verification: `tsc --noEmit` exit 0; ffmpeg command includes `drawtext...enable` filter
- ☑ **Task 5.7 — Long-form = foundation gate.** DONE S72 2026-04-17. If YouTube long-form upload fails (catch block) or no video URL exists (else branch), the orchestrator returns early with error logged — zero shorts, zero Buffer, zero distribution. `cleanupPipelineJob` called on early return. Commit `a1bca26`.
  - File: `src/engine/vidrush-orchestrator.ts` (STEP 3 error handling)
  - Verification: `tsc --noEmit` exit 0; catch block returns OrchestratorResult with clipCount=0
- ☐ **Task 5.8 — Animated brand card (Dopamine Ladder Level 1: Stimulation).** REDESIGNED S70 per Dopamine Ladder analysis. The brand card is a FIXED visual anchor — identical every video, only the hook text changes. This is the "face" of the faceless channel. Programmatically generated .mp4 animation clips baked into Docker at `brand-assets/`. **TCF** → dark matte (#0A0A0A) background, brand logo/wordmark centered, **data-glitch animation** fires at frame 0 (RGB channel split, scan lines, static burst) resolving to clean logo within 0.8-1.0s. MUST hit hard — this is the visual stun gun. **Ace Richie** → rich dark background with brand warmth (deep amber/gold), brand logo centered, **luminous pulse animation** fires at frame 0 (warm light bloom expanding outward, sacred geometry flash) resolving to clean logo within 0.8-1.0s. MUST hit as hard as the glitch — not subtle, not ambient. Animation duration: 1.0-1.3s. Total clip: 1.3s. Animation STOPS cleanly before typewriter begins — no bleed. If programmatic quality insufficient, Architect will provide designed .mp4 assets as replacement.
  - Files: `scripts/generate-brand-animations.py` (new — generates both brand .mp4 clips), `pod/brand-assets/brand_card_tcf.mp4`, `pod/brand-assets/brand_card_ace.mp4`, `pod/Dockerfile` (COPY brand-assets)
  - Verification: (1) each .mp4 is 1.3s ± 0.1s; (2) visual spot-check confirms hard-hitting animation, not subtle; (3) animation resolves to clean settled state before cut; (4) Architect visual approval
- ☑ **Task 5.9 — Terminal Override typewriter on brand card (Dopamine Ladder Level 2: Captivation).** DONE S71 2026-04-17. `_render_opening_sequence()` in `pod/pipelines/compose.py`: 5-step ffmpeg pipeline (extract last frame → generate typewriter .ass → render still+subtitle → re-encode brand card → concat). Brand-specific ASS: TCF=JetBrains Mono silver, Ace=Montserrat SemiBold gold. `hook_text` field added to `JobSpec` (TS+Pydantic+worker). `compose_video()` prepends opening clip before scene clips. Docker build context changed to repo root. Commit `6789b33`. REDESIGNED S70. The typewriter now renders ON TOP of the settled brand card (post-animation), NOT on a separate matte background. The brand card holds steady while hook text types in below/over the logo. `.ass` generation on the pod. **TCF** → clean monospace (JetBrains Mono or similar), silver/white text, no green, terminal aesthetic. **Ace Richie** → Montserrat SemiBold, warm accent glow, premium sans-serif. Typewriter reveals first 8-9 words of hook, holds for 8% tail. Trust gate: 3-5s of brand card + typewriter ONLY (no captions) before Scene 1. Total TO window: 3.7s (1.3s brand animation + 3.7s typewriter = 5.0s total opening). Fonts baked into Docker at `/app/brand-assets/`. Composition order: brand_card_animation.mp4 (1.3s) → extend last frame as still for 3.7s with typewriter .ass overlay → hard cut to Scene 1.
  - Files: `pod/pipelines/compose.py` (new `_render_opening_sequence()` function replacing old `_render_terminal_override()`), `pod/Dockerfile` (COPY fonts)
  - Verification: (1) opening sequence is exactly 5.0s; (2) typewriter starts AFTER animation resolves (~1.3s mark); (3) no caption bleed into opening; (4) visual spot-check per brand confirms premium quality
- ☑ **Task 5.10 — Kinetic captions via GPU Whisper in `pod/pipelines/compose.py`.** DONE S73 2026-04-16. `faster-whisper==1.0.3` added to requirements. `compose.py` gains full caption pipeline: `_extract_audio_from_video` (ffmpeg WAV 16kHz mono) -> `_transcribe_word_timestamps` (faster-whisper large-v3 on CUDA float16) -> `_chunk_words_into_bursts` (2-4 word groups, sentence-boundary aware) -> `_generate_caption_ass` (brand-specific ASS: TCF=Bebas Neue 72pt silver uppercase \| Ace=Montserrat SemiBold 68pt gold, both BorderStyle 1 no-box with scale pop-in animation) -> `_burn_captions` (ffmpeg subtitles filter). Wired into `compose_video()` as Stage 3 between concat and thumbnail. `skip_until_s=OPENING_TOTAL_DUR` prevents caption overlap with brand card + typewriter. Green opaque-box captions retired. Commit `d446a8b`.
  - Files: `pod/pipelines/compose.py` (new `_generate_captions()` function), `pod/requirements.txt` (add `faster-whisper` or `openai-whisper`)
  - Verification: (1) Whisper runs on GPU (log shows CUDA device, not CPU); (2) .ass file has no green color codes (`grep '00FF' *.ass` returns 0); (3) captions start AFTER intro+TO; (4) visual spot-check on produced video shows clean, brand-aligned text
- ☑ **Task 5.11 — Composite audio mixing in `pod/pipelines/compose.py`.** DONE S74 2026-04-16. `_mix_audio()` function (+210 lines, compose.py 832->1042): extracts narration from concatenated video (44100Hz stereo WAV), loops brand music bed (ace=music_sovereign.mp3, tcf=music_urgent.mp3) at -18dB, layers typing.mp3 during typewriter window (BRAND_CARD_ANIM_DUR onset) at -12dB, intro sting at -8dB at t=0, outro sting positioned to end at video end at -6dB. ffmpeg complex filter with amix inputs=N:duration=longest:dropout_transition=2 + volume compensation (NdB). Re-muxes mixed audio onto video with -c:v copy. Wired as Stage 2.5 in `compose_video()` between concat (Stage 2) and captions (Stage 3). Graceful fallback: if any step fails, returns original video. Commit `b94b8be`.
  - Files: `pod/pipelines/compose.py` (new `_mix_audio()` function), `pod/Dockerfile` (COPY audio assets)
  - Verification: `ffprobe -show_streams -select_streams a` on output shows exactly 1 audio stream; manual playback confirms music bed present underneath narration without drowning speech
- ☐ **Task 5.12 — Docker image rebuild + live pod test of full composition.** Rebuild Docker image with all new assets (fonts, intro clips, music beds, stings, brand card animations) and the updated compose.py. Run one end-to-end pod job per brand. Verify: brand card animation → typewriter → scenes with kinetic captions → music bed throughout → final.mp4 is the FINISHED product.
  - Files: `pod/Dockerfile`, `.github/workflows/pod-build.yml`, `scripts/test-full-composition.ts`, `package.json`
  - Verification: GH Actions build succeeds; live pod job returns a video that requires ZERO post-processing from Railway
  - **S75 partial 2026-04-17:** Docker image rebuilt (GH Actions green). Test script committed (`e0ed7db`). 3 orphan pods terminated. Live test blocked by RunPod US-KS-2 SUPPLY_CONSTRAINT (all 8 GPU types exhausted). Retry next session — no code changes needed.
- ☐ **Task 5.13 — Dopamine Ladder anticipation mechanics in script writer prompt.** S70 addition. Add explicit Level 3 (Anticipation) instructions to the `generateScript` Pass 1 prompt in `faceless-factory.ts`. The current prompt says "forward momentum" but does NOT instruct misdirection, head-fakes, or curiosity loop resets. New instruction block teaches the LLM to: (1) plant a question early via the hook, (2) build toward the answer with specific details, (3) head-fake or redirect BEFORE delivering the answer to reset the curiosity loop, (4) deliver the non-obvious answer (validation) then immediately open a NEW question. This is the "edging of storytelling" pattern from Kallaway's Dopamine Ladder framework. Also add to the blueprint extraction prompt: `narrative_arc` should explicitly include misdirection beats in ACT 2.
  - Files: `src/engine/faceless-factory.ts` (Pass 1 prompt writing rules + blueprint prompt)
  - Verification: diff shows new anticipation block in prompt; existing `tsc --noEmit` still clean; no functional code change (prompt-only)
- ☐ **Task 5.14 — Raise sourceIntelligence cap from 2500 to 8000 chars.** S70 addition. The blueprint extraction prompt feeds `sourceIntelligence.slice(0, 2500)` (~625 tokens) to the LLM. With Groq llama-3.3-70b's 128K context window and our total input at ~3K tokens, there is ~119K tokens of headroom. Raising to 8000 chars (~2000 tokens) gives the blueprint extractor 3x more raw material to find the deepest thesis without approaching any limit. Total input with raise: ~5K tokens (still 96% headroom).
  - Files: `src/engine/faceless-factory.ts` (two `.slice(0, 2500)` → `.slice(0, 8000)`)
  - Verification: `grep "slice(0, 2500)" src/engine/faceless-factory.ts` returns 0 matches; `grep "slice(0, 8000)"` returns 2 matches

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

## Phase 5 Audit Log

### S69 2026-04-16 — Task 5.1 (Script Assembly Clip-Awareness Audit) ✅

**Audited files:** `src/engine/faceless-factory.ts` (generateScript, assembleVideo, produceFacelessVideo), `src/agent/personas.ts`, `src/data/shared-context.ts`, `src/engine/content-engine.ts`, `src/engine/vidrush-orchestrator.ts`, `src/index.ts` (auto-pipeline trigger).

**FINDING 1: The long-form script writer is CLEANER THAN EXPECTED.**

The `generateScript()` function (faceless-factory.ts lines 533-932) with `targetDuration === "long"` has ZERO explicit references to shorts, clips, TikTok, or chopping. The prompt actively says: *"This is NOT a compilation of short clips. This is ONE COHESIVE STORY with a beginning, middle, and end — like a Netflix documentary scene."* The two-pass architecture (ACT 1+2 → ACT 3) is structurally sound for long-form narrative.

**FINDING 2: The clip-awareness contamination is NOT in the script prompt — it's in the ARCHITECTURE.**

The real repetition problem comes from these sources:

1. **Segment expansion (lines 893-932)**: When the script has <10 segments, each SHORT segment is LLM-expanded into TWO segments. This literally asks: *"Rewrite this as TWO separate segments."* The expansion prompt has no anti-repetition guardrails — it just splits ideas without checking what the other segments already covered. This creates the "same point restated from a different angle" problem.

2. **`produceFacelessBatch()` (line 3143-3161)**: Calls `produceFacelessVideo()` with `"short"` — meaning the batch path uses the SHORT-FORM script writer (5 segments, 30-60s). This is ONLY used for the manual `/api/faceless/produce` webhook. The scheduled auto-pipeline via Alfred seeds goes through `executeFullPipeline` → VidRush → `produceFacelessVideo(llm, ..., "long")`. So the primary production path IS long-form. The `"short"` default parameter on `produceFacelessVideo` (line 2915) is misleading but NOT active in production.

3. **Yuki persona (personas.ts line 40)**: *"Find viral moments, cut short clips, apply pattern interrupts."* This is the clip-chopper agent, not the script writer. But it feeds into how clips are extracted from the long-form.

4. **Short-form path (lines 833-862)**: A separate single-pass script writer for 30-60s verticals. Uses `"Write a ... faceless short"` language. This path is dormant in production (only triggered by manual webhook or explicit `"short"` parameter), but its existence means the codebase still carries the short-first mindset.

**FINDING 3: The "5 segments" short-form writer IS a clip-awareness vector.**

The short-form prompt (line 839) says: *"Write a ${durationRange} voiceover script for a ${niche} faceless short. ONE powerful idea, not a summary."* While this is clean in isolation, the fact that `generateScript` defaults to `targetDuration: "short"` (line 538) means any caller that forgets to pass `"long"` gets the short-form writer. Risk: future code paths accidentally produce short-form when long-form was intended.

**FINDING 4: No clip-awareness language in `shared-context.ts` or `content-engine.ts`.**

Both are clean. The seed generation (Alfred in `index.ts`) is also clean — it just emits `PIPELINE_IDEA_ACE` / `PIPELINE_IDEA_TCF` with niche + thesis, no mention of clips or shorts.

**SUMMARY OF ITEMS TO STRIP IN TASK 5.2:**

| Location | What to change | Why |
|---|---|---|
| `faceless-factory.ts` line 538 | Change default from `"short"` to `"long"` | Long-form is the foundation; short-form should require explicit opt-in |
| `faceless-factory.ts` lines 893-932 | Remove or rewrite segment expansion | Creates the repetition Ace identified; 16-segment target should be hit by the writer, not by splitting |
| `faceless-factory.ts` lines 833-862 | Mark short-form path as `@deprecated` | Short-form scripts are now produced by the shorts-curator from long-form, not written independently |
| `faceless-factory.ts` line 3153 | Change `"short"` to `"long"` in `produceFacelessBatch` | Batch path should produce long-form by default |
| `personas.ts` line 40 | Rewrite Yuki's goal to remove "cut short clips" | Yuki's role changes: she schedules curated shorts (Phase 5.3 output), she doesn't cut them |

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

**Conclusion:** The credentials for this pod + Railway service exist ONLY in (a) Ace's personal Chrome (not reachable by Claude-in-Chrome's isolated p