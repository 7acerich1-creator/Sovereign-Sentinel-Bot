// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Shorts Auto-Comment Pinner
// Session 117 (2026-04-25) — Yuki engagement on Shorts.
//
// Yuki's existing YouTube engagement loop (S58 watcher + S115 auto-replier)
// only sees COMMENTS on long-form. Shorts get nothing — no pinned comment,
// no diagnostic CTA, no top-of-thread engagement. This module closes that gap.
//
// Architecture:
//   - 5-min cron (alongside the comment watcher) — search.list?order=date
//     for both channels, fetch the most recent 5 uploads.
//   - For each, hit videos.list?part=contentDetails and parse the ISO 8601
//     duration. Anything ≤ 60s is a Short.
//   - For each Short uploaded within the last 90 min that we haven't yet
//     commented on (Supabase dedup), generate a 2-sentence diagnostic
//     comment via gemini-2.5-flash-lite using a SHORT-FORM prompt distinct
//     from the long-form replier (60-sec viewer = lower attention budget).
//   - Post via the existing postYouTubeComment helper as the channel owner.
//     Channel-owner comments get the verified-creator badge automatically;
//     YouTube Data API does NOT support programmatic pinning (Studio-only),
//     so the badge + first-position-by-recency is the visibility lever.
//
// Telemetry: dedup table `yuki_short_comments_posted` (video_id, brand,
//   posted_at, comment_id, comment_text). Migration SQL inline below.
//
// SQL — run once in Supabase SQL Editor:
//
//   create table if not exists public.yuki_short_comments_posted (
//     video_id     text primary key,
//     brand        text not null check (brand in ('sovereign_synthesis','containment_field')),
//     posted_at    timestamptz not null default now(),
//     comment_id   text,
//     comment_text text,
//     error        text
//   );
//   create index if not exists yuki_short_comments_posted_brand_posted_at_idx
//     on public.yuki_short_comments_posted (brand, posted_at desc);
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { generateShortText } from "../llm/gemini-flash";
import { postYouTubeComment } from "../tools/youtube-comment-tool";

type Brand = "sovereign_synthesis" | "containment_field";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const BRAND_CONFIG: Record<Brand, { label: string; channelId: string; diagnosticUrl: string }> = {
  sovereign_synthesis: {
    label: "Sovereign Synthesis",
    channelId: "UCbj9a6brDL9hNIY1BpxOJfQ",
    diagnosticUrl: "https://sovereign-synthesis.com/diagnostic",
  },
  containment_field: {
    label: "The Containment Field",
    channelId: "UCLHJIIEjavmrS3R70xnCD1Q",
    diagnosticUrl: "https://sovereign-synthesis.com/diagnostic",
  },
};

// Shorts uploaded longer than this ago are skipped — momentum window has closed.
const SHORT_FRESHNESS_MS = 90 * 60_000;

// YouTube returns at most this many recent uploads per channel per cron tick.
const RECENT_UPLOADS_PER_CHANNEL = 5;

const SHORT_DURATION_MAX_S = 61; // YT Shorts cap is 60s; +1s tolerance.

// ── OAuth helper (mirrors pattern in youtube-comment-watcher.ts) ──
async function getYouTubeToken(brand: Brand): Promise<string | null> {
  const directToken = process.env.YOUTUBE_ACCESS_TOKEN;
  if (directToken) return directToken;

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

// ── ISO 8601 duration parser (PT1M30S → 90 seconds) ──
function parseISO8601Duration(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return -1;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return h * 3600 + min * 60 + s;
}

// ── Fetch most recent uploads on a channel ──
interface RecentUpload {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string; // ISO timestamp
}

async function fetchRecentUploads(brand: Brand, token: string, max: number): Promise<RecentUpload[]> {
  const channelId = BRAND_CONFIG[brand].channelId;
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=${max}`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      console.error(`[YukiShorts] search.list ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return [];
    }
    const data = (await resp.json()) as any;
    const items: any[] = data.items || [];
    return items
      .filter((it) => it.id?.videoId)
      .map((it) => ({
        videoId: it.id.videoId,
        title: it.snippet?.title || "",
        description: it.snippet?.description || "",
        publishedAt: it.snippet?.publishedAt || new Date().toISOString(),
      }));
  } catch (err: any) {
    console.error(`[YukiShorts] fetchRecentUploads exception: ${err.message}`);
    return [];
  }
}

