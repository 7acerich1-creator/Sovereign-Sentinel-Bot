// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — YouTube Comment Alert Layer
// Session 58 (2026-04-14) — first real audience signal response infrastructure.
//
// Polls both YouTube channels (Sovereign Synthesis + The Containment Field) on a 5-minute
// cadence via the Data API v3 commentThreads endpoint (allThreadsRelatedToChannel
// requires channel-owner OAuth — we have refresh tokens for both).
//
// For each NEW comment (not in public.youtube_comments_seen and published within
// the last 24h), DMs the Architect on Telegram with channel, video title, author,
// text, and a direct reply link.
//
// No sentiment scoring, no filtering. First-pass spec: get the comment into Ace's
// hand within 5 min. See memory/project_first_audience_signal.md for the @noemicsafordi
// trigger event that motivated this build.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";
import { replyToCommentAsAce } from "./yuki-comment-replier";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

type Brand = "sovereign_synthesis" | "containment_field";

const BRAND_CONFIG: Record<Brand, { label: string; channelId: string }> = {
  sovereign_synthesis: {
    label: "Sovereign Synthesis",
    channelId: "UCbj9a6brDL9hNIY1BpxOJfQ",
  },
  containment_field: {
    label: "The Containment Field",
    channelId: "UCLHJIIEjavmrS3R70xnCD1Q",
  },
};

// ── OAuth helper (mirrors pattern in tools/youtube-cta-tools.ts) ──
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

// ── Supabase helpers ──
async function fetchSeenCommentIds(brand: Brand, ids: string[]): Promise<Set<string>> {
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return new Set();
  try {
    const inList = ids.map((id) => `"${id}"`).join(",");
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/youtube_comments_seen?select=comment_id&brand=eq.${brand}&comment_id=in.(${encodeURIComponent(inList)})`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    if (!resp.ok) return new Set();
    const rows = (await resp.json()) as Array<{ comment_id: string }>;
    return new Set(rows.map((r) => r.comment_id));
  } catch {
    return new Set();
  }
}

async function recordCommentAsSeen(row: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/youtube_comments_seen`, {
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
    console.error(`[YTCommentWatcher] record failed: ${err.message}`);
  }
}

// ── Process-local fallback dedup (when Supabase is unreachable) ──
const inMemorySeen: Record<Brand, Set<string>> = {
  sovereign_synthesis: new Set(),
  containment_field: new Set(),
};
let firstRunPerBrand: Record<Brand, boolean> = { sovereign_synthesis: true, containment_field: true };

// ── Main poll function — call once per tick ──
export async function pollYouTubeComments(
  telegram: Channel,
  chatId: string,
  opts: { alertWindowMs?: number } = {}
): Promise<void> {
  const alertWindowMs = opts.alertWindowMs ?? 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const brand of Object.keys(BRAND_CONFIG) as Brand[]) {
    const cfg = BRAND_CONFIG[brand];
    const token = await getYouTubeToken(brand);
    if (!token) {
      console.log(`[YTCommentWatcher] ${cfg.label}: no OAuth token — skipping`);
      continue;
    }

    let threads: any[] = [];
    try {
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=${cfg.channelId}&order=time&maxResults=20&textFormat=plainText`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        console.error(`[YTCommentWatcher] ${cfg.label} fetch ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        continue;
      }
      const data = (await resp.json()) as any;
      threads = data.items || [];
    } catch (err: any) {
      console.error(`[YTCommentWatcher] ${cfg.label} error: ${err.message}`);
      continue;
    }

    if (threads.length === 0) continue;

    const ids = threads.map((t) => t.id).filter(Boolean);
    const seenFromDb = await fetchSeenCommentIds(brand, ids);

    // First process-run AND empty DB for this brand → seed without alerting
    const isFirstRun = firstRunPerBrand[brand];
    firstRunPerBrand[brand] = false;

    for (const thread of threads) {
      const commentId: string = thread.id;
      if (!commentId) continue;
      if (seenFromDb.has(commentId) || inMemorySeen[brand].has(commentId)) continue;

      const top = thread.snippet?.topLevelComment?.snippet || {};
      const videoId: string = thread.snippet?.videoId || "";
      const authorName: string = top.authorDisplayName || "(unknown)";
      const authorChannelUrl: string = top.authorChannelUrl || "";
      const authorHandle = authorChannelUrl.split("/").pop() || authorName;
      const textOriginal: string = top.textOriginal || top.textDisplay || "";
      const publishedAt: string = top.publishedAt || "";

      const publishedMs = publishedAt ? Date.parse(publishedAt) : now;
      const withinWindow = now - publishedMs <= alertWindowMs;

      // Record as seen regardless (prevents re-alerting on the next tick)
      await recordCommentAsSeen({
        comment_id: commentId,
        brand,
        video_id: videoId,
        author_handle: authorHandle,
        author_display_name: authorName,
        text_original: textOriginal.slice(0, 2000),
        published_at: publishedAt || new Date().toISOString(),
      });
      inMemorySeen[brand].add(commentId);

      // Skip alerting on the seed pass OR if comment is older than the alert window
      if (isFirstRun && seenFromDb.size === 0) continue;
      if (!withinWindow) continue;

      // Fetch video title (best-effort; failure doesn't block the alert)
      let videoTitle = videoId;
      try {
        const vResp = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (vResp.ok) {
          const vData = (await vResp.json()) as any;
          videoTitle = vData.items?.[0]?.snippet?.title || videoId;
        }
      } catch { /* ignore */ }

      const replyUrl = `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`;
      const textPreview = textOriginal.length > 500 ? textOriginal.slice(0, 497) + "..." : textOriginal;

      const msg =
        `🟡 *New YouTube Comment — ${cfg.label}*\n\n` +
        `*Video:* ${videoTitle}\n` +
        `*From:* ${authorName} (${authorHandle})\n` +
        `*Published:* ${publishedAt}\n\n` +
        `"${textPreview}"\n\n` +
        `*Reply →* ${replyUrl}`;

      try {
        await telegram.sendMessage(chatId, msg, { parseMode: "Markdown" });
        console.log(`[YTCommentWatcher] alerted: ${cfg.label} / ${authorName} / ${commentId}`);
      } catch (err: any) {
        console.error(`[YTCommentWatcher] Telegram send failed: ${err.message}`);
      }

      // Yuki auto-reply (fire-and-forget) — Session 115 (2026-04-24).
      // Generates a plain-Ace voice reply and posts it via the threaded-reply
      // API. Failures are logged + recorded to youtube_comments_seen.reply_error
      // but never propagate up here — the watcher's job is the alert; the reply
      // is best-effort additive.
      replyToCommentAsAce({
        commentId,
        brand,
        videoId,
        videoTitle,
        authorName,
        authorHandle,
        textOriginal,
      }).catch((err: any) => {
        console.error(`[YTCommentWatcher] yuki replier crashed unexpectedly: ${err.message}`);
      });
    }
  }
}
