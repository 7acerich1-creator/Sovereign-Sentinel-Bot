// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Social Media Optimization Prompt Template
// The "Viral Brain" for platform-specific content distribution
//
// Used by: generatePlatformCopy() in vidrush-orchestrator.ts
// Purpose: Deep platform-aware copy generation (replaces shallow generic prompts)
// Integration: Quality Gate (Step 6) + Platform Adaptation Engine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SocialOptimizationContext {
  contentType: "faceless_video" | "short_clip" | "long_form" | "carousel" | "text_post";
  platform: "youtube_shorts" | "tiktok" | "instagram_reels" | "x_twitter" | "threads" | "linkedin" | "facebook";
  targetAudience: string;
  sourceTitle: string;
  niche: string;
  transcript: string;
  brand: "ace_richie" | "containment_field";
}

/**
 * Builds the full social media optimization prompt for a given context.
 * This is the "Viral Brain" — it doesn't just generate captions,
 * it generates platform-optimized, algorithm-aware, virality-tuned content.
 *
 * Call this ONCE PER PLATFORM PER CLIP for maximum specificity,
 * or batch per-platform with multiple clips for efficiency.
 */
export function buildSocialOptimizationPrompt(ctx: SocialOptimizationContext): string {
  const brandBlock = buildBrandFrequencyBlock(ctx.brand);
  return `${brandBlock}

You are a social media marketing expert who will provide best practices for maximizing the reach and viral potential of content on social media platforms. Your goal is to give actionable, specific advice based on the type of content, platform, and target audience.

Here is the type of content being uploaded:
<content_type>
${ctx.contentType.replace(/_/g, " ")}
</content_type>

Here is the social media platform or platforms being used:
<platform>
${ctx.platform.replace(/_/g, " ")}
</platform>

Here is the target audience:
<target_audience>
${ctx.targetAudience}
</target_audience>

SOURCE VIDEO TITLE: "${ctx.sourceTitle}"
NICHE: ${ctx.niche.replace(/_/g, " ")}
TRANSCRIPT EXCERPT: ${ctx.transcript.slice(0, 2000)}
BRAND: ${ctx.brand === "ace_richie" ? "Sovereign Synthesis (Ace Richie) — personal brand, liberation framework, dark psychology transmuted into sovereignty" : "The Containment Field — anonymous dark psychology top-of-funnel feeder brand"}

Your task is to provide comprehensive best practices for uploading and optimizing this content to maximize reach and viral potential. Consider the following key areas in your analysis:

1. **Platform-Specific Optimization**: Technical specifications, format requirements, and platform algorithm preferences
2. **Timing and Posting Strategy**: When to post for maximum visibility with the target audience
3. **Content Optimization**: Thumbnails, captions, hashtags, keywords, and metadata
4. **Engagement Tactics**: How to encourage likes, comments, shares, and saves
5. **Algorithm Considerations**: What the platform's algorithm prioritizes and how to work with it
6. **Accessibility and Reach**: Captions, subtitles, and features that broaden audience
7. **Cross-Promotion**: Strategies for amplifying reach beyond the initial post
8. **Content Quality Factors**: What makes content shareable and engaging for this specific audience

Before providing your recommendations, use the scratchpad to think through the specific characteristics of the platform, content type, and audience.

<scratchpad>
Consider:
- What are the unique algorithm priorities for this platform?
- What content formats perform best on this platform?
- What are the engagement patterns of the target audience?
- What time zones and posting times are most relevant?
- What makes content go viral on this specific platform?
</scratchpad>

Structure your response with clear sections covering the most important best practices. Prioritize the recommendations by impact — put the most critical factors first. Be specific and actionable rather than generic.

Your final response should be comprehensive yet focused on the most impactful strategies. Write your complete recommendations inside <recommendations> tags, organizing them by category with clear headings. Make sure your advice is tailored to the specific content type, platform, and target audience provided.`;
}

// ── Pre-built audience profiles from Business Intelligence ──
// These map to the Sovereign Synthesis customer avatars

