# VISUAL PRODUCTION SPEC — Sovereign Synthesis + The Containment Field
**Created: 2026-04-02 (Cowork Session 8)**
**Purpose: Visual production guidelines for both brands.**
**Design Tokens:** `.claude/skills/brand-identity/resources/design-tokens.json` is the CANONICAL color/font reference. This spec must align with those tokens.

---

## CORE PRINCIPLE

The distinction between content that converts and content that gets scrolled past comes down to one thing: **the visuals feel REAL, not AI-generated.** For video content, this means cinematic stock B-roll sourced from premium libraries. For image+text social posts, stylized AI imagery CAN work when it's intentionally non-photorealistic (comic panels, abstract, branded graphics).

---

## ACE RICHIE / SOVEREIGN SYNTHESIS

### Video Shorts
- **B-roll:** Gold-hour lighting, architectural grandeur, upward movement, sunrise/mountain summit, sovereign imagery, slow-motion city shots at dusk, columns and open spaces
- **Captions:** Bold gold (#d4a843) on dark backgrounds (#0a0a0f), drop shadow for readability
- **Voiceover:** Authoritative but warm, measured pace, Sovereign Synthesis lexicon (Firmware Update, Escape Velocity, Protocol 77)
- **Music:** Ambient atmospheric, NOT phonk or trap. Think Hans Zimmer-lite — tension that resolves into power
- **Pacing:** Visual change every 3-4 seconds for retention
- **End card:** "Sovereign Synthesis" wordmark, gold on dark
- **Color grade:** Warm gold (#d4a843) highlights, teal (#00e5c7) accents, deep void (#0a0a0f) shadows, cinematic contrast

### Image+Text Posts (Buffer)
- **Comic panels:** For educational sequences. Dark backgrounds, gold/amber accent gradients, branded typography. The existing Sovereign Synthesis comic panels are the template.
- **Single posts:** Dark background (#0a0a0f), gold accent (#d4a843), teal highlight (#00e5c7), one powerful text line over a cinematic or abstract visual. Protocol 77 hook-pivot-anchor structure in copy.
- **Image style:** AI-generated abstract/cinematic is acceptable (intentionally non-photorealistic). Niche-matched per the IMAGE_NICHE_PREFIXES in content-engine.ts.

---

## THE CONTAINMENT FIELD

### Video Shorts
- **B-roll:** Rain on glass, shadows, surveillance-aesthetic footage, urban night, cold blue lighting, slow dolly shots, industrial environments, neon reflections on wet concrete
- **Captions:** White or cold blue (#5A9CF5) on black/dark backgrounds (#0a0a0f), sharp sans-serif font
- **Voiceover:** Clinical, detached, almost unsettling. Measured, low cadence. NOT dramatic — more like a whistleblower reading a classified report
- **Music:** Dark ambient, tension drones, sub-bass. Think documentary score during the "reveal" moment
- **Pacing:** Visual change every 2-3 seconds (faster pace = more tension/urgency)
- **End card:** "The Containment Field" in sharp white sans-serif on black
- **Color grade:** Cold blue (#5A9CF5) / teal (#00e5c7) highlights, deep void (#0a0a0f) shadows, desaturated with clinical precision

### Image+Text Posts (Buffer)
- **Style:** High contrast noir. Cold blue (#5A9CF5) + teal (#00e5c7) + charcoal palette. Sharp sans-serif type.
- **Tone:** Clinical, exposing. "They don't want you to know" energy.
- **Image style:** Surveillance-aesthetic, noir photography mood. Dark with single accent color.

---

## NICHE × BRAND VISUAL MATRIX

| Niche | Ace Richie Visual | Containment Field Visual |
|-------|------------------|--------------------------|
| **Dark Psychology** | Noir cinema, amber light cutting through darkness, brutalist architecture | Surveillance camera angle, rain-slicked urban, cold blue (#5A9CF5) accent |
| **Self Improvement** | Golden hour, figure ascending stone steps, sovereign and majestic | Sterile corporate, shattered mirror, deconstructed wellness |
| **Burnout** | Chains dissolving to golden particles, industrial to natural transition | Human in hamster wheel of screens, toxic green device glow |
| **Quantum** | Cosmic geometric light patterns, deep indigo + electric gold | Data-visualization, reality glitching, wireframe overlaid on physical space |
| **Brand** | Gold (#d4a843) + teal (#00e5c7), throne-like composition, master architect energy | Dark room, single blue light on classified document, information broker |

---

## WHAT NOT TO DO

- **No generic AI art.** If it looks like "I typed a prompt into Midjourney and didn't art-direct," it fails.
- **No text on images from AI.** AI-generated text in images is always garbled. Use "NO text, NO words, NO letters" in all prompts.
- **No stock photo vibes.** If it could be a Getty Images thumbnail for "business success," it's wrong.
- **No Joker/Bateman/Marcus Aurelius imagery.** It's the MOOD, not the IP. Original aesthetic, not derivative.
- **No hashtag spam.** Max 2 hashtags, only if they serve the message.

---

## PRODUCTION TOOLS (CURRENT)

| Step | Tool | Notes |
|------|------|-------|
| Image generation | Gemini Imagen 4 (primary), DALL-E 3 (fallback) | Imagen 4 preferred for cinematic quality |
| Image storage | Supabase Storage `public-assets/content-images/` | Public URLs for Buffer API |
| Text+image posting | Buffer GraphQL API (9 channels) | Code handles distribution, not agents |
| Video clips | yt-dlp + ffmpeg (via VidRush pipeline) | Make.com Scenarios E/F |
| Video posting | YouTube Data API (direct, bypasses Buffer) | OAuth tokens for both channels |
| Stock footage | Future: Pexels/Artgrid API integration for video B-roll | Not yet built |