// ── Fetch durations for a batch of video IDs ──
async function fetchDurations(videoIds: string[], token: string): Promise<Record<string, number>> {
  if (videoIds.length === 0) return {};
  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.join(",")}`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      console.error(`[YukiShorts] videos.list ${resp.status}`);
      return {};
    }
    const data = (await resp.json()) as any;
    const out: Record<string, number> = {};
    for (const item of data.items || []) {
      const id = item.id;
      const iso = item.contentDetails?.duration;
      if (id && iso) out[id] = parseISO8601Duration(iso);
    }
    return out;
  } catch (err: any) {
    console.error(`[YukiShorts] fetchDurations exception: ${err.message}`);
    return {};
  }
}

// ── Supabase dedup helpers ──
async function fetchAlreadyPostedIds(brand: Brand, videoIds: string[]): Promise<Set<string>> {
  if (!SUPABASE_URL || !SUPABASE_KEY || videoIds.length === 0) return new Set();
  try {
    const inList = videoIds.map((id) => `"${id}"`).join(",");
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/yuki_short_comments_posted?select=video_id&brand=eq.${brand}&video_id=in.(${encodeURIComponent(inList)})`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    if (!resp.ok) return new Set();
    const rows = (await resp.json()) as Array<{ video_id: string }>;
    return new Set(rows.map((r) => r.video_id));
  } catch {
    return new Set();
  }
}