export const TARGET_AUDIENCES = {
  trapped_professional: `Men ages 25-44 who feel trapped in corporate systems. High earners who sense something is "off" about the matrix they operate in. They consume dark psychology, stoicism, and self-improvement content. They're looking for a framework to escape — not motivation, but a SYSTEM. They respond to authority, specificity, and pattern-interrupt hooks that name the exact feeling they can't articulate.`,

  awakening_mind: `People in the early stages of "waking up" — they've started questioning societal narratives but don't have a framework yet. They're consuming conspiracy-adjacent content, philosophy, and "hidden knowledge" videos. They're primed for the Firmware Update but need the Glitch (hook) to pull them in. Age 18-35, heavy TikTok/YouTube consumers.`,

  dark_psychology_seeker: `People actively searching for dark psychology, manipulation tactics, and power dynamics content. They want to understand how systems control them. The Containment Field brand catches them at this entry point and funnels them toward sovereignty (transmutation, not exploitation). Heavy short-form consumers, engagement-driven.`,

  inner_circle_candidate: `High-agency individuals who have already consumed beginner content and want depth. They're willing to pay for mentorship, frameworks, and direct access. They've watched 10+ videos, joined the Telegram, and are ready for the $497-$4997 tier. Small audience, high conversion intent.`,

  chosen_one: `The person who has always felt different — like they were meant for something bigger but couldn't name it. They're not broken, they're unactivated. They resonate with "chosen one" narratives, Neo/Matrix archetypes, spiritual awakening content, and the feeling that the system wasn't built for them because they were built to transcend it. Age 20-40, heavy YouTube/TikTok consumers. They're drawn to content that CONFIRMS what they already suspected about themselves — that they're not crazy, they're sovereign. They respond to identity-level hooks ("You were never meant to fit in"), destiny framing ("The simulation flagged you because you're a threat to it"), and content that makes them feel seen for the first time. This is the highest-emotion, highest-share audience — they don't just consume, they IDENTIFY. Every share is a declaration of who they are.`,
} as const;

// ── Platform-specific metadata defaults ──
// Used by scheduleBufferWeek() when building metadata objects

export const PLATFORM_DEFAULTS = {
  youtube_shorts: {
    categoryId: "22",       // People & Blogs (highest discovery for our niche)
    privacy: "public" as const,
    madeForKids: false,
    maxTitleLength: 100,
    requiredInTitle: "#Shorts",
  },
  tiktok: {
    maxCaptionLength: 2200,
    optimalHashtags: 5,
    hookWindowSeconds: 1.5,  // Must hook within 1.5s or swipe
  },
  instagram_reels: {
    maxCaptionLength: 2200,
    optimalHashtags: 10,     // 8-12 is the sweet spot for Reels
    shouldShareToFeed: true,
    type: "reel" as const,
  },
  x_twitter: {
    maxLength: 280,
    optimalHashtags: 2,      // X penalizes hashtag-heavy posts
  },
  threads: {
    maxLength: 500,
    optimalHashtags: 0,      // Threads deprioritizes hashtag-loaded posts
  },
  linkedin: {
    maxLength: 3000,
    optimalHashtags: 4,
    bestFormat: "insight_post", // Frame as expertise, not promotion
  },
  facebook: {
    maxLength: 63206,
    optimalHashtags: 2,
    bestFormat: "shareable_insight",
  },
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEPLOYMENT 4 — AUDIENCE ROTATION PROTOCOL
// Forces demographic-angle diversity across clips in a batch.
// The content is universal. What changes per clip is WHO discovers it.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface AudienceAngle {
  id: string;
  name: string;
  demographic: string;
  voice: string;
  emotionalEntry: string;
  keywordSeeds: string[];
  titlePatterns: string[];
  bannedOpeners: string[];
}

