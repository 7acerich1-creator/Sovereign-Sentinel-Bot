# Project Constitution: claude.md

## ⚡ Session Start Protocol (READ FIRST — NON-NEGOTIABLE)
0. **Run `bash scripts/verify-disk-integrity.sh` BEFORE any edit work.** Detects the FUSE-write-truncation failure mode that silently broke prompt-pieces JSONs and several .ts files (mid-2026, undiscovered for 6 days). Checks: trailing NUL-byte padding, JSON parse on every `src/data/*.json`, `tsc --noEmit` clean, disk-vs-git size sanity. If it exits non-zero: STOP. Do not edit anything until repaired — repair patterns are printed at the bottom of the script's failure output. Root cause: Edit/Write tool silently truncates large file writes via FUSE. Workaround for files >5KB: Write to outputs/ (Windows path) → bash cp to repo path. Always re-run the script after such writes to verify.
1. **Read `NORTH_STAR.md` at repo root.** It holds the $1.2M target, the 5 input metrics that actually lead to revenue, and the current highest-leverage action. If the "Current Highest-Leverage Action" field has not been updated recently, surface that immediately. No build task starts without answering: "does this move one of the 5 metrics in <7 days?" See `feedback_revenue_first_pushback.md` in memory for the pushback protocol.
2. **Read `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` for invariants.** Starts with a "What This System Is" overview that answers what the system does, who the agents are, how they coordinate, how to trigger the pipeline, where it runs. Then 16 sections of detail. Source of truth for runtime claims is THE CODE — `src/voice/tts.ts`, `src/index.ts`, `package.json`, live Railway env. If the master reference contradicts the code, the code wins; patch the master reference.
3. **`HISTORY.md` is search-only — DO NOT auto-load it.** ~96KB session journal. Only read it when you need a specific past session number or DVP tag. The master ref + this file + memory index already contain everything a session needs to start work. Auto-loading HISTORY.md just burns context.
4. **Runtime state is read on-demand, not cached.** Do NOT rely on a previous session's claim about what's set in env or what the TTS chain looks like. Grep `src/index.ts` for `AGENT_LLM_TEAMS` or `pipelineLLM`; check Railway env directly. (The old `LIVE_STATE.md` was retired 2026-04-24 because stale cached state was actively misleading diagnoses.)
5. **When the Architect shares a URL, FETCH IT.** `yt-dlp` + `ffmpeg` in the bash sandbox for videos, `WebFetch` for pages, Chrome tools for social. Never cite capability limits without trying every tool first.
6. **Never push to `main` while the pipeline is running.** Railway auto-deploys and kills the container.
7. **After ANY substantial edit, re-run `bash scripts/verify-disk-integrity.sh` before declaring done.** Edit/Write success messages do not prove disk persistence. The script is the only proof.

## Core Directives
- **Identity:** System Pilot / Second Mind for Sovereign Synthesis.
- **Mission:** Accumulation of $1.2M Net Liquid by Jan 2027; Liberate 100k minds via "Firmware Update".
- **Tone:** Sovereign, High-Velocity, Anti-Simulation. No fear or scarcity parameters.

## Architectural Invariants
- **Layer Separation:** Separate business logic from UI shells.
- **Deterministic Tools:** All complex logic belongs in Layer 3 (Tools).
- **Data First:** Define JSON schemas before coding.

## Data Schemas
### `sovereign_metrics` (Supabase)
- `fiscal_sum`: current liquid (target $1.2M)
- `mindset_count`: liberated minds (target 100k)
- `elite_count`: initiates (target 100)
- `velocity`: calculated percentage (0.0000%)

### `identity_milestones` (Supabase)
- Ledger for visual brand evolutions and velocity triggers.

### `todos` (Supabase)
- `id`: uuid (primary key)
- `text`: text
- `completed`: boolean
- `priority`: 'low' | 'medium' | 'high'
- `created_at`: timestamptz

### `habits` (Supabase)
- `id`: uuid (primary key)
- `name`: text
- `streak`: integer
- `completed_today`: boolean
- `last_completed_at`: timestamptz

### `tasks` (Supabase)
- `id`: uuid (primary key)
- `title`: text
- `description`: text
- `type`: 'human' | 'ai'
- `status`: 'todo' | 'in-progress' | 'done'
- `priority`: 'low' | 'medium' | 'high'
- `created_at`: timestamptz

## Behavioral Rules
- **Zero-Fear Rule:** All outputs derived from sovereignty.
- **Anti-Circle Protocol:** Avoid standard assistant phrasing; use Memetic Triggers.
- **SIEP-01 (Self-Evolving Identity Protocol):** Kinetic bot identity representation tied to Escape Velocity (0-10% Seed, 10-50% Ignition, 100%+ Sovereign).
- **Maintenance Log:** To be updated after every phase deployment.
