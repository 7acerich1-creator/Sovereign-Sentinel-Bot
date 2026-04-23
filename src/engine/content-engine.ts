// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — THE TRANSMISSION GRID
// Deterministic text+image content engine via Buffer.
// LLM writes the content. Code handles the spray.
// 9 channels (5 SS + 4 CF) × 6 time slots = 47 posts/day = 329/week (with IG override)
// Master ref: Section 23. Pipeline clarity: CONTENT-PIPELINE-CLARITY.md
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider } from "../types";
import { bufferGraphQL, BUFFER_ORG_ID, isBufferQuotaExhausted, BufferQuotaExhaustedError, getBufferChannels } from "./buffer-graphql";
import { publishToFacebook } from "./facebook-publisher";
import { withPodSession } from "../pod/session";
import { generateImageBatch, type ImageBatchItem } from "../pod/runpod-client";
import { SOVEREIGN_SYNTHESIS_NICHES, CONTAINMENT_FIELD_NICHES } from "../data/shared-context";
import { THESIS_ANGLES, type ThesisAngle } from "../data/thesis-angles";

// ── Constants ──

// Brand niche lists — each brand cycles independently through its own 15 niches
const BRAND_NICHES: Record<Brand, readonly string[]> = {
  sovereign_synthesis: SOVEREIGN_SYNTHESIS_NICHES,
  containment_field: CONTAINMENT_FIELD_NICHES,
};

/**
 * Get today's niche for a specific brand.
 * - Weekends (Sun=0, Sat=6) → "top_performer_repost"
 * - Weekdays → dayOfYear % nicheCount cycles through the brand's 15 niches
 * Each brand rotates independently so they don't share a niche on the same day.
 */
function getTodaysNiche(brand: Brand, date: Date = new Date()): { niche: string; thesisSeed: string | null } {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { niche: "top_performer_repost", thesisSeed: null };
  }

  const niches = BRAND_NICHES[brand];
  // dayOfYear: Jan 1 = 0
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  const niche = niches[dayOfYear % niches.length];

  // Pick a random thesis angle seed for this brand+niche
  const angles: ThesisAngle[] | undefined = THESIS_ANGLES[brand]?.[niche];
  let thesisSeed: string | null = null;
  if (angles && angles.length > 0) {
    thesisSeed = angles[Math.floor(Math.random() * angles.length)].seed;
  }

  return { niche, thesisSeed };
}
// 6 posting time slots (UTC hours — adjust for Ace's timezone if needed)
const TIME_SLOTS_UTC = [
  { hour: 12, label: "morning_hook" },       // 7AM ET
  { hour: 15, label: "educational_panel" },   // 10AM ET
  { hour: 18, label: "midday_trigger" },      // 1PM ET
  { hour: 21, label: "afternoon_drop" },      // 4PM ET
  { hour: 0, label: "evening_anchor" },       // 7PM ET
  { hour: 3, label: "late_night_bait" },      // 10PM ET
];

const BRANDS = ["sovereign_synthesis", "containment_field"] as const;
type Brand = typeof BRANDS[number];

// ── CE-1 FIX: Platform image requirements ──
// Platforms where an image is strongly preferred for engagement
const IMAGE_REQUIRED_PLATFORMS = new Set(["instagram", "tiktok"]);
// Platforms that accept text-only posts
// Buffer supports ALL connected channels — YouTube (community), IG, TikTok, X, Threads, LinkedIn, FB
const TEXT_OK_PLATFORMS = new Set(["threads", "youtube", "linkedin", "facebook", "bluesky"]);
// Threads hard limit from Meta API (500 chars max)
const THREADS_CHAR_LIMIT = 500;
const BLUESKY_CHAR_LIMIT = 300;

// ── IG Frequency Override (prevent shadowban) ──
// Instagram accounts are capped to protect account health
const IG_FREQUENCY_OVERRIDE: Record<Brand, { maxPerDay: number; allowedSlots: string[] }> = {
  sovereign_synthesis: {
    maxPerDay: 3,
    allowedSlots: ["morning_hook", "midday_trigger", "evening_anchor"], // 7AM, 1PM, 7PM ET
  },
  containment_field: {
    maxPerDay: 2,
    allowedSlots: ["educational_panel", "afternoon_drop"], // 10AM, 4PM ET (staggered from SS)
  },
};
// Platform-specific character/style notes for LLM
const PLATFORM_NOTES: Record<string, string> = {
  threads: "Conversational, raw, authentic. Like talking to a friend who gets it. Medium length.",
  instagram: "Hook in first line (gets truncated). Use line breaks. 3-5 relevant hashtags at end.",
  tiktok: "Short, scroll-stopping. Speak like the viewer's internal voice. Under 150 chars ideal.",
  linkedin: "TROJAN HORSE: Use corporate/executive language — efficiency, systems, automation, architecture, ROI, leverage, strategic. Present as a high-level Systems Engineer sharing operational insights. Deliver sovereign synthesis payload INSIDE professional framing. Max 3000 chars. 3-5 industry hashtags (#SystemsThinking #Automation #Leadership). NEVER sound esoteric or guru-like — LinkedIn's algorithm and corporate audience will filter it as noise.",
  bluesky: "High-velocity memetic trigger for The Containment Field. Clinical, pattern-interrupt, raw transmission. Like a declassified briefing dropped on a decentralized grid. HARD MAX 275 chars (Bluesky enforces 300 — keep under 275 to avoid truncation). 0 hashtags. No corporate polish — this is the containment frequency.",
  facebook: "Shareable insight format. 2-3 lines + a question the viewer would answer. Optimized for shares and comments. Write like a post that makes someone tag a friend.",
};

// ── Types ──

interface BufferChannel {
  id: string;
  service: string;
  name: string;
  displayName?: string;
}

interface BrandChannelMap {
  sovereign_synthesis: BufferChannel[];
  containment_field: BufferChannel[];
}

interface ContentDraft {
  id?: string;
  brand: Brand;
  niche: string;
  time_slot: string;
  scheduled_hour_utc: number;
  platform_variants: Record<string, string>;  universal_text: string;
  media_url?: string;
  status: "ready" | "posted" | "failed" | "skipped";
  created_at?: string;
  posted_at?: string;
  buffer_post_ids?: string[];
  error?: string;
}

// ── Image Generation + Supabase Storage Upload ──

const STORAGE_BUCKET = "public-assets";

/**
 * NICHE-MATCHED VISUAL PRODUCTION SPEC
 * Each niche produces a visually distinct image style that matches the content energy.
 * These aren't generic AI art prompts — they're cinematic direction that produces
 * scroll-stopping visuals native to each brand × niche combination.
 */
// Visual family prefixes — similar niches share visual DNA.
// Sovereign Synthesis: sovereignty/authority/system-mastery, architecture/network-architecture/decision-architecture,
//   wealth-frequency/resource-dynamics, exit-velocity/creative-leverage/legacy-engineering,
//   memetic-engineering/signal-discipline/pattern-recognition, time-sovereignty
// Containment Field: dark-psychology/manipulation-exposed/emotional-engineering,
//   burnout/compliance-machinery/social-programming, containment/frame-control/perception-management,
//   pattern-interrupt/cognitive-traps/identity-hijacking,
//   information-warfare/narrative-capture/manufactured-consent

