// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — THE TRANSMISSION GRID
// Deterministic text+image content engine via Buffer.
// LLM writes the content. Code handles the spray.
// 9 channels (5 Ace + 4 CF) × 6 time slots = 47 posts/day = 329/week (with IG override)
// Master ref: Section 23. Pipeline clarity: CONTENT-PIPELINE-CLARITY.md
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider } from "../types";

// ── Constants ──

const BUFFER_GRAPHQL_ENDPOINT = "https://api.buffer.com";

// Niche rotation: Mon=0 → Sun=6, getDay() returns 0=Sun
const NICHE_ROTATION: Record<number, { niche: string; hookStyle: string }> = {
  1: { niche: "dark_psychology", hookStyle: "They don't want you to know..." },
  2: { niche: "self_improvement", hookStyle: "The version of you that..." },
  3: { niche: "burnout", hookStyle: "Your 9-to-5 is a..." },
  4: { niche: "quantum", hookStyle: "Reality isn't what you think..." },
  5: { niche: "brand", hookStyle: "I built this because..." },
  0: { niche: "top_performer_repost", hookStyle: "Data-driven repost" }, // Sunday
  6: { niche: "top_performer_repost", hookStyle: "Data-driven repost" }, // Saturday
};
// 6 posting time slots (UTC hours — adjust for Ace's timezone if needed)
const TIME_SLOTS_UTC = [
  { hour: 12, label: "morning_hook" },       // 7AM ET
  { hour: 15, label: "educational_panel" },   // 10AM ET
  { hour: 18, label: "midday_trigger" },      // 1PM ET
  { hour: 21, label: "afternoon_drop" },      // 4PM ET
  { hour: 0, label: "evening_anchor" },       // 7PM ET
  { hour: 3, label: "late_night_bait" },      // 10PM ET
];

const BRANDS = ["ace_richie", "containment_field"] as const;
type Brand = typeof BRANDS[number];

// ── CE-1 FIX: Platform image requirements ──
// Platforms that REJECT text-only posts via Buffer API
const IMAGE_REQUIRED_PLATFORMS = new Set(["instagram", "tiktok"]);
// Platforms that accept text-only posts
const TEXT_OK_PLATFORMS = new Set(["x", "twitter", "threads", "youtube", "linkedin"]);

// ── IG Frequency Override (prevent shadowban) ──
// Instagram accounts are capped to protect account health
const IG_FREQUENCY_OVERRIDE: Record<Brand, { maxPerDay: number; allowedSlots: string[] }> = {
  ace_richie: {
    maxPerDay: 3,
    allowedSlots: ["morning_hook", "midday_trigger", "evening_anchor"], // 7AM, 1PM, 7PM ET
  },
  containment_field: {
    maxPerDay: 2,
    allowedSlots: ["educational_panel", "afternoon_drop"], // 10AM, 4PM ET (staggered from Ace)
  },
};
// Platform-specific character/style notes for LLM
const PLATFORM_NOTES: Record<string, string> = {
  x: "Max 280 chars. Punchy, direct. Hashtags: 1-2 max. End with a hook or question.",
  linkedin: "Professional but bold. 1-3 short paragraphs. No hashtag spam. Can be slightly longer.",
  threads: "Conversational, raw, authentic. Like talking to a friend who gets it. Medium length.",
  instagram: "Hook in first line (gets truncated). Use line breaks. 3-5 relevant hashtags at end.",
  tiktok: "Short, scroll-stopping. Speak like the viewer's internal voice. Under 150 chars ideal.",
  youtube: "Community post style. Ask a question or drop a hot take. Medium length.",
};

// ── Types ──

interface BufferChannel {
  id: string;
  service: string;
  name: string;
  displayName?: string;
}

