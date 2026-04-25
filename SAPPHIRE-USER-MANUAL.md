# Sapphire — Your Personal Assistant Manual

Plain English. Read once, you're set.

---

## What Sapphire is

Sapphire is your personal assistant in your Telegram. She runs on the same bot infrastructure as your business agents but has a separate brain for your personal life. When you DM her about your calendar, kids, email, errands, or anything personal, she talks like a normal assistant. No "Architect", no jargon, no theatrics.

---

## Where to find her

Open Telegram. Find the bot whose token is `SAPPHIRE_TOKEN` — same Sapphire bot you've always had. Send her a private message. That DM is where everything happens.

---

## First-time setup (one-time, ~5 minutes)

You need to give her access to three things: your two Gmail/Calendar accounts and your Notion. After this, she's set forever.

### 1. Connect empoweredservices2013@gmail.com

DM Sapphire: `/auth_google_primary`

She'll send you a link. Tap it. Google will ask which account — pick `empoweredservices2013@gmail.com`. Click "Continue" / "Allow". Google shows you a code on a page (long string). Copy it. Paste it back to Sapphire as your next message.

She'll say "Got it. empoweredservices2013 is connected."

### 2. Connect 7ace.rich1@gmail.com

DM Sapphire: `/auth_google_secondary`

Same flow. Pick `7ace.rich1@gmail.com` this time. Copy code. Paste back.

### 3. Connect Notion

DM Sapphire: `/auth_notion`

She'll walk you through it, but here's the short version:

a. Open https://www.notion.so/my-integrations in any browser
b. Click "+ New integration"
c. Name it "Sapphire". Pick your main workspace. Click "Submit".
d. On the next page, find "Internal Integration Secret". Click "Show", then "Copy".
e. Paste that secret to Sapphire as your next message.

She'll say "Notion is connected."

### 4. Tell her where to put your daily logs

In Notion, create (or pick) a page where you want your daily operations log to live. Could be a fresh page called "Sapphire Operations Log" or any existing page.

On that page, click the "..." menu in the top right → "Connections" (or "Add connections") → search for "Sapphire" → click it.

Now copy the page's URL (top of the browser).

DM Sapphire: `set my parent page to <paste URL here>`

She'll confirm. From now on, every morning brief and evening wrap gets appended to a daily page inside there.

### 5. Verify everything

DM Sapphire: `/auth_status`

You should see three green checks. If anything's red, run that auth command again.

---

## How to talk to her

Just talk normally. She handles natural language.

### Reminders

- "Remind me Friday at 2pm to take the girls to a birthday party."
- "Remind me in 2 days to call the mechanic."
- "Set a reminder for tomorrow at 9am — gym."
- "What reminders do I have today?"
- "Cancel the mechanic reminder."

She'll set them, list them, cancel them. Reminders fire as DMs at the time you said. They survive the bot restarting (they live in Supabase).

### Calendar

- "What's on my calendar tomorrow?"
- "When is my dentist appointment?"
- "Add a 3pm meeting Wednesday with John."
- "Move my 2pm tomorrow to 4pm."

She reads/writes to BOTH your Gmail accounts' calendars.

### Email

- "Any new emails today?"
- "Anything important come in?"
- "Search my email for the school field trip permission slip."
- "Draft a reply to Sarah saying I can't make it Thursday."
- "Send the email."

By default she creates DRAFTS — she only sends if you explicitly say "send".

### Notes / Notion

- "Add to today: called pediatrician, scheduled for next Tuesday."
- "Find that note about the car insurance renewal."

### Standing facts (her long-term memory)

- "Remember: birthday parties for the girls = $25 gift budget."
- "Remember: my pediatrician is Dr. Patel at City Health."
- "What do you remember about gift budgets?"

She stores these forever, surfaces them automatically when relevant.

---

## What she does on her own (no prompting needed)

| When | What |
|------|------|
| Every 60 seconds | Checks for reminders that are due, fires DMs |
| Every 30 minutes | Scans both inboxes for important new emails (school, urgent, invitations, etc.), DMs you if anything matters |
| Every 6 hours | Looks 48 hours ahead in your calendar, auto-creates a 24h-ahead reminder for any event you don't already have one for |
| 11:00 AM CDT daily | Morning brief — calendar today + tomorrow, important emails, reminders firing today. DM + appended to today's Notion page. |
| 1:15 AM CDT daily | Evening wrap — what fired today, what's tomorrow. DM + appended to that day's Notion page. |

The morning/evening times don't conflict with your content pipeline. Verified.

---

## Voice mode (totally free)

Default: she replies with text.

- `/voice_on` — she replies as voice notes for everything
- `/voice_off` — back to text only
- `/voice_brief` — voice for ONLY the morning brief and evening wrap, text for everything else

You can also send her **voice notes** anytime — she transcribes them and acts on what you said. Useful while driving.

---

## All her commands (the cheat sheet)

| Command | What it does |
|---------|--------------|
| `/sapphire_help` | Show this same cheat sheet inside Telegram |
| `/auth_status` | Show what's connected |
| `/auth_google_primary` | Connect empoweredservices2013 |
| `/auth_google_secondary` | Connect 7ace.rich1 |
| `/auth_notion` | Connect Notion |
| `/voice_on` | Voice-note replies for everything |
| `/voice_off` | Text-only replies |
| `/voice_brief` | Voice only for morning brief / evening wrap |

Everything else is just normal conversation.

---

## When something goes wrong

- **She doesn't reply at all** → Bot might be redeploying. Wait 60 seconds and try again.
- **She says something didn't connect** → Run the auth command again. Codes expire in 10 minutes.
- **Reminder didn't fire** → DM her: "did the X reminder fire?" — she can look it up.
- **Wrong time on a reminder** → Cancel it, set a new one. She defaults to CDT.
- **Notion page didn't update** → Check that the parent page is still shared with the Sapphire integration. Notion sometimes drops connections.

---

## Where things live (for your reference)

| Thing | Lives at |
|-------|----------|
| Sapphire's bot | Telegram, your existing Sapphire DM |
| Reminders / facts / credentials | Supabase project `wzthxohtgojenukmdubz`, tables starting with `sapphire_` |
| Daily operations log | Notion, inside the parent page you set |
| Source code | `Sovereign-Sentinel-Bot` repo, files starting with `sapphire-` and `src/tools/sapphire/` |

---

## What she does NOT do

- She does NOT post content (Yuki does that)
- She does NOT make purchases
- She does NOT delete emails
- She does NOT auto-accept calendar invites (she'll ask you)
- She does NOT touch your business pipeline (Sovereign Synthesis stuff stays with Veritas/Yuki/Anita/Vector)

---

## Quick start: the 90-second test

Once setup is done, send her this exactly:

> Remind me in 5 minutes to test that you're working.

She'll confirm. In 5 minutes you'll get a DM. If you do, she's live.