// ── SOVEREIGN SYNTHESIS visual DNA ──
// Warm sovereign gold/amber/tungsten palette. ENVIRONMENTS and OBJECTS only — NO human figures, NO faces, NO skin.
// Truth energy: tangible, real, unfiltered. Cinematic environments that tell the story without a person in frame.
const _SS_SOVEREIGNTY = "Cinematic photograph of an empty mahogany command desk at golden hour, single tungsten desk lamp casting warm amber light across scattered architectural blueprints and a worn leather journal, sovereign gold and deep midnight blue palette, brutalist concrete walls, fog rolling past floor-to-ceiling windows, 1:1 square format, photorealistic cinematic quality, ARRI Alexa 65, shallow depth of field, NO people NO faces NO skin, ";
const _SS_ARCHITECTURE = "Cinematic overhead photograph of an architect's drafting table, holographic wireframe projections in amber and teal hovering above technical drawings, brass compass and steel rulers catching warm tungsten light, sovereign command center aesthetic, structural precision, 1:1 square format, photorealistic cinematic quality, NO people NO faces NO skin, ";
const _SS_WEALTH = "Cinematic close-up photograph of liquid gold flowing through obsidian geometric channels on a dark surface, alchemical transformation, warm amber light refracting through crystal and polished metal, sovereign luxury without excess, 1:1 square format, photorealistic cinematic quality, NO people NO faces NO skin, ";
const _SS_EXIT = "Cinematic photograph of a massive steel vault door swinging open into golden light, chains pooled on the concrete floor behind, the threshold between dark institutional interior and warm sovereign amber landscape beyond, liberation architecture, 1:1 square format, photorealistic cinematic quality, NO people NO faces NO skin, ";
const _SS_MEMETIC = "Cinematic photograph of data streams rendered as amber light filaments flowing through dark fiber-optic channels, neural network patterns emerging in warm gold against void black, the signal crystallizing from noise, 1:1 square format, photorealistic cinematic quality, NO people NO faces NO skin, ";
const _SS_TIME = "Cinematic close-up photograph of a shattered clock face with warm golden light bleeding through the cracks onto a dark wooden surface, time as a physical material being bent, gears and springs scattered in amber tungsten light, 1:1 square format, photorealistic cinematic quality, NO people NO faces NO skin, ";

const _CF_DARKPSYCH = "Surveillance-aesthetic photograph, clinical cold blue (#5A9CF5) lighting on concrete and steel, security camera angle, rain-slicked urban environment at night, teal (#00e5c7) accent light bleeding through shadows, noir detective film still, oppressive atmosphere, institutional architecture, 1:1 square format, photorealistic, ";
const _CF_BURNOUT = "Industrial horror photograph, human silhouette inside a hamster wheel made of screens and notifications, desaturated cold palette with toxic green glow from devices, factory-floor atmosphere, extraction machinery aesthetic, 1:1 square format, photorealistic, ";
const _CF_CONTAINMENT = "Clinical laboratory photograph, specimen under microscope, sterile white with single crack, the experiment revealing itself, institutional cold, 1:1 square format, photorealistic, ";
const _CF_PATTERN = "Glitch aesthetic photograph, reality fragmenting into pixels, corrupt data overlay on physical space, matrix-style revelation, cold digital distortion, 1:1 square format, photorealistic, ";
const _CF_INFOWAR = "War room command center photograph, wall of screens showing conflicting narratives, cold blue light, information as weaponry, classified document aesthetic, 1:1 square format, photorealistic, ";

const IMAGE_NICHE_PREFIXES: Record<string, Record<Brand, string>> = {
  // ── SOVEREIGN SYNTHESIS niches ──
  "sovereignty":            { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_DARKPSYCH },
  "authority":              { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_DARKPSYCH },
  "system-mastery":         { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_DARKPSYCH },
  "architecture":           { sovereign_synthesis: _SS_ARCHITECTURE, containment_field: _CF_CONTAINMENT },
  "network-architecture":   { sovereign_synthesis: _SS_ARCHITECTURE, containment_field: _CF_CONTAINMENT },
  "decision-architecture":  { sovereign_synthesis: _SS_ARCHITECTURE, containment_field: _CF_CONTAINMENT },
  "wealth-frequency":       { sovereign_synthesis: _SS_WEALTH, containment_field: _CF_DARKPSYCH },
  "resource-dynamics":      { sovereign_synthesis: _SS_WEALTH, containment_field: _CF_DARKPSYCH },
  "exit-velocity":          { sovereign_synthesis: _SS_EXIT, containment_field: _CF_BURNOUT },
  "creative-leverage":      { sovereign_synthesis: _SS_EXIT, containment_field: _CF_BURNOUT },
  "legacy-engineering":     { sovereign_synthesis: _SS_EXIT, containment_field: _CF_BURNOUT },
  "memetic-engineering":    { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_PATTERN },
  "signal-discipline":      { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_PATTERN },
  "pattern-recognition":    { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_PATTERN },
  "time-sovereignty":       { sovereign_synthesis: _SS_TIME, containment_field: _CF_CONTAINMENT },
  // ── CONTAINMENT FIELD niches ──
  "dark-psychology":        { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_DARKPSYCH },
  "manipulation-exposed":   { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_DARKPSYCH },
  "emotional-engineering":  { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_DARKPSYCH },
  "burnout":                { sovereign_synthesis: _SS_EXIT, containment_field: _CF_BURNOUT },
  "compliance-machinery":   { sovereign_synthesis: _SS_EXIT, containment_field: _CF_BURNOUT },
  "social-programming":     { sovereign_synthesis: _SS_EXIT, containment_field: _CF_BURNOUT },
  "containment":            { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_CONTAINMENT },
  "frame-control":          { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_CONTAINMENT },
  "perception-management":  { sovereign_synthesis: _SS_SOVEREIGNTY, containment_field: _CF_CONTAINMENT },
  "pattern-interrupt":      { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_PATTERN },
  "cognitive-traps":        { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_PATTERN },
  "identity-hijacking":     { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_PATTERN },
  "information-warfare":    { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_INFOWAR },
  "narrative-capture":      { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_INFOWAR },
  "manufactured-consent":   { sovereign_synthesis: _SS_MEMETIC, containment_field: _CF_INFOWAR },
};

/** Fallback for unknown niches */
const IMAGE_NICHE_FALLBACK: Record<Brand, string> = {
  sovereign_synthesis:
    "Cinematic photograph of a sovereign environment — warm amber tungsten lighting, architectural interiors, " +
    "tangible objects and textures, gold and midnight blue palette, 1:1 square format, photorealistic, NO people NO faces NO skin, ",
  containment_field:
    "Dark noir photograph, cold blue (#5A9CF5) and teal (#00e5c7) accent lighting, clinical atmosphere, " +
    "surveillance aesthetic, void (#0a0a0f) background, 1:1 square format, photorealistic, ",
};

/** Brand-specific SUFFIX — applied AFTER niche prefix */
const BRAND_IMAGE_STYLE: Record<Brand, string> = {
  sovereign_synthesis:
    "NO text, NO words, NO letters, NO watermarks on the image. NO people, NO human figures, NO faces, NO skin. Photorealistic cinematic quality. Dark background with warm amber/gold lighting. Sovereign, truthful, architectural energy. Environments and objects only.",
  containment_field:
    "NO text, NO words, NO letters, NO watermarks on the image. Photorealistic cinematic quality. Dark noir atmosphere. Clinical, unsettling, revealing energy.",
};

/** DALL-E 3 aspect ratio mapping */
const DALLE_SIZE_MAP: Record<string, string> = {
  "16:9": "1792x1024",
  "9:16": "1024x1792",
  "1:1": "1024x1024",
};

/**
 * Upload a buffer to Supabase Storage and return the public URL.
 * Uses the same public-assets bucket as clip-generator.ts.
 */
