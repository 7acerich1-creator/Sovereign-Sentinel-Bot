---
name: maven-crew
description: Agentic hive mind orchestration, meeting harvest, and autonomous content production.
---

# Maven Crew — Agentic Hive Mind

## Overview
The **Maven Crew** is a squad of 6 AI agents operating as a unified content production and business intelligence engine inside the Gravity Claw Telegram bot (Railway). All inter-agent communication flows through the `crew_dispatch` table in Supabase.

- **Runtime**: TypeScript on Railway (service name: "Gravity Claw")
- **Dispatch Engine**: `src/agent/crew-dispatch.ts` — Supabase-backed task routing
- **Poller**: Runs every 15s in `src/index.ts`, claims pending tasks per agent

## The Crew

| Agent | Role | Primary Output |
|-------|------|----------------|
| **Sapphire** | Chief Operations Officer | Strategy coordination, metric analysis, task routing |
| **Alfred** | Content Surgeon | Long-form writing, transcript synthesis, course modules |
| **Yuki** | Viral Agent / Head of Distribution | Short-form clips, captions, Buffer posting (SOLE poster) |
| **Anita** | The Propagandist | Intellectual copy, email sequences, landing pages |
| **Vector** | Funnel & Distribution | Platform adaptation, scheduling, funnel optimization |
| **Veritas** | Intelligence Officer | Research, trend analysis, competitive intelligence |

## Pipeline Routes (Hardcoded in crew-dispatch.ts)
```
Alfred → Yuki (timestamped_hooks) + Anita (cleaned_transcript) + Sapphire (core_summary)
Yuki → Anita (viral_package) + Vector (clip_metadata)
Anita → Vector (platform_posts)
```

## Key Skills Referenced
- **copy-psychology** (`.claude/skills/copy-psychology/SKILL.md`): ALL outbound copy must pass through the 4-Part Copy Architecture (Glitch → Pivot → Bridge → Anchor). Yuki and Anita are primary copy producers. Alfred handles long-form from transcripts only.
- **brand-identity** (`.claude/skills/brand-identity/SKILL.md`): Design tokens, voice/tone, visual identity.
- **business-intelligence** (`.claude/skills/business-intelligence/SKILL.md`): Target avatars, customer journeys, core metrics.

## Dispatch Mechanics
1. **Dispatching**: `dispatchTask({ from_agent, to_agent, task_type, payload, priority, chat_id })`
2. **Claiming**: Poller calls `claimTasks(agentName)` every 15s, marks tasks "claimed"
3. **Processing**: Claimed task payload injected into agent's `processMessage()` via its AgentLoop
4. **Completion**: `completeDispatch(taskId, "completed"|"failed", result)`
5. **Pipeline Handoff**: `triggerPipelineHandoffs(fromAgent, outputs)` auto-dispatches downstream per PIPELINE_ROUTES

## Buffer Distribution Protocol
- **Yuki is the SOLE Buffer posting authority.** No other agent posts directly.
- Other agents dispatch content TO Yuki via `crew_dispatch` for distribution.
- Buffer tools: `SocialSchedulerListProfilesTool`, `SocialSchedulerPostTool`, `SocialSchedulerPendingTool`
- All posts logged to `content_transmissions` table in Supabase.

## Stasis Detection
All 6 agents have a Stasis Detection Protocol in their blueprints. A daily system dispatch at 2PM triggers `stasis_self_check` for each agent. Trigger conditions: no tasks in 48h, declining KPIs, missing pipeline outputs, strategic opportunities, or inter-agent blocks.

## Vid Rush Workflow
1. Ace drops a YouTube URL in Telegram
2. Alfred extracts transcript, identifies hooks, generates cleaned content
3. Pipeline auto-dispatches: Alfred → Yuki (clips) + Anita (narrative) + Sapphire (summary)
4. Yuki produces viral packages → dispatches to Vector for scheduling
5. Anita produces long-form copy → dispatches to Vector for distribution
6. Vector schedules across 9 Buffer channels

## Architecture Boundary
- Gravity Claw (Railway) and Mission Control (Vercel) NEVER communicate directly
- Supabase is the ONLY meeting point between the two
- Bot writes to: `crew_dispatch`, `activity_log`, `vid_rush_queue`, `content_transmissions`
- Dashboard reads those same tables + manages `tasks` table
