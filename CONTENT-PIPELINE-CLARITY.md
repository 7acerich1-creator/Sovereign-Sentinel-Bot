# CONTENT PIPELINE CLARITY — Two Engines, One Mission
### Last Updated: 2026-04-01 | Companion to Master Reference Section 23

---

## THE TWO ENGINES

There are exactly TWO content distribution engines. They run in parallel. They serve different purposes. They never overlap.

| | **TRANSMISSION GRID** (text+image) | **VID RUSH** (video) |
|---|---|---|
| **What it posts** | Text posts, quote cards, comic panels, hot takes, infographics | YouTube Shorts, future TikTok/IG Reels |
| **Posts through** | Buffer GraphQL API | YouTube Data API directly (bypasses Buffer) |
| **Automation level** | ✅ FULLY AUTONOMOUS — scheduled, deterministic, no human input | ⚠️ SEMI-AUTONOMOUS — needs source video, then auto-processes |
| **Code location** | `src/engine/content-engine.ts` | `src/tools/vid-rush.ts` + `src/tools/clip-generator.ts` + `src/tools/video-publisher.ts` |
| **Supabase table** | `content_engine_queue` | `vid_rush_queue` |
| **Status** | ✅ BUILT — awaiting deploy + first run | 🔧 BUILT but has gaps (see below) |

---

## ENGINE 1: TRANSMISSION GRID (Text + Image via Buffer)

**Named: "The Transmission Grid"**

### What It Does
Every morning at 6:30 AM ET, the Transmission Grid wakes up and:
1. Checks the day's niche (Mon=dark psychology, Tue=self improvement, Wed=burnout, Thu=quantum, Fri=brand)
2. Generates 12 unique posts (6 time slots × 2 brands) using the LLM
3. Each post gets platform-specific text variants (X version, LinkedIn version, etc.)
4. Stores everything in `content_engine_queue` with status "ready"
5. Every 5 minutes, the distribution sweep checks for ready posts whose time has arrived
6. Posts to ALL channels for that brand via Buffer simultaneously
7. Logs results to `content_transmissions` for Vector's metrics sweep
8. On weekends, reposts the week's top performers instead of generating new content

### ACTUAL Channel Count (Verified from Buffer — 2026-04-01)

**Ace Richie — 5 channels:**

| # | Platform | Handle | Buffer Channel |
|---|----------|--------|----------------|
| 1 | TikTok | acerichie77 | ✅ Connected |
| 2 | Instagram | ace_richie_77 | ✅ Connected |
| 3 | YouTube | Ace Richie 77 | ✅ Connected (text+image ONLY, no video) |
| 4 | X (Twitter) | AceRichie77 | ✅ Connected |
| 5 | Threads | ace_richie_77 | ✅ Connected |

**Containment Field — 4 channels:**

| # | Platform | Handle | Buffer Channel |
|---|----------|--------|----------------|
| 1 | TikTok | the_containment_field | ✅ Connected |
| 2 | Instagram | the_containment_field | ✅ Connected |
| 3 | YouTube | The Containment Field | ✅ Connected (text+image ONLY, no video) |
| 4 | X (Twitter) | ContainmentFld | ✅ Connected |

**Total: 9 channels across both brands.**

### What's NOT Connected to Buffer

| Platform | Brand | Status |
|----------|-------|--------|
| **LinkedIn** | Ace Richie | ❌ NOT IN BUFFER — listed in old posting guide but never connected |
| **Threads** | Containment Field | ❌ NOT IN BUFFER — only Ace Richie has Threads |
| **Reddit** | Sovereign Synthesis | ❌ NOT IN BUFFER — manual or direct API only |
| **Pinterest** | Either | ❌ NOT IN BUFFER — mentioned in old posting guide, not connected |

### Daily Output Math

```
Ace Richie:     5 channels × 6 time slots = 30 posts/day
Containment Field: 4 channels × 6 time slots = 24 posts/day
────────────────────────────────────────────────────────────
TOTAL FROM TRANSMISSION GRID:     54 posts/day = 378 posts/week
```

Weekends use reposts, so raw production = 5 weekdays × 54 = 270 new posts + weekend reposts.

### 6 Time Slots (ET / UTC)

| Slot | ET Time | UTC Time | Content Angle | Purpose |
|------|---------|----------|---------------|---------|
| 1 | 7:00 AM | 12:00 | Morning Hook | Scroll-stopping attention grab to start the day |
| 2 | 10:00 AM | 15:00 | Educational Panel | Comic panel, infographic, teach something |
| 3 | 1:00 PM | 18:00 | Midday Trigger | Quote card or hot take |
| 4 | 4:00 PM | 21:00 | Afternoon Drop | Image + text post |
| 5 | 7:00 PM | 00:00 | Evening Anchor | Story post or thread-style |
| 6 | 10:00 PM | 03:00 | Late Night Bait | Dark psychology hook |

