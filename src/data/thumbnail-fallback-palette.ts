// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Thumbnail Fallback Palette
// Session 117 (2026-04-25) — When the LLM fails JSON-schema validation
// twice in a row, the renderer pulls from this curated list of pain-point
// pairs instead of silent-truncating a fragment.
//
// Each entry is a complete two-tier thumbnail in Rev. Ike form:
//   - headline: 3-6 word ALL CAPS pain-point or imperative
//   - subhead: 4-8 word italic amplifier in mixed case
//
// HARD RULE: every pair must be a COMPLETE THOUGHT. No fragments,
// no setups, no cliffhangers. A stranger reads the pair cold and
// understands the full diagnosis instantly.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Brand } from "../pod/types";

export interface ThumbnailFallbackPair {
  headline: string;
  subhead: string;
  /** Lowercase keywords that match this pair to a script topic.
   *  Used for soft semantic ranking. Empty array = generic fallback. */
  match_keywords: string[];
}

const SS_PAIRS: ThumbnailFallbackPair[] = [
  {
    headline: "BURN THE MANUAL",
    subhead: "And Why Your Brain Keeps Buying It",
    match_keywords: ["program", "manual", "instruction", "rules", "scripts"],
  },
  {
    headline: "THEY DESIGNED YOUR CAGE",
    subhead: "The Architecture They Hide From You",
    match_keywords: ["cage", "trap", "system", "control", "architecture"],
  },
  {
    headline: "DELETE YOUR OLD SELF",
    subhead: "The Identity Reset They Don't Teach",
    match_keywords: ["identity", "self", "ego", "transformation", "shift"],
  },
  {
    headline: "STOP CHASING THE SIGNAL",
    subhead: "It Was Never On The Other End",
    match_keywords: ["chase", "signal", "approval", "external", "validation"],
  },
  {
    headline: "YOUR MEMORIES ARE INSTALLED",
    subhead: "And This Is Who Wrote Them",
    match_keywords: ["memory", "memories", "installed", "programming", "past"],
  },
  {
    headline: "REALITY HAS AN OWNER",
    subhead: "And It Wasn't Going To Be You",
    match_keywords: ["reality", "ownership", "control", "manifestation"],
  },
  {
    headline: "THE GLITCH IS THE GATE",
    subhead: "What Most People Run From Is The Door",
    match_keywords: ["glitch", "gate", "door", "breakthrough", "anomaly"],
  },
  {
    headline: "YOU WERE NEVER FREE",
    subhead: "And This Is The Mechanism That Held You",
    match_keywords: ["free", "freedom", "liberation", "bondage", "mechanism"],
  },
  {
    headline: "COLLAPSE THE OLD TIMELINE",
    subhead: "What Has To Die Before You Rebuild",
    match_keywords: ["collapse", "timeline", "rebuild", "death", "ending"],
  },
  {
    headline: "STOP NEGOTIATING WITH GHOSTS",
    subhead: "The Voice You Argue With Isn't Yours",
    match_keywords: ["voice", "ghost", "internal", "argument", "self-talk"],
  },
];