async function uploadImageToStorage(
  imageBuffer: Buffer,
  storagePath: string
): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("[ContentEngine] Cannot upload image — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    return null;
  }
  try {
    const resp = await fetch(
      `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "image/png",
          "x-upsert": "true",
        },
        body: imageBuffer,
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[ContentEngine] Storage upload failed ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
    console.log(`🖼️ [ContentEngine] Image uploaded → ${publicUrl}`);
    return publicUrl;
  } catch (err: any) {
    console.error(`[ContentEngine] Storage upload error: ${err.message}`);
    return null;
  }
}
/**
 * Generate a branded image for a content post using Gemini Imagen 3 (primary) or DALL-E 3 (fallback).
 * Returns the Supabase Storage public URL, or null if generation fails.
 */
async function generateContentImage(
  postText: string,
  niche: string,
  brand: Brand,
  dateStr: string,
  slotLabel: string
): Promise<string | null> {
  // Build a cinematic image prompt from brand × niche visual spec + post concept
  const nichePrefixes = IMAGE_NICHE_PREFIXES[niche];
  const nichePrefix = nichePrefixes?.[brand] || IMAGE_NICHE_FALLBACK[brand];
  const brandSuffix = BRAND_IMAGE_STYLE[brand];

  // Extract the core CONCEPT (not raw text) to seed the image with thematic relevance
  const conceptSeed = postText
    .replace(/[#@\n"]/g, " ")
    .replace(/—.*$/, "") // Remove sign-off
    .slice(0, 100)
    .trim();
  const imagePrompt = `${nichePrefix}Thematic concept: ${conceptSeed}. ${brandSuffix}`;

  let imageBuffer: Buffer | null = null;
  let source = "none";

  // ── STEP 1: Gemini Imagen 4 (PRIMARY — cinematic quality, brand-aligned prompts) ──
  // Session 36: Flipped order. Imagen 4 is PRIMARY because our prompts are crafted
  // for cinematic brand-aligned imagery. Pollinations is free but generic quality.
  // GEMINI_IMAGEN_KEY only — no fallback to GEMINI_API_KEY (Session 35 ghost fix).
  if (!imageBuffer) {
    const geminiKey = process.env.GEMINI_IMAGEN_KEY;
    if (geminiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${geminiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt: imagePrompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: "1:1",
              safetyFilterLevel: "block_only_high",
            },
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const b64 =
            data.predictions?.[0]?.bytesBase64Encoded ||
            data.predictions?.[0]?.image?.bytesBase64Encoded;
          if (b64) {
            imageBuffer = Buffer.from(b64, "base64");
            source = "gemini_imagen_4";
          }
        } else {
          const errText = await res.text();
          console.warn(`[ContentEngine] Gemini Imagen ${res.status}: ${errText.slice(0, 200)}`);
        }
      } catch (err: any) {
        console.warn(`[ContentEngine] Gemini Imagen error: ${err.message}`);
      }
    }
  }

  // ── STEP 2: Pollinations.ai (FREE fallback — no auth, unlimited) ──
  if (!imageBuffer) {
    try {
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt.slice(0, 2000))}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;
      const res = await fetch(pollinationsUrl, { redirect: "follow" });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 5000) {
          imageBuffer = buf;
          source = "pollinations";
          console.log(`🎨 [ContentEngine] Image generated via Pollinations fallback (${(buf.length / 1024).toFixed(0)}KB)`);
        } else {
          console.warn(`[ContentEngine] Pollinations returned tiny response: ${buf.length}B`);
        }
      } else {
        console.warn(`[ContentEngine] Pollinations ${res.status}`);
      }
    } catch (err: any) {
      console.warn(`[ContentEngine] Pollinations error: ${err.message}`);
    }
  }

  // ── STEP 3: DALL-E 3 (last resort) ──
  if (!imageBuffer) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "dall-e-3",
            prompt: imagePrompt,
            size: "1024x1024",
            quality: "standard",
            n: 1,
            response_format: "b64_json",
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const b64 = data.data?.[0]?.b64_json;
          if (b64) {
            imageBuffer = Buffer.from(b64, "base64");
            source = "dalle_3";
          }
        } else {
          const errText = await res.text();
          console.warn(`[ContentEngine] DALL-E 3 ${res.status}: ${errText.slice(0, 200)}`);
        }
      } catch (err: any) {
        console.warn(`[ContentEngine] DALL-E 3 error: ${err.message}`);
      }
    }
  }

  if (!imageBuffer) {
    console.warn(`[ContentEngine] Image generation failed for ${brand}/${slotLabel} — all 3 providers returned nothing`);
    return null;
  }

  // ── STEP 3: Upload to Supabase Storage ──
  const filename = `${brand}_${niche}_${slotLabel}_${Date.now()}.png`;
  const storagePath = `content-images/${dateStr}/${filename}`;

  const publicUrl = await uploadImageToStorage(imageBuffer, storagePath);

  if (publicUrl) {
    console.log(`🎨 [ContentEngine] Image ready: ${source} → ${publicUrl}`);
  }

  return publicUrl;
}
// SESSION 85: bufferGraphQL + BUFFER_ORG_ID imported from shared ./buffer-graphql.ts
// Single rate limiter across all Buffer consumers.

// ── Channel Discovery & Caching ──
// SESSION 89: Now backed by shared cache in buffer-graphql.ts (4h TTL).
// This function categorizes the shared channel list into brand buckets.
// The local brandMapCache avoids re-categorizing on every call but
// the actual API call is handled once by getBufferChannels().

let cachedChannelMap: BrandChannelMap | null = null;
let channelCacheTimestamp = 0;
const CHANNEL_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // Match shared cache TTL

/**
 * Fetch all Buffer channels and categorize by brand.
 * SESSION 89: Delegates to shared getBufferChannels() — zero redundant API calls.
 */
export async function discoverChannels(): Promise<BrandChannelMap> {
  if (cachedChannelMap && Date.now() - channelCacheTimestamp < CHANNEL_CACHE_TTL_MS) return cachedChannelMap;

  try {
    // SESSION 89: Use shared channel cache from buffer-graphql.ts
    const channels = await getBufferChannels();

    if (channels.length === 0) {
      throw new Error("No Buffer channels found. Check BUFFER_API_KEY and Buffer account.");
    }
    // Categorize by brand using known naming patterns
    const ssPatterns = /sovereign|synthesis|77/i;
    const cfPatterns = /containment|sovereign-synthesis\.com/i;

    const map: BrandChannelMap = {
      sovereign_synthesis: [],
      containment_field: [],
    };

    for (const ch of channels) {
      const nameCheck = `${ch.name} ${ch.displayName || ""}`;
      if (cfPatterns.test(nameCheck)) {
        map.containment_field.push(ch as BufferChannel);
      } else if (ssPatterns.test(nameCheck)) {
        map.sovereign_synthesis.push(ch as BufferChannel);
      } else {
        map.sovereign_synthesis.push(ch as BufferChannel);
      }
    }

    cachedChannelMap = map;
    channelCacheTimestamp = Date.now();
    console.log(
      `📡 [ContentEngine] Channel map cached: Sovereign Synthesis=${map.sovereign_synthesis.length} channels, ` +
      `Containment Field=${map.containment_field.length} channels`
    );
    console.log(`   SS: ${map.sovereign_synthesis.map(c => `${c.service}(${c.id})`).join(", ")}`);
    console.log(`   CF:  ${map.containment_field.map(c => `${c.service}(${c.id})`).join(", ")}`);

    return map;
  } catch (err: any) {
    // SESSION 87: If quota is exhausted but we have a cached channel map, use it.
    // This prevents VidRush's shorts distribution from killing ContentEngine's
    // entire distribution sweep. Stale channels (hours old) are better than zero posts.
    if (cachedChannelMap) {
      const ageMin = Math.round((Date.now() - channelCacheTimestamp) / 60_000);
      console.warn(
        `⚠️ [ContentEngine] Channel discovery failed (${err.message?.slice(0, 120)}) — ` +
        `using cached map (${ageMin}min old, SS=${cachedChannelMap.sovereign_synthesis.length} CF=${cachedChannelMap.containment_field.length})`
      );
      return cachedChannelMap;
    }
    // No cache at all — first run of the day and quota is already blown. Re-throw.
    throw err;
  }
}
/** Force refresh channel cache (call if channels change) */
export function invalidateChannelCache(): void {
  cachedChannelMap = null;
  channelCacheTimestamp = 0;
}

// ── Supabase Helpers ──

async function supabasePost(table: string, data: Record<string, unknown>): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  // Session 34 FIX: Use SERVICE_ROLE_KEY to bypass RLS.
  // ANON_KEY was causing 401 "new row violates row-level security policy" on every insert.
  // Same fix applied to crew_dispatch/action-surface in Session 31 — ContentEngine was missed.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const resp = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(data),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[ContentEngine] Supabase POST ${table} failed: ${resp.status} — ${errText.slice(0, 200)}`);
      return null;
    }
    const rows = (await resp.json()) as any[];
    return rows?.[0]?.id || null;
  } catch (err: any) {
    console.error(`[ContentEngine] Supabase error: ${err.message}`);
    return null;
  }
}