### Niche Rotation

| Day | Niche | Hook Style |
|-----|-------|-----------|
| Monday | Dark Psychology | "They don't want you to know..." |
| Tuesday | Self-Improvement | "The version of you that..." |
| Wednesday | Burnout / Corporate Escape | "Your 9-to-5 is a..." |
| Thursday | Quantum / Reality Engineering | "Reality isn't what you think..." |
| Friday | Brand / Sovereign Synthesis | "I built this because..." |
| Saturday | Top performer repost | Data-driven repost |
| Sunday | Top performer repost | Data-driven repost |

### Transmission Grid Status

| Component | Status |
|-----------|--------|
| Content Engine module (`content-engine.ts`) | ✅ Built |
| Supabase table (`content_engine_queue`) | ✅ Created |
| Scheduled jobs in `index.ts` | ✅ Wired |
| Channel discovery + caching | ✅ Built (fetches from Buffer at boot) |
| Platform-specific text variants | ✅ Built (LLM generates per-platform copy) |
| Weekend repost logic | ✅ Built |
| TypeScript compile | ✅ Clean — 0 errors |
| **Deployed to Railway** | ❌ NOT YET — needs push to GitHub |
| **First live run** | ❌ NOT YET — verify after deploy |
| **Image generation in posts** | ❌ NOT YET — currently text-only, image gen is a future add |

---

## ENGINE 2: VID RUSH (Video via Direct Platform APIs)

### What It Does (When Triggered)
Vid Rush is NOT autonomous like the Transmission Grid. It activates when someone feeds it a YouTube URL:

1. **Source Input:** Ace provides a YouTube URL (or long-form video is created)
2. **Alfred** intercepts the URL → runs Whisper transcription → scores segments by sovereign keyword density
3. **Vid Rush Tool** takes the top-scoring segments → downloads video via yt-dlp → cuts clips via ffmpeg
4. **Clip Generator** scales to 9:16 (1080×1920) → applies niche color grade → burns captions → uploads to Supabase Storage
5. **Video Publisher** publishes finished clips to YouTube Shorts (via YouTube Data API)
6. **Buffer companion post** — a text+image version of each Short also goes through Buffer to all channels

### What IS Built in Vid Rush

| Component | Status | Code |
|-----------|--------|------|
| YouTube URL interception in Telegram | ✅ Built | `index.ts` (Alfred handler) |
| Whisper transcription (OpenAI API) | ✅ Built | `vid-rush.ts` |
| Segment scoring (keyword density, sentence energy) | ✅ Built | `vid-rush.ts` |
| Sliding window clip selection (non-overlapping) | ✅ Built | `vid-rush.ts` |
| yt-dlp video download | ✅ Built | `clip-generator.ts` |
| ffmpeg clip cutting + 9:16 scaling | ✅ Built | `clip-generator.ts` |
| Niche-specific color grading | ✅ Built | `clip-generator.ts` (4 niche filters) |
| Caption burn (drawtext) | ✅ Built | `clip-generator.ts` |
| Supabase Storage upload | ✅ Built | `clip-generator.ts` |
| `vid_rush_queue` table logging | ✅ Built | `clip-generator.ts` |
| YouTube Shorts publish tool | ✅ Built | `video-publisher.ts` |
| YouTube OAuth tokens (both channels) | ✅ Obtained | Railway env vars set 2026-03-31 |
| TikTok publish tool | ✅ Built | `video-publisher.ts` |
| Instagram Reels publish tool | ✅ Built | `video-publisher.ts` |
| Crew dispatch pipeline (Alfred→Yuki→Anita→Vector) | ✅ Built | `crew-dispatch.ts` |

### What's NOT Built / Gaps in Vid Rush

