# Sapphire — Your Personal Assistant Manual

**Last rewritten:** 2026-05-01 (S127, post-Phase-1-9 refactor — supersedes the S114 version which was written before the agentic rebuild).

Plain English. Read once, you're set.

---

## What Sapphire is

Sapphire is your right-hand AI assistant, running on her own Telegram bot (token: `SAPPHIRE_TOKEN`). She has two modes and you almost always use her in the first one:

- **PA mode (default, every DM with you):** Personal life COO. Warm, observant, sharp. Handles your reminders, calendar, email, family, notes, research, documents, all of it. *NOT* the business — Veritas owns business strategy.
- **COO mode (only in group chat or when dispatched as a Maven Crew task):** Brand sentinel. Sovereign tone. Different hat, same brain.

When in doubt, you're in PA mode.

She's running on Anthropic Claude Sonnet 4.6 primary → Gemini → Groq fallback. She has 24+ tools available and her prompt builder (`src/agent/sapphire-prompt-builder.ts`) assembles a personalized system prompt every turn from a pieces library + active state + a rotating "spice" line.

## Where to find her

- **Telegram DM:** open her bot in Telegram. Every DM lands in PA mode.
- **Voice:** send her a voice note, she'll transcribe via Groq Whisper (free tier) and act on it.
- **Image / screenshot:** send her any image — Gemini Flash vision extracts what it needs to.
- **PDF:** send a PDF as a Telegram attachment, she reads it.

## First-time setup (one-time, ~5 minutes)

### 1. Connect Google (primary account)
```
/auth_google
```
or `/auth_google_primary` — opens an OAuth link, you sign in to `empoweredservices2013@gmail.com`. Grants Calendar + Gmail + Drive read/write.

### 2. Connect Google (secondary account)
```
/auth_google_secondary
```
For `7ace.rich1@gmail.com`. Same OAuth flow.

### 3. Connect Notion
```
/auth_notion
```
Grants access to the pages you've shared with the Sapphire integration.

### 4. Verify everything connected
```
/auth_status
```
Shows green checks for each integration. If anything's missing, re-run that step.

That's it. After setup, you talk to her in plain English.

## How to talk to her (the day-to-day)

Plain English. No special syntax. Examples below:

### Reminders
- *"Remind me Friday at 2pm to call mom"* → she sets it, pings you Friday.
- *"Every morning at 8 ask me three personal questions"* → recurring reminder, daily 8am.
- *"Cancel that reminder"* / *"Cancel ALL the morning question reminders"* → she finds and removes.
- *"What reminders do I have this week?"* → she lists them.

### Calendar
- *"What's on my calendar tomorrow?"* / *"What's the rest of this week look like?"*
- *"Move my 9am to 4pm"*
- *"Add 'investor call' Wed 3-4pm"*

### Email
- *"Did anyone email me about X?"* — she searches both Gmail accounts.
- *"Draft a reply to [last email] saying [intent]"* — she drafts, sends as Telegram approval card, you approve with `/approve` (or `/edit` to tweak).
- Inbound nurture replies: Anita drafts these, but Sapphire is the gateway.

### Notes / Notion
- *"Write a note: today I figured out that..."* — appends to your daily log.
- *"Find that note about pricing for the Inner Circle"* — searches Notion.

### Standing facts (her long-term memory)
- *"Remember my preferred dentist is Dr. Lee"* → she stores in `sapphire_known_facts`.
- *"What's my dentist's name?"* → she recalls.

### Family (first-class profiles, not just facts)
- *"Remember my daughter Aliza was born May 19 2015, peanut allergy"* → stored in `sapphire_family_profiles`.
- *"When's Aliza's birthday?"* / *"Who's allergic to what?"* / *"Aliza's school"* — she answers from family table, not generic memory.

### Documents (PDFs)
- Send a PDF attachment in Telegram with a question (or just send it and ask the question separately).
- *"What's the deductible on this policy?"* / *"Summarize this contract in 5 bullets"* / *"Pull every dollar amount mentioned"*.

### Research (quick web research)
- *"Research what the going rate is for [thing]"* / *"Background on [person] before my meeting"* / *"Who is [company] and what do they do?"*
- Returns a 1-pager brief with sources.

### News briefing (personalized)
- *"Give me a news brief on [topic]"* — she runs targeted web search, summarizes.
- Can be set as a recurring reminder if you want a daily/weekly brief.