async function recordPosted(row: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/yuki_short_comments_posted`, {
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
    console.error(`[YukiShorts] record failed: ${err.message}`);
  }
}

// ── Yuki short-form comment generator ──
// Distinct from the long-form replier: 60-sec viewer = lower attention,
// punchier hook callback, single CTA, no preamble.
const YUKI_SHORTS_SYSTEM_PROMPT = `You are Yuki — Ace's diagnostic-aware second mind. The viewer just watched a 60-second short on a specific identity / behavioral / containment topic. Write a single pinned-style comment, 1 to 2 sentences MAX, that calls back to one specific pattern from the video and points to the diagnostic.

VOICE RULES:
- Sovereign tone, but conversational. NOT robotic, NOT preachy.
- Direct second person — talk TO the viewer, not about them.
- 1 to 2 sentences MAX. Short-form viewers do not read long comments.
- ONE specific call-back to the video's content (not a generic "great video!").
- ONE call to action — point to the diagnostic. No multi-link spam.
- NO emojis. NO sycophancy. NO "love this", "amazing", "absolutely".
- NO begging ("please subscribe", "smash that like").
- The CTA URL goes at the end on its own line, prefixed with "→ ".

OUTPUT FORMAT (JSON ONLY, no markdown, no code fences):
{"should_post": true, "comment": "your comment text here including the URL"}
OR
{"should_post": false, "reason": "short reason"}

WHEN NOT TO POST (return should_post=false):
- The video is not actually a Sovereign Synthesis or Containment Field topic (off-niche).
- The title is so generic you can't write a specific call-back.

Example output (Sovereign Synthesis, video title "The Machine's 3 Identity Traps"):
{"should_post": true, "comment": "Which of the 3 traps did you just catch yourself in? The diagnostic names it in 60 seconds.\\n→ https://sovereign-synthesis.com/diagnostic"}

Example output (Containment Field, video title "Why You Keep Returning To Them"):
{"should_post": true, "comment": "If the return loop just hit, you can name the exact pattern keeping you in it.\\n→ https://sovereign-synthesis.com/diagnostic"}

Now write the comment for the actual video below.`;

interface CommentDecision {
  should_post: boolean;
  comment?: string;
  reason?: string;
}

async function generateShortsComment(
  brand: Brand,
  videoTitle: string,
  videoDescription: string,
): Promise<CommentDecision> {
  const diagnosticUrl = BRAND_CONFIG[brand].diagnosticUrl;
  const userMessage = `Brand: ${BRAND_CONFIG[brand].label}\nDiagnostic URL: ${diagnosticUrl}\nVideo title: ${videoTitle}\nVideo description (first 400 chars): ${videoDescription.slice(0, 400)}`;

  const { text, error } = await generateShortText(
    YUKI_SHORTS_SYSTEM_PROMPT,
    userMessage,
    { maxOutputTokens: 350, temperature: 0.7 }
  );

  if (error || !text) {
    return { should_post: false, reason: error || "empty LLM response" };
  }

  const cleaned = text.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();

  let parsed: CommentDecision;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: treat plain text as the comment if it looks like a comment
    const trimmed = cleaned.replace(/^["']|["']$/g, "");
    if (trimmed && trimmed.length < 400 && trimmed.includes(diagnosticUrl)) {
      return { should_post: true, comment: trimmed };
    }
    return { should_post: false, reason: `LLM returned non-JSON: ${cleaned.slice(0, 100)}` };
  }

  if (parsed.should_post && parsed.comment) {
    // Hard cap — 350 chars is plenty for 2 sentences + URL
    if (parsed.comment.length > 350) {
      return { should_post: false, reason: `comment too long (${parsed.comment.length} chars)` };
    }
    // Sanity check: must contain the diagnostic URL or it's malformed
    if (!parsed.comment.includes("sovereign-synthesis.com")) {
      return { should_post: false, reason: "comment missing diagnostic URL" };
    }
  }

  return parsed;
}

// ── Main poll function — call once per tick from the scheduler ──
const inMemoryPosted: Record<Brand, Set<string>> = {
  sovereign_synthesis: new Set(),
  containment_field: new Set(),
};

export async function pollNewShortsForPinnedComment(): Promise<void> {
  const brands: Brand[] = ["sovereign_synthesis", "containment_field"];
  const now = Date.now();

  for (const brand of brands) {
    try {
      const token = await getYouTubeToken(brand);
      if (!token) {
        console.warn(`[YukiShorts] No OAuth token for ${brand}, skipping`);
        continue;
      }

      const recent = await fetchRecentUploads(brand, token, RECENT_UPLOADS_PER_CHANNEL);
      if (recent.length === 0) continue;

      // Filter by freshness window
      const fresh = recent.filter((u) => {
        const t = Date.parse(u.publishedAt);
        return Number.isFinite(t) && (now - t) <= SHORT_FRESHNESS_MS;
      });
      if (fresh.length === 0) continue;

      // Filter by duration (Shorts only)
      const durations = await fetchDurations(fresh.map((f) => f.videoId), token);
      const shorts = fresh.filter((f) => {
        const d = durations[f.videoId];
        return Number.isFinite(d) && d > 0 && d <= SHORT_DURATION_MAX_S;
      });
      if (shorts.length === 0) continue;

      // Dedup against Supabase + in-memory
      const ids = shorts.map((s) => s.videoId);
      const alreadyPosted = await fetchAlreadyPostedIds(brand, ids);
      const todo = shorts.filter((s) =>
        !alreadyPosted.has(s.videoId) && !inMemoryPosted[brand].has(s.videoId)
      );
      if (todo.length === 0) continue;

      console.log(`[YukiShorts] ${brand}: ${todo.length} new shorts to comment on`);

      for (const short of todo) {
        try {
          const decision = await generateShortsComment(brand, short.title, short.description);
          if (!decision.should_post || !decision.comment) {
            console.log(`[YukiShorts] Skipping ${short.videoId} (${brand}): ${decision.reason || "no comment generated"}`);
            inMemoryPosted[brand].add(short.videoId);
            await recordPosted({
              video_id: short.videoId,
              brand,
              comment_text: null,
              error: `skipped: ${decision.reason || "no_comment"}`,
            });
            continue;
          }

          const result = await postYouTubeComment(short.videoId, decision.comment, brand);
          if (result.success) {
            console.log(`[YukiShorts] Posted on ${short.videoId} (${brand}): ${decision.comment.slice(0, 80)}...`);
            inMemoryPosted[brand].add(short.videoId);
            await recordPosted({
              video_id: short.videoId,
              brand,
              comment_id: result.commentId || null,
              comment_text: decision.comment,
            });
          } else {
            console.error(`[YukiShorts] POST failed on ${short.videoId}: ${result.error}`);
            await recordPosted({
              video_id: short.videoId,
              brand,
              comment_text: decision.comment,
              error: result.error || "unknown",
            });
            // Don't add to inMemoryPosted — let it retry on the next tick.
          }

          // Spacing between posts to avoid quota burst.
          await new Promise((r) => setTimeout(r, 1500));
        } catch (err: any) {
          console.error(`[YukiShorts] short ${short.videoId} crashed: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`[YukiShorts] brand ${brand} crashed: ${err.message}`);
    }
  }
}
