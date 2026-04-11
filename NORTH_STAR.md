# NORTH_STAR.md — The Only File That Matters

> **⚡ Read this BEFORE `LIVE_STATE.md`, BEFORE the master reference, BEFORE anything.**
> Every session reads this first. If nothing here changed in the last session, the last session didn't move the mission.

---

## The One Target
**$1,200,000 net liquid by January 1, 2027.**
Everything else is a means. If a proposed action does not move this number or the input metrics that lead to it, it is a distraction.

## The Input Metrics That Actually Lead to the Target
These are the only numbers that matter. If the dial is at zero on any of these, the session's job is to move *that* dial, not to build something adjacent.

1. **Top-of-funnel attention per week** (YouTube views, Shorts views, IG reach). Target: 10,000/wk baseline, 100,000/wk for escape velocity.
2. **Landing page visitors per week** (sovereign-landing analytics). Target: 500/wk to test conversion.
3. **Email list signups per week** (Tier 0/T1 opt-ins). Target: 50/wk to feed the nurture sequence.
4. **Paid conversions per week** (Stripe). Target: 1/wk at any tier to prove the funnel works end-to-end.
5. **Revenue per week** (Stripe net). Target: $77/wk → $770/wk → $7,700/wk.

**Current reality (measured 2026-04-10, Session 46 funnel audit — the first real audit in 46 sessions):**

| Metric | Target/wk | Current (28d → /wk) | Gap to target | Notes |
|---|---|---|---|---|
| **1. Top-of-funnel attention** | 10,000/wk | ~930/wk combined | **~10x short** | Ace Richie YT: 3.7K views/28d (~925/wk). The Containment Field: 20 views/28d (~5/wk). Buffer: 322 impressions TOTAL (not /wk). |
| **2. Landing page visitors** | 500/wk | **0 AND UNMEASURABLE** | **∞** | sovereign-landing shows 0 visitors on Vercel. But also: `@vercel/analytics` package is NOT INSTALLED. We literally cannot measure this metric right now. |
| **3. Email signups** | 50/wk | **0 confirmed** | **50/wk** | No opt-in data surfaced. |
| **4. Paid conversions** | 1/wk | **0** | **1/wk** | Stripe: $0.00 gross, $0.00 net, 7-day window empty. |
| **5. Revenue** | $77/wk → $7,700/wk | **$0/wk** | **$77/wk** | Stripe shows no payments, no balances, no activity. |

**Channel snapshot (2026-04-10):**
- **Ace Richie YT** — 44 subs (+12/28d, organic), 3.7K views/28d, 10.6 watch hrs, top video "OUTDATED CODE" at **14.3% CTR** (strong), top content "You Chosen? #Shorts" at 46 views. **This is the brightest signal in the entire stack.** Do not abandon it.
- **The Containment Field YT** — 3 subs (+2/28d), 20 views/28d, 0.8 watch hrs. Alive but pre-escape-velocity. Not a scale target yet.
- **Buffer** — 322 impressions total (+1794% = starting from zero), 9 engagements, 0 audience.
- **X/Twitter** — **CANCELED 2026-04-10.** One fewer channel. Distribution strategy must be updated.
- **sovereign-landing** — 0 measurable traffic AND no analytics package installed (broken measurement layer).
- **Stripe** — $0 across every metric.

**The diagnosis:** The bottleneck is not attention (Ace Richie YT is doing 925 views/wk with 0 paid effort and a 14.3% CTR on the last video — that's real). The bottleneck is that **nothing connects the attention to the funnel**. No CTAs on YouTube driving to sovereign-landing. No analytics on sovereign-landing to even measure if CTAs worked. No signups because nobody lands. No Stripe events because nobody signs up. **The funnel has a severed spine at the landing page.**

---

## The Current Highest-Leverage Action (UPDATE EVERY SESSION)
*If this field says the same thing two sessions in a row, the last session didn't earn its keep.*

**Action:** **Reconnect the severed spine — Ace Richie YT → sovereign-landing — in 7 days.**

Concrete 7-day intervention (do this, in this order, nothing else):

1. **Install `@vercel/analytics` on sovereign-landing repo** (~20 min). `npm i @vercel/analytics` + `<Analytics />` in root layout + deploy. Without this we are flying blind on metric #2 forever.
2. **Audit the top 3 Ace Richie YT videos** for CTA presence + destination. Target videos: "OUTDATED CODE" (14.3% CTR = strongest), "You Chosen? #Shorts" (46 views = most-watched), one other top performer. Does the description link to sovereign-landing? Does the pinned comment? Does the in-video CTA speak the URL? Screenshot each. If not, fix immediately.
3. **Publish ONE new Ace Richie long-form video this week** with a boring, direct, front-loaded CTA to sovereign-landing. Not clever. Not artful. "Link in description, sovereign-landing.com, opt in if you want the framework." Watch the Vercel dashboard for 7 days. This is the first feedback loop we will ever have run.
4. **Update `project_distribution_strategy.md` memory** to remove X/Twitter from the channel list. Check Railway env vars + Buffer channel IDs — if the bot is still trying to post to a dead X channel it is wasting cycles and producing silent errors.

**Why this and not something else:** Ace Richie YT is the brightest organic signal in 46 sessions of work. 14.3% CTR and +12 organic subs/28d is real. Every session to date has either built more infrastructure upstream (bot, agents, pipelines) or wished downstream (landing copy, funnel tiers). Nobody ever connected them. The cheapest, fastest, most-measurable move is to install a working measurement layer on sovereign-landing and then point the one channel that actually has eyes at it.

**Why NOT build something new:** Because we have 0 signups, 0 conversions, $0 revenue AND cannot measure our landing page. Building anything else right now is indistinguishable from continuing the stuck pattern.

**Last updated:** 2026-04-10 (Session 46 — first real funnel audit completed. Worst metric identified: sovereign-landing measurement layer is broken. Intervention proposed.)

**Updated by:** Session 46 (Claude, with Ace's screenshots)

---

## The Pushback Rule (NON-NEGOTIABLE)
If Ace proposes a build task — any new code, any refactor, any infrastructure work — the first question is:

> **"Does this move one of the 5 input metrics above in less than 7 days, measurably?"**

- **If yes:** Execute without friction.
- **If no:** Push back in writing before starting. Offer the revenue-first alternative. Respect his final call if he still wants to build — but don't let him build in silence.

This rule exists because 46 sessions of building with $0 revenue is the signal that "build first, revenue later" is a loop, not a strategy. The next session that breaks the loop is the session that started generating.

---

## What This File Is NOT
- Not a task list (that's for tasks)
- Not a roadmap (that's for planning)
- Not a changelog (that's the master reference)
- Not aspirational language (aspirations don't close loops)

This file is the terminal authority on **whether today's work was revenue-relevant**. The answer is yes or no. Write it down.
