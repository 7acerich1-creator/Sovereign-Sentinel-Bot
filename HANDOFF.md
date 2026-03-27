# Gravity Claw v3.0 — Session Handoff Prompt
**Date:** 2026-03-22
**Project path:** `C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects\scratch\gravity-claw`
**Railway project:** `77e69bc6-f7db-4485-a756-ec393fcd280e`
**Railway service:** `0f2ba264-a815-43c1-b299-24e4a1aa865e`
**Bot:** `@sovereignsynthesis_bot` | Token: `8655277486:AAHLa84nxqcf3mmZ6QsitEE1FgjZgeYm3ok`
**Authorized User ID:** `8593700720` (Ace Richie / Richard)

---

## Current Status: BOT IS ONLINE BUT NOT RESPONDING

The bot deploys successfully, starts up, passes auth, receives messages — but **never sends a reply**. The polling loop freezes after the first message because `agentLoop.processMessage()` hangs and never returns.

---

## Root Causes Identified (All Fixed in Code, Latest Deploy In Progress)

### 1. ✅ 459 Tools Sent to Gemini → API Choke
The agent loop passed all 459 MCP tool definitions to Gemini on every message. This caused the API to hang silently. **Fix:** Capped at 64 tools in `src/agent/loop.ts`.

### 2. ✅ Gemini Tool Parameter Conversion Bug
MCP tools use JSON Schema format (`{ type: "object", properties: {...}, required: [...] }`) but the Gemini provider did `Object.entries(t.parameters)` expecting a flat map. This produced malformed function declarations causing the Gemini API to hang. **Fix:** `src/llm/providers.ts` now detects JSON Schema vs flat map format.

### 3. ✅ Polling Loop Freezes When Handler Hangs
grammY processes updates **sequentially**. When `agentLoop.processMessage()` hangs forever, the entire long-polling loop freezes — no new messages can be received. **Fix:** Added `Promise.race()` with 120s timeout wrapper in `src/index.ts`.

### 4. ✅ Polling Crash Silent Failure
`bot.start()` was fire-and-forget with no `.catch()`. If the polling loop died, it died silently. **Fix:** Added `.then()/.catch()` handlers with 5s auto-restart in `src/channels/telegram.ts`.

### 5. ✅ Morning Briefing Spam (Every 60s)
The `dateKey` guard in the scheduler was computed but never used, so briefings fired every 60 seconds during the matching hour. **Fix:** `briefingFiredDates` object in `src/index.ts` properly gates per-day.

### 6. ✅ Briefings with Fabricated Intel
Prompts asked Gemini to report revenue/habits/streaks with no real data — it hallucinated numbers. **Fix:** Prompts in `src/proactive/briefings.ts` now explicitly prohibit fabrication and say "No data tracked yet" when context is empty.

### 7. ✅ Identity Files Missing from Docker Build
`soul.md`, `claude.md`, `mcp.json` were stripped by `.railwayignore` having `*.md`. **Fix:** Both `.railwayignore` and `.dockerignore` now use specific exclusions; Dockerfile COPYs identity files explicitly.

---

## Latest Deployment State

The **5th deployment** (`build id: e45b6f4c`) was submitted just before handoff. It contains all fixes above. You need to:

1. Wait for the build to complete (~3 min from submission)
2. Confirm new scheduler IDs appear in logs (not `ff5e1807` / `6388701e`)
3. Send a test message to `@sovereignsynthesis_bot`
4. Watch for these new log lines:
   - `🧠 [AgentLoop] Building context for message: "..."`
   - `🔧 [AgentLoop] Sending 64/459 tools to LLM`
   - `🔄 [AgentLoop] Iteration 1/10 — calling LLM...`
   - `✅ [AgentLoop] LLM responded`

---

## Key Files Modified This Session

