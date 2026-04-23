# SKILL: Sovereign Funnel Audit

## Purpose
Deep strategic audit of the entire Sovereign Synthesis conversion funnel — from content impression to product purchase. This is NOT a surface-level status check. This is a systematic teardown of every stage, identifying leaks, broken links, missing assets, and conversion blockers.

## When to Activate
- User says "audit my funnel", "check my funnel", "funnel health", "conversion audit"
- User asks about link strategy, CTA effectiveness, or why revenue is $0
- User asks about landing pages, product ladder, or email sequences

## Architecture Context

### The Funnel Stages
1. **IMPRESSION** — Content reaches eyeballs (YouTube, TikTok, IG, X, Threads, LinkedIn, Pinterest)
2. **CLICK** — Viewer visits sovereign-synthesis.com (T0 landing page)
3. **CAPTURE** — Email collected via lead magnet on T0 page
4. **NURTURE** — Email sequence educates and builds trust
5. **CONVERT T1** — The Shield: Protocol 77 ($77) — first paid product
6. **ASCEND** — T2→T6 upsell ladder through continued relationship

### Two Brands Feed the Top
- **Sovereign Synthesis** — personal brand, all 5 niches, primary revenue driver
- **The Containment Field** — anonymous dark psychology feeder, top-of-funnel only, creates curiosity → funnels to sovereign-synthesis.com

### Product Ladder (Stripe — LOCKED)
- T0: Free (email capture at sovereign-synthesis.com root domain)
- T1: The Shield: Protocol 77 — $77 (prod_UAvCSFqyO1DhOt)
- T2: The Map: Navigation Override — $177 (prod_UAvCuJRCaw6VNE)
- T3: The Architect: Foundation Protocol — $477 (prod_UAvCaUUJF45gtE)
- T4: The Architect: Adversarial Systems — $1,497 (prod_UAvCbyZdNcV9Q0)
- T5: The Architect: Sovereign Integration — $3,777 (prod_UAvCJAItedto70)
- T6: Inner Circle: Sovereign Licensing — $12,000 (prod_UAvCmnkjzGOpN2)

### CTA Strategy
- All video CTAs (spoken + text): "sovereign-synthesis.com" — clean, warm, memorable
- YouTube descriptions: sovereign-synthesis.com as primary link
- TikTok: Profile link field only (80 char bio limit, no in-post links)
- Instagram: Link in bio → sovereign-synthesis.com
- X/Threads/LinkedIn/Facebook: Domain mention in post text (these platforms allow it)
- NEVER use long paths like /tier-0/links in CTAs — kills memorability and conversion

## Audit Methodology

When activated, run ALL of the following checks systematically:

### Stage 1: Content Distribution Health
Use `social_scheduler_list_profiles` and `social_scheduler_pending_posts` to check:
- [ ] How many Buffer channels are active and connected?
- [ ] Are posts actually scheduling and publishing? Any failed posts?
- [ ] Is content going to BOTH Sovereign Synthesis AND Containment Field channels?
- [ ] What's the posting frequency? Target: 250+ pieces/week across all platforms
- [ ] Are video clips (TikTok/IG/YouTube Shorts) getting public URLs from Supabase storage?

### Stage 2: CTA & Link Integrity
Use `browser` or `fetch_url` to check:
- [ ] Does sovereign-synthesis.com load? What page does it show?
- [ ] Is sovereign-synthesis.com functioning as T0 (email capture)?
- [ ] Does the T0 page have a clear lead magnet and email form?
- [ ] Do YouTube video descriptions contain sovereign-synthesis.com?
- [ ] Check Instagram bio link — does it point to sovereign-synthesis.com?
- [ ] Check TikTok profile link — does it point to sovereign-synthesis.com?

### Stage 3: Stripe Product Health
Use `stripe_metrics` to check:
- [ ] Are all 6 products active in Stripe?
- [ ] Any payment links configured and working?
- [ ] Any customers or subscriptions? (Revenue target: $1.2M by Jan 2027)
- [ ] Are product prices correct? ($77, $177, $477, $1497, $3777, $12000)

### Stage 4: Email Sequence (Manual Check)
Flag for Architect attention:
- [ ] Is there an email service provider connected? (ConvertKit, Mailchimp, etc.)
- [ ] Does T0 actually capture emails?
- [ ] Is there an automated email sequence that nurtures → T1 offer?
- [ ] How many emails in the sequence? What's the cadence?

### Stage 5: Pipeline Production Health
Query Supabase for recent activity:
- [ ] How many videos produced in the last 7 days?
- [ ] How many clips generated and distributed?
- [ ] Are both brands (sovereign_synthesis + containment_field) producing content?
- [ ] Any pipeline failures in the last 7 days?
- [ ] Is Alfred's daily trend scan finding and triggering pipelines?

### Stage 6: The Containment Field → Sovereign Synthesis Handoff
- [ ] Does TCF content have CTAs that lead to sovereign-synthesis.com?
- [ ] Is TCF YouTube channel getting long-form uploads? (Requires YOUTUBE_REFRESH_TOKEN_TCF)
- [ ] Are TCF clips distributing to TCF-specific Buffer channels?
- [ ] Is the TCF voice/brand distinct from Sovereign Synthesis? (Anonymous, dark psych only, no face)

## Output Format
Present findings as a strategic brief, NOT a checklist. Lead with the most critical blocker. Group issues by severity:
- 🔴 **CRITICAL** — Revenue-blocking. Fix immediately.
- 🟡 **WARNING** — Reducing effectiveness. Fix this week.
- 🟢 **HEALTHY** — Working as designed.

End with a prioritized action list: what to fix first, second, third.

## Known Issues (as of Session 26, 2026-04-05)
- sovereign-synthesis.com root domain is NOT functioning as T0
- T0 lives at /tier-0/links (bad URL for CTAs)
- Instagram bio points to old T0 path
- TikTok has no clickable link configured
- Revenue: $0. No email capture. No nurture sequence.
- Gemini billing: $62.30 balance, card declining
- The Containment Field YouTube not receiving long-form uploads (YOUTUBE_REFRESH_TOKEN_TCF may not be set)
