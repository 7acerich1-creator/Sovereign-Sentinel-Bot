// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Hook Dropper
// Session 115 (2026-04-24) — twice-daily outbound consciousness hooks
// on the freshest uploads of the highest-leverage channels Ace's two
// channels are subscribed to.
//
// FLOW (per brand, per run):
//   1. List subscriptions via /youtube/v3/subscriptions?mine=true (uses
//      the channel-owner OAuth token already on Railway).
//   2. For each subscribed channel, fetch /channels?part=statistics to
//      get subscriberCount. Sort desc — biggest first.
//   3. Take top N candidates. For each, derive the uploads playlist id
//      (UU + channelId.slice(2)) and pull the single latest video via
//      /playlistItems?playlistId=...&maxResults=1.
//   4. Skip any (brand, target_video_id) already in youtube_hook_drops
//      (UNIQUE constraint also enforces this server-side as a backstop).
//   5. Ask Claude Haiku to generate ONE single-sentence consciousness-hook
//      reframe — brand-voiced (NOT plain Ace voice; this is public outreach).
//      The hook must reference something specific about the target video
//      title to avoid looking like spam.
//   6. Post the hook as a top-level comment via postYouTubeComment.
//   7. Insert into youtube_hook_drops (records success or error).
//
// VOICE: Brand voice for the channel posting (SS or CF), NOT plain-Ace voice.
// These are public memetic triggers, not friendly DMs. They MUST reference
// the specific video they're posted on or they will read as guru-spam.
//
// THROTTLE: Hard cap MAX_DROPS_PER_RUN = 5 per brand. Twice/day = 20 drops/day
// max across both brands. Keeps quota usage <2.5K/day vs 10K daily quota and
// keeps the comment frequency below YouTube's spam-detection thresholds.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { postYouTubeComment } from "../tools/youtube-comment-tool";
import { generateShortText } from "../llm/gemini-flash";

type Brand = "sovereign_synthesis" | "containment_field";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const MAX_DROPS_PER_RUN = 5;
const MAX_SUBSCRIPTIONS_TO_SCAN = 50;

// Brand voice prompts. These are PUBLIC posts on other people's videos —
// must be a sharp single-sentence observation that references the specific
// video, not generic Sovereign Synthesis pitches. No links, no CTAs, no
// "check out my channel". The whole point is to plant a thought, not sell.
const BRAND_HOOK_PROMPTS: Record<Brand, string> = {
  sovereign_synthesis: `You are writing ONE single-sentence comment on someone else's YouTube video, posted from the Sovereign Synthesis channel.

The goal: drop a "consciousness hook" — a sharp systemic observation that reframes whatever the video is about into a deeper pattern. Like a smart friend leaving the most precise comment in the section. Memorable, not preachy.

VOICE RULES:
- ONE sentence. Hard cap. No exceptions.
- Must reference something specific about THIS video (use the title). A generic comment is a fail.
- No links. No URLs. No "check out". No "subscribe". No emojis.
- No sycophancy ("great video", "loved this"). No villain-coded snark either.
- No buzzwords like "consciousness", "frequency", "vibration", "matrix" — those signal guru-content. Use plain words to point at the systemic thing.
- Tone: observant, slightly sharper than the average comment, like you're seeing the pattern under the topic. Not spiritual. Not academic. Just a clearer angle.

GOOD EXAMPLES (note: each one names what the video is about, then reframes):
Video about productivity: "The interesting part isn't the system — it's that the same person who can't stick to one for a week will run someone else's for ten years if they're paid to."
Video about confidence: "Most 'confidence' content is teaching people to perform certainty about decisions they were never allowed to actually make for themselves."
Video about money mindset: "The mindset isn't the bottleneck — it's that the people teaching it had a financial floor under them when they ran the experiment."

OUTPUT: Plain text, ONE sentence, no quotes, no markdown.`,

  containment_field: `You are writing ONE single-sentence comment on someone else's YouTube video, posted from The Containment Field channel — an anonymous account that points at psychological capture mechanisms.

The goal: drop a darker, more clinical reframe. Forensic, not preachy. The kind of comment that makes someone scroll back up to re-read the video.

VOICE RULES:
- ONE sentence. Hard cap.
- Must reference something specific about THIS video (use the title). Generic = fail.
- No links, URLs, CTAs, emojis.
- No spiritual language. No "consciousness", "vibration", "frequency", "matrix" — too on-the-nose.
- Tone: cold, observational, slightly unsettling. Like a forensic note in the margin. Names the mechanism without preaching.
- Don't moralize. State the pattern.

GOOD EXAMPLES:
Video on toxic relationships: "Most of the 'gaslighting' framing handles the symptom — the architecture underneath is that the person was rewarded for self-doubt long before the relationship started."
Video on burnout: "Burnout reads like a workload problem; functionally it's the body refusing a contract the mind already signed twice."
Video on social anxiety: "The anxiety isn't the malfunction — it's the only honest signal in a system that's been rewarding performed comfort for years."

OUTPUT: Plain text, ONE sentence, no quotes, no markdown.`,
};