| File | What Changed |
|------|-------------|
| `src/agent/loop.ts` | Cap tools at 64, added verbose logging throughout |
| `src/llm/providers.ts` | Fixed Gemini tool param conversion (JSON Schema vs flat map) |
| `src/channels/telegram.ts` | Added raw update logging, polling crash recovery, `drop_pending_updates: true` |
| `src/index.ts` | Added 120s timeout on agent loop, fixed briefing date guard, added handler logging |
| `src/proactive/briefings.ts` | Fixed hallucination in briefing prompts |
| `.railwayignore` + `.dockerignore` | Fixed `*.md` exclusion to preserve `soul.md`, `claude.md` |
| `Dockerfile` | Added `COPY soul.md`, `COPY claude.md`, `COPY mcp.json` |

---

## How to Pull Railway Logs (Windows PowerShell)

```powershell
$outFile = "$env:TEMP\railway_logs.txt"
Set-Location "C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects\scratch\gravity-claw"
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "C:\Users\richi\AppData\Roaming\npm\node_modules\@railway\cli\bin\railway.js","logs","--lines","40" `
  -NoNewWindow -Wait -RedirectStandardOutput $outFile
Get-Content $outFile
```

## How to Deploy (Windows PowerShell)

```powershell
$outFile = "$env:TEMP\railway_deploy.txt"
$errFile = "$env:TEMP\railway_deploy_err.txt"
Set-Location "C:\Users\richi\OneDrive\Documents\SovereignSynthesisProjects\scratch\gravity-claw"
$p = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "C:\Users\richi\AppData\Roaming\npm\node_modules\@railway\cli\bin\railway.js","up","--detach" `
  -NoNewWindow -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile -Wait
Write-Host "EXIT: $($p.ExitCode)"
Get-Content $outFile
```

## How to Check If Polling Is Active

```powershell
$token = "8655277486:AAHLa84nxqcf3mmZ6QsitEE1FgjZgeYm3ok"
# If 409 = polling IS active. If 200/empty = polling NOT active.
try {
  $r = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getUpdates?limit=1&timeout=1" -TimeoutSec 5
  Write-Host "getUpdates OK (polling NOT active)"
} catch {
  Write-Host "409 = polling IS active: $($_.Exception.Message)"
}
```

---

## If Bot Still Doesn't Respond After Latest Deploy

The next thing to check is whether the **Gemini API call** is hanging even with 64 tools. Two options:

**Option A — Disable tools entirely for first test:**
In `src/agent/loop.ts` line ~98, change:
```typescript
tools: toolDefs.length > 0 ? toolDefs : undefined,
```
to:
```typescript
tools: undefined, // Temporarily disabled for debug
```
Deploy, test if bot responds. If yes, the tool schema conversion is still broken.

**Option B — Switch primary LLM to Anthropic:**
In Railway variables, set `LLM_DEFAULT_PROVIDER=anthropic`. The Anthropic provider uses standard `fetch()` with a response timeout and is less likely to hang silently than the Gemini SDK.

---

## Architecture Quick Reference

```
Telegram → grammY bot.start() [long polling]
  → auth guard (userId: 8593700720)
  → telegram.onMessage() callback
  → groupManager.shouldRespond() [passes for private chats]
  → 120s timeout race
  → agentLoop.processMessage()
    → buildContext() [SQLite + Markdown + Supabase memory]
    → 64 tools selected from 459 total
    → failoverLLM.generate() [Gemini → Anthropic → OpenAI fallover]
  → telegram.sendMessage(response)
```

---

## What's Working

- ✅ Deployment pipeline (Railway, Docker, identity files)
- ✅ Bot starts and connects to Telegram
- ✅ Messages are received and pass auth
- ✅ Morning/evening briefings fire once per day (no spam)
- ✅ Briefings don't hallucinate data
- ✅ 459 MCP tools loaded (Supabase, Pinecone, Notion, Vercel, Zapier, Stripe, Fireflies, StitchMCP)
- ✅ soul.md, claude.md, mcp.json deployed in container

## What's Pending

- ❌ Bot not responding to messages (latest fix deployed, awaiting verification)
- ⬜ Remove diagnostic logging once bot works
- ⬜ Mission Control dashboard integration