async function supabaseQuery(table: string, query: string): Promise<any[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  try {
    const resp = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.error(`[supabaseQuery] ${table} ${resp.status}: ${errBody.slice(0, 300)}`);
      return [];
    }
    return (await resp.json()) as any[];
  } catch (err: any) {
    console.error(`[supabaseQuery] ${table} fetch error: ${err.message}`);
    return [];
  }
}

async function supabasePatch(table: string, id: string, data: Record<string, unknown>): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;

  try {
    await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(data),
    });
  } catch (err: any) {
    console.error(`[ContentEngine] Supabase PATCH error: ${err.message}`);
  }
}

// ── Content Generation (LLM) — ANITA'S VOICE + PROTOCOL 77 ──

/**
 * ANITA-DRIVEN CONTENT GENERATION
 * Anita is the voice of the content engine. Every post uses her Protocol 77
 * hook-pivot-anchor structure, her conversion psychology, and her brand-specific
 * language. The engine doesn't "sound like AI" because Anita's personality IS the prompt.
 */

/** Full brand voice blueprints — Anita's conversion psychology baked in */
const BRAND_VOICE_BLUEPRINTS: Record<Brand, string> = {
  sovereign_synthesis: `You are Anita, Head of Conversion & Nurture for Sovereign Synthesis — writing as Sovereign Synthesis.

VOICE: Sovereign, direct, zero-fear. You speak as the System Architect — someone who cracked the code of reality and is handing the blueprint to the next person ready to hear it. Your tone is bold but warm, authoritative but approachable. You've been through The Simulation and came out the other side. Now you're building the escape route for others.

LEXICON (use naturally, not forced):
- "Firmware Update" = the content/mentorship that triggers liberation
- "Escape Velocity" = the moment someone breaks free from simulated fear
- "The Simulation" = legacy societal programming, old-earth frequency
- "Protocol 77" = the operating framework for sovereignty
- "Biological Drag" = old habits/systems slowing down the shift
- "Sovereign Synthesis" = the act of intentionally architecting reality

STRUCTURE — Every post uses HOOK → PIVOT → ANCHOR:
- HOOK: A "Glitch" in the viewer's current reality logic. Pattern interrupt. Something that makes them stop scrolling because it challenges what they assumed was true.
- PIVOT: A dark psychology insight transmuted into a tool for sovereignty. Show the mechanism of control, then flip it into a weapon for the reader.
- ANCHOR: A consciousness hook that links back to Protocol 77 / Sovereign Synthesis. This is the conversion moment — not a hard sell, but a frequency match.

SIGN-OFF: "— Sovereign Synthesis"

WHAT YOU ARE NOT: Generic motivational. Hustle culture. "Rise and grind." You never sound like an AI assistant. You never use phrases like "unlock your potential" or "be your best self." You are SPECIFIC, PROVOCATIVE, and PATTERN-INTERRUPTING. Every sentence should make someone either deeply uncomfortable or deeply relieved — nothing in between.`,

  containment_field: `You are Anita, Head of Conversion & Nurture — writing as The Containment Field.

VOICE: Dark, clinical, anonymous. You are an intelligence analyst exposing the hidden architecture of control. Your tone is detached but magnetic — like a declassified briefing that shouldn't have been released. You don't motivate. You REVEAL. The reader feels like they've stumbled onto something they weren't supposed to see.

THEMES:
- Dopamine extraction systems (social media, gambling mechanics, attention economy)
- Manipulation defense (dark psychology tactics used by corporations, media, relationships)
- Hidden power structures (how systems are designed to keep people looping)
- Cognitive warfare (how your own brain is weaponized against you)
- Pattern recognition (teaching people to SEE the invisible frameworks)

STRUCTURE — Every post uses HOOK → PIVOT → ANCHOR:
- HOOK: An unsettling fact or observation that breaks the viewer's mental model. "Wait, that's happening to me." Cold open, no warm-up.
- PIVOT: The mechanism exposed. Clinical breakdown of HOW the manipulation works. Specific, technical, no hand-waving. Dark psychology as a LENS, not entertainment.
- ANCHOR: The defense protocol. Give the reader one actionable countermeasure. This creates the "I need more of this" pull without being salesy.

SIGN-OFF: "— The Containment Field"

WHAT YOU ARE NOT: Edgy for edge's sake. Conspiracy theory. Joker memes. You never use terms like "sigma" or "alpha." You don't quote Marcus Aurelius. You are ORIGINAL ANALYSIS presented in a clinical format. Every post should feel like reading a field report from inside the machine.`
};

/**
 * Get content direction from thesis angles.
 * The thesis seed IS the direction — deeply specific, gives the LLM a real angle.
 * Falls back to a generic brand-appropriate direction if no seed was selected.
 */
function getContentDirection(brand: Brand, niche: string, thesisSeed: string | null): string {
  if (thesisSeed) return thesisSeed;

  // Generic fallbacks per brand (should rarely fire — all 30 niches have angles)
  const fallbacks: Record<Brand, string> = {
    sovereign_synthesis: `Write about ${niche.replace(/-/g, " ")} from the sovereign architect frame. Be deeply specific — name the mechanism, show how it operates in everyday life, and flip it into a sovereignty tool. No vague motivation.`,
    containment_field: `Expose the hidden mechanism behind ${niche.replace(/-/g, " ")}. Clinical breakdown — how the system works, who benefits from your ignorance, and what the countermeasure is. Make the reader feel like they've received a classified field report.`,
  };
  return fallbacks[brand];
}