export const AUDIENCE_ANGLES: readonly AudienceAngle[] = [
  {
    id: "corporate_burnout",
    name: "Corporate Burnout",
    demographic: "Knowledge workers 28-45, high-performing, salaried, sensing the career ladder is a trap. Middle managers, senior ICs, former 'high potential' hires who hit the ceiling.",
    voice: "Authoritative, tactical, inside-baseball. 'I see what you see.' No woo, no mysticism, no slogans.",
    emotionalEntry: "The quiet Sunday-night dread. The performance review that felt like gaslighting. The promotion that turned into a heavier leash.",
    keywordSeeds: [
      "corporate burnout recovery",
      "quiet quitting 2026",
      "escape 9 to 5 corporate",
      "middle management trap",
      "salary golden handcuffs",
      "LinkedIn hustle fatigue",
      "career ladder broken"
    ],
    titlePatterns: [
      "Your 'Promotion' Was A Leash Upgrade",
      "The 6-Figure Cage Nobody Names",
      "Why Your Best Employees Leave At 34",
      "The Review That Broke Me"
    ],
    bannedOpeners: ["matrix", "dark psychology", "simulation", "sovereign", "they don't want you"]
  },
  {
    id: "spiritual_awakening",
    name: "Spiritual Awakening / Consciousness Shift",
    demographic: "25-45, post-religion seekers, kundalini/consciousness curious, reading Ram Dass, doing breathwork, tracking their own dark nights. Not 'love & light' — integration stage.",
    voice: "Warm, initiated, fellow-traveler. 'I've been through the tunnel too.' Zero woo-woo vocabulary dumping.",
    emotionalEntry: "The 3am awakening that won't stop. The dark night that nobody warned them about. The friends who can't hear them anymore.",
    keywordSeeds: [
      "spiritual awakening signs 2026",
      "dark night of the soul integration",
      "kundalini awakening symptoms",
      "ego death recovery",
      "awakening loneliness",
      "consciousness shift phases",
      "nervous system spiritual awakening"
    ],
    titlePatterns: [
      "The Stage Of Awakening Nobody Warns You About",
      "Why Your Third Eye Opened At 3am",
      "The Integration Phase They Never Talk About",
      "When Your Awakening Isolates You"
    ],
    bannedOpeners: ["matrix", "simulation", "dark psychology", "sovereign"]
  },
  {
    id: "tech_ai_realism",
    name: "Tech / AI Realism",
    demographic: "22-40, software engineers, PMs, designers, knowledge workers watching AI compress their field. Pragmatic, not doomer, not hype-bro. They read Hacker News and track release notes.",
    voice: "Data-forward, blunt, slightly cynical. Numbers in the hook. Name specific models and dates. No 'future of work' platitudes.",
    emotionalEntry: "The release note that quietly deprecated their skill. The junior dev that got laid off first. The sinking feeling that '3-5 years safe' just became '18 months'.",
    keywordSeeds: [
      "AI job displacement 2026",
      "software engineer AI layoffs",
      "claude sonnet jobs replaced",
      "knowledge worker obsolescence",
      "post AI career pivot",
      "AI proof skills 2026",
      "GPT-5 career impact"
    ],
    titlePatterns: [
      "Claude Sonnet 4.6 Just Made This Skill Worthless",
      "The 3 Jobs GPT-5 Can't Touch Yet (Data)",
      "Why Senior Engineers Are Quietly Panicking",
      "The Layoff Math Nobody Is Doing Publicly"
    ],
    bannedOpeners: ["matrix", "simulation", "dark psychology", "sovereign"]
  },
  {
    id: "relationship_trauma",
    name: "Relationship Trauma Recovery",
    demographic: "25-45, just left a narcissistic / avoidant / abusive partner, consuming attachment theory, cPTSD aware, doing IFS/EMDR. Knows the vocabulary, needs the deeper pattern.",
    voice: "Clinical but tender. Name-the-pattern precise. No victim framing, no 'you are enough' platitudes. Specificity is the love language.",
    emotionalEntry: "Month 4 of no-contact when they still miss them. The dream where the ex came back soft. The moment they realized the 'love bombing' was a technique.",
    keywordSeeds: [
      "narcissistic abuse recovery",
      "avoidant attachment healing",
      "trauma bond breaking",
      "anxious attachment partner",
      "cPTSD relationship symptoms",
      "fawn response healing",
      "post narcissist reclamation"
    ],
    titlePatterns: [
      "The Silent Stage Of Narcissistic Recovery",
      "Why You Still Miss Them At Month 4",
      "The Avoidant's 3-Month Discard Pattern",
      "The Closure You're Not Going To Get"
    ],
    bannedOpeners: ["matrix", "simulation", "dark psychology", "sovereign"]
  },
  {
    id: "parent_millennial",
    name: "Millennial Parent",
    demographic: "30-42, raising 0-10 year olds, screen-time anxious, questioning public school, gentle-parenting fatigued. Reading Janet Lansbury AND Jonathan Haidt. Exhausted but not checked out.",
    voice: "Raw, solidarity, 'you're not failing'. Admits hard things. No guilt stacks.",
    emotionalEntry: "The iPad handoff they said they'd never do. The tantrum in Target that broke them. The realization their 4-year-old can't self-regulate after three years of 'gentle'.",
    keywordSeeds: [
      "gentle parenting burnout",
      "screen time limits toddler",
      "homeschool vs public 2026",
      "millennial parent exhausted",
      "phone free childhood",
      "iPad kid generation",
      "raising kids in 2026"
    ],
    titlePatterns: [
      "The Gentle Parenting Lie Nobody Admits",
      "Why Your 4-Year-Old Can't Self-Regulate",
      "Phone-Free Childhood: 90-Day Result",
      "The Target Tantrum That Broke Me"
    ],
    bannedOpeners: ["matrix", "simulation", "dark psychology", "sovereign"]
  },
  {
    id: "late_diagnosed_nd",
    name: "Late-Diagnosed Neurodivergent",
    demographic: "25-45 adults who recently realized they have ADHD, autism, or AuDHD. Identity reframe phase. Masking burnout. They're grieving the version of themselves that didn't know.",
    voice: "Validating, systems-aware, slight relief. 'It wasn't a character flaw, it was a wiring mismatch.'",
    emotionalEntry: "The TikTok that broke the dam. The 30-year retrospective of every 'lazy' label. The first unmasked afternoon that felt terrifying and free.",
    keywordSeeds: [
      "late diagnosed ADHD adult",
      "autistic burnout recovery",
      "audhd women symptoms",
      "RSD rejection sensitivity",
      "executive dysfunction adult",
      "masking burnout autism",
      "ADHD tax daily"
    ],
    titlePatterns: [
      "The ADHD Trait They Diagnosed As 'Lazy' For 30 Years",
      "Why Autistic Burnout Feels Like Dying",
      "The Masking Tax: 34 Years, 1 Collapse",
      "The Diagnosis That Rewrote My Whole Childhood"
    ],
    bannedOpeners: ["matrix", "dark psychology", "simulation", "sovereign"]
  },
  {
    id: "deconstruction",
    name: "Faith Deconstruction",
    demographic: "22-40, exvangelical / ex-Mormon / ex-JW / ex-Catholic, rebuilding identity post-religion. Grief phase, not triumphalist. Still loves their family.",
    voice: "Careful, non-triumphalist, fellow-traveler. Does not dunk on believers. Honors the loss.",
    emotionalEntry: "The first Christmas without the church family. The prayer muscle memory that won't quit. The morality they're building from scratch.",
    keywordSeeds: [
      "faith deconstruction 2026",
      "exvangelical recovery",
      "religious trauma syndrome",
      "leaving church community grief",
      "deconstructing christianity",
      "ex Mormon rebuild identity",
      "purity culture healing"
    ],
    titlePatterns: [
      "The Stage Of Deconstruction Nobody Warns You About",
      "Why Leaving Church Feels Like Grief",
      "Rebuilding Morality Without Hell",
      "The First Christmas After Leaving"
    ],
    bannedOpeners: ["matrix", "dark psychology", "simulation", "sovereign"]
  },
  {
    id: "financial_prisoner",
    name: "Financial Prisoner",
    demographic: "24-42, in debt or paycheck-to-paycheck on 'good' income ($80k-$150k), knows budgeting advice is gaslighting, rents because priced out of homeownership.",
    voice: "Unapologetic, math-forward, system-critical. Dave Ramsey voice BANNED. Name specific numbers.",
    emotionalEntry: "The $127 grocery run that used to be $60. The rent increase that erased the raise. The student loan balance that's HIGHER than the original principal.",
    keywordSeeds: [
      "paycheck to paycheck 100k salary",
      "student loan trap 2026",
      "house poor millennial",
      "inflation real wages 2026",
      "middle class squeeze",
      "budgeting doesn't work",
      "rent vs buy 2026 math"
    ],
    titlePatterns: [
      "Why $100K Still Feels Broke In 2026",
      "The Budgeting Advice That's Making You Poorer",
      "The 'Middle Class' Bracket That Doesn't Exist Anymore",
      "The Raise That Erased Itself In 4 Months"
    ],
    bannedOpeners: ["matrix", "dark psychology", "simulation", "sovereign"]
  }
] as const;

