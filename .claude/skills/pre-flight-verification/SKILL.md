---
name: pre-flight-verification
description: Mandatory deep-trace verification protocol before declaring ANY system operational. Prevents surface-level diagnostics from masking hidden failures.
---

# Pre-Flight Verification Protocol (PFV-01)

## PURPOSE

Surface-level diagnostics lie. A health endpoint returning "ok" does NOT mean the pipeline works. An API key existing does NOT mean it's loaded into the provider chain. A config default does NOT mean the runtime uses that default.

This protocol exists because of a pattern that has killed pipeline runs repeatedly: **code documents one thing, runtime does another, and surface checks can't tell the difference.**

## WHEN TO ACTIVATE

MANDATORY before:
- Declaring a system "ready" or "operational"
- Giving the green light on any pipeline run
- Telling the Architect "the machine is armed"
- Any session where infrastructure changes were made in a prior session but never verified

## THE PROTOCOL: 5 LAYERS OF VERIFICATION

### LAYER 1: RUNTIME CHAIN VERIFICATION (not just key existence)

**The Rule:** Never trust that a key exists. Verify the key is LOADED and ACTIVE in the runtime chain.

**Case study:** `GROQ_API_KEY` existed in Railway. VidRush status confirmed `groq_whisper: true`. But Groq was never initialized as an LLM provider because `LLM_FAILOVER_ORDER` env var in Railway didn't include it. `buildTeamLLM(["groq", ...])` silently skipped Groq because it wasn't in `providersByName`.

**The Check:**
1. For every provider that should be in a chain, verify it appears in the RUNTIME output — not just the config.
2. Hit `/api/content-engine/diag` and confirm `llm_chain` lists expected providers in expected order.
3. If a provider is missing from runtime chain but its key exists, the env var override is the first suspect.

**Implementation:** The diag endpoint MUST report `llm_chain: ["groq", "gemini", "anthropic", "openai"]` — the actual instantiated provider list, not the config default.

### LAYER 2: ENV VAR OVERRIDE AUDIT

**The Rule:** Any function that reads env vars with a fallback default (`envList`, `envInt`, `process.env.X || "default"`) can be silently overridden by a Railway env var set in a previous session.

**Case study:** `config.ts` has `failoverOrder: envList("LLM_FAILOVER_ORDER", ["anthropic", "gemini", "groq", "openai", "deepseek"])`. Default includes Groq. But if `LLM_FAILOVER_ORDER` was set in Railway before Groq was added, it overrides the default and excludes Groq permanently.

**The Check:**
1. When adding a new provider/feature that depends on being in an env-var-controlled list, verify the actual Railway env var value — not just the code default.
2. Treat every `envList()` / `envInt()` call as a potential override site.
3. When in doubt, remove the Railway env var so the code default takes effect. Or update the Railway env var to include the new provider.

### LAYER 3: ERROR MESSAGE FORENSICS

**The Rule:** Read error messages as data, not just descriptions. Count the providers listed. Compare against what should be there. A missing provider in an error is more informative than the providers that are listed.

**Case study:** Error said `"All LLM providers failed: 1. gemini... 2. anthropic... 3. openai..."` — three providers. The pipelineLLM was built with `["groq", "gemini", "anthropic", "openai"]` — four providers. The missing provider IS the bug.

**The Check:**
1. When a failover chain reports failure, count the entries. Compare against expected chain length.
2. If the count doesn't match, a provider was never instantiated. That's the root cause — not the failures of the providers that DID try.

### LAYER 4: THEORY vs. PRACTICAL VERIFICATION

**The Rule:** Code existing is not the same as code executing. A function being defined is not the same as it being called. A config value being written is not the same as it being read at runtime.

This is the "THEORY to PRACTICAL FLOWS" pattern from the master reference. It has caught us before (Buffer enum, Make.com scenarios, content engine distribution). It will catch us again if we don't verify.

**The Check:**
1. For any new feature: trace the call path from trigger to execution. Identify every handoff point.
2. At each handoff: verify the value being passed is what you expect, not what the code says it should be.
3. The boot log is the source of truth for what's actually loaded. `Active model:` lines tell you which providers exist. If a provider isn't in the boot log, it doesn't exist at runtime — period.

### LAYER 5: SMOKE TEST BEFORE LIVE FIRE

**The Rule:** Never send the Architect into a live pipeline run without a smoke test that exercises the EXACT path the pipeline will take.

**The Check:**
1. `/test_tts` — verifies the TTS chain fires (which provider, success/failure).
2. `/api/content-engine/diag` — verifies LLM chain AND TTS chain with actual runtime data. (Image gen chain probe was removed S127 — image gen runs through RunPod FLUX, verified via `/flux-batch` instead.)
3. `/dryrun <url>` — verifies the full pipeline logic without burning real resources.
4. Only after all three return clean do you declare the system operational.

## POST-FAILURE INVESTIGATION TEMPLATE

When a pipeline run fails, before attempting any fix:

```
1. WHAT FAILED: [exact error message, verbatim]
2. WHAT'S MISSING: [compare error against expected chain — what's absent?]
3. WHY IT'S MISSING: [trace from config -> env var -> provider init -> runtime chain]
4. WHERE IT DIVERGES: [the exact line where code expectation != runtime reality]
5. WHAT MASKED IT: [which surface diagnostic gave a false green light?]
6. THE FIX: [code change, env var change, or both]
7. THE GUARD: [what diagnostic/check prevents this class of failure from recurring?]
```

## REQUIRED DIAG ENDPOINT FIELDS (post-S127)

The `/api/content-engine/diag` endpoint MUST report:
- `llm_chain`: Array of provider names in actual failover order
- `llm_chain_count`: Number of active providers
- `pipeline_llm_chain`: The pipeline-specific LLM chain
- `tts_chain`: Always ["xtts"] (S106: ElevenLabs/Edge/OpenAI TTS purged)
- `xtts_server_url_set`: Boolean
- `gemini_text_key_set`: Boolean
- `openai_key_set`: Boolean

Image generation is NOT probed by this endpoint anymore (S127). Image gen runs through RunPod FLUX exclusively; verify via `/flux-batch` and pod logs.

## THE GOLDEN RULE

**"It's not real until I see it in the runtime output."**

Not the config file. Not the code. Not the env var dashboard. The RUNTIME OUTPUT. Boot logs, diag endpoint responses, actual error messages. That's reality. Everything else is theory.
