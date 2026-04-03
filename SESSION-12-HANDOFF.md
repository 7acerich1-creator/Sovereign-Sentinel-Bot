# SESSION 12 KICKOFF — Deploy + Manual Login + VidRush E2E

## READ FIRST
Read `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` — Session 11 summary has the full state.

## WHAT HAPPENED IN SESSION 11
- **Chromium + puppeteer-core** added to Dockerfile.bot production stage
- **browser.ts** replaced: 3 actions → 12 actions (navigate, click, type, wait, screenshot, extract, evaluate, login, upload_video, cookies_save, cookies_load, close). Singleton browser, cookie persistence, mobile emulation.
- **tiktok-browser-upload.ts** — Full Puppeteer upload workflow: download video → restore cookies → navigate to upload page → attach file → fill caption → click Post → save cookies
- **instagram-browser-upload.ts** — Same pattern with mobile viewport emulation (iPhone 390×844)
- **VideoPublisherTool** — Browser fallback wired: TikTok/IG use browser upload when API tokens missing + BROWSER_ENABLED=true
- **Login endpoints** — `POST /api/browser/tiktok-login` and `POST /api/browser/instagram-login` (120s manual login windows)
- **Agent personalities** — All 6 agents get browser directives injected at boot. Yuki = primary TikTok+IG distributor.
- **Build status**: ✅ Clean compile (tsc --noEmit = 0 errors)
- **Push status**: ⏳ NOT PUSHED — needs git commit + push

## SESSION 12 TASKS — IN ORDER

### TASK 1: Git Push + Railway Deploy
Commit all Session 11 changes and push to main. Railway auto-deploys.

Changed files:
- `Dockerfile.bot` — Chromium + PUPPETEER env vars
- `package.json` — puppeteer-core dependency
- `src/tools/browser.ts` — Full rewrite (12 actions)
- `src/tools/tiktok-browser-upload.ts` — NEW
- `src/tools/instagram-browser-upload.ts` — NEW
- `src/tools/video-publisher.ts` — Browser fallback + imports
- `src/index.ts` — New imports, new tools, login endpoints, browser directives, status endpoint update
- `scripts/update-agent-browser-scopes.ts` — NEW (Supabase blueprint updater)

Expect Railway build to take longer due to Chromium install (~200MB).

### TASK 2: Set Railway Env Vars
```
BROWSER_ENABLED=true
```
PUPPETEER_EXECUTABLE_PATH is already set in Dockerfile — no Railway env needed for it.

### TASK 3: Run Supabase Blueprint Update
After deploy, execute:
```
npx ts-node scripts/update-agent-browser-scopes.ts
```
Or run from Cowork. This appends browser scope sections to each agent's `personality_config.prompt_blueprint` in Supabase.

### TASK 4: TikTok Manual Login
1. Hit `POST https://gravity-claw-production-d849.up.railway.app/api/browser/tiktok-login`
2. Within 120 seconds, the headless browser has navigated to tiktok.com/login
3. Problem: This is HEADLESS — you can't see the browser.
4. **Workaround options:**
   a. Use Ace's phone to log into TikTok web, export cookies via browser extension, and POST them to a new endpoint
   b. Build a non-headless debug mode that takes screenshots every 5s and sends them to Telegram
   c. Use TikTok mobile app session cookies (extract from device)
5. Save cookies to `/app/data/browser-cookies/tiktok.json`

**IMPORTANT**: Headless login for TikTok is tricky because TikTok may detect headless Chrome. May need to add stealth plugin (`puppeteer-extra-plugin-stealth`) or extract cookies externally.

### TASK 5: Instagram Manual Login
Same as Task 4 but for Instagram:
1. Hit `POST /api/browser/instagram-login`
2. Same headless challenge applies
3. Instagram may trigger 2FA challenge
4. Save cookies to `/app/data/browser-cookies/instagram.json`

### TASK 6: VidRush End-to-End Test
1. Drop a YouTube URL to any agent via Telegram DM
2. Verify: Make.com Scenarios E+F fire
3. Verify: `/api/vidrush` callback hits Railway
4. Verify: Groq Whisper transcribes successfully
5. Verify: Clips generated + uploaded to Supabase Storage
6. Verify: `vid_rush_queue` has rows with status = "ready"
7. Fire `POST /api/vid-rush/sweep`
8. Verify: YouTube Shorts published to Ace Richie 77 channel
9. Verify: TikTok + IG uploaded via browser (if cookies are set from Tasks 4-5)

### TASK 7: Cookie Extraction Endpoint (if headless login fails)
If Tasks 4-5 fail due to headless detection, build:
`POST /api/browser/import-cookies` — accepts `{ domain: "tiktok", cookies: [...] }` body
This allows extracting cookies from a real browser (via EditThisCookie extension or browser dev tools) and importing them into the bot's cookie storage.

## ENV VARS STATUS (as of Session 11)
| Var | Status | Notes |
|-----|--------|-------|
| GROQ_API_KEY | ✅ SET | Primary Whisper provider |
| YOUTUBE_CLIENT_ID | ✅ SET | |
| YOUTUBE_CLIENT_SECRET | ✅ SET | |
| YOUTUBE_REFRESH_TOKEN | ✅ SET | Ace Richie 77 channel |
| YOUTUBE_REFRESH_TOKEN_TCF | ✅ SET | The Containment Field channel |
| BROWSER_ENABLED | ❌ NOT SET | **SET TO `true` IN TASK 2** |
| TIKTOK_ACCESS_TOKEN | ❌ N/A | API blocked — using browser upload |
| INSTAGRAM_ACCESS_TOKEN | ❌ N/A | API blocked — using browser upload |
| OPENAI_API_KEY | ⚠️ BILLING DEAD | Groq is primary |

## NEW FILES REFERENCE
- `src/tools/browser.ts` — Full browser automation (12 actions, cookie persistence, singleton)
- `src/tools/tiktok-browser-upload.ts` — TikTok web upload via Puppeteer + `tiktokLoginFlow()`
- `src/tools/instagram-browser-upload.ts` — IG web upload via Puppeteer + mobile emulation + `instagramLoginFlow()`
- `scripts/update-agent-browser-scopes.ts` — One-time Supabase personality blueprint updater

## NEW API ENDPOINTS
- `POST /api/browser/tiktok-login` — 120s manual login window, saves cookies
- `POST /api/browser/instagram-login` — 120s manual login window, saves cookies