interface BrandChannelMap {
  ace_richie: BufferChannel[];
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

/** Niche-aware image prompt prefixes (mirrors image-generator.ts) */
const IMAGE_NICHE_PREFIXES: Record<string, string> = {
  dark_psychology:
    "High contrast monochromatic, brutalist aesthetic, heavy shadows, single geometric element, cinematic, ",
  self_improvement:
    "Clean minimal, bright warm tones, forward momentum, architectural, ",
  burnout:
    "Muted desaturated palette, warm undertones, soft industrial, release energy, ",
  quantum:
    "Abstract geometric, deep blue shifted, high saturation, conceptual visualization, ",
  brand:
    "Sovereign Synthesis brand aesthetic, amber and teal accents, dark background, authoritative minimal, ",
};
/** Brand-specific visual style suffixes */
const BRAND_IMAGE_STYLE: Record<Brand, string> = {
  ace_richie:
    "Gold and amber tones, sovereign iconography, empowering, liberation energy, dark midnight background. No text overlays.",
  containment_field:
    "Dark noir aesthetic, blood red and charcoal, ominous, clinical, high contrast shadows. No text overlays.",
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
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("[ContentEngine] Cannot upload image — SUPABASE_URL or SUPABASE_ANON_KEY missing");
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
  // Build an enhanced image prompt from the post text + niche + brand
  const nichePrefix = IMAGE_NICHE_PREFIXES[niche] || IMAGE_NICHE_PREFIXES.brand;
  const brandSuffix = BRAND_IMAGE_STYLE[brand];

  // Extract the core concept from the post text (first 120 chars) to seed the image
  const conceptSeed = postText.replace(/[#@\n]/g, " ").slice(0, 120).trim();
  const imagePrompt = `${nichePrefix}${conceptSeed}. ${brandSuffix} Social media post image, 1:1 square format, visually striking, no text.`;

  let imageBuffer: Buffer | null = null;
  let source = "none";

  // ── STEP 1: Try Gemini Imagen 4 ──
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },        body: JSON.stringify({
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
  // ── STEP 2: Fallback to DALL-E 3 ──
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
          const errText = await res.text();          console.warn(`[ContentEngine] DALL-E 3 ${res.status}: ${errText.slice(0, 200)}`);
        }
      } catch (err: any) {
        console.warn(`[ContentEngine] DALL-E 3 error: ${err.message}`);
      }
    }
  }