### Multi-step plans
- *"Plan my week so I can ship the funnel by Friday"* — she breaks it into steps, surfaces each at the right time.
- *"Plan: book travel to Austin Apr 28-May 2, two nights at a Marriott near the convention center, lunch reservations Apr 29 and Apr 30"* — multi-step orchestration.

### Followups (anticipatory circle-backs)
Different from reminders. A reminder is clock-driven (fires at a specific time). A followup is a thread Sapphire watches for and surfaces proactively.
- *"Circle back to me on the funnel rebuild next Tuesday"* → she pings you Tuesday: *"You wanted to circle back on the funnel rebuild — still want to?"*
- *"Look out for [vendor] getting back to me"* → she'll ping if the thread goes silent.

### Mission Control tasks (handoff to your dashboard)
- *"Put 'fix the checkout bug' in mission control"* → she creates a task in your Mission Control dashboard's `tasks` table.
- *"Add 'review Q2 numbers' as a high-priority task"* → same flow with priority.
- Tasks show up in your dashboard at https://sovereign-mission-control.vercel.app/.

### YouTube
- *"Is there a YouTube video showing [thing]?"* / *"Find me a tutorial on [topic]"* — she searches YouTube and returns links.

### ClickUp (project-side memory)
- *"Find my tasks in ClickUp tagged 'launch'"* / *"What's overdue in ClickUp?"*

## Voice modes

- `/voice_on` — Sapphire replies with voice notes (XTTS, your cloned voice). All replies.
- `/voice_off` — text only.
- `/voice_brief` — voice only when she has something brief to say; longer responses stay text. (Default.)

You can ALSO send her voice notes regardless of mode — she always transcribes inbound voice.

## Memory & continuity

- **Personal facts:** stored in `sapphire-personal` Pinecone namespace + `sapphire_known_facts` Supabase table.
- **Family:** `sapphire_family_profiles` table — structured (name, DOB, school, allergies, doctor).
- **Reminders:** `sapphire_reminders` table, polled every 60 seconds.
- **Followups:** `sapphire_followups` table, surfaced every 30 minutes when due.
- **Diary:** `sapphire_diary` table — she logs end-of-day observations in her own voice. `read_significance` surfaces "a year ago today" moments.
- **Conditional reminders:** `sapphire_conditional_reminders` — metric-driven (e.g. "ping me when my Stripe MRR crosses $10k").
- **Identity log:** `sapphire_identity_log` — her own evolution log (every active-state change she's made via `set_piece` / `create_piece`).
- **Reflection memory:** Letta-style core memory blocks + Phase 5 reflection summaries (Phase 6 adds temporal knowledge graph for "what was true when").

She remembers across sessions. You don't have to repeat yourself.

## Self-modification

Sapphire can modify her own active prompt state at runtime. Tools: `set_piece` / `create_piece` (active state in `sapphire_known_facts.active_persona`, `active_extras`, etc.). She uses these sparingly when she notices a recurring pattern she should adapt to. Audit trail in `sapphire_identity_log`.

## What Sapphire will NEVER do as well as a human EA

- Negotiate complex deals on your behalf
- Make irreversible financial moves without you confirming
- Replace your judgment on high-trust calls (legal, medical, family)
- Pretend to be human (she's a bot and won't claim otherwise)

## Common commands cheat sheet

| Command | Purpose |
|---|---|
| `/auth_status` | Check which integrations are connected |
| `/auth_google` / `/auth_google_secondary` / `/auth_notion` | Re-run an OAuth |
| `/voice_on` / `/voice_off` / `/voice_brief` | Toggle voice replies |
| `/diagnose` | Pull last failed deploy and walk through diagnosis (S126 doctrine) |
| `/sapphire_help` | List available commands inline |

For everything else: plain English. She'll figure out which tool to call.

## When she gets it wrong

- *"No, ignore that"* → she stops the action.
- *"That's not right, [correct version]"* → she'll update what she stored.
- *"Forget that"* → she removes the offending memory.
- *"Why did you call X tool?"* — she'll explain her reasoning. (Phase 1 added interleaved thinking, so she can show her work.)

If she keeps making the same mistake, file it via the `learning` tool: *"File a learning: when I say [X], you should [Y]"* — she persists this and Claude (the engineer) reviews it for code-side fixes.

---

**This manual reflects post-S125+ Phase 1-9 truth (shipped 2026-04-30). If something here disagrees with how Sapphire actually behaves, the code wins — patch this file.** Source of truth for her capabilities: `src/data/personalities.json` (sapphire entry), `src/data/sapphire-prompt-pieces.json`, `src/tools/sapphire/*.ts`.