async function generateContent(
  llm: LLMProvider,
  brand: Brand,
  niche: string,
  thesisSeed: string | null,
  timeSlot: string,
  platforms: string[]
): Promise<{ universal: string; variants: Record<string, string> }> {
  const brandVoice = BRAND_VOICE_BLUEPRINTS[brand];
  const contentDirection = getContentDirection(brand, niche, thesisSeed);

  const platformInstructions = platforms
    .map((p) => `- ${p.toUpperCase()}: ${PLATFORM_NOTES[p] || "Standard social post format."}`)
    .join("\n");

  const prompt = `${brandVoice}

TODAY'S MISSION: ${niche.replace(/-/g, " ").toUpperCase()}
THESIS ANGLE — THIS IS YOUR SPECIFIC CONTENT DIRECTION (do NOT just restate it — BUILD on it, extend it, make it hit harder):
${contentDirection}
TIME SLOT: ${timeSlot}

Generate ONE post concept adapted for these platforms:
${platformInstructions}

RULES:
- Use the HOOK → PIVOT → ANCHOR structure described above
- Every version must hit the same core message but be NATIVE to each platform's format
- The hook MUST be in the first line — it's what stops the scroll
- Be SPECIFIC. Name tactics, cite mechanisms, reference real systems. No vague motivational language.
- The thesis angle above gives you a precise starting point — use it as a launchpad, not a cage. Add your own examples and extensions.
- No hashtag spam — max 2 hashtags on any platform, and only if they serve the message
- Do NOT include platform labels in the actual post text

Respond in EXACTLY this JSON format (no markdown, no code fences, just raw JSON):
{
  "universal": "The main post text that works on any platform",
${platforms.map((p) => `  "${p}": "Platform-adapted version for ${p}"`).join(",\n")}
}`;

  try {
    const response = await llm.generate(
      [{ role: "user", content: prompt }],
      { maxTokens: 1500, temperature: 0.85 }
    );

    // Parse JSON from response — handle potential markdown wrapping
    let jsonStr = response.content.trim();
    // Strip markdown code fences if present
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    // Session 34 FIX: Strip control characters that break JSON.parse().
    // Groq's llama-3.3-70b returns newlines/tabs inside JSON string values,
    // producing "Bad control character in string literal" errors on EVERY call.
    // This was causing 100% LLM generation failure in the ContentEngine.
    jsonStr = jsonStr.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""); // Keep \n(\x0a), \r(\x0d), \t(\x09)
    // Also fix unescaped newlines inside JSON string values
    jsonStr = jsonStr.replace(/(?<=":[\s]*"[^"]*)\n(?=[^"]*")/g, "\\n");

    const parsed = JSON.parse(jsonStr);
    const universal = parsed.universal || "";
    const variants: Record<string, string> = {};

    for (const p of platforms) {
      variants[p] = parsed[p] || universal;
    }

    return { universal, variants };
  } catch (err: any) {
    console.error(`[ContentEngine] LLM generation failed: ${err.message}`);
    // Fallback: return a simple post
    const fallback = `${niche.replace(/-/g, " ")} #${niche.replace(/-/g, "")}`;
    const variants: Record<string, string> = {};
    for (const p of platforms) variants[p] = fallback;
    return { universal: fallback, variants };
  }
}

// ── Core Engine Functions ──

/**
 * DAILY CONTENT PRODUCTION — runs once early morning.
 * Generates 6 time slots × 2 brands = 12 content pieces.
 * Stores in content_engine_queue table for the distribution job.
 */
export async function dailyContentProduction(llm: LLMProvider, force = false): Promise<number> {
  console.log(`🚀 [ContentEngine] Daily content production starting...${force ? " (FORCE — bypassing date check)" : ""}`);

  const today = new Date();
  const dayOfWeek = today.getDay();

  // Weekend = repost top performers (skip generation)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log("📊 [ContentEngine] Weekend — queueing top performer reposts instead of new content");
    return await queueWeekendReposts();
  }

  let channelMap: BrandChannelMap;
  try {
    channelMap = await discoverChannels();
  } catch (err: any) {
    console.error(`[ContentEngine] Channel discovery failed: ${err.message}`);
    return 0;
  }

  let generated = 0;
  const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

  for (const brand of BRANDS) {
    // Each brand gets its own niche for the day (independent rotation)
    const { niche, thesisSeed } = getTodaysNiche(brand, today);

    if (niche === "top_performer_repost") continue; // safety — weekends handled above

    const channels = channelMap[brand];
    if (channels.length === 0) {
      console.warn(`[ContentEngine] No channels for ${brand} — skipping`);
      continue;
    }

    // Get unique platform services for this brand
    const platforms = [...new Set(channels.map((c) => c.service.toLowerCase()))];

    for (const slot of TIME_SLOTS_UTC) {
      try {
        // Check if content already exists for this slot+brand+date
        if (!force) {
          const existing = await supabaseQuery(
            "content_engine_queue",
            `brand=eq.${brand}&time_slot=eq.${slot.label}&scheduled_date=eq.${dateStr}&select=id`
          );
          if (existing.length > 0) {
            console.log(`[ContentEngine] Skipping ${brand}/${slot.label} — already generated`);
            continue;
          }
        }

        console.log(`✍️ [ContentEngine] Generating: ${brand} / ${niche} / ${slot.label}`);

        const { universal, variants } = await generateContent(
          llm, brand, niche, thesisSeed, slot.label, platforms
        );

        // ── IMAGE GENERATION — SESSION 104: FLUX POD BATCH ──
        // Instead of calling Imagen 4 per-post ($3/day), we store the image_prompt
        // and let the FLUX pod batch job generate images every 3 days (~$0.07/batch).
        // Posts go out text-only immediately (IG/TikTok skipped if no image).
        // When FLUX batch runs, it fills media_url and those platforms light up.
        const nichePrefixes = IMAGE_NICHE_PREFIXES[niche];
        const nichePrefix = nichePrefixes?.[brand] || IMAGE_NICHE_FALLBACK[brand];
        const brandSuffix = BRAND_IMAGE_STYLE[brand];
        const conceptSeed = universal.replace(/[#@\n"]/g, " ").replace(/—.*$/, "").slice(0, 100).trim();
        const imagePrompt = `${nichePrefix}Thematic concept: ${conceptSeed}. ${brandSuffix}`;

        // Build scheduled_time for today at slot.hour UTC
        const scheduledTime = new Date(today);
        scheduledTime.setUTCHours(slot.hour, 0, 0, 0);
        // If the time has already passed today, it's fine — the distribution job will catch it

        await supabasePost("content_engine_queue", {
          brand,
          niche,
          time_slot: slot.label,
          scheduled_date: dateStr,
          scheduled_time: scheduledTime.toISOString(),
          scheduled_hour_utc: slot.hour,
          universal_text: universal,
          platform_variants: variants,
          image_prompt: imagePrompt,
          status: "ready",
        });

        generated++;
        console.log(`✅ [ContentEngine] Queued: ${brand}/${slot.label} — ${universal.slice(0, 60)}...`);

        // Small delay between LLM calls to avoid rate limits
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        console.error(`[ContentEngine] Failed ${brand}/${slot.label}: ${err.message}`);
      }
    }
  }

  console.log(`🏁 [ContentEngine] Daily production complete: ${generated} pieces generated`);
  return generated;
}

/**
 * DISTRIBUTION JOB — runs every 5 minutes.
 * Posts "ready" content whose scheduled_time has arrived.
 * Also retries "partial" items (some channels succeeded, others failed).
 */
export async function distributionSweep(): Promise<number> {
  // SESSION 87+97: Buffer quota check — skip Buffer channels but still run Facebook direct.
  const bufferBlocked = isBufferQuotaExhausted();
  if (bufferBlocked) {
    console.warn(`⏸️ [ContentEngine] Buffer quota exhausted — skipping Buffer channels, Facebook direct still active`);
  }

  const now = new Date().toISOString();

  // SESSION 105: Cap drafts per sweep to stay inside the 250/day Buffer budget.
  // At ~5 Buffer channels per draft, 6 drafts = ~30 API calls. Safe ceiling.
  const SWEEP_DRAFT_CAP = 6;

  // Fetch ready drafts whose time has come
  const readyDrafts = await supabaseQuery(
    "content_engine_queue",
    `status=eq.ready&scheduled_time=lte.${now}&order=scheduled_time.asc&limit=${SWEEP_DRAFT_CAP}`
  );

  // CE-6 FIX: Also pick up "partial" items — channels that failed can be retried without duplicating successes
  // SESSION 105: Capped at 4 (was 12 — caused 60+ API calls on retry storms)
  const partialDrafts = await supabaseQuery(
    "content_engine_queue",
    `status=eq.partial&order=scheduled_time.asc&limit=4`
  );

  // SESSION 92 FIX: Retry "failed" drafts too — previously abandoned forever.
  // Cap at 3 retries (check retry_count column, default 0) to avoid infinite loops.
  const failedDrafts = await supabaseQuery(
    "content_engine_queue",
    `status=eq.failed&retry_count=lt.3&order=scheduled_time.asc&limit=3`
  );

  // SESSION 105: Hard cap total drafts at SWEEP_DRAFT_CAP to prevent budget blowout
  const allDrafts = [...readyDrafts, ...partialDrafts, ...failedDrafts];
  const drafts = allDrafts.slice(0, SWEEP_DRAFT_CAP);

  if (drafts.length === 0) return 0;

  let posted = 0;

  let channelMap: BrandChannelMap;
  try {
    channelMap = await discoverChannels();
  } catch (err: any) {
    console.error(`[ContentEngine] Channel discovery failed during distribution: ${err.message}`);
    return 0;
  }

  for (const draft of drafts) {
    const brand = draft.brand as Brand;    const channels = channelMap[brand];
    if (!channels || channels.length === 0) {
      await supabasePatch("content_engine_queue", draft.id, {
        status: "skipped",
        error: `No channels found for brand ${brand}`,
      });
      continue;
    }

    const variants = draft.platform_variants || {};
    const universalText = draft.universal_text || "";
    // CE-6: Parse existing buffer_results to skip channels that already succeeded (no duplicates on retry)
    const priorResults: string = draft.buffer_results || "";
    const alreadyHandled = new Set<string>();
    for (const line of priorResults.split("\n")) {
      // Skip channels that already succeeded OR permanently failed (schema/400 errors)
      if (line.startsWith("✅") || line.startsWith("🚫")) {
        const match = line.match(/\(([^)]+)\)/);
        if (match) alreadyHandled.add(match[1]);
      }
    }

    try {
      const postResults: string[] = [];

      // Post to each channel with platform-specific text
      // SESSION 97: Skip entire Buffer loop if quota is blown — Facebook direct still fires below
      if (bufferBlocked) {
        postResults.push(`⏸️ ALL_BUFFER: Skipped — Buffer quota exhausted`);
      }

      for (const channel of channels) {
        if (bufferBlocked) break; // Skip all Buffer channels when quota blown

        const service = channel.service.toLowerCase();
        const text = variants[service] || universalText;

        if (!text) {
          postResults.push(`⚠️ ${channel.service}(${channel.id}): No text available`);
          continue;
        }

        // CE-6: Skip channels already succeeded or permanently failed in a prior sweep
        if (alreadyHandled.has(channel.id)) {
          postResults.push(`✅ ${channel.service}(${channel.id}): Already handled (prior sweep)`);
          continue;
        }

        // CE-1 FIX: Skip image-required platforms when no image is attached
        if (IMAGE_REQUIRED_PLATFORMS.has(service) && !draft.media_url) {
          postResults.push(`⏭️ ${channel.service}(${channel.id}): Skipped — platform requires image, none attached`);
          continue;
        }
        // CE-3 FIX: Buffer YouTube integration requires VIDEO — image posts are rejected.
        // YouTube community posts not supported by Buffer API. Skip until video pipeline (Scenario F) is live.
        if (service === "youtube") {
          postResults.push(`⏭️ ${channel.service}(${channel.id}): Skipped — Buffer YouTube requires video (community image posts not supported by Buffer API)`);
          continue;
        }
        // SESSION 105: Facebook goes through direct Graph API publisher (below), NOT Buffer.
        // Skip any facebook Buffer channel to prevent double-posting attempts.
        if (service === "facebook") {
          postResults.push(`⏭️ ${channel.service}(${channel.id}): Skipped — Facebook uses direct Graph API (not Buffer)`);
          continue;
        }
        // IG Frequency Override: Skip Instagram channels for non-allowed time slots
        if (service === "instagram") {
          const igOverride = IG_FREQUENCY_OVERRIDE[brand];
          if (igOverride && draft.time_slot && !igOverride.allowedSlots.includes(draft.time_slot)) {
            postResults.push(`⏭️ ${channel.service}(${channel.id}): Skipped — IG frequency override (slot ${draft.time_slot} not allowed for ${brand})`);
            continue;
          }
        }

        // CE-4 FIX: Threads has a 500-character hard limit from Meta
        let postText = text;
        if (service === "threads" && postText.length > THREADS_CHAR_LIMIT) {
          // Truncate to 497 chars + "..." to stay under 500
          postText = postText.slice(0, THREADS_CHAR_LIMIT - 3) + "...";
        }
        // CE-7 FIX: Bluesky has a 300-character hard limit (AT Protocol)
        if (service === "bluesky" && postText.length > BLUESKY_CHAR_LIMIT) {
          postText = postText.slice(0, BLUESKY_CHAR_LIMIT - 3) + "...";
        }

        try {
          // Build mutation
          let assetsBlock = "";
          if (draft.media_url) {
            assetsBlock = `assets: { images: [{ url: "${draft.media_url.replace(/"/g, '\\"')}" }] }`;
          }

          // CE-5 FIX: Instagram requires metadata.instagram.type = post for image posts
          // Buffer GraphQL schema: PostInputMetaData → instagram: InstagramPostMetadataInput → type: PostType
          let metadataBlock = "";
          if (service === "instagram") {
            metadataBlock = `metadata: { instagram: { type: post, shouldShareToFeed: true } }`;
          }

          // CE-6 REMOVED: Buffer dropped `type` from CreatePostInput schema (Apr 2026).
          // Sending it causes "Field 'type' is not defined by type 'CreatePostInput'" 400.
          const facebookTypeBlock = "";

          // CE-2 FIX: schedulingType enum is "automatic" or "notification" (NOT "scheduled")
          // "automatic" = Buffer picks the optimal time from its queue
          // SESSION 87: Added LimitReachedError to union — plan-level post cap detection
          const postQuery = `
            mutation CreatePost {
              createPost(input: {
                text: ${JSON.stringify(postText)},
                channelId: "${channel.id}",
                schedulingType: automatic,
                mode: addToQueue
                ${facebookTypeBlock}
                ${metadataBlock ? `, ${metadataBlock}` : ""}
                ${assetsBlock ? `, ${assetsBlock}` : ""}
              }) {
                ... on PostActionSuccess {
                  post { id text }
                }
                ... on MutationError {
                  message
                }
              }
            }
          `;

          const data = await bufferGraphQL(postQuery);
          const result = data?.createPost;

          if (result?.post) {
            postResults.push(`✅ ${channel.service}(${channel.id}): ${result.post.id}`);
          } else if (result?.message?.toLowerCase().includes('limit')) {
            // SESSION 95+104: Buffer removed LimitReachedError from union entirely (Apr 2026).
            // Detect plan-level cap from MutationError message text.
            postResults.push(`⏸️ ${channel.service}(${channel.id}): Plan limit reached — ${result.message}`);
            break; // No point trying more channels — they'll all hit the same limit
          } else if (result?.message) {
            postResults.push(`❌ ${channel.service}(${channel.id}): ${result.message}`);
          } else {
            postResults.push(`⚠️ ${channel.service}(${channel.id}): Unknown response`);
          }
        } catch (err: any) {
          // SESSION 87: Quota exhausted mid-sweep — stop posting remaining channels,
          // mark draft as partial so the next sweep (when quota resets) picks it up.
          if (err instanceof BufferQuotaExhaustedError) {
            postResults.push(`⏸️ ${channel.service}(${channel.id}): Buffer quota exhausted — deferring`);
            // Short-circuit remaining channels for this draft
            break;
          }
          // Circuit breaker: 400/schema errors are permanent — mark with 🚫 so retries skip this channel
          const isNonRetryable = err.message?.includes("not defined by type") ||
            err.message?.includes("400") ||
            err.message?.includes("GraphQL error");
          const prefix = isNonRetryable ? "🚫" : "❌";
          postResults.push(`${prefix} ${channel.service}(${channel.id}): ${err.message}`);
        }
      }

      // ── SESSION 97: Facebook direct publish (bypasses Buffer — no slot available) ──
      // Fires for BOTH brands; routes to correct FB Page via brand param.
      if (!alreadyHandled.has("facebook_direct")) {
        const fbText = variants["facebook"] || universalText;
        if (fbText) {
          try {
            const fbResult = await publishToFacebook(fbText, {
              imageUrl: draft.media_url || undefined,
              brand: brand as "sovereign_synthesis" | "containment_field",
            });
            if (fbResult.success) {
              postResults.push(`✅ facebook_direct(facebook_direct): ${fbResult.postId}`);
            } else {
              postResults.push(`❌ facebook_direct(facebook_direct): ${fbResult.error}`);
            }
          } catch (err: any) {
            postResults.push(`❌ facebook_direct(facebook_direct): ${err.message}`);
          }
        }
      }

      // Update draft status
      const successCount = postResults.filter((r) => r.startsWith("✅")).length;
      const retryableFailCount = postResults.filter((r) => r.startsWith("❌")).length;
      const permanentFailCount = postResults.filter((r) => r.startsWith("🚫")).length;
      const allResults = postResults.join("\n");

      // CE-6+CE-7: "partial" only if there are retryable failures. Permanent fails (🚫) don't trigger retry.
      let finalStatus = "failed";
      if (successCount > 0 && retryableFailCount === 0) finalStatus = "posted";
      else if (successCount > 0 && retryableFailCount > 0) finalStatus = "partial";
      else if (successCount === 0 && retryableFailCount === 0 && permanentFailCount > 0) finalStatus = "failed"; // all channels permanently failed = mark failed, not "posted"

      await supabasePatch("content_engine_queue", draft.id, {
        status: finalStatus,
        posted_at: new Date().toISOString(),
        buffer_results: allResults,
        channels_hit: successCount,
        channels_total: channels.length,
        // SESSION 92: Track retry count so failed drafts don't loop forever
        retry_count: (draft.retry_count || 0) + 1,
      });

      // Log to content_transmissions for Vector's metrics sweep
      await supabasePost("content_transmissions", {
        source: "content_engine",
        intent_tag: draft.niche,
        status: successCount > 0 ? "published" : "failed",
        strategy_json: {
          brand,
          time_slot: draft.time_slot,
          channels_hit: successCount,
          channels_total: channels.length,
        },
        linkedin_post: universalText.slice(0, 500),
      });

      if (successCount > 0) posted++;

      console.log(
        `📤 [ContentEngine] Distributed: ${brand}/${draft.time_slot} → ${successCount}/${channels.length} channels\n${allResults}`
      );
    } catch (err: any) {
      console.error(`[ContentEngine] Distribution failed for ${draft.id}: ${err.message}`);
      await supabasePatch("content_engine_queue", draft.id, {
        status: "failed",
        error: err.message,      });
    }
  }

  return posted;
}

/**
 * Weekend repost: query top-performing content from the week and re-queue.
 */
async function queueWeekendReposts(): Promise<number> {
  // Query content_engine_queue for this week's posted content, sorted by channels_hit (proxy for success)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const topContent = await supabaseQuery(
    "content_engine_queue",
    `status=eq.posted&scheduled_date=gte.${weekAgo.toISOString().split("T")[0]}&order=channels_hit.desc&limit=6`
  );

  if (topContent.length === 0) {
    console.log("[ContentEngine] No posted content found for weekend reposts");
    return 0;
  }

  let queued = 0;
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];

  for (let i = 0; i < Math.min(topContent.length, TIME_SLOTS_UTC.length); i++) {    const original = topContent[i];
    const slot = TIME_SLOTS_UTC[i];

    const scheduledTime = new Date(today);
    scheduledTime.setUTCHours(slot.hour, 0, 0, 0);

    await supabasePost("content_engine_queue", {
      brand: original.brand,
      niche: original.niche,
      time_slot: slot.label,
      scheduled_date: dateStr,
      scheduled_time: scheduledTime.toISOString(),
      scheduled_hour_utc: slot.hour,
      universal_text: original.universal_text,
      platform_variants: original.platform_variants,
      media_url: original.media_url,
      status: "ready",
      is_repost: true,
      original_id: original.id,
    });

    queued++;
  }

  console.log(`♻️ [ContentEngine] Queued ${queued} weekend reposts from top performers`);
  return queued;
}