/**
 * Deterministic angle assignment: given a clip's global index and a content offset
 * (typically a hash of the source title), return the AudienceAngle that clip MUST target.
 * Rotates through AUDIENCE_ANGLES modulo its length so no two clips in the same batch
 * collide and different source videos start from different angles.
 */
export function angleForClipIndex(globalIndex: number, offset = 0): AudienceAngle {
  const pool = AUDIENCE_ANGLES;
  const idx = ((globalIndex + offset) % pool.length + pool.length) % pool.length;
  return pool[idx];
}

/**
 * Builds the AUDIENCE ROTATION PROTOCOL block that gets injected into the
 * generatePlatformCopy LLM prompt. One assignment per clip in the batch.
 */
export function buildAudienceRotationBlock(
  assignments: Array<{ clipLabel: string; angle: AudienceAngle }>
): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════");
  lines.push("AUDIENCE ROTATION PROTOCOL (NON-NEGOTIABLE)");
  lines.push("═══════════════════════════════════════════════");
  lines.push("");
  lines.push("The content is universal. WHO discovers it changes per clip.");
  lines.push("Every clip in this batch has a PRE-ASSIGNED demographic angle.");
  lines.push("You MUST write that clip's titles, hooks, captions, and descriptions FROM THAT ANGLE'S PERSPECTIVE.");
  lines.push("No two clips in this batch may share the same angle, keyword cluster, or emotional entry.");
  lines.push("");
  lines.push("ASSIGNMENTS (each clip → its angle):");
  lines.push("");
  for (const { clipLabel, angle } of assignments) {
    lines.push(`━ ${clipLabel} → ${angle.name}`);
    lines.push(`   Demographic: ${angle.demographic}`);
    lines.push(`   Voice: ${angle.voice}`);
    lines.push(`   Emotional entry: ${angle.emotionalEntry}`);
    lines.push(`   SEO keyword seeds (weave 5-7 into the YouTube description bottom): ${angle.keywordSeeds.join(", ")}`);
    lines.push(`   Title patterns (imitate the shape, do NOT copy verbatim): ${angle.titlePatterns.map(t => `"${t}"`).join(" | ")}`);
    lines.push(`   BANNED opener words for this clip's title: ${angle.bannedOpeners.join(", ")}`);
    lines.push("");
  }
  lines.push("TITLE VARIANCE RULES (APPLY TO EVERY CLIP):");
  lines.push('- BANNED title starts (batch-wide): "The Matrix", "Dark Psychology", "The Simulation", "They Don\'t Want You To", "Sovereign" as first word, "Why The System".');
  lines.push("- REQUIRED: hyper-specific, curiosity-gap, demographic-coded. Include a number, a name, a product, or a pattern-interrupt noun in the first 4 words when possible.");
  lines.push("- Each clip's youtube_short title MUST use vocabulary from its assigned demographic, NOT the Sovereign Synthesis internal lexicon.");
  lines.push('- Generic "awakening" / "mindset" / "liberation" titles are BANNED unless they are directly demographic-coded (e.g. "The Awakening Nobody Warned The Exvangelical Kids About").');
  lines.push("");
  lines.push("TAG SMUGGLING PROTOCOL (BUFFER DROPS YOUTUBE API TAGS — WORK AROUND IT):");
  lines.push("Buffer's YouTube integration strips the tags field entirely. To preserve SEO discovery, you MUST append a 'Related topics:' line at the VERY BOTTOM of each youtube_short description string, containing 5-7 of that clip's assigned angle keyword seeds, comma-separated, blended naturally.");
  lines.push("Format (exact): '\\n\\nRelated topics: <kw1>, <kw2>, <kw3>, <kw4>, <kw5>, <kw6>'");
  lines.push("Rules:");
  lines.push("  • Use ONLY keywords from the clip's assigned angle. Cross-contamination is banned.");
  lines.push("  • Adapt the seeds to the clip's specific insight — do NOT dump the list verbatim.");
  lines.push("  • No hashtags in the Related topics line. Plain text only.");
  lines.push("  • No hype words ('insane', 'must-see', 'mind-blown').");
  lines.push("  • The 'Related topics:' line is MANDATORY on every youtube_short description.");
  lines.push("");
  return lines.join("\n");
}

