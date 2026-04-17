# CONTENT-PIPELINE-CLARITY.md — Cross-Platform Asset Matrix

> **Purpose:** Single reference for what each platform receives from the automated pipeline.
> Every field below is derived from live code as of Session 79 (2026-04-17).
> If the code changes, this file must be updated in the same commit.

---

## Pipeline Flow (Summary)

```
Alfred seeds (2/day: 1 Ace Richie, 1 TCF)
  → Script generation (Groq on Railway)
  → Pod wake (RunPod H100 80GB)
  → XTTS narration + FLUX images + ffmpeg composition (pod)
  → Finished long-form MP4 returned to Railway via R2
  → YouTube long-form upload (Railway)
  → Shorts curator identifies 3-4 clips from script + timestamps
  → ffmpeg extracts 9:16 shorts from long-form (Railway)
  → Shorts uploaded to Supabase Storage (temp) → Buffer scheduling
  → Buffer distributes shorts across all active channels over 7 days
  → Supabase Storage cleanup (60s delay after Buffer acceptance)
```

---

## Long-Form YouTube Video

| Field | Value |
|---|---|
| **Platform** | YouTube via Data API v3 resumable upload |
| **Aspect ratio** | 16:9 (horizontal) — pod composition native output |
| **Duration** | 8-18 minutes typical, 16 scenes, ±14min anti-ghost jitter on schedule |
| **Title** | LLM-generated (Groq, content-engine), scroll-stop optimized, brand-specific tone |
| **Description** | LLM-generated via `generateLongFormDescription()` — 4 mandatory paragraphs (Thesis, Pivot, Delivery, Who-It's-For) + diagnostic link + protocol link + 5-7 keyword seeds + 7 hashtags footer |
| **Description line 1** | `🧬 Take the Diagnostic: https://sovereign-synthesis.com/diagnostic` — present in all 4 description paths |
| **Tags** | Pulled from demographic angle keyword seeds. Buffer strips YT tags field, so SEO also lives in description body |
| **Hashtags** | 7 camelCase + 1 brand (`#SovereignSynthesis` or `#ContainmentField`). No generic tags (`#mindset`, `#motivation`, `#selfhelp` explicitly forbidden) |
| **Category** | 27 (Education) — hard-coded |
| **Thumbnail** | Pod-generated (last-frame extraction). Uploaded via `thumbnails.set` API |
| **Brand routing** | Dual OAuth refresh tokens — Ace Richie → `@ace_richie77`, TCF → `@TheContainmentField` |
| **Audio** | XTTS narration + music bed (-18dB) + intro sting (-8dB) + outro sting (-6dB) + typing SFX (-12dB). Composite mixed on pod |
| **Captions** | Kinetic via faster-whisper GPU large-v3. TCF = Bebas Neue 72pt silver uppercase. Ace = Montserrat SemiBold 68pt gold. No green. Starts after 5.0s opening |
| **Opening sequence** | 5.0s: 1.3s brand card animation + 3.7s typewriter. TCF = data-glitch. Ace = luminous pulse. Hook text typed over settled brand card |

---

## Curated YouTube Shorts (3-4 per long-form)

| Field | Value |
|---|---|
| **Platform** | YouTube Shorts via Data API v3 resumable upload |
| **Aspect ratio** | 9:16 vertical — `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920` |
| **Duration** | 15-59 seconds. Hard-capped at 59s (padding included). Curator enforces 15s minimum |
| **Title** | LLM-generated, auto-appends `#Shorts` |
| **Description** | Short-form copy from Buffer scheduling, platform-aware |
| **Tags** | Inherited from long-form angle keywords |
| **Category** | 22 (People & Blogs) — hard-coded |
| **CTA overlay** | Last 2s: `drawtext` ffmpeg filter. "Full video on the channel — @ace_richie77" or "@TheContainmentField". Bebas Neue |
| **Audio** | Re-encoded AAC 128kbps with fade in (0.3s) / fade out (1.5s). NOT stream-copied — prevents mid-word cut bug |
| **Selection** | Shorts curator LLM picks 3-4 strongest standalone moments. Ranked by confidence, non-overlapping, each stands alone |

---

## TikTok

| Field | Value |
|---|---|
| **Platform** | TikTok via pull-from-URL API or browser fallback |
| **Aspect ratio** | 9:16 — same clip file as YouTube Shorts |
| **Duration** | 15-59 seconds — same clips |
| **Caption** | 150 characters max (TikTokPublishTool limit) — short hook text |
| **Hashtags** | Exactly 5 demographic-coded. No generic tags. In caption body |
| **Audio** | Same AAC 128k re-encoded MP4 |
| **Upload** | `publicUrl` pull (primary) or browser file upload (fallback). Via Buffer or direct |

---

## Instagram Reels

| Field | Value |
|---|---|
| **Platform** | Instagram via Graph API container publish flow |
| **Aspect ratio** | 9:16 — same clip file |
| **Duration** | 15-59 seconds — same clips |
| **Caption** | Up to 2200 characters — longer copy with hook + context |
| **Hashtags** | 8-12 demographic-tailored. In caption body. No generic tags |
| **Audio** | Same AAC 128k re-encoded MP4 |
| **Upload** | Graph API container flow (URL → container → publish). Via Buffer or direct |

---

## Buffer-Distributed Text Platforms

Text-only posts (no video) via Buffer scheduling.

| Platform | Hashtag cap | Notes |
|---|---|---|
| **X / Twitter** | 0-2 max | Short, punchy text only |
| **Threads** | 0 hashtags | Clean text, no tags |
| **LinkedIn** | 3-5 professional | Professional tone variant |
| **Facebook** | Platform defaults | Text post with link back to YouTube |

---

## Buffer Scheduling Logic

| Parameter | Value |
|---|---|
| **Distribution window** | 7 days from publish date |
| **Time slots** | 8 per day, staggered with ±14 minute anti-ghost jitter |
| **Channel selection** | ALL active (non-paused) Buffer channels — no service-type filtering |
| **Media routing** | Media-required channels (TikTok, IG, YouTube) get video+text ONLY if clip has `publicUrl`. Text-only channels always get posts |
| **Cleanup** | Supabase Storage clips deleted 60s after Buffer accepts mutation. R2 clips NOT deleted (zero egress) |

---

## Brand Routing Matrix

| Layer | Ace Richie (@ace_richie77) | The Containment Field (@TheContainmentField) |
|---|---|---|
| **Allowed niches** | sovereignty, authority, architecture, system-mastery, wealth-frequency | burnout, dark-psychology, containment, manipulation-exposed, pattern-interrupt |
| **Niche cooldown** | 14d relaxed from 30d if all blocked | Same |
| **TTS voice** | XTTS clone from `ace_ref.wav` | XTTS clone from `tcf_ref.wav` |
| **Caption style** | Montserrat SemiBold 68pt gold | Bebas Neue 72pt silver uppercase |
| **Brand card** | Luminous pulse (gold/amber) | Data-glitch (dark matte) |
| **Typewriter font** | Montserrat SemiBold, warm gold | JetBrains Mono, silver/white |
| **Music bed** | `music_sovereign.mp3` at -18dB | `music_urgent.mp3` at -18dB |
| **Brand hashtag** | `#SovereignSynthesis` | `#ContainmentField` |
| **YouTube OAuth** | Ace Richie refresh token | TCF refresh token |
| **Pinecone namespace** | `scripts-ace-richie` | `scripts-tcf` |

---

## Quality Gates (Automated, Pre-Distribution)

| Gate | Behavior |
|---|---|
| **Brand niche violation** | `BrandNicheViolation` thrown → Telegram alert → pipeline halts for that brand |
| **Script similarity >0.85** | Rejected, 2 retries max, then Telegram alert + halt |
| **Long-form upload failure** | Zero shorts, zero Buffer, zero distribution (foundation gate) |
| **Shorts >59s after padding** | Hard-capped at 59s |
| **Audio encoding** | AAC re-encode on all shorts — no stream-copy |

---

## Batch Production Mode (Phase 7)

| Parameter | Value |
|---|---|
| **Trigger** | `/produce_batch` Telegram command or scheduler |
| **Pod lifecycle** | ONE warm pod for entire batch. `withPodSession` with 5-min idle between jobs |
| **Target throughput** | 6-8 videos per batch window |
| **Estimated GPU cost** | ~$1.50-2.00 per batch (full week of content) |
| **Script generation** | On-the-fly per brand/niche via Groq (Railway). Uniqueness-checked against Pinecone before pod compute starts |
| **Sweep on exit** | Signal handlers + `sweepStalePods()` guarantee no orphan GPU spend |

---

*Last updated: 2026-04-17, Session 79.*
*Source files: `src/engine/vidrush-orchestrator.ts`, `src/tools/video-publisher.ts`, `src/engine/faceless-factory.ts`, `src/engine/shorts-curator.ts`, `src/tools/r2-upload.ts`, `src/pod/session.ts`*