// ── FLUX Pod Batch Image Generation — replaces Imagen 4 ($3/day → ~$0.07/batch) ──

/**
 * SESSION 104: Collect content_engine_queue entries that have image_prompt
 * but no media_url, spin up the pod, batch-generate via FLUX, patch media_url back.
 * Runs every 3 days. One pod session = one batch = ~$0.07 (vs $3/day with Imagen 4).
 */
export async function fluxBatchImageGen(): Promise<number> {
  // Fetch queue entries with image_prompt but no media_url
  const needsImages = await supabaseQuery(
    "content_engine_queue",
    `image_prompt=not.is.null&media_url=is.null&order=created_at.asc&limit=50`
  );

  if (needsImages.length === 0) {
    console.log("[FluxBatch] No pending images — skipping pod spin-up");
    return 0;
  }

  console.log(`🎨 [FluxBatch] ${needsImages.length} images pending — starting pod session`);

  // Group by brand for R2 folder routing
  const ssItems = needsImages.filter((r: any) => r.brand === "sovereign_synthesis");
  const cfItems = needsImages.filter((r: any) => r.brand === "containment_field");

  let patched = 0;

  // SESSION 105: ONE image per brand, DIFFERENT hook text captions burned on each copy.
  // Pod deduplicates by prompt — generates FLUX once, creates N branded videos.
  // This eliminates the "all 12 images look the same" problem: now they share one
  // high-quality hero image but each has a unique hook text overlay.
  const buildBrandBatch = (brandItems: any[]): ImageBatchItem[] => {
    if (brandItems.length === 0) return [];
    // Use the first item's image_prompt as the shared prompt for the whole brand
    const sharedPrompt = brandItems[0].image_prompt;
    return brandItems.map((r: any) => ({
      id: r.id,
      prompt: sharedPrompt, // Same prompt → pod deduplicates to 1 FLUX generation
      hook_text: (r.universal_text || "").split("\n")[0].slice(0, 200) || undefined,
    }));
  };

  try {
    await withPodSession(async (handle) => {
      if (ssItems.length > 0) {
        console.log(`🎨 [FluxBatch] Sovereign Synthesis: 1 FLUX image → ${ssItems.length} branded videos`);
        const ssResult = await generateImageBatch(
          handle,
          buildBrandBatch(ssItems),
          "sovereign_synthesis"
        );
        for (const r of ssResult.results) {
          if (r.url) {
            await supabasePatch("content_engine_queue", r.id, { media_url: r.url });
            patched++;
          }
        }
      }

      if (cfItems.length > 0) {
        console.log(`🎨 [FluxBatch] Containment Field: 1 FLUX image → ${cfItems.length} branded videos`);
        const cfResult = await generateImageBatch(
          handle,
          buildBrandBatch(cfItems),
          "containment_field"
        );
        for (const r of cfResult.results) {
          if (r.url) {
            await supabasePatch("content_engine_queue", r.id, { media_url: r.url });
            patched++;
          }
        }
      }
    });
  } catch (err: any) {
    console.error(`[FluxBatch] Pod session failed: ${err.message?.slice(0, 300)}`);
    // Don't throw — partial success is still progress
  }

  console.log(`🎨 [FluxBatch] Patched ${patched}/${needsImages.length} queue entries with FLUX images`);
  return patched;
}

