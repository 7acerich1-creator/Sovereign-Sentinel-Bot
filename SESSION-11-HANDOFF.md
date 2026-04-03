# SESSION 11 KICKOFF — Browser Automation Overhaul + VidRush E2E Test

## READ FIRST
Read `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` — Session 10 summary has the full state. All code changes from Session 10 are deployed (commit `94a99bf`).

## WHAT HAPPENED IN SESSION 10
- Whisper transcription swapped from OpenAI (billing dead) to **Groq** (`whisper-large-v3-turbo`). Uses `GROQ_API_KEY` already in Railway.
- New `/api/vid-rush/sweep` endpoint — distributes clips from `vid_rush_queue` to YouTube/TikTok/IG via direct APIs.
- New `/api/vid-rush/status` endpoint — reports queue state + which platform tokens are detected.
- YouTube OAuth tokens CONFIRMED SET in Railway (all 4: client ID, secret, refresh token Ace, refresh token TCF).
- TikTok + Instagram API access BLOCKED by platform gatekeeping. **Browser automation is the workaround.**

## SESSION 11 TASKS — IN ORDER

### TASK 1: Chromium + Puppeteer in Docker
The Dockerfile (`Dockerfile.bot`) needs Chromium added to the production stage. Current production stage is `node:20-slim`.

Add to the production stage `apt-get` block:
```
chromium
```

Add to the npm install:
```
npm install puppeteer-core
```

Set env in Dockerfile:
```
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
```

DO NOT install full `puppeteer` — use `puppeteer-core` + system Chromium to avoid downloading a second Chromium binary.

### TASK 2: Upgrade browser.ts — From Toy to Weapon
Current `src/tools/browser.ts` only has 3 actions: navigate, extract, screenshot. It's useless for real automation.

**Replace entirely** with a full-featured browser automation tool that supports:
- `login` — navigate to URL, type credentials, submit, save cookies to SQLite/file for session reuse
- `upload_video` — navigate to upload page, use `page.setInputFiles()` to attach video, fill text fields, click publish
- `click` — click an element by CSS selector
- `type` — type text into an element by CSS selector
- `wait` — wait for selector to appear
- `evaluate` — run arbitrary JS in page context
- `screenshot` — take screenshot (already exists)
- `cookies_save` / `cookies_load` — persist and restore session cookies so agents don't re-login every time

Use `puppeteer-core` with `executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'`.

Launch with: `headless: 'new'`, `args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']`

### TASK 3: TikTok Browser Upload Tool
New file: `src/tools/tiktok-browser-upload.ts`

Puppeteer workflow:
1. Load saved TikTok session cookies (from prior login)
2. Navigate to `https://www.tiktok.com/upload`
3. Wait for upload area to load
4. Download video from Supabase Storage URL to `/tmp/`
5. Use file input to attach the video
6. Wait for upload/processing to complete
7. Fill caption field with provided text
8. Click "Post" button
9. Save updated cookies for next session
10. Return success/failure with post URL if available

Credential storage: `TIKTOK_SESSION_COOKIES` env var in Railway (JSON string of cookies array), or store in Supabase `platform_sessions` table.

**IMPORTANT:** TikTok's web uploader may require initial manual login. Build a `/api/browser/tiktok-login` endpoint that: launches browser, navigates to tiktok.com/login, waits 120 seconds for Ace to complete login via Telegram-forwarded screenshot + cookie save. One-time setup, then cookies persist.

### TASK 4: Instagram Browser Upload Tool
New file: `src/tools/instagram-browser-upload.ts`

Same pattern as TikTok:
1. Load saved IG session cookies
2. Navigate to `https://www.instagram.com/`
3. Click "New post" / use `instagram.com/create/style/` or the mobile-emulated upload flow
4. Attach video, fill caption, publish
5. Save cookies

Instagram web upload requires mobile viewport emulation:
```ts
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.setUserAgent('Mozilla/5.0 (iPhone; ...) Mobile Safari/...');
```

### TASK 5: Wire Browser Upload into VideoPublisherTool
In `video-publisher.ts`, the `VideoPublisherTool.execute()` method currently checks `configured[platform]` for API tokens. Add fallback logic:

