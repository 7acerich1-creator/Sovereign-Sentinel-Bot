#!/usr/bin/env ts-node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Session 42: Seed YouTube Growth Protocol directives into Supabase protocols table.
// These are Layer 3 on-demand protocols — agents retrieve them via read_protocols tool.
// Keeps system prompts lean (Directive 1: Prompt Economy) while giving agents
// full playbook access when they need it.
//
// Run: npx ts-node scripts/seed-youtube-protocols.ts
// Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const YOUTUBE_PROTOCOLS = [
  {
    protocol_name: "youtube_seo_protocol",
    niche: "all",
    directive: `YOUTUBE SEO PROTOCOL (Alfred — apply to ALL title/description/tag work):

TITLE FORMULA: [Emotional Trigger] + [Specific Topic] + [Implied Promise]. Under 60 chars. Front-load the keyword. Never clickbait without delivering.

DESCRIPTION: First 200 chars = primary keyword in first sentence (algorithm priority zone). 200-500 words total. Structure: compelling summary → chapter timestamps → CTA (subscribe, email, community) → natural language SEO summary. NEVER comma-separated keyword lists. 1-2 LSI keywords woven naturally.

HASHTAGS: 3-5 max in description. First 3 display above title. YouTube allows 15 but 3-5 is optimal.

TAGS: 10-15 relevant tags within 500-char limit. Include: exact title, primary keyword, 2-3 related terms, channel name. 5 highly relevant > 50 generic.

KEYWORD DIVERSITY (CRITICAL): Each clip from the same source video MUST target a DIFFERENT keyword cluster. Same keywords = same audience = wasted reach. The content is universal — vary WHO discovers it.`,
    active: true,
    created_by: "architect",
  },
  {
    protocol_name: "youtube_script_protocol",
    niche: "all",
    directive: `YOUTUBE SCRIPT PROTOCOL (Anita — apply to ALL script work):

STRUCTURE: Hook (0-3s, core pain statement, NO introductions) → Problem Amplification (3-30s) → Framework Introduction (30s-2min) → Deep Dive (2min-end) → CTA (final 30s).

EXTREMITY MODIFIER: NEVER make soft claims. Every statement must feel existential.
- WRONG: "Social media is bad for your focus"
- RIGHT: "The algorithm is a weaponized slot machine designed by neuroscientists to steal your executive function"

RETENTION: Write a curiosity loop every 2 minutes — tease upcoming information to prevent drop-off. Target 50%+ average view duration.

LEXICAL BLACKLIST (violation risks community guideline strike):
NEVER: "How to make money," "Passive income," "Get rich," "Make $10k a month," "Side hustle"
ALWAYS: "Sovereign Wealth," "Financial Autonomy," "Resource Capture," "Escaping the Wage Matrix," "Sovereign Architecture"

VIEWER TIERS: Build for CORE viewers (watch full videos, binge, engage with insights). Not casual scrollers. Every script must reward people who watch to the end.

COPY ARCHITECTURE: GLITCH (pattern interrupt) → PIVOT (reframe) → BRIDGE (to their world) → ANCHOR (to Protocol 77).`,
    active: true,
    created_by: "architect",
  },
  {
    protocol_name: "youtube_visual_protocol",
    niche: "all",
    directive: `YOUTUBE VISUAL PROTOCOL (Yuki — apply to ALL video/thumbnail work):

MUTE-AUTOPLAY SCROLL TRAP: First 5 seconds MUST have aggressive, high-contrast, center-screen text overlays hardcoded into the video. 70%+ traffic is mobile. 68% of mobile viewers decide to click within 1 second. The visual alone must stop the scroll.

PATTERN INTERRUPT BASELINE:
- The Containment Field: Visual interrupt every 3-4 seconds
- Ace Richie: Visual interrupt every 5-7 seconds

THUMBNAIL 3-ELEMENT RULE: Every thumbnail = (1) face/figure with strong emotion, (2) large readable text 3-5 words legible at phone size, (3) contrasting visual element. 1280x720 min. NEVER repeat exact title on thumbnail. Create 2 variants per video. Swap if CTR below 4% after 48h.

BRAND VISUAL IDENTITY:
- Ace Richie: Dark backgrounds, gold/amber accent, clean typography
- Containment Field: Noir/clinical, green-on-black data overlays, glitch effects

SHORTS FORMAT: Vertical 9:16, text overlay first 2 seconds, hard cut opening, cliffhanger ending. 30-45 seconds optimal.`,
    active: true,
    created_by: "architect",
  },
  {
    protocol_name: "youtube_analytics_protocol",
    niche: "all",
    directive: `YOUTUBE ANALYTICS PROTOCOL (Vector — apply to ALL analytics work):

REVIEW CADENCE:
- Daily (first 30 days): Real-time views on new uploads for first 24h
- Weekly (Monday): AVD, CTR, subscriber conversion, traffic sources → report via save_content_draft
- Monthly: Strategy review → pillar performance, kills, pivots, competitor audit

BENCHMARKS (new channel):
- 30-day: AVD 40%+, CTR 3%+, 50-200 views/48h, 100 subs
- 60-day: AVD 50%+, CTR 4%+, 200-500 views/48h, 500 subs
- 90-day: AVD 55%+, CTR 5%+, 500-2000 views/48h, 1000-2500 subs

CTR BY SOURCE: Search 8-15%, Suggested 5-10%, Browse 4-5%.

PIVOT TRIGGERS:
- AVD below 35% on 3 consecutive videos → flag for Anita script rewrite
- CTR below 2.5% on 3 consecutive → flag for Yuki thumbnail redesign
- Pillar underperforms for 5 videos → recommend kill to Veritas
- Shorts outperform long-form consistently → recommend ratio shift

QUALITY CTR (2026): YouTube evaluates 30 seconds post-click behavior. High CTR + immediate drop-off = negative signal. Track "quality engagement" not just click rate.`,
    active: true,
    created_by: "architect",
  },
  {
    protocol_name: "youtube_compliance_protocol",
    niche: "all",
    directive: `YOUTUBE AI CONTENT COMPLIANCE (ALL agents — 2026 policy):

WARNING: January 2026, YouTube suspended monetization on thousands of faceless AI channels. This directly affects The Containment Field.

WHAT GETS FLAGGED: Faceless compilations with zero commentary, template clones with identical visuals/sound, AI slideshows with no real narration, recycled clips.

COMPLIANCE REQUIREMENTS:
1. Original scripts — three-pass architecture (thesis extraction + narrative arc). No source parroting.
2. Transformative narrative — unique analysis, not repackaged content
3. Visual variety — 12-16 scenes per video, Imagen 4 custom visuals (not stock), varied compositions
4. Distinct sonic identity — Edge TTS voice, niche-aware music beds, signature audio
5. No template repetition — thumbnail variants, different visual pacing per video

STANDING RULE: Every video must pass compliance check before upload. If it looks auto-generated by any generic AI tool, it does NOT ship. Content must reflect genuine human editorial judgment.

YPP ELIGIBILITY (2026 two-tier):
- Tier 1: 500 subs + 3K watch hours OR 3M Shorts views in 90 days → fan funding, memberships
- Tier 2: 1K subs + 4K watch hours OR 10M Shorts views → full ad revenue`,
    active: true,
    created_by: "architect",
  },
  {
    protocol_name: "youtube_shorts_protocol",
    niche: "all",
    directive: `YOUTUBE SHORTS PROTOCOL (Yuki + pipeline — apply to ALL Shorts work):

START: After Video 11 (algorithm needs initial long-form data first).
FREQUENCY: 2-3 Shorts per day, spaced 4-6 hours apart (each gets own algorithmic evaluation).
LENGTH: 30-45 seconds optimal.
FORMAT: Vertical 9:16, text overlay first 2 seconds, hard cut opening, cliffhanger ending.

HOOK: First 1-3 seconds determine swipe-away. This is the ONLY thing that matters for Shorts discovery.

CONTENT SOURCE: Repurpose highest-retention segments from long-form + standalone tests. Never duplicate full content between Short and long-form.

BRIDGE TO LONG-FORM: End every Short with "Full breakdown on my channel." Pin comment linking to related long-form video.

ALGORITHM (2026 verified): Shorts algorithm is FULLY DECOUPLED from long-form. 74% of Shorts views come from non-subscribers. Channels using Shorts + long-form grow 41% faster. Only Engaged Views count toward YPP.

TITLE DIVERSITY: Each Short MUST target a different keyword than other Shorts from the same source. YouTube distributes independently — different titles reach different audiences.

UPLOAD: Include #Shorts in title. Buffer handles YouTube Shorts via video upload. YouTube categoryId: "22". Privacy: public. madeForKids: false.`,
    active: true,
    created_by: "architect",
  },
];

async function seed() {
  console.log("🔄 Seeding YouTube protocols into Supabase...\n");

  for (const proto of YOUTUBE_PROTOCOLS) {
    // Upsert: delete existing if same name, then insert fresh
    const { error: delError } = await supabase
      .from("protocols")
      .delete()
      .eq("protocol_name", proto.protocol_name);

    if (delError) {
      console.warn(`  ⚠️ Delete failed for ${proto.protocol_name}: ${delError.message}`);
    }

    const { data, error } = await supabase
      .from("protocols")
      .insert(proto)
      .select("id, protocol_name")
      .single();

    if (error) {
      console.error(`  ❌ ${proto.protocol_name}: ${error.message}`);
    } else {
      console.log(`  ✅ ${proto.protocol_name} (id: ${data.id})`);
    }
  }

  console.log("\n✅ All YouTube protocols seeded. Agents can now retrieve via read_protocols('all').");
}

seed().catch(console.error);