async function getYouTubeToken(brand: Brand): Promise<string | null> {
  const refreshToken = brand === "containment_field"
    ? process.env.YOUTUBE_REFRESH_TOKEN_TCF
    : process.env.YOUTUBE_REFRESH_TOKEN;
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return null;
  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    return data.access_token || null;
  } catch {
    return null;
  }
}

interface SubscriptionTarget {
  channelId: string;
  channelTitle: string;
  subscriberCount: number;
}

async function listSubscriptions(token: string): Promise<SubscriptionTarget[]> {
  const out: SubscriptionTarget[] = [];
  let pageToken: string | undefined;
  let scanned = 0;
  while (scanned < MAX_SUBSCRIPTIONS_TO_SCAN) {
    const url = `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      console.error(`[YukiHookDropper] subscriptions.list ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return out;
    }
    const data = (await resp.json()) as any;
    for (const item of data.items || []) {
      const channelId = item.snippet?.resourceId?.channelId;
      const channelTitle = item.snippet?.title || "(unknown)";
      if (channelId) out.push({ channelId, channelTitle, subscriberCount: 0 });
    }
    scanned += (data.items || []).length;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function enrichWithSubscriberCounts(token: string, subs: SubscriptionTarget[]): Promise<void> {
  // channels.list batches up to 50 ids
  for (let i = 0; i < subs.length; i += 50) {
    const slice = subs.slice(i, i + 50);
    const ids = slice.map((s) => s.channelId).join(",");
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${ids}`;
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) continue;
      const data = (await resp.json()) as any;
      const byId: Record<string, number> = {};
      for (const item of data.items || []) {
        const id = item.id as string;
        const count = parseInt(item.statistics?.subscriberCount || "0", 10);
        byId[id] = isNaN(count) ? 0 : count;
      }
      for (const s of slice) {
        s.subscriberCount = byId[s.channelId] || 0;
      }
    } catch {
      /* tolerate */
    }
  }
}

interface LatestVideo {
  videoId: string;
  videoTitle: string;
  publishedAt: string;
}

async function getLatestUpload(token: string, channelId: string): Promise<LatestVideo | null> {
  // Uploads playlist id is UU + channelId[2:]
  const uploadsPlaylistId = "UU" + channelId.slice(2);
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=1`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const item = (data.items || [])[0];
    if (!item) return null;
    const videoId = item.snippet?.resourceId?.videoId;
    const videoTitle = item.snippet?.title || "(untitled)";
    const publishedAt = item.snippet?.publishedAt || "";
    if (!videoId) return null;
    return { videoId, videoTitle, publishedAt };
  } catch {
    return null;
  }
}

async function alreadyDropped(brand: Brand, videoId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/youtube_hook_drops?select=id&brand=eq.${brand}&target_video_id=eq.${encodeURIComponent(videoId)}&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return false;
    const rows = (await resp.json()) as any[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function recordDrop(row: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/youtube_hook_drops`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch (err: any) {
    console.error(`[YukiHookDropper] recordDrop failed: ${err.message}`);
  }
}

async function generateHook(brand: Brand, videoTitle: string, channelTitle: string): Promise<string | null> {
  const userMessage = `Channel: ${channelTitle}\nVideo title: ${videoTitle}\n\nWrite ONE single-sentence comment per the rules above.`;

  const { text: raw, error } = await generateShortText(
    BRAND_HOOK_PROMPTS[brand],
    userMessage,
    { maxOutputTokens: 250, temperature: 0.85 }
  );

  if (error || !raw) {
    console.warn(`[YukiHookDropper] LLM failed: ${error}`);
    return null;
  }

  let text = raw.trim().replace(/^["']|["']$/g, "");
  // Enforce single sentence — strip anything after first sentence-ending punctuation+space+capital
  const m = text.match(/^.+?[.!?](?=\s+[A-Z]|$)/s);
  if (m) text = m[0];
  if (!text || text.length > 350) return null;
  // Hard reject obvious failure modes
  if (/https?:\/\//i.test(text)) return null;
  if (/subscribe|check out|my channel/i.test(text)) return null;
  return text;
}

/**
 * Main entry point. Called by the scheduled job twice/day.
 */
export async function runHookDrops(brand: Brand): Promise<{ attempted: number; posted: number; errors: number }> {
  const stats = { attempted: 0, posted: 0, errors: 0 };
  const token = await getYouTubeToken(brand);
  if (!token) {
    console.log(`[YukiHookDropper] ${brand}: no OAuth token, skipping`);
    return stats;
  }

  let subs = await listSubscriptions(token);
  if (subs.length === 0) {
    console.log(`[YukiHookDropper] ${brand}: no subscriptions found`);
    return stats;
  }

  await enrichWithSubscriberCounts(token, subs);
  // Sort highest leverage first
  subs.sort((a, b) => b.subscriberCount - a.subscriberCount);

  for (const sub of subs) {
    if (stats.posted >= MAX_DROPS_PER_RUN) break;

    const latest = await getLatestUpload(token, sub.channelId);
    if (!latest) continue;

    if (await alreadyDropped(brand, latest.videoId)) continue;

    stats.attempted++;
    const hook = await generateHook(brand, latest.videoTitle, sub.channelTitle);
    if (!hook) {
      stats.errors++;
      await recordDrop({
        brand,
        subscribed_channel_id: sub.channelId,
        subscribed_channel_title: sub.channelTitle,
        target_video_id: latest.videoId,
        target_video_title: latest.videoTitle,
        comment_text: "(LLM returned no usable hook)",
        error: "llm_no_hook",
      });
      continue;
    }

    const result = await postYouTubeComment(latest.videoId, hook, brand);
    if (result.success) {
      stats.posted++;
      console.log(`[YukiHookDropper] ${brand}: dropped on ${sub.channelTitle} / ${latest.videoTitle}`);
      await recordDrop({
        brand,
        subscribed_channel_id: sub.channelId,
        subscribed_channel_title: sub.channelTitle,
        target_video_id: latest.videoId,
        target_video_title: latest.videoTitle,
        comment_id: result.commentId,
        comment_text: hook,
      });
    } else {
      stats.errors++;
      console.error(`[YukiHookDropper] ${brand}: post failed on ${sub.channelTitle}: ${result.error}`);
      await recordDrop({
        brand,
        subscribed_channel_id: sub.channelId,
        subscribed_channel_title: sub.channelTitle,
        target_video_id: latest.videoId,
        target_video_title: latest.videoTitle,
        comment_text: hook,
        error: (result.error || "unknown").slice(0, 500),
      });
    }
  }

  console.log(`[YukiHookDropper] ${brand}: attempted=${stats.attempted} posted=${stats.posted} errors=${stats.errors}`);
  return stats;
}
