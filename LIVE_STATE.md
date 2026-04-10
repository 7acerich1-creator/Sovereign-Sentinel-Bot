# LIVE_STATE.md — Sovereign Sentinel Bot

> **⚡ AUTO-GENERATED.** Do not edit by hand. Run `npm run verify-state` to regenerate.
> This file is the single source of truth for current runtime state. If the master
> reference contradicts this file, **this file wins** — the master reference only holds
> invariants, not live values.

**Last verified:** `2026-04-10T21:24:54.635Z`
**Generator:** `scripts/verify-state.ts`

## Git State
- **Branch:** `main`
- **HEAD:** `435288b9329a55d2f29d9060e3e20921fef8d3f8`
- **Working tree:** DIRTY (169 files)
- **Last commit:** 435288b Session 45: Kinetic Baseline (YT Growth Protocol Task 3) - per-scene punch-ins + chromatic aberration + Ken Burns reversal (14 hours ago)

## Package
- **Name:** `gravity-claw`
- **Version:** `3.0.0`
- **Node engine:** `>=20`

## TTS Routing — src/voice/tts.ts
### Runtime Priority (computed from env vars + code)
**edge → openai** (no ElevenLabs key available)

### Voice Identifiers
- **ElevenLabs voice ID (source-coded default):** `IRHApOXLvnW57QJPQH2P`
- **Edge TTS voice (source-coded):** `en-US-AndrewMultilingualNeural`

### Environment
- `FORCE_ELEVENLABS`: UNSET
- `ELEVENLABS_API_KEY`: UNSET
- `ELEVENLABS_API_KEY_ALT`: UNSET

### Source Block (verbatim quote of the chain assembly)
```typescript
  const chain: TTSProvider[] = [];
  const forceElevenLabs = process.env.FORCE_ELEVENLABS === "true";

  if (forceElevenLabs && config.voice.elevenLabsApiKey) {
    chain.push("elevenlabs"); // Only first if explicitly forced
  }
  chain.push("edge"); // FREE — always primary unless forced otherwise
  if (!forceElevenLabs && config.voice.elevenLabsApiKey) {
    chain.push("elevenlabs"); // Demoted to fallback
  }
  if (config.voice.whisperApiKey) chain.push("openai");

  let lastError: Error | null = null;

  for (const provider of chain) {
```

## Agent LLM Teams — src/index.ts
### Environment
- `LLM_FAILOVER_ORDER`: UNSET
- `ANTHROPIC_API_KEY`: UNSET
- `GROQ_API_KEY`: UNSET
- `GROQ_API_KEY_TCF`: UNSET
- `GEMINI_API_KEY`: UNSET
- `OPENAI_API_KEY`: UNSET

### AGENT_LLM_TEAMS block (verbatim)
```typescript
  const AGENT_LLM_TEAMS: Record<string, FailoverLLM> = {
    alfred: buildTeamLLM(["anthropic", "groq"], 0, false),    // Anthropic-first — dispatches + user chat
    anita: buildTeamLLM(["anthropic", "groq"], 0, true),      // Anthropic-first — dispatches + user chat
    sapphire: buildTeamLLM(["anthropic", "groq"]),             // Anthropic-first (unchanged)
    veritas: buildTeamLLM(["anthropic", "groq"]),              // Anthropic-first (unchanged)
    vector: buildTeamLLM(["anthropic", "groq"], 0, false),    // Anthropic-first — dispatches + user chat
    yuki: buildTeamLLM(["anthropic", "groq"], 0, true),       // Anthropic-first — dispatches + user chat
  };
```
### Pipeline LLMs (verbatim)
```typescript
  const pipelineLLM = buildTeamLLM(["groq", "anthropic"], 1, false);     // Key A — Ace pipeline
  const tcfPipelineLLM = buildTeamLLM(["groq", "anthropic"], 1, true);   // Key B — TCF pipeline
```

## Critical Environment Variables (presence only)
> Only SET / UNSET status is shown. Secret values are never printed.

**Database & Memory**
- `SUPABASE_URL`: UNSET
- `SUPABASE_SERVICE_ROLE_KEY`: UNSET
- `PINECONE_API_KEY`: UNSET

**Telegram**
- `TELEGRAM_BOT_TOKEN`: UNSET
- `TELEGRAM_CHAT_ID`: UNSET

**Content Pipeline**
- `BUFFER_ACCESS_TOKEN`: UNSET
- `YOUTUBE_COOKIES_BASE64`: UNSET
- `YOUTUBE_OAUTH_REFRESH_TOKEN`: UNSET
- `TIKTOK_ACCESS_TOKEN`: UNSET
- `INSTAGRAM_ACCESS_TOKEN`: UNSET

**Stripe & Revenue**
- `STRIPE_SECRET_KEY`: UNSET
- `STRIPE_WEBHOOK_SECRET`: UNSET

**Webhook Bridge**
- `MC_WEBHOOK_URL`: UNSET
- `WEBHOOK_SHARED_SECRET`: UNSET


---

## Session-Start Cross-Check Protocol

Every session must run this check against the master reference before trusting any
"current state" claim:

1. Read `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md`
2. Read this file (`LIVE_STATE.md`)
3. If this file is older than 24h → run `npm run verify-state` first
4. If the master reference's routing/credit claims contradict this file → **this file wins**
5. Flag the contradiction and patch the master reference before continuing work

This protocol exists because session-authored references rot, and code does not.