```
if (!configured.tiktok && config.tools.browserEnabled) → use TikTokBrowserUploadTool
if (!configured.instagram && config.tools.browserEnabled) → use InstagramBrowserUploadTool
```

YouTube stays on direct API (tokens are set and working).

### TASK 6: Update Agent Scopes
Every agent has a personality blueprint in Supabase. Update each with specific browser use cases:

| Agent | Browser Use Cases |
|-------|-------------------|
| **Alfred** | Research topics for content, verify external links, pull source material from URLs, extract quotes from articles |
| **Veritas** | Fact-check claims by browsing source URLs, competitive analysis (scrape competitor landing pages), verify live site status |
| **Vector** | Scrape analytics dashboards (Buffer, Stripe if needed), pull social metrics from platform pages when APIs are rate-limited |
| **Anita** | Research trending topics on platforms, browse subreddits/forums for content inspiration, extract viral hook patterns |
| **Yuki** | **PRIMARY: TikTok + Instagram video upload via browser.** Also: verify posts went live by checking platform pages |
| **Sapphire** | Strategic intelligence gathering, browse industry news, pull market data from public sources |

Update the personality blueprints in Supabase `agent_personalities` table AND the system prompts that agents receive. The browser capability needs to be part of their ACTIVE instructions, not just a tool they theoretically have access to.

### TASK 7: Set Railway Env Vars
```
BROWSER_ENABLED=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### TASK 8: VidRush End-to-End Test
After all above is deployed:
1. Drop a YouTube URL to any agent via Telegram DM
2. Verify: Make.com Scenarios E+F fire (check execution count in Make.com)
3. Verify: `/api/vidrush` callback hits Railway
4. Verify: Groq Whisper transcribes successfully
5. Verify: Clips generated + uploaded to Supabase Storage
6. Verify: `vid_rush_queue` has rows with status = "ready"
7. Fire `/api/vid-rush/sweep`
8. Verify: YouTube Shorts published to Ace Richie 77 channel
9. Verify: TikTok + IG uploaded via browser (if Tasks 3-4 complete)

## ENV VARS STATUS (as of Session 10)
| Var | Status | Notes |
|-----|--------|-------|
| GROQ_API_KEY | ✅ SET | Primary Whisper provider now |
| YOUTUBE_CLIENT_ID | ✅ SET | |
| YOUTUBE_CLIENT_SECRET | ✅ SET | |
| YOUTUBE_REFRESH_TOKEN | ✅ SET | Ace Richie 77 channel |
| YOUTUBE_REFRESH_TOKEN_TCF | ✅ SET | The Containment Field channel |
| TIKTOK_ACCESS_TOKEN | ❌ NOT SET | API blocked — use browser upload instead |
| INSTAGRAM_ACCESS_TOKEN | ❌ NOT SET | API blocked — use browser upload instead |
| INSTAGRAM_BUSINESS_ID | ❌ NOT SET | API blocked — use browser upload instead |
| BROWSER_ENABLED | ❌ NOT SET | Set to `true` after Chromium in Docker |
| OPENAI_API_KEY | ⚠️ BILLING DEAD | Groq is primary now, this is fallback only |

## EXISTING CODE REFERENCE
- `src/tools/browser.ts` — Current barebones browser tool (replace in Task 2)
- `src/tools/video-publisher.ts` — VideoPublisherTool + TikTokPublishTool + InstagramReelsPublishTool + YouTubeShortsPublishTool (wire browser fallback in Task 5)
- `src/tools/vid-rush.ts` — VidRush pipeline (NOW uses Groq Whisper)
- `src/tools/clip-generator.ts` — Clip cutting + Supabase upload
- `src/index.ts` lines 931-991 — `/api/vidrush` endpoint
- `src/index.ts` — `/api/vid-rush/sweep` and `/api/vid-rush/status` endpoints (NEW in Session 10)
- `Dockerfile.bot` — Needs Chromium added (Task 1)
- `src/config.ts` line 102 — `browserEnabled` setting