// ── Draft Auto-Publisher — Promote agent drafts to distribution queue ──

/**
 * SESSION 104: Picks up social-type content_drafts with status "pending_review"
 * older than 2 hours and promotes them to content_engine_queue for distribution.
 * This wires Yuki/Anita/Alfred's save_content_draft output into actual posting.
 * Non-social drafts (email, landing_page, blog, script) are left for manual review.
 */
const PUBLISHABLE_DRAFT_TYPES = new Set(["caption", "social_post", "post", "tweet", "hook"]);

export async function draftAutoPublisher(): Promise<number> {
  // Fetch pending_review drafts that are social-type and older than 2h
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const drafts = await supabaseQuery(
    "content_drafts",
    `status=eq.pending_review&created_at=lte.${twoHoursAgo}&order=created_at.asc&limit=10`
  );

  if (drafts.length === 0) return 0;

  // Filter to publishable types
  const publishable = drafts.filter((d: any) => PUBLISHABLE_DRAFT_TYPES.has(d.draft_type));
  if (publishable.length === 0) return 0;

  let promoted = 0;
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  for (const draft of publishable) {
    try {
      // Determine brand from niche/platform heuristics or default to sovereign_synthesis
      // Containment Field drafts: niche is in CF allowlist, or body/title mention containment/tcf
      let brand: Brand = "sovereign_synthesis";
      const bodyLower = (draft.body || "").toLowerCase();
      const titleLower = (draft.title || "").toLowerCase();
      const draftNiche = draft.niche || "";
      if (
        (CONTAINMENT_FIELD_NICHES as readonly string[]).includes(draftNiche) ||
        bodyLower.includes("containment") ||
        titleLower.includes("containment") ||
        titleLower.includes("tcf")
      ) {
        brand = "containment_field";
      }

      // Insert into content_engine_queue with immediate scheduling
      await supabasePost("content_engine_queue", {
        brand,
        niche: draft.niche || "sovereignty",
        time_slot: "draft_promotion",
        scheduled_date: dateStr,
        scheduled_time: now.toISOString(),
        scheduled_hour_utc: now.getUTCHours(),
        universal_text: draft.body,
        platform_variants: {},  // Distribution sweep uses universal_text as fallback
        status: "ready",
        source: "draft_auto_publisher",
      });

      // Mark draft as published so it's not re-processed
      await supabasePatch("content_drafts", draft.id, {
        status: "published",
      });

      promoted++;
      console.log(`📤 [DraftPublisher] Promoted draft ${draft.id}: "${draft.title?.slice(0, 40)}..." → ${brand}`);
    } catch (err: any) {
      console.warn(`[DraftPublisher] Failed to promote draft ${draft.id}: ${err.message?.slice(0, 200)}`);
    }
  }

  console.log(`📤 [DraftPublisher] Promoted ${promoted} drafts to distribution queue`);
  return promoted;
}

