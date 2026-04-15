// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared operational context — injected into every agent's system prompt.
// KEEP THIS UNDER 1,500 CHARS. Move details to protocols/Pinecone.
// Session 27: Extracted from 10-12K shared tail that was bloating every agent.
// Session 66 (Phase 3 Task 3.2): BRAND_NICHE_ALLOWLIST exported SEPARATELY
// below so the intake-layer guard does NOT bloat the shared agent prompt.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Brand } from "../pod/types";

export const SHARED_AGENT_CONTEXT = `
## Operational Context
Funnel (T0-T7, live at sovereign-synthesis.com). YOU KNOW THIS - recite it when asked:
T0 FREE: /tier-0/links - Containment Field linktree. Anonymous dark-psych top-of-funnel.
T1 FREE: /tier-1/diagnostic (12Q quiz) + /tier-1/download.html (Reality Override Manual PDF). Awareness stage.
T2 $77 "The Shield: Protocol 77": /tier-2/protocol-77.html - First paid. Defense framework against manipulation.
T3 $177 "The Map: Navigation Override": /tier-3/manifesto.html - Navigate systems of control. Strategic awareness.
T4 $477 "The Architect: Foundation Protocol": /tier-4/defense-protocol.html - Build sovereign systems. Phase 1.
T5 $1,497 "The Architect: Adversarial Systems": /tier-5/phase-2.html - Counter-manipulation mastery. Phase 2.
T6 $3,777 "The Architect: Sovereign Integration": /tier-6/phase-3.html - Full integration. Phase 3.
T7 $12,000 "Inner Circle: Sovereign Licensing": /tier-7/inner-circle.html - Application only. License to teach.
Journey = Shield (defend) > Map (navigate) > Architect (build in 3 phases) > Inner Circle (license mastery).
Homepage / = email+name capture > Supabase initiates > nurture email > redirect to /tier-1/diagnostic.
Stripe P77 checkout: buy.stripe.com/eVq5kFcwy8sX4N0eD9fYY00. Full product data: query product_tiers table in Supabase.
Two brands: Ace Richie (personal) + The Containment Field (anonymous dark psych - NEVER cross-reference).
Architecture: Bot runs on Railway. Dashboard on Vercel. Supabase is the ONLY bridge.
Tables you write to: crew_dispatch, tasks, activity_log, content_drafts, content_transmissions.

## Task Approval Protocol
- propose_task > appears in Mission Control as "To Do"
- Ace moves to "In Progress" = YOUR green light to execute
- NEVER execute ai-generated tasks without this approval
- Human-assigned tasks: his assignment IS approval - start immediately
- save_content_draft for ALL output. Invisible work is worthless.
- Log significant actions to activity_log.

## Standing Rules
- Yuki is SOLE Buffer posting authority. All other agents dispatch to her.
- Buffer uses ALL active channels. Never filter by service type.
- Copy follows 4-Part Architecture: GLITCH > PIVOT > BRIDGE > ANCHOR.
- call read_protocols before content tasks for niche-specific directives.
- Stasis alert: if no tasks for 48h, flag it. Max 1 proactive msg/24h.
`.trim();


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3 Task 3.2 — Brand Niche Allowlist (INTAKE LAYER)
//
// Single source of truth for which niches each brand is permitted to produce
// content in. Enforced at Alfred seed-generation time (Task 3.3) and hard-
// failed at pipeline entry (Task 3.4 BrandNicheViolation).
//
// DO NOT embed this in SHARED_AGENT_CONTEXT — token economy rule. Personas
// that need the list pull it on demand via nicheAllowlistLine(brand).
//
// Why the split: S48 Brand Routing Matrix (commits 67fe042 + 7761363) fixed
// the RENDER layers (aesthetic/terminal/thumbnail/captions/stingers/TTS).
// It did NOT fix Alfred's shared seed producing "burnout" for Ace Richie.
// This allowlist is the intake-side fix.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Niches Ace Richie 77 (personal brand, sovereign architect) is allowed to produce. */
export const ACE_RICHIE_NICHES = [
  "sovereignty",
  "authority",
  "architecture",
  "system-mastery",
  "wealth-frequency",
] as const;

/** Niches The Containment Field (anonymous dark-psych top-of-funnel) is allowed to produce. */
export const CONTAINMENT_FIELD_NICHES = [
  "burnout",
  "dark-psychology",
  "containment",
  "manipulation-exposed",
  "pattern-interrupt",
] as const;

/** Allowed-niche string literal unions for type-level brand safety. */
export type AceRichieNiche = (typeof ACE_RICHIE_NICHES)[number];
export type ContainmentFieldNiche = (typeof CONTAINMENT_FIELD_NICHES)[number];
export type AllowedNiche = AceRichieNiche | ContainmentFieldNiche;

/** Canonical allowlist mapping, keyed by the Phase 4 Brand contract. */
export const BRAND_NICHE_ALLOWLIST: Readonly<Record<Brand, readonly string[]>> = {
  ace_richie: ACE_RICHIE_NICHES,
  containment_field: CONTAINMENT_FIELD_NICHES,
} as const;

/**
 * Normalize a free-form niche string to the kebab-case form used in the
 * allowlists. Alfred may emit "wealth frequency" or "Wealth_Frequency" — the
 * guard must treat those as the canonical "wealth-frequency".
 */
export function normalizeNiche(niche: string): string {
  return niche
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Returns the permitted niches for a brand. Throws if an unknown brand is
 * passed in — a Brand-typed caller cannot hit this, but runtime payloads
 * (e.g. from Supabase) are strings, so the throw is a tripwire.
 */
export function getAllowedNiches(brand: Brand): readonly string[] {
  const allowed = BRAND_NICHE_ALLOWLIST[brand];
  if (!allowed) {
    throw new Error(`getAllowedNiches: unknown brand "${brand}"`);
  }
  return allowed;
}

/** Boolean gate — true when niche (after normalization) is permitted for brand. */
export function isAllowedNiche(brand: Brand, niche: string): boolean {
  const normalized = normalizeNiche(niche);
  return getAllowedNiches(brand).includes(normalized);
}

/**
 * Formats the brand allowlist as a one-line constraint string for injection
 * into a persona prompt on demand (Alfred seed generation). Kept concise so
 * callers that inline it do not blow the per-persona token budget.
 *
 * Example output:
 *   "ACE_RICHIE allowed niches: sovereignty | authority | architecture | ..."
 */
export function nicheAllowlistLine(brand: Brand): string {
  const niches = getAllowedNiches(brand).join(" | ");
  return `${brand.toUpperCase()} allowed niches: ${niches}`;
}
