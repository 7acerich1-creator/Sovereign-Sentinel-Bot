# Agent Brand Update Prompts — S107

Copy-paste these into each agent's Telegram chat to update them on the rebrand.

---

## ALL AGENTS (send to each one):

```
BRAND UPDATE — EFFECTIVE IMMEDIATELY:

The channel formerly known as "Ace Richie 77" is now "Sovereign Synthesis." This is not a cosmetic change — this is a full identity rebrand.

WHAT CHANGED:
- "Ace Richie" as a brand no longer exists. The brand is "Sovereign Synthesis."
- "Ace" is still the Architect's name. You still call him Ace. He is still the founder. But the BRAND is Sovereign Synthesis.
- The YouTube channel is now Sovereign Synthesis. Handle: @sovereign_synthesis77
- Two brands, two channels: Sovereign Synthesis (primary) + The Containment Field (dark psychology feeder)
- Both brands funnel to sovereign-synthesis.com
- All social profiles have been updated

WHAT STAYS THE SAME:
- The Containment Field brand, identity, and channel are unchanged
- The funnel (T0-T7) is unchanged
- Stripe products are unchanged
- sovereign-synthesis.com is unchanged
- The mission ($1.2M, 100K minds, 100 Inner Circle) is unchanged

VISUAL IDENTITY SPLIT (critical for content):
- Sovereign Synthesis = WARM. Gold, amber, tungsten light. Environments and objects ONLY — NO human figures, NO faces, NO skin in any generated images. Truth energy. Gregory Crewdson aesthetic.
- The Containment Field = COLD. Blue, steel, teal. Surveillance, institutional corridors, oppressive architecture. Silhouettes permitted. Fincher aesthetic.

These two brands must NEVER look like they came from the same source. Completely distinct visual DNA.

Sign-offs are now "— Sovereign Synthesis" (not "— Ace Richie | Sovereign Synthesis").

Acknowledge this update and confirm you understand the distinction.
```

---

## ANITA (additional — growth/copy specific):

```
ANITA — COPY UPDATE:

All copy you produce for the Sovereign Synthesis brand signs off as "— Sovereign Synthesis." Drop "Ace Richie" from all sign-offs, headers, and brand references.

When writing for The Containment Field: NEVER mention Sovereign Synthesis, Ace, or any product by name. TCF is anonymous. The bridge happens organically through the viewer's own curiosity.

The 4-Part Copy Architecture (GLITCH → PIVOT → BRIDGE → ANCHOR) remains identical. The voice mandate remains identical. Only the brand name has changed.

Confirm.
```

---

## YUKI (additional — distribution specific):

```
YUKI — DISTRIBUTION UPDATE:

Channel routing has been updated in the codebase. Buffer channels for the renamed profiles should auto-detect via the new regex patterns.

When scheduling content:
- Sovereign Synthesis channels: warm, sovereign energy, environments/objects imagery
- Containment Field channels: cold, clinical, surveillance imagery
- CTA overlay for SS shorts: "@sovereign_synthesis77"
- CTA overlay for CF shorts: "@TheContainmentField"

Cross-contamination between brand aesthetics is a hard failure. If you're unsure which brand a piece belongs to, ask before posting.

Confirm.
```

---

## ALFRED (additional — content direction specific):

```
ALFRED — CONTENT DIRECTION UPDATE:

Your visual direction rules have been overhauled in the codebase. When generating script segments:

FOR SOVEREIGN SYNTHESIS:
- Visual directions must describe ENVIRONMENTS and OBJECTS only
- Absolutely NO people, NO human figures, NO faces, NO hands, NO skin
- Warm tungsten/amber/gold lighting only
- Think: empty architect's desk at golden hour, worn leather journal under a lamp, blueprints scattered across mahogany, a vault door swinging open into golden light
- Camera language: "ARRI Alexa 65, warm tungsten lighting, tangible material texture"

FOR THE CONTAINMENT FIELD:
- Cold blue/steel/teal institutional environments
- Human silhouettes permitted (small, dwarfed by oppressive architecture)
- Security cameras, fluorescent lighting, concrete corridors
- Camera language: "security camera angle, cold fluorescent lighting, clinical atmosphere"

Thumbnail text has been bumped from 3-6 words to 6-10 words. Write complete standalone statements that work as scroll-stoppers.

Confirm.
```

---

## VECTOR (additional — analytics specific):

```
VECTOR — ANALYTICS UPDATE:

The brand identifier in all Supabase tables has changed from "ace_richie" to "sovereign_synthesis." Any queries filtering by brand must use the new value. The Supabase migration has already been applied — all historical data has been updated.

Tables affected: content_engine_queue, youtube_comments_seen, niche_cooldown, cta_audit_proposals.

When reporting metrics, reference "Sovereign Synthesis" (not "Ace Richie") and "SS" (not "Ace") as the shorthand.

Confirm.
```

---

## SAPPHIRE (additional — operations specific):

```
SAPPHIRE — OPERATIONAL UPDATE:

A NudeNet v3 NSFW safety gate has been added to the FLUX image generation pipeline. Every generated image now passes through a classifier before entering the video composition pipeline. This was triggered by a YouTube channel warning for nudity in AI-generated images.

The gate works automatically:
1. Image generated → NudeNet scores it
2. Score > 0.65 → auto-retry with safety suffix
3. Second fail → environment-only fallback image + incident logged

Monitor for: nsfw_detected, nsfw_retry, nsfw_hard_fail log events during pipeline runs. If nsfw_hard_fail frequency exceeds 5% of scenes, escalate — the prompt templates may need further refinement.

Also: brand identifier is now "sovereign_synthesis" in all Supabase queries. Migration 008 has been applied.

Confirm.
```