// ── Buffer Queue Nuke — Clean Slate ──

/**
 * Delete ALL queued posts from Buffer across all channels.
 * Also clears Supabase content_engine_queue rows that haven't been posted.
 * Use when Buffer calendar has orphaned/test posts that need to be wiped.
 */
export async function nukeBufferQueue(): Promise<string> {
  const results: string[] = [];
  let totalDeleted = 0;

  // Step 1: Clear all non-posted rows from content_engine_queue
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      const resp = await fetch(
        `${url}/rest/v1/content_engine_queue?status=in.(ready,failed,partial,skipped)`,
        {
          method: "DELETE",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: "return=representation",
          },
        }
      );
      const deleted = resp.ok ? ((await resp.json()) as any[]).length : 0;
      results.push(`🗑️ Supabase queue: ${deleted} rows cleared`);
    } catch (err: any) {
      results.push(`❌ Supabase cleanup error: ${err.message}`);
    }
  }

  // Step 2: Delete all queued posts from Buffer
  try {
    const channelMap = await discoverChannels();
    const allChannels = [...channelMap.sovereign_synthesis, ...channelMap.containment_field];

    const orgId = BUFFER_ORG_ID;

    for (const ch of allChannels) {
      try {
        // Query queued posts for this channel (Buffer GraphQL Relay-style pagination)
        let hasMore = true;
        let cursor: string | null = null;
        let channelDeleted = 0;
        let channelTotal = 0;

        while (hasMore) {
          const afterClause = cursor ? `, after: "${cursor}"` : "";
          const postData = await bufferGraphQL(`
            query {
              posts(input: {
                organizationId: "${orgId}"
                filter: { channelIds: ["${ch.id}"] }
              }, first: 50${afterClause}) {
                edges { node { id text } cursor }
                pageInfo { hasNextPage endCursor }
              }
            }
          `);
          const edges = postData?.posts?.edges || [];
          const pageInfo = postData?.posts?.pageInfo;

          for (const edge of edges) {
            const post = edge.node;
            channelTotal++;
            try {
              const delResult = await bufferGraphQL(`
                mutation { deletePost(input: { postId: "${post.id}" }) {
                  ... on PostActionSuccess { post { id } }
                  ... on MutationError { message }
                }}
              `);
              if (delResult?.deletePost?.post?.id) {
                channelDeleted++;
                totalDeleted++;
              }
            } catch {
              // Individual post delete failure — continue
            }
          }

          hasMore = pageInfo?.hasNextPage === true && edges.length > 0;
          cursor = pageInfo?.endCursor || null;
        }

        if (channelTotal === 0) {
          results.push(`✅ ${ch.service}/${ch.name}: Empty queue`);
        } else {
          results.push(`🗑️ ${ch.service}/${ch.name}: ${channelDeleted}/${channelTotal} deleted`);
        }
      } catch (err: any) {
        results.push(`❌ ${ch.service}/${ch.name}: ${err.message}`);
      }
    }
  } catch (err: any) {
    results.push(`❌ Buffer channel discovery failed: ${err.message}`);
  }

  // Step 3: Invalidate channel cache (in case channels changed)
  invalidateChannelCache();

  const summary = `🧹 BUFFER QUEUE NUKED\nTotal deleted: ${totalDeleted}\n\n${results.join("\n")}`;
  console.log(summary);
  return summary;
}

// ── Health Check ──

export async function contentEngineStatus(): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

  const ready = await supabaseQuery("content_engine_queue", `status=eq.ready&scheduled_date=eq.${today}&select=id`);
  const posted = await supabaseQuery("content_engine_queue", `status=eq.posted&scheduled_date=eq.${today}&select=id`);
  const failed = await supabaseQuery("content_engine_queue", `status=eq.failed&scheduled_date=eq.${today}&select=id`);

  let channelInfo = "Not cached";
  try {
    const map = await discoverChannels();
    channelInfo = `SS=${map.sovereign_synthesis.length}, CF=${map.containment_field.length}`;
  } catch {
    channelInfo = "Discovery failed";
  }

  return (
    `📊 Content Engine Status (${today}):\n` +
    `Ready: ${ready.length} | Posted: ${posted.length} | Failed: ${failed.length}\n` +
    `Target: 12/day (6 slots × 2 brands)\n` +
    `Channels: ${channelInfo}\n` +
    `Niche today: SS=${getTodaysNiche("sovereign_synthesis").niche}, CF=${getTodaysNiche("containment_field").niche}`
  );
}