| Gap | Description | Impact | Fix Needed |
|-----|-------------|--------|------------|
| **VR-1: No autonomous trigger** | Vid Rush only fires when someone sends a YouTube URL. There's no "wake up and produce Shorts" scheduler. | No Shorts produced without manual input | Build a daily Shorts production scheduler OR connect to content calendar |
| **VR-2: No source video creation pipeline** | Ace hasn't recorded source material. The whole pipeline assumes existing YouTube videos to clip FROM. | Nothing to clip from = nothing to publish | Ace records source content OR AI-generated video (ElevenLabs + stock footage) |
| **VR-3: Clip → YouTube Shorts publish is NOT automated** | Clips land in `vid_rush_queue` with status "ready". But nothing automatically reads the queue and calls `youtube_publish_short`. Yuki would need to be told to do this. | Clips sit in queue, never reach YouTube | Build a `vid_rush_publish_sweep` job (like the Transmission Grid's distribution sweep) |
| **VR-4: No posting schedule for Shorts** | Posting guide says 5 Shorts/day × 2 brands = 10/day. But there's no scheduler that spaces them out across time slots. | Either all post at once or none post | Define Short time slots + add scheduling logic |
| **VR-5: No "1 long video → many Shorts" orchestration** | The concept is: Ace creates ONE 15-30 min video → system cuts 10-30 Shorts from it → posts them over days. But nothing manages the inventory (how many clips left, how many per day, etc.) | Clips could be dumped all at once or never used | Build a clip inventory manager that meters out X clips/day from the queue |
| **VR-6: Buffer companion posts for Shorts not automated** | For every Short published on YouTube, a text+image companion should go through Buffer. Nothing connects these. | Missed multiplier — Shorts exist on YouTube only | After YouTube publish, auto-generate a still frame + hook text → fire through Transmission Grid |
| **VR-7: No end-to-end test completed** | Pipeline chain fires (proven 2026-04-01), but no clip has actually been cut from a real video and published to YouTube. | Unknown failure modes | Feed a test video through the full pipeline |
| **VR-8: TikTok tokens not obtained** | `TIKTOK_ACCESS_TOKEN` not in Railway. App review not submitted. | No TikTok video publishing | Submit app for review on TikTok Developer Portal |
| **VR-9: Instagram Reels API killed** | Meta API integration abandoned (Section 9 of master ref). | No Instagram Reels via API — Buffer handles image+text only | Deferred permanently. IG Reels = manual or future workaround |

### Vid Rush Target (When Fully Operational)

```
Source: Ace records/curates 1 long-form video per week (minimum)
  ↓
Vid Rush cuts 20-30 clips per video
  ↓
Clip inventory: 5 clips published per day × 2 brands = 10 Shorts/day
  ↓
Each Short also gets a Buffer companion post (text+image)
  ↓
Weekly from Vid Rush: 70 Shorts + 70 companion posts = 140 posts/week
```

### Combined Target (Both Engines)

```
Transmission Grid:    378 posts/week (54/day × 7 days, weekends = reposts)
Vid Rush (future):  + 140 posts/week (10 Shorts/day + 10 companion posts/day)
──────────────────────────────────────────────────────────────────────────
COMBINED:             518 posts/week (well above 250+ target)
```

**Current reality until Vid Rush gaps are closed:**
Transmission Grid alone = 378 posts/week. That already exceeds the 250+ target.

---

## WHAT TO BUILD NEXT (Priority Order)

### Priority 1: Deploy Transmission Grid
- Push to GitHub → Railway auto-deploys
- Watch first morning run (6:30 AM ET)
- Verify Buffer queues fill up across all 9 channels
- **This alone gets you above 250+/week**

### Priority 2: Connect LinkedIn to Buffer
- LinkedIn is the one missing Ace Richie channel
- Adding it = 6 channels for Ace (up from 5) = +6 posts/day = +42/week
- Go to Buffer → Connect → LinkedIn → Ace Richie profile

### Priority 3: Close VR-3 (Publish Sweep for Shorts)
- Build a `vid_rush_publish_sweep` job (same pattern as Transmission Grid's distribution sweep)
- Reads `vid_rush_queue` where `status=ready`, publishes to YouTube via `youtube_publish_short`
- Meters out clips: max 5 per day per brand (VR-5)

### Priority 4: Close VR-1 (Source Content)
- Ace records first source video (even a 10-minute screen recording explaining Protocol 77)
- Feed the URL to Alfred in Telegram
- Watch the full pipeline fire

### Priority 5: Close VR-6 (Buffer Companion Posts)
- After each YouTube Short publishes, auto-create a still frame + hook text
- Fire through the Transmission Grid's Buffer distribution

---

## QUICK REFERENCE — WHO DOES WHAT

| Agent | Transmission Grid Role | Vid Rush Role |
|-------|----------------------|---------------|
| **Alfred** | — | Intercepts YouTube URLs, extracts hooks, scores segments |
| **Yuki** | — | Cuts clips, color grades, burns captions, publishes Shorts |
| **Anita** | — | Creates email copy tied to clip themes |
| **Vector** | Tracks performance, queues reposts | Tracks Shorts performance |
| **Sapphire** | — | Monitors pipeline health, summarizes chain completion |
| **Veritas** | — | Weekly strategic directive |
| **THE CODE** (no agent) | Daily production + distribution sweep | Publish sweep (NOT YET BUILT) |

The Transmission Grid is unique because NO AGENT runs it. It's pure deterministic code. The LLM generates the content, but the distribution — which channels, what time, which brand — is hardcoded logic. No LLM vibes.

---

*This document is the canonical pipeline clarity reference. If it conflicts with the posting guide or master reference, update both.*