const CF_PAIRS: ThumbnailFallbackPair[] = [
  {
    headline: "THE TRAP HAS YOUR NAME",
    subhead: "Why You Keep Returning To It",
    match_keywords: ["trap", "pattern", "loop", "return", "compulsion"],
  },
  {
    headline: "YOUR PARTNER MIRRORED YOU",
    subhead: "Until You Forgot Which Face Was Yours",
    match_keywords: ["partner", "mirror", "relationship", "narcissist", "identity"],
  },
  {
    headline: "EXIT BEFORE THEY NOTICE",
    subhead: "The 3 Signs The Field Is Closing",
    match_keywords: ["exit", "leave", "escape", "closing", "departure"],
  },
  {
    headline: "GRAY ROCK IS NOT ENOUGH",
    subhead: "What The Containment Strategy Misses",
    match_keywords: ["gray rock", "containment", "narcissist", "strategy"],
  },
  {
    headline: "THEY CONDITIONED THE FAWN",
    subhead: "How Compliance Got Wired Into Your Body",
    match_keywords: ["fawn", "compliance", "trauma", "conditioning", "nervous"],
  },
  {
    headline: "THE LIGHTHOUSE STANCE",
    subhead: "Why Standing Still Disarms The Storm",
    match_keywords: ["lighthouse", "stance", "still", "storm", "ground"],
  },
  {
    headline: "THE HOOVER IS COMING",
    subhead: "Recognize It Before It Lands",
    match_keywords: ["hoover", "return", "come back", "recycle"],
  },
  {
    headline: "MICRO-COMPLIANCE IS HOW THEY OWN YOU",
    subhead: "The Tiny Yeses That Built The Cage",
    match_keywords: ["micro", "compliance", "small", "yes", "creep"],
  },
  {
    headline: "YOU ARE NOT THE PROGRAM",
    subhead: "Reading The System That Runs On You",
    match_keywords: ["program", "system", "code", "running", "automation"],
  },
  {
    headline: "THE FIELD IS LISTENING",
    subhead: "What They Hear When You Go Silent",
    match_keywords: ["silent", "listening", "field", "observation", "watch"],
  },
];

const PAIRS_BY_BRAND: Record<Brand, ThumbnailFallbackPair[]> = {
  sovereign_synthesis: SS_PAIRS,
  containment_field: CF_PAIRS,
};

/**
 * Pick a fallback thumbnail pair for a given brand + optional topic context.
 * Soft-matches keywords against the script title/hook/niche; falls back to
 * round-robin if no keyword hits.
 *
 * @param brand - Brand routing key.
 * @param topicContext - Optional concatenation of title + hook + niche for
 *   keyword matching. Lowercased internally.
 * @returns A valid headline/subhead pair guaranteed to pass validation.
 */
export function pickFallbackPair(
  brand: Brand,
  topicContext: string = "",
): ThumbnailFallbackPair {
  const pool = PAIRS_BY_BRAND[brand] || PAIRS_BY_BRAND.sovereign_synthesis;
  const ctx = topicContext.toLowerCase();

  if (ctx) {
    // Score each pair by keyword match count
    const scored = pool.map((pair) => ({
      pair,
      score: pair.match_keywords.filter((kw) => ctx.includes(kw.toLowerCase())).length,
    }));
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) {
      return scored[0].pair;
    }
  }

  // No keyword match — pick at random from the brand pool
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Validate a thumbnail headline against the strict spec.
 * Returns null if valid; an error string if invalid.
 */
export function validateHeadline(text: string): string | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return "empty";
  if (trimmed.length > 32) return `too long (${trimmed.length} chars, max 32)`;

  const words = trimmed.split(/\s+/);
  if (words.length < 3) return `too few words (${words.length}, min 3)`;
  if (words.length > 6) return `too many words (${words.length}, max 6)`;

  // Must be ALL CAPS or numerals (allow !, ?, em-dash, apostrophe)
  if (!/^[A-Z0-9 !?\u2014'-]+$/.test(trimmed)) {
    return "must be ALL CAPS, no lowercase or non-permitted punctuation";
  }

  // Reject trailing comma or mid-clause cutoff signals
  if (/,$/.test(trimmed)) return "ends with comma (mid-clause fragment)";
  if (/\.\.\.$/.test(trimmed)) return "ends with ellipsis (cliffhanger)";

  return null;
}

/**
 * Validate a thumbnail subhead against the strict spec.
 * Returns null if valid; an error string if invalid.
 */
export function validateSubhead(text: string): string | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return "empty";
  if (trimmed.length > 56) return `too long (${trimmed.length} chars, max 56)`;

  const words = trimmed.split(/\s+/);
  if (words.length < 4) return `too few words (${words.length}, min 4)`;
  if (words.length > 8) return `too many words (${words.length}, max 8)`;

  if (/,$/.test(trimmed)) return "ends with comma (mid-clause fragment)";
  if (/\.\.\.$/.test(trimmed)) return "ends with ellipsis (cliffhanger)";

  return null;
}