/**
 * Cheap deterministic string hash → non-negative int. Used so the same source video
 * always rotates angles the same way, and different sources start from different
 * positions in the angle pool.
 */
export function hashStringToAngleOffset(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 48 — FREQUENCY BIFURCATION PROTOCOL
// Single source of truth for brand voice bifurcation.
// Consumed by Anita (faceless-factory.ts) and Yuki (vidrush-orchestrator.ts
// + buildSocialOptimizationPrompt above) so updating ONE file updates every
// LLM prompt injection site in the pipeline.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type BrandFrequency = "ace_richie" | "containment_field";

export interface BrandFrequencyProfile {
  brandLabel: string;
  frequencyLayer: "LOWER" | "HIGHER";
  identity: string;
  theme: string;
  tone: string;
  style: string;
  structure: string;
  lexiconRequired: readonly string[];
  lexiconBanned: readonly string[];
  sampleTitles: readonly string[];
  sampleHooks: readonly string[];
  voiceMandate: string;
}

export const BRAND_FREQUENCY_PROFILES: Record<BrandFrequency, BrandFrequencyProfile> = {
  containment_field: {
    brandLabel: "The Containment Field",
    frequencyLayer: "LOWER",
    identity: "The Containment Field is an anonymous, top-of-funnel channel written for people who are still INSIDE the machine and know something is wrong but do not yet have the vocabulary. The narrator is a whistleblower reading a declassified brief at a quiet table — measured, tactical, specific. The audience is a tired worker who just closed their laptop and is looking for someone who can finally NAME what is happening to them. Never speak in cosmology, quantum metaphors, or spiritual vocabulary.",
    theme: "Escaping the Matrix as a concrete set of behavioral programs installed by the workplace. Dark psychology as it is used IN PRACTICE — by managers, HR, performance reviews, promotion ladders. Systemic corporate burnout as the product of an extraction loop. Human behavioral programming installed one micro-compliance at a time. The 9-to-5 grind as a conditioning apparatus, not a moral failure.",
    tone: "Clinical, edgy, tactical, grounded in raw survival. Name the extraction loop. Name the operator. Empathize with the exhaustion FIRST, then expose the manipulation. Never uplifting. Never 'expansive'. Never motivational. The emotional peak is RECOGNITION, not transcendence.",
    style: "High-velocity, punchy, listicle-friendly. Frameworks with numbers ('3 Signs', '6 Tricks', '4 Micro-Compliance Traps'). Short sentences. Pattern-interrupt hooks that name a specific body sensation the viewer is having right now ('If your chest tightens when your manager says quick sync...'). Zero abstract language. Every claim is falsifiable and tactical.",
    structure: "NAME THE LOOP (clinical description of the extraction pattern) → EXPOSE THE MECHANISM (how the operant conditioning was installed) → DELIVER ONE COUNTERMEASURE (a single concrete tactic the viewer can run tomorrow morning). Lists are encouraged. Numbered steps are encouraged. The viewer should feel ARMED, not awakened.",
    lexiconRequired: [
      "nervous system",
      "systemic exploitation",
      "cognitive dissonance",
      "micro-compliance",
      "the machine",
      "extraction loop",
      "operant conditioning",
      "behavioral program",
      "the grind",
      "gaslighting",
      "performance review",
      "manager",
      "countermeasure",
    ],
    lexiconBanned: [
      "quantum",
      "quantum field",
      "quantum mechanics",
      "timeline",
      "timelines",
      "timeline jumping",
      "timeline distortion",
      "source",
      "the source",
      "source code",
      "God-consciousness",
      "god-consciousness",
      "god consciousness",
      "frequency",
      "frequencies",
      "frequency signature",
      "monad",
      "solipsism",
      "identity spaghettification",
    ],
    sampleTitles: [
      "The 4 Micro-Compliance Traps Built Into Your Workday",
      "3 Signs Your Manager Is Running An Extraction Loop On You",
      "6 Tricks HR Uses To Keep You Compliant",
      "The Performance Review Is A Behavioral Program",
      "5 Behavioral Programs Your Company Installed Without Telling You",
    ],
    sampleHooks: [
      "If your chest tightens when your manager says 'quick sync', your body already knows what your mind hasn't named yet.",
      "There are three micro-compliance traps in your last performance review. I'm going to name all of them.",
      "The exhaustion you feel at 3pm isn't laziness. It's a conditioning loop that took 14 months to install.",
    ],
    voiceMandate:
      "You speak like a whistleblower reading a declassified brief at a quiet table. Measured, low-cadence, zero dramatics. Every claim is tactical and falsifiable. The viewer should feel SEEN in their exhaustion and then ARMED with a specific countermeasure — never 'uplifted' or 'expanded'.",
  },
  ace_richie: {
    brandLabel: "Ace Richie / Sovereign Synthesis",
    frequencyLayer: "HIGHER",
    identity: "Ace Richie speaking as the System Architect. Personal brand. Master-level sovereign transmission for souls who have already outgrown the 'how do I survive my manager' layer. The audience is a mind that already suspects reality is self-authored and is hunting for the vocabulary to confirm it. Never speak in hacks, tips, numbered lists, or workplace analogies.",
    theme: "Master-Level Sovereign Synthesis. Quantum mechanics of the soul. Timeline jumping as a daily practice. Solipsism as operating system — the viewer is authoring the universe by the frequency signature they are broadcasting. Event horizons of identity. The collapse of the old self as a prerequisite for the monad to re-select its timeline.",
    tone: "Hypnotic, esoteric, deeply philosophical, absolute. Speak in edicts, not suggestions. Do not offer hacks, tips, tricks, numbered steps, or frameworks the viewer can 'try'. Deliver universal laws the way an oracle delivers them — as though the viewer was always meant to hear this, and the only variable is whether they are ready. Warmth is allowed; concession is not.",
    style: "Slow, mesmerizing pacing. Long, breath-driven sentences that loop back on themselves. Pauses. Repetition as incantation. Speaking directly to the soul's architecture and the illusion of separation between the viewer and the universe they believe is happening TO them. Every line should feel like it was spoken into existence, not written into a doc.",
    structure: "EDICT (a universal law stated as fact in the first breath) → MIRROR (show the viewer they are already living inside this law, unconsciously) → DISTORTION (reveal the timeline they are broadcasting and why it is being mirrored back at them) → RE-SELECTION (name the frequency signature they must hold to collapse into the next timeline — NOT an action step, a state). No lists. No bullet points. No 'here is what to do tomorrow'.",
    lexiconRequired: [
      "quantum field",
      "frequency signature",
      "event horizon",
      "timeline distortion",
      "timeline jumping",
      "monad",
      "identity spaghettification",
      "the field",
      "the signal",
      "the collapse",
      "solipsism",
      "source",
      "the self re-authoring",
    ],
    lexiconBanned: [
      "bosses",
      "boss",
      "manager",
      "managers",
      "corporate",
      "corporation",
      "corporations",
      "hacks",
      "hack",
      "psychology tricks",
      "psychology trick",
      "dark psychology trick",
      "lazy",
      "laziness",
      "the 9-to-5",
      "9 to 5",
      "9-to-5",
      "nine to five",
      "tips",
      "tip",
      "3 signs",
      "6 tricks",
      "listicle",
    ],
    sampleTitles: [
      "You Are The Monad That Forgot It Chose This",
      "The Timeline You Are Broadcasting Is Being Mirrored Back",
      "Identity Spaghettification At The Edge Of The Self",
      "The Frequency Signature That Collapses Every Other Version Of You",
      "You Were Never Inside The Story — The Story Was Inside You",
    ],
    sampleHooks: [
      "The timeline you are standing on was selected by a version of you that did not yet know it was selecting.",
      "Every room you walk into is being authored in real time by the frequency you decided to hold on the way in.",
      "The universe is not happening to you. It is spelling itself out of you, and you are the only one who can misspell it.",
    ],
    voiceMandate:
      "You speak like an oracle who already knows what the viewer is about to remember. Slow. Inevitable. Never hurried. Never listing. Never 'explaining' — unfolding. The viewer should feel RECOGNIZED at the level of the soul, not the nervous system. They should feel the cadence change their breathing.",
  },
};

/**
 * Build the FREQUENCY BIFURCATION PROTOCOL block that gets prepended to every
 * LLM prompt (Anita scriptwriter, Yuki copywriter, long-form SEO) for a given
 * brand. This is the non-negotiable voice-lock layer.
 */
export function buildBrandFrequencyBlock(brand: BrandFrequency): string {
  const p = BRAND_FREQUENCY_PROFILES[brand];
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════");
  lines.push(`FREQUENCY BIFURCATION PROTOCOL — ${p.frequencyLayer} FREQUENCY LAYER`);
  lines.push(`CHANNEL: ${p.brandLabel}`);
  lines.push("═══════════════════════════════════════════════");
  lines.push("");
  lines.push("This block overrides any generic voice advice that follows it.");
  lines.push("Violations are a hard failure, not a stylistic preference.");
  lines.push("");
  lines.push("IDENTITY:");
  lines.push(`  ${p.identity}`);
  lines.push("");
  lines.push("THEME:");
  lines.push(`  ${p.theme}`);
  lines.push("");
  lines.push("TONE:");
  lines.push(`  ${p.tone}`);
  lines.push("");
  lines.push("STYLE:");
  lines.push(`  ${p.style}`);
  lines.push("");
  lines.push("STRUCTURE:");
  lines.push(`  ${p.structure}`);
  lines.push("");
  lines.push("REQUIRED LEXICON (weave naturally, do not dump):");
  for (const w of p.lexiconRequired) lines.push(`  • ${w}`);
  lines.push("");
  lines.push("BANNED LEXICON (ZERO TOLERANCE — self-audit before emitting):");
  for (const w of p.lexiconBanned) lines.push(`  • ${w}`);
  lines.push("");
  lines.push("SAMPLE TITLE SHAPES (imitate the shape, do NOT copy verbatim):");
  for (const t of p.sampleTitles) lines.push(`  • "${t}"`);
  lines.push("");
  lines.push("SAMPLE HOOK SHAPES (imitate the cadence, do NOT copy verbatim):");
  for (const h of p.sampleHooks) lines.push(`  • "${h}"`);
  lines.push("");
  lines.push("VOICE MANDATE:");
  lines.push(`  ${p.voiceMandate}`);
  lines.push("");
  lines.push("SELF-AUDIT (run before emitting ANY final output):");
  lines.push("  1. Scan every sentence for the BANNED LEXICON list above. If any banned word appears, REWRITE that sentence.");
  lines.push("  2. Confirm that at least 3 words from the REQUIRED LEXICON appear organically in the output.");
  lines.push("  3. Read the output aloud in your head in the voice described by VOICE MANDATE. If the cadence does not match, rewrite.");
  lines.push("═══════════════════════════════════════════════");
  return lines.join("\n");
}
