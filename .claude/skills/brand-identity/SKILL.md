---
name: brand-identity
description: Single source of truth for Sovereign Synthesis visual + verbal identity. Read this BEFORE generating any user-facing surface — emails, sales pages, member portal, diagnostics, social posts. Defines the light-default consumer aesthetic, canonical templates, and voice/tone rules.
---

# Sovereign Synthesis — Brand Identity

**Brand:** Sovereign Synthesis
**Domain:** sovereign-synthesis.com
**Locked:** 2026-04-26

---

## The architecture (read this first)

There is **one customer-facing brand**: Sovereign Synthesis. Every surface a paying customer or candidate touches lives under this identity. The Containment Field is a content channel (videos, anonymous social) that funnels traffic INTO Sovereign Synthesis — it is not a separate website-design system. Mission Control and bot UIs are operator workspaces, not consumer-facing, and use a darker operational theme.

If you are generating **anything a buyer would see**, you use the consumer aesthetic defined here. No exceptions without explicit Architect override.

---

## Visual canon — the consumer aesthetic

**Default theme: LIGHT.** Light cream background, white card, sovereign gold accents, charcoal text. This is what landed with real readers (the Christina-test, S114) and is now the canonical default.

For exact tokens (colors, fonts, sizes), read:
👉 **[`resources/design-tokens.json`](resources/design-tokens.json)** — `colors.light_theme` is the consumer default.

The dark theme tokens still exist, but they are reserved for:
- Bot/agent UI (Sentinel, Mission Control)
- Containment Field video content (the cold-blue clinical aesthetic in actual videos)

**Never use dark theme on sovereign-synthesis.com** unless explicitly told to.

---

## Canonical templates — copy these, don't reinvent

When you build a new email, page, or component, start from the canonical template — do not author HTML from scratch. The templates have been Mom-tested for readability and Gmail-rendering safety.

### Email
👉 **[`resources/email-templates.md`](resources/email-templates.md)** — canonical email HTML pattern. Use the table-based light layout with the gold CTA button + plaintext fallback URL.

### User-facing pages (sales, diagnostics, member portal)
👉 **[`resources/user-facing-pages.md`](resources/user-facing-pages.md)** — canonical page CSS variables + structure. Georgia/serif headlines + Helvetica body + sovereign gold accents on cream/white cards.

### Voice + tone (how to write inside any of these surfaces)
👉 **[`resources/voice-tone.md`](resources/voice-tone.md)** — sovereign frequency rules + the Mom Test for plain English.

---

## The Mom Test — non-negotiable for all consumer copy

Before any user-facing copy ships, it must pass the Mom Test: a smart adult who is not in the sovereignty subculture must understand every sentence on first read.

Three jargon tiers govern word choice. Read [`resources/voice-tone.md`](resources/voice-tone.md) for the full kill list. Quick summary:

| Tier | Action | Examples |
|---|---|---|
| **Brand frequency words** | Keep | Sovereign, Protocol, the formation, the Shield, the simulation |
| **Specialized but explainable** | Keep — explain on first use | Architecture, the Containment Field, Lighthouse Stance |
| **Pure jargon** | Cut everywhere | vectors, heuristic, memetic, fossil record, frequency weapon, transmission vector |

If a piece of copy contains a Tier-3 word and you ship it, you have failed the Mom Test. The rule is hard.

---

## Brand identity layers (visual context, not for daily use)

For tone snapshots of each layer in the broader system:

- **Sovereign Synthesis** — Ace's primary brand. Consumer-facing. Sovereign, warm, authoritative. Gold + cream + serif headlines.
- **The Containment Field** — Anonymous content channel. Clinical, detached. Used in videos/social only. Never consumer-facing on the website.
- **Gravity Claw** — Operator infrastructure (Sentinel Bot, Mission Control dashboard). Cyan + gold on near-black. Architect-facing only.

For exact color/typography per layer, read [`resources/design-tokens.json`](resources/design-tokens.json) `brands` section.

---

## When this skill is required

Read this skill (and the resources it points to) BEFORE producing any of:

- An email (welcome, nurture, purchase, transactional, broadcast)
- A landing page or sales page (anything served from sovereign-synthesis.com)
- A diagnostic or quiz UI
- Member-portal pages or paid content delivery
- Social post HTML for Bluesky / LinkedIn / etc. that links to the site
- A new brand asset (PDF, audio thumbnail, OG image)

If you are an agent (Anita, Yuki, Alfred, Vector, etc.) producing user-facing copy or design, **this skill is your starting reference, not an optional supplement.**
