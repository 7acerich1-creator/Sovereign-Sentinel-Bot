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
  return `You are a social media marketing expert who will provide best practices for maximizing the reach and viral potential of content on social media platforms. Your goal is to give actionable, specific advice based on the type of content, platform, and target audience.

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