  if (!imageBuffer) {
    console.warn(`[ContentEngine] Image generation failed for ${brand}/${slotLabel} — both providers returned nothing`);
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
// ── Buffer GraphQL Helpers ──

function getBufferToken(): string {
  const token = process.env.BUFFER_API_KEY;
  if (!token) throw new Error("BUFFER_API_KEY not configured");
  return token;
}

async function bufferGraphQL(query: string): Promise<any> {
  const token = getBufferToken();
  const resp = await fetch(BUFFER_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Buffer GraphQL ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const result: any = await resp.json();
  if (result.errors?.length > 0) {
    throw new Error(`Buffer GraphQL error: ${result.errors.map((e: any) => e.message).join("; ")}`);
  }
  return result.data;
}
// ── Channel Discovery & Caching ──

let cachedChannelMap: BrandChannelMap | null = null;

/**
 * Fetch all Buffer channels and categorize by brand.
 * Uses known account names to sort channels into Ace Richie vs Containment Field.
 */
export async function discoverChannels(): Promise<BrandChannelMap> {
  if (cachedChannelMap) return cachedChannelMap;

  const orgId = process.env.BUFFER_ORG_ID || "69c613a244dbc563b3e05050";
  const query = `
    query GetChannels {
      channels(input: { organizationId: "${orgId}" }) {
        id
        name
        displayName
        service
      }
    }
  `;

  const data = await bufferGraphQL(query);
  const channels: BufferChannel[] = data?.channels || [];

  if (channels.length === 0) {
    throw new Error("No Buffer channels found. Check BUFFER_API_KEY and Buffer account.");
  }
  // Categorize by brand using known naming patterns
  const acePatterns = /ace|richie|77/i;
  const cfPatterns = /containment/i;

  const map: BrandChannelMap = {
    ace_richie: [],
    containment_field: [],
  };

  for (const ch of channels) {
    const nameCheck = `${ch.name} ${ch.displayName || ""}`;
    if (cfPatterns.test(nameCheck)) {
      map.containment_field.push(ch);
    } else if (acePatterns.test(nameCheck)) {
      map.ace_richie.push(ch);
    } else {
      map.ace_richie.push(ch);
    }
  }

  cachedChannelMap = map;
  console.log(
    `📡 [ContentEngine] Channel map cached: Ace Richie=${map.ace_richie.length} channels, ` +
    `Containment Field=${map.containment_field.length} channels`
  );
  console.log(`   Ace: ${map.ace_richie.map(c => `${c.service}(${c.id})`).join(", ")}`);
  console.log(`   CF:  ${map.containment_field.map(c => `${c.service}(${c.id})`).join(", ")}`);

  return map;
}
/** Force refresh channel cache (call if channels change) */
export function invalidateChannelCache(): void {
  cachedChannelMap = null;
}

// ── Supabase Helpers ──

async function supabasePost(table: string, data: Record<string, unknown>): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
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
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  try {
    const resp = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!resp.ok) return [];
    return (await resp.json()) as any[];
  } catch {
    return [];
  }
}

async function supabasePatch(table: string, id: string, data: Record<string, unknown>): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;  if (!url || !key) return;

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

// ── Content Generation (LLM) ──

/**
 * Generate platform-adapted content for a single time slot + brand.
 * One LLM call produces variants for all platforms.
 */
async function generateContent(
  llm: LLMProvider,
  brand: Brand,
  niche: string,
  hookStyle: string,
  timeSlot: string,  platforms: string[]
): Promise<{ universal: string; variants: Record<string, string> }> {
  const brandVoice = brand === "ace_richie"
    ? "Sovereign Synthesis voice: empowering, liberating, gold-frequency. You are the System Architect showing people how to reclaim their sovereignty. Use the Sovereign Synthesis lexicon (Firmware Update, Escape Velocity, The Simulation, Protocol 77). Bold, direct, visionary."
    : "The Containment Field voice: dark, clinical, exposing. You are an anonymous intelligence revealing the hidden systems of control. Dark psychology education. Noir tone, sharp, detached but magnetic. Themes: manipulation defense, dopamine extraction, hidden power structures.";

  const platformInstructions = platforms
    .map((p) => `- ${p.toUpperCase()}: ${PLATFORM_NOTES[p] || "Standard social post format."}`)
    .join("\n");

  const prompt = `You are a content engine for a social media brand. Generate ONE post concept adapted for multiple platforms.

BRAND VOICE: ${brandVoice}

TODAY'S NICHE: ${niche}
HOOK STYLE: "${hookStyle}"
TIME SLOT: ${timeSlot}

Generate a post with these platform-specific adaptations:
${platformInstructions}

RULES:
- Every version must hit the same core message but be NATIVE to each platform's style
- Include the hook in the first line of every version
- No generic motivational fluff — be specific, provocative, pattern-interrupting
- Sovereign Synthesis sign-off for Ace Richie brand: "— Ace Richie | Sovereign Synthesis"
- Containment Field sign-off: "— The Containment Field"
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
    const fallback = `${hookStyle} #${niche.replace(/_/g, "")}`;    const variants: Record<string, string> = {};
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
export async function dailyContentProduction(llm: LLMProvider): Promise<number> {
  console.log("🚀 [ContentEngine] Daily content production starting...");

  const today = new Date();
  const dayOfWeek = today.getDay();
  const nicheConfig = NICHE_ROTATION[dayOfWeek];

  if (!nicheConfig) {
    console.warn("[ContentEngine] No niche configured for day", dayOfWeek);
    return 0;
  }

  // Weekend = repost top performers (skip generation)
  if (nicheConfig.niche === "top_performer_repost") {
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
        const existing = await supabaseQuery(
          "content_engine_queue",
          `brand=eq.${brand}&time_slot=eq.${slot.label}&scheduled_date=eq.${dateStr}&select=id`
        );
        if (existing.length > 0) {          console.log(`[ContentEngine] Skipping ${brand}/${slot.label} — already generated`);
          continue;
        }

        console.log(`✍️ [ContentEngine] Generating: ${brand} / ${nicheConfig.niche} / ${slot.label}`);

        const { universal, variants } = await generateContent(
          llm, brand, nicheConfig.niche, nicheConfig.hookStyle, slot.label, platforms
        );

        // ── IMAGE GENERATION (Gap 12 fix) ──
        // Generate a branded image for this post and upload to Supabase Storage.
        // If generation fails, post goes out as text-only (IG/TikTok will be skipped by distribution sweep).
        let mediaUrl: string | null = null;
        try {
          mediaUrl = await generateContentImage(universal, nicheConfig.niche, brand, dateStr, slot.label);
          if (mediaUrl) {
            console.log(`🖼️ [ContentEngine] Image attached: ${brand}/${slot.label} → ${mediaUrl.slice(-60)}`);
          } else {
            console.warn(`⚠️ [ContentEngine] No image for ${brand}/${slot.label} — text-only fallback`);
          }
        } catch (err: any) {
          console.error(`[ContentEngine] Image generation crashed for ${brand}/${slot.label}: ${err.message}`);
          // Continue without image — text-only is better than no post
        }
        // Build scheduled_time for today at slot.hour UTC
        const scheduledTime = new Date(today);
        scheduledTime.setUTCHours(slot.hour, 0, 0, 0);
        // If the time has already passed today, it's fine — the distribution job will catch it

        await supabasePost("content_engine_queue", {
          brand,
          niche: nicheConfig.niche,
          time_slot: slot.label,
          scheduled_date: dateStr,
          scheduled_time: scheduledTime.toISOString(),
          scheduled_hour_utc: slot.hour,
          universal_text: universal,
          platform_variants: variants,
          media_url: mediaUrl || undefined,
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

  console.log(`🏁 [ContentEngine] Daily production complete: ${generated} pieces generated`);  return generated;
}

/**
 * DISTRIBUTION JOB — runs every 5 minutes.
 * Posts "ready" content whose scheduled_time has arrived.
 */
export async function distributionSweep(): Promise<number> {
  const now = new Date().toISOString();

  // Fetch ready drafts whose time has come
  const drafts = await supabaseQuery(
    "content_engine_queue",
    `status=eq.ready&scheduled_time=lte.${now}&order=scheduled_time.asc&limit=5`
  );

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

    try {
      const postResults: string[] = [];

      // Post to each channel with platform-specific text
      for (const channel of channels) {
        const service = channel.service.toLowerCase();
        const text = variants[service] || universalText;

        if (!text) {
          postResults.push(`⚠️ ${channel.service}(${channel.id}): No text available`);
          continue;
        }

        // CE-1 FIX: Skip image-required platforms when no image is attached
        if (IMAGE_REQUIRED_PLATFORMS.has(service) && !draft.media_url) {
          postResults.push(`⏭️ ${channel.service}(${channel.id}): Skipped — platform requires image, none attached`);
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

        try {
          // Build mutation
          let assetsBlock = "";
          if (draft.media_url) {
            assetsBlock = `assets: { images: [{ url: "${draft.media_url.replace(/"/g, '\\"')}" }] }`;
          }

          // CE-2 FIX: Use scheduled timing with explicit scheduledAt instead of automatic
          const scheduledAt = draft.scheduled_time || new Date().toISOString();
          const query = `
            mutation CreatePost {
              createPost(input: {
                text: ${JSON.stringify(text)},
                channelId: "${channel.id}",
                schedulingType: scheduled,
                scheduledAt: "${scheduledAt}",
                mode: addToQueue
                ${assetsBlock ? `, ${assetsBlock}` : ""}
              }) {
                ... on PostActionSuccess {                  post { id text scheduledAt }
                }
                ... on MutationError {
                  message
                }
              }
            }
          `;

          const data = await bufferGraphQL(query);
          const result = data?.createPost;

          if (result?.post) {
            postResults.push(`✅ ${channel.service}(${channel.id}): ${result.post.id}`);
          } else if (result?.message) {
            postResults.push(`❌ ${channel.service}(${channel.id}): ${result.message}`);
          } else {
            postResults.push(`⚠️ ${channel.service}(${channel.id}): Unknown response`);
          }
        } catch (err: any) {
          postResults.push(`❌ ${channel.service}(${channel.id}): ${err.message}`);
        }
      }

      // Update draft status
      const successCount = postResults.filter((r) => r.startsWith("✅")).length;
      const allResults = postResults.join("\n");

      await supabasePatch("content_engine_queue", draft.id, {
        status: successCount > 0 ? "posted" : "failed",        posted_at: new Date().toISOString(),
        buffer_results: allResults,
        channels_hit: successCount,
        channels_total: channels.length,
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

// ── Health Check ──

export async function contentEngineStatus(): Promise<string> {  const today = new Date().toISOString().split("T")[0];

  const ready = await supabaseQuery("content_engine_queue", `status=eq.ready&scheduled_date=eq.${today}&select=id`);
  const posted = await supabaseQuery("content_engine_queue", `status=eq.posted&scheduled_date=eq.${today}&select=id`);
  const failed = await supabaseQuery("content_engine_queue", `status=eq.failed&scheduled_date=eq.${today}&select=id`);

  let channelInfo = "Not cached";
  try {
    const map = await discoverChannels();
    channelInfo = `Ace=${map.ace_richie.length}, CF=${map.containment_field.length}`;
  } catch {
    channelInfo = "Discovery failed";
  }

  return (
    `📊 Content Engine Status (${today}):\n` +
    `Ready: ${ready.length} | Posted: ${posted.length} | Failed: ${failed.length}\n` +
    `Target: 12/day (6 slots × 2 brands)\n` +
    `Channels: ${channelInfo}\n` +
    `Niche today: ${NICHE_ROTATION[new Date().getDay()]?.niche || "unknown"}`
  );
}