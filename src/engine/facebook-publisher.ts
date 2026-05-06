/**
 * facebook-publisher.ts — Direct Facebook Page publishing via Graph API v25.0
 * Bypasses Buffer entirely. Uses System User tokens with pages_manage_posts scope.
 *
 * Env vars required (Railway):
 *   FACEBOOK_PAGE_ACCESS_TOKEN    — Sovereign Synthesis page token
 *   FACEBOOK_PAGE_ID              — Sovereign Synthesis page ID (1064072003457963)
 *   FACEBOOK_CF_PAGE_ACCESS_TOKEN — The Containment Field page token
 *   FACEBOOK_CF_PAGE_ID           — The Containment Field page ID (987809164425935)
 *
 * Optional env:
 *   FACEBOOK_PLANNER_LEAD_MIN     — minutes ahead to schedule each post in
 *                                    Business Suite Planner instead of live.
 *                                    `0` or unset = live publishing (legacy).
 *                                    Recommended: 15 — gives a veto window
 *                                    where every bot post lands in Planner
 *                                    inbox where the Architect can review,
 *                                    edit, or cancel before auto-publish.
 *                                    Min effective value 11 (Meta requires
 *                                    scheduled_publish_time > 10 min ahead).
 */

import { shouldAlertOnce, formatAuthAlert } from "../proactive/yuki-auth-alert";

const FB_API = "https://graph.facebook.com/v25.0";
const META_MIN_SCHEDULE_LEAD_MIN = 11; // Meta requires > 10 min lead

export type FacebookBrand = "sovereign_synthesis" | "containment_field";

// ── S130 (2026-05-04): Self-healing FB auth alert ────────────────────────
// When Meta returns a token-failure-class error (expired token, revoked
// admin permission, 2FA toggle on the page's business), fire a Telegram DM
// to the Architect once per 6h per brand. Without this, FB publishing can
// silently fail for days. Pattern mirrors yuki-auth-alert.ts (the IG/TT/FB
// reply-poll alerts that already run on this bot).
function isFacebookTokenFailure(data: any): boolean {
  const errMsg = String(data?.error?.message || "").toLowerCase();
  const errCode = data?.error?.code;
  // 190 = token expired/invalid. 200 + admin/2FA wording = revoked or 2FA-locked.
  if (errCode === 190) return true;
  if (errCode === 200 && /sufficient administrative permission|two factor authentication|access token/i.test(errMsg)) return true;
  if (errCode === 10 && /permission/i.test(errMsg)) return true;
  return false;
}

async function alertFacebookAuthFailure(brand: FacebookBrand, errMsg: string): Promise<void> {
  if (!shouldAlertOnce("facebook", brand)) return;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIdRaw = process.env.TELEGRAM_AUTHORIZED_USER_IDS || process.env.TELEGRAM_AUTHORIZED_USER_ID || process.env.AUTHORIZED_USER_ID || "8593700720";
  const chatId = chatIdRaw.split(",")[0].trim();
  if (!botToken || !chatId) return;
  const message = formatAuthAlert("facebook", brand, errMsg);
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
    console.log(`📡 [FacebookPublisher] Auth-failure alert dispatched for ${brand}`);
  } catch (err: any) {
    console.warn(`[FacebookPublisher] Failed to send auth alert: ${err?.message}`);
  }
}

// ── S130-FB4 — Publish-failure alerts (non-auth Meta errors) ──────────────
// The auth-alert layer above catches token-class failures (190/200/10) so
// Architect knows to refresh tokens. But Meta also returns *content-class*
// errors that the auth layer ignores — invalid parameter (100), upload
// failure (6000), abusive content (368), and novel/unknown codes. Without
// this layer those are silent: error logged to console only, no Telegram
// DM, Architect misses every failed publish until manually checking the
// FB pages or Railway logs. This adds a separate alert channel for those,
// throttled per (brand, lane, error-class) so a recurring problem doesn't
// spam the DM channel.

const lastPublishAlerted = new Map<string, number>();
const PUBLISH_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h, mirrors auth-alert cadence

type PublishLane = "feed" | "photo" | "video" | "reel";

/**
 * Classify a Meta API error response into an error-class string used for
 * alert routing + throttle keying. The classification deliberately keeps
 * "auth" and "rate" silent here (auth has its own alert path; rate is
 * transient and Meta will accept retries). Everything else gets surfaced.
 */
function classifyFacebookPublishError(data: any): string {
  const code = data?.error?.code;
  if (code === 190 || code === 200 || code === 10) return "auth";   // handled by alertFacebookAuthFailure
  if (code === 613) return "rate";                                  // transient, no alert
  if (code === 100) return "param";                                 // aspect/resolution/duration violation
  if (code === 6000) return "upload";                               // CDN/file fetch issue
  if (code === 368) return "abuse";                                 // content flagged by Meta
  return "unknown";                                                 // catch-all so we don't miss novel modes
}

function shouldAlertPublishOnce(brand: FacebookBrand, lane: PublishLane, errClass: string): boolean {
  const key = `fb-publish:${brand}:${lane}:${errClass}`;
  const now = Date.now();
  const last = lastPublishAlerted.get(key) || 0;
  if (now - last < PUBLISH_ALERT_COOLDOWN_MS) return false;
  lastPublishAlerted.set(key, now);
  return true;
}

async function alertFacebookPublishFailure(
  brand: FacebookBrand,
  lane: PublishLane,
  errMsg: string,
  errCode: number | string,
  errClass: string,
): Promise<void> {
  // Auth + rate are not surfaced through this path
  if (errClass === "auth" || errClass === "rate") return;
  if (!shouldAlertPublishOnce(brand, lane, errClass)) return;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIdRaw = process.env.TELEGRAM_AUTHORIZED_USER_IDS || process.env.TELEGRAM_AUTHORIZED_USER_ID || process.env.AUTHORIZED_USER_ID || "8593700720";
  const chatId = chatIdRaw.split(",")[0].trim();
  if (!botToken || !chatId) return;

  const brandLabel = brand === "sovereign_synthesis" ? "Sovereign Synthesis" : "Containment Field";
  const laneLabel = lane === "reel" ? "Reel" : lane === "video" ? "Video" : lane === "photo" ? "Photo" : "Feed post";
  const fixHint =
    errClass === "param"   ? "Likely an aspect-ratio / resolution / duration violation. For Reels: 9:16, ≥540p, 4-60s, ≥23fps. Check the queue row's media_url and the pod's compose params."
    : errClass === "upload" ? "Meta couldn't fetch the .mp4 from R2. Verify the R2 URL is publicly reachable and the file isn't 0-byte or partially uploaded."
    : errClass === "abuse"  ? "Meta flagged this content as abusive. Review the caption + thumbnail — could be a banned term or imagery that triggered Meta's classifiers."
    : /* unknown */          "Unrecognized Meta error code. Check Railway logs for the full response and cross-reference at developers.facebook.com/docs/graph-api/guides/error-handling.";

  const message =
    `📘 *${laneLabel} publish failed (${brandLabel})*\n` +
    `Code: ${errCode} (${errClass})\n` +
    `Reason: ${errMsg.slice(0, 300)}\n\n` +
    `${fixHint}\n\n` +
    `(Throttled to once per 6h per brand/lane/error-class.)`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
    console.log(`📡 [FacebookPublisher] Publish-failure alert dispatched (${brand}/${lane}/${errClass})`);
  } catch (err: any) {
    console.warn(`[FacebookPublisher] Failed to send publish-failure alert: ${err?.message}`);
  }
}

// ── S130-FB5 — First-commenter (caption-clean CTA in the first comment) ──
// FB / IG growth pattern: caption stays clean (no link clutter), the click
// target sits in the first comment. Engagement-ranking algorithms historically
// favor this layout. Failure of the comment is non-fatal to the parent publish.

async function postFirstComment(
  pageId: string,
  token: string,
  parentPostId: string,
  text: string,
  brand: FacebookBrand,
): Promise<void> {
  try {
    const res = await fetch(`${FB_API}/${parentPostId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, access_token: token }),
    });
    const data = (await res.json()) as any;
    if (data.id) {
      console.log(`💬 [FacebookPublisher] First comment posted on ${parentPostId} (${brand}): ${data.id}`);
      return;
    }
    const errCode = data.error?.code || "unknown";
    const errMsg = data.error?.message || JSON.stringify(data).slice(0, 200);
    console.warn(`⚠️ [FacebookPublisher] First-comment failed (${brand}): code=${errCode} - ${errMsg}`);
    // Surface non-auth/non-rate failures so a recurring comment-permission issue gets visibility.
    const errClass = classifyFacebookPublishError(data);
    if (errClass !== "auth" && errClass !== "rate") {
      await alertFacebookPublishFailure(brand, "feed", `first-comment: ${errMsg}`, errCode, errClass);
    }
  } catch (err: any) {
    console.warn(`⚠️ [FacebookPublisher] First-comment network error (${brand}): ${err.message}`);
  }
}

// ── S130-FB5 — Reel-publish success DM (graceful verification, mutable) ──
// After a Reel publishes successfully, DM Architect a one-line message with the
// reel URL so he can eyeball the auto-extracted cover (post-prepend) by tapping
// a link instead of hunting through Railway logs. Throttled 12h per brand to
// avoid noise. Disabled entirely when env FACEBOOK_PUBLISH_DM_DISABLED=1 — set
// this on Railway when you've seen enough cleanly-landed Reels to trust the
// chain and don't want the DMs anymore.

const lastReelPublishDmAt = new Map<string, number>();
const REEL_PUBLISH_DM_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h per brand

async function dmReelPublishSuccess(brand: FacebookBrand, reelUrl: string): Promise<void> {
  if (process.env.FACEBOOK_PUBLISH_DM_DISABLED === "1") return;
  const now = Date.now();
  const last = lastReelPublishDmAt.get(brand) || 0;
  if (now - last < REEL_PUBLISH_DM_COOLDOWN_MS) return;
  lastReelPublishDmAt.set(brand, now);

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIdRaw = process.env.TELEGRAM_AUTHORIZED_USER_IDS || process.env.TELEGRAM_AUTHORIZED_USER_ID || process.env.AUTHORIZED_USER_ID || "8593700720";
  const chatId = chatIdRaw.split(",")[0].trim();
  if (!botToken || !chatId) return;

  const brandLabel = brand === "sovereign_synthesis" ? "Sovereign Synthesis" : "The Containment Field";
  const message = `🎬 Reel published — ${brandLabel}\n${reelUrl}\n\n_(Mute via FACEBOOK_PUBLISH_DM_DISABLED=1 on Railway. Throttled 12h per brand.)_`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
    console.log(`📡 [FacebookPublisher] Reel-publish verification DM dispatched (${brand})`);
  } catch (err: any) {
    console.warn(`[FacebookPublisher] Failed to send Reel-publish DM: ${err?.message}`);
  }
}

interface FacebookPostResult {
  success: boolean;
  postId?: string;
  error?: string;
  /** True when this post was staged in Planner instead of going live. */
  scheduled?: boolean;
  /** Unix timestamp (seconds) when the staged post will auto-publish. */
  scheduledFor?: number;
  /**
   * Public URL of the published post when known. Currently set only on the
   * Reels lane (`https://www.facebook.com/reel/{video_id}`) and used by
   * the post-publish verification DM. Other lanes leave this undefined.
   */
  postUrl?: string;
}

/**
 * S118c — Resolve the scheduled_publish_time to use for this call.
 * Priority: per-call override > FACEBOOK_PLANNER_LEAD_MIN env > live.
 * Returns null when posting should go LIVE; otherwise a unix timestamp (seconds).
 * Always clamped to >= now + META_MIN_SCHEDULE_LEAD_MIN to avoid Meta's reject.
 */
function resolveScheduledTime(perCallOverride?: number): number | null {
  // Explicit per-call value wins
  if (typeof perCallOverride === "number" && perCallOverride > 0) {
    const minTs = Math.floor(Date.now() / 1000) + META_MIN_SCHEDULE_LEAD_MIN * 60;
    return Math.max(perCallOverride, minTs);
  }
  // Env default
  const envMin = Number(process.env.FACEBOOK_PLANNER_LEAD_MIN || 0);
  if (!envMin || envMin <= 0) return null; // Live mode
  const effectiveLead = Math.max(envMin, META_MIN_SCHEDULE_LEAD_MIN);
  return Math.floor(Date.now() / 1000) + effectiveLead * 60;
}

function getPageCredentials(brand: FacebookBrand): { token: string; pageId: string } | null {
  if (brand === "containment_field") {
    const token = process.env.FACEBOOK_CF_PAGE_ACCESS_TOKEN;
    const pageId = process.env.FACEBOOK_CF_PAGE_ID;
    if (!token || !pageId) return null;
    return { token, pageId };
  }
  // Default: sovereign_synthesis / Sovereign Synthesis
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!token || !pageId) return null;
  return { token, pageId };
}

/**
 * SESSION 115b — In-memory cache for Page Access Tokens derived from the
 * System User token at runtime. Keyed by pageId. We refresh every 24h.
 *
 * Background: prior to S115b the env vars `FACEBOOK_*_PAGE_ACCESS_TOKEN`
 * held a SYSTEM USER access token (or a legacy long-lived user token).
 * Posting to `/PAGE_ID/feed` with a non-Page token causes Meta to return
 * a misleading "publish_actions deprecated" (code=200) error. The fix is
 * to first call `GET /PAGE_ID?fields=access_token&access_token=SU_TOKEN`
 * to obtain the Page-scoped access token, then use THAT for /feed POSTs.
 *
 * If the env-var token IS already a Page Access Token, the exchange still
 * succeeds (Meta returns the same/equivalent page token). On exchange
 * failure we fall back to the env-var token unchanged so any prior working
 * config keeps working.
 */
const pageTokenCache = new Map<string, { token: string; fetchedAt: number }>();
const PAGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function resolvePageAccessToken(seedToken: string, pageId: string): Promise<string> {
  const cached = pageTokenCache.get(pageId);
  if (cached && Date.now() - cached.fetchedAt < PAGE_TOKEN_TTL_MS) {
    return cached.token;
  }

  try {
    const url = `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(seedToken)}`;
    const res = await fetch(url, { method: "GET" });
    const data = (await res.json()) as any;
    if (data && typeof data.access_token === "string" && data.access_token.length > 0) {
      pageTokenCache.set(pageId, { token: data.access_token, fetchedAt: Date.now() });
      console.log(`🔑 [FacebookPublisher] Resolved Page Access Token for pageId=${pageId}`);
      return data.access_token;
    }
    const errMsg = data?.error?.message || JSON.stringify(data).slice(0, 200);
    console.warn(`⚠️ [FacebookPublisher] Could not exchange for Page Access Token (pageId=${pageId}): ${errMsg}. Falling back to seed token.`);
  } catch (err: any) {
    console.warn(`⚠️ [FacebookPublisher] Network error exchanging Page Access Token (pageId=${pageId}): ${err.message}. Falling back to seed token.`);
  }
  // Fallback path — cache briefly (1 min) so we don't hammer the exchange endpoint on persistent failures.
  pageTokenCache.set(pageId, { token: seedToken, fetchedAt: Date.now() - PAGE_TOKEN_TTL_MS + 60_000 });
  return seedToken;
}

/**
 * Publish a text post (with optional link) to a Facebook Page.
 * Brand parameter selects the target page (defaults to sovereign_synthesis).
 *
 * S118c — When `scheduledPublishTime` is set OR `FACEBOOK_PLANNER_LEAD_MIN`
 * env is > 0, the post is staged in Business Suite Planner instead of going
 * live. The Architect can review/edit/cancel from `business.facebook.com`
 * before the scheduled time. Same return shape; `scheduled: true` is set.
 */
export async function publishToFacebook(
  text: string,
  options?: {
    link?: string;
    imageUrl?: string;
    /**
     * Explicit video URL — uploads as a native FB video via /PAGE_ID/videos.
     * Use this (not `link`) when you have an .mp4 you want to play on FB.
     * Posting an .mp4 as a `link` produces a blank link-card preview because
     * R2/raw .mp4 URLs return no Open Graph metadata.
     */
    videoUrl?: string;
    /**
     * Optional thumbnail (.jpg/.png URL) attached when `videoUrl` is set.
     * The image is fetched server-side and sent as multipart `thumb` to the
     * /videos endpoint so FB renders a non-black preview frame.
     * Spec: ≥720p, ≤2MB, JPG/PNG, 16:9 or 1:1 recommended.
     *
     * NOTE: ignored when `asReel` is true. Meta's /video_reels endpoint does
     * not expose a custom-cover parameter at publish time — Reels covers are
     * auto-extracted from the video and can only be updated via a separate
     * post-publish call to /VIDEO_ID/thumbnails (not yet wired here).
     */
    thumbnailUrl?: string;
    /**
     * When true (and `videoUrl` is also set), publish to /PAGE_ID/video_reels
     * instead of /PAGE_ID/videos. Reels lane gets significantly more algorithmic
     * reach for vertical short-form content (per Meta's Reels-prioritization).
     *
     * Constraints — Meta will reject the publish if the video doesn't meet:
     *   - Aspect ratio 9:16 (vertical)
     *   - Resolution ≥ 540×960
     *   - Duration 4-60 seconds
     *   - Frame rate ≥ 23 fps
     *
     * Use only for content that satisfies these (e.g. faceless-factory standalone
     * shorts, VidRush chopped clips). Do NOT enable for content_engine_queue feed
     * posts — those don't meet aspect-ratio / duration constraints.
     */
    asReel?: boolean;
    /**
     * Optional CTA text. When provided, fires `POST /{post_id}/comments` with
     * this message immediately after the parent publish succeeds. Lets the
     * caption stay clean while a CTA link sits in the first comment, where
     * engagement-pattern algorithms tend to favor it. First-comment failures
     * are non-fatal — the parent publish stays successful, the failure logs +
     * fires a publish-failure alert.
     */
    firstCommentText?: string;
    brand?: FacebookBrand;
    /** Unix timestamp (seconds). Overrides FACEBOOK_PLANNER_LEAD_MIN env. */
    scheduledPublishTime?: number;
  }
): Promise<FacebookPostResult> {
  const brand = options?.brand || "sovereign_synthesis";
  const creds = getPageCredentials(brand);

  if (!creds) {
    const prefix = brand === "containment_field" ? "FACEBOOK_CF_" : "FACEBOOK_";
    return {
      success: false,
      error: `${prefix}PAGE_ACCESS_TOKEN or ${prefix}PAGE_ID not set`,
    };
  }

  const { token: seedToken, pageId } = creds;
  // Always exchange the env-var token for a true Page Access Token before
  // calling /PAGE_ID/feed. Cached per pageId for 24h. Fallback-safe.
  const token = await resolvePageAccessToken(seedToken, pageId);

  // Resolve scheduled-publish timestamp (null = live mode).
  const scheduledFor = resolveScheduledTime(options?.scheduledPublishTime);

  // S130-FB5 — Post-publish hooks. Run after any successful publish in any lane.
  //   1) firstCommentText  → fires POST /{post_id}/comments (CTA-in-first-comment)
  //   2) Reel + postUrl    → fires verification DM with reel URL (cover eyeball)
  // Failures of either hook are non-fatal — the parent publish stays successful,
  // the failure logs (and for first-comment, also fires a publish-failure alert
  // so a recurring permissions issue doesn't go silent).
  const finalize = async (result: FacebookPostResult): Promise<FacebookPostResult> => {
    if (!result.success) return result;
    if (result.postId && options?.firstCommentText) {
      await postFirstComment(pageId, token, result.postId, options.firstCommentText, brand);
    }
    if (options?.asReel && result.postUrl) {
      await dmReelPublishSuccess(brand, result.postUrl);
    }
    return result;
  };

  try {
    // Explicit video upload path — caller passes `videoUrl` (the .mp4) and
    // optionally `thumbnailUrl` (the preview image) and/or `asReel` to choose
    // the Reels lane vs feed-video lane.
    //   asReel=true  → /PAGE_ID/video_reels (3-phase upload). More algorithmic
    //                  reach. Auto-cover only (Meta doesn't expose custom cover
    //                  at publish). thumbnailUrl is ignored on this path.
    //   asReel=false → /PAGE_ID/videos (feed video). Custom thumbnail attached
    //                  as multipart `thumb` when thumbnailUrl is provided.
    if (options?.videoUrl) {
      if (options?.asReel) {
        return await finalize(await postReel(pageId, token, text, options.videoUrl, scheduledFor, brand));
      }
      return await finalize(await postVideo(
        pageId,
        token,
        text,
        options.videoUrl,
        scheduledFor,
        brand,
        options.thumbnailUrl || null,
      ));
    }

    // Legacy detection: if a video URL was passed via `imageUrl` (older
    // callers like content-engine that don't yet use `videoUrl`), still
    // route to /videos. No thumbnail in this branch — those callers don't
    // produce one. Black-preview risk remains until callers migrate.
    if (options?.imageUrl) {
      const lowerUrl = options.imageUrl.toLowerCase().split("?")[0];
      const videoExts = [".mp4", ".mov", ".webm", ".m4v", ".avi"];
      if (videoExts.some(ext => lowerUrl.endsWith(ext))) {
        return await finalize(await postVideo(pageId, token, text, options.imageUrl, scheduledFor, brand));
      }
      return await finalize(await postPhoto(pageId, token, text, options.imageUrl, scheduledFor, brand));
    }

    const body: Record<string, string> = {
      message: text,
      access_token: token,
    };

    if (options?.link) {
      body.link = options.link;
    }

    if (scheduledFor !== null) {
      body.published = "false";
      body.scheduled_publish_time = String(scheduledFor);
    }

    const res = await fetch(`${FB_API}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as any;

    if (data.id) {
      const mode = scheduledFor !== null
        ? `🗓️ STAGED in Planner for ${new Date(scheduledFor * 1000).toISOString()}`
        : `✅ Posted live`;
      console.log(`${mode} to ${brand}: ${data.id}`);
      return await finalize(
        scheduledFor !== null
          ? { success: true, postId: data.id, scheduled: true, scheduledFor }
          : { success: true, postId: data.id },
      );
    }

    const errCode = data.error?.code || "unknown";
    const errSubcode = data.error?.error_subcode || "";
    const errMsg = data.error?.message || JSON.stringify(data);
    console.error(`❌ [FacebookPublisher] API error (${brand}): code=${errCode} subcode=${errSubcode} - ${errMsg}`);
    if (isFacebookTokenFailure(data)) await alertFacebookAuthFailure(brand, errMsg);
    await alertFacebookPublishFailure(brand, "feed", errMsg, errCode, classifyFacebookPublishError(data));
    return { success: false, error: `${errMsg} (code=${errCode})` };
  } catch (err: any) {
    console.error(`❌ [FacebookPublisher] Network error (${brand}): ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Post a photo with caption to the Page.
 * S118c — When `scheduledFor` is provided, the photo is staged in Planner.
 */
async function postPhoto(
  pageId: string,
  token: string,
  caption: string,
  imageUrl: string,
  scheduledFor: number | null = null,
  brand: FacebookBrand = "sovereign_synthesis"
): Promise<FacebookPostResult> {
  const body: Record<string, string> = {
    url: imageUrl,
    message: caption,
    access_token: token,
  };

  if (scheduledFor !== null) {
    body.published = "false";
    body.scheduled_publish_time = String(scheduledFor);
  }

  const res = await fetch(`${FB_API}/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as any;

  if (data.id || data.post_id) {
    const id = data.post_id || data.id;
    const mode = scheduledFor !== null
      ? `🗓️ STAGED Photo in Planner for ${new Date(scheduledFor * 1000).toISOString()}`
      : `✅ Photo posted live`;
    console.log(`${mode} to ${brand}: ${id}`);
    return scheduledFor !== null
      ? { success: true, postId: id, scheduled: true, scheduledFor }
      : { success: true, postId: id };
  }

  const errCode = data.error?.code || "unknown";
  const errSubcode = data.error?.error_subcode || "";
  const errMsg = data.error?.message || JSON.stringify(data);
  console.error(`❌ [FacebookPublisher] Photo API error: code=${errCode} subcode=${errSubcode} - ${errMsg}`);
  if (isFacebookTokenFailure(data)) await alertFacebookAuthFailure(brand, errMsg);
  await alertFacebookPublishFailure(brand, "photo", errMsg, errCode, classifyFacebookPublishError(data));
  return { success: false, error: `${errMsg} (code=${errCode})` };
}

/**
 * S115c — Post a video with description to the Page via /PAGE_ID/videos endpoint.
 * Accepts a hosted file_url (R2 .mp4 in our case). FB pulls the file server-side.
 * Returns the video ID + post ID.
 *
 * S118c — When `scheduledFor` is provided, the video is staged in Planner.
 *
 * S130-FB1 — When `thumbnailUrl` is provided, the thumbnail is fetched
 * server-side and attached as multipart `thumb` so FB renders a clean preview
 * frame instead of auto-picking (often a black fade-in frame). Per Meta API,
 * `thumb` must be a binary upload; URL strings are not accepted in that field.
 * If the thumbnail fetch fails, we fall back to the JSON path silently — the
 * post still goes through, just without a custom thumbnail.
 */
async function postVideo(
  pageId: string,
  token: string,
  description: string,
  videoUrl: string,
  scheduledFor: number | null = null,
  brand: FacebookBrand = "sovereign_synthesis",
  thumbnailUrl: string | null = null,
): Promise<FacebookPostResult> {
  // ── Multipart path: only when a thumbnail URL was passed ────────────
  if (thumbnailUrl) {
    try {
      const thumbResp = await fetch(thumbnailUrl);
      if (!thumbResp.ok) {
        console.warn(`⚠️ [FacebookPublisher] Thumbnail fetch ${thumbResp.status} from ${thumbnailUrl}. Falling back to no-thumb upload.`);
      } else {
        const thumbBytes = await thumbResp.arrayBuffer();
        const thumbType = thumbResp.headers.get("content-type") || "image/jpeg";
        const thumbBlob = new Blob([thumbBytes], { type: thumbType });

        const form = new FormData();
        form.append("file_url", videoUrl);
        form.append("description", description);
        form.append("access_token", token);
        form.append("thumb", thumbBlob, "thumb.jpg");
        if (scheduledFor !== null) {
          form.append("published", "false");
          form.append("scheduled_publish_time", String(scheduledFor));
        }

        const res = await fetch(`${FB_API}/${pageId}/videos`, {
          method: "POST",
          body: form,
        });
        const data = (await res.json()) as any;

        if (data.id) {
          const mode = scheduledFor !== null
            ? `🗓️ STAGED Video+thumb in Planner for ${new Date(scheduledFor * 1000).toISOString()}`
            : `✅ Video+thumb posted live`;
          console.log(`${mode} to ${brand}: ${data.id}`);
          return scheduledFor !== null
            ? { success: true, postId: data.id, scheduled: true, scheduledFor }
            : { success: true, postId: data.id };
        }

        const errCode = data.error?.code || "unknown";
        const errSubcode = data.error?.error_subcode || "";
        const errMsg = data.error?.message || JSON.stringify(data);
        console.error(`❌ [FacebookPublisher] Video+thumb API error: code=${errCode} subcode=${errSubcode} - ${errMsg}`);
        if (isFacebookTokenFailure(data)) await alertFacebookAuthFailure(brand, errMsg);
        await alertFacebookPublishFailure(brand, "video", errMsg, errCode, classifyFacebookPublishError(data));
        return { success: false, error: `${errMsg} (code=${errCode})` };
      }
    } catch (err: any) {
      console.warn(`⚠️ [FacebookPublisher] Thumbnail fetch network error: ${err.message}. Falling back to no-thumb upload.`);
      // Fall through to JSON path
    }
  }

  // ── JSON path: no thumbnail (or thumbnail fetch failed) ────────────
  const body: Record<string, string> = {
    file_url: videoUrl,
    description,
    access_token: token,
  };

  if (scheduledFor !== null) {
    body.published = "false";
    body.scheduled_publish_time = String(scheduledFor);
  }

  const res = await fetch(`${FB_API}/${pageId}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as any;

  if (data.id) {
    const mode = scheduledFor !== null
      ? `🗓️ STAGED Video in Planner for ${new Date(scheduledFor * 1000).toISOString()}`
      : `✅ Video posted live`;
    console.log(`${mode} to ${brand}: ${data.id}`);
    return scheduledFor !== null
      ? { success: true, postId: data.id, scheduled: true, scheduledFor }
      : { success: true, postId: data.id };
  }

  const errCode = data.error?.code || "unknown";
  const errSubcode = data.error?.error_subcode || "";
  const errMsg = data.error?.message || JSON.stringify(data);
  console.error(`❌ [FacebookPublisher] Video API error: code=${errCode} subcode=${errSubcode} - ${errMsg}`);
  if (isFacebookTokenFailure(data)) await alertFacebookAuthFailure(brand, errMsg);
  await alertFacebookPublishFailure(brand, "video", errMsg, errCode, classifyFacebookPublishError(data));
  return { success: false, error: `${errMsg} (code=${errCode})` };
}

/**
 * S130-FB2 — Publish a Reel via /PAGE_ID/video_reels (3-phase upload flow).
 *
 * Reels lane gets significantly more algorithmic reach than feed videos for
 * vertical short-form content. For 9:16 ≤60s clips (faceless-factory standalone
 * shorts, VidRush chopped clips), this is the right destination.
 *
 * Per Meta's Reels publishing API (verified against
 * https://developers.facebook.com/docs/video-api/guides/reels-publishing/ +
 * https://developers.facebook.com/docs/graph-api/reference/page/video_reels/),
 * the flow is three sequential calls:
 *
 *   1. POST /PAGE_ID/video_reels?upload_phase=start
 *      → returns { video_id, upload_url, success }
 *   2. POST <upload host>/video-upload/v25.0/<video_id>
 *      with header `Authorization: OAuth <token>` and `file_url: <CDN URL>`
 *      → Meta fetches the video server-side from our R2 hosted URL
 *   3. POST /PAGE_ID/video_reels?upload_phase=finish&video_id=...
 *      &video_state=PUBLISHED&description=...   (or SCHEDULED + scheduled_publish_time)
 *
 * Cover image: NOT exposed by /video_reels at publish time (no thumb / cover_url
 * parameter is documented). Cover is auto-extracted from the video frame. To set
 * a custom cover, a separate POST /VIDEO_ID/thumbnails call is required AFTER
 * publish — that's a follow-up if/when auto-cover quality proves insufficient.
 * The caller's thumbnailUrl is silently ignored on this lane.
 *
 * Failure modes (all surface via FacebookPostResult.error):
 *   - 100 Invalid parameter   → typically aspect/resolution/duration violation
 *   - 6000 Upload failure     → CDN URL unreachable from Meta or invalid file
 *   - 190/200/10 token errors → Telegram alert via alertFacebookAuthFailure
 *   - 613 Rate limit          → backoff (no retry here yet — left to caller)
 *
 * Reels constraints (Meta-enforced):
 *   - Aspect ratio: 9:16 (vertical)        - Resolution:  ≥540×960 (540p)
 *   - Duration:    4-60 seconds            - Frame rate:  ≥23 fps
 */
async function postReel(
  pageId: string,
  token: string,
  description: string,
  videoUrl: string,
  scheduledFor: number | null = null,
  brand: FacebookBrand = "sovereign_synthesis",
): Promise<FacebookPostResult> {
  // ── Phase 1 — Initialize upload session ────────────────────────────
  let videoId: string;
  try {
    const startUrl = `${FB_API}/${pageId}/video_reels?upload_phase=start&access_token=${encodeURIComponent(token)}`;
    const startRes = await fetch(startUrl, { method: "POST" });
    const startData = (await startRes.json()) as any;
    if (!startData.video_id) {
      const errMsg = startData.error?.message || JSON.stringify(startData).slice(0, 300);
      const errCode = startData.error?.code || "unknown";
      console.error(`❌ [FacebookPublisher] Reel init error (${brand}): code=${errCode} - ${errMsg}`);
      if (isFacebookTokenFailure(startData)) await alertFacebookAuthFailure(brand, errMsg);
      await alertFacebookPublishFailure(brand, "reel", `init: ${errMsg}`, errCode, classifyFacebookPublishError(startData));
      return { success: false, error: `reel-init: ${errMsg} (code=${errCode})` };
    }
    videoId = String(startData.video_id);
  } catch (err: any) {
    console.error(`❌ [FacebookPublisher] Reel init network error (${brand}): ${err.message}`);
    return { success: false, error: `reel-init network: ${err.message}` };
  }

  // ── Phase 2 — Hosted-file upload (Meta fetches videoUrl server-side) ──
  try {
    const uploadEndpoint = `https://rupload.facebook.com/video-upload/v25.0/${videoId}`;
    const uploadRes = await fetch(uploadEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `OAuth ${token}`,
        "file_url": videoUrl,
      },
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error(`❌ [FacebookPublisher] Reel upload error (${brand}): http=${uploadRes.status} body=${errText.slice(0, 300)}`);
      // The rupload endpoint returns text/HTTP status, not Meta's standard JSON
      // error envelope, so we hard-classify these as "upload" errors and pass
      // the HTTP status as the error code for the alert.
      await alertFacebookPublishFailure(brand, "reel", `upload http ${uploadRes.status}: ${errText.slice(0, 200)}`, `http_${uploadRes.status}`, "upload");
      return { success: false, error: `reel-upload: http ${uploadRes.status} - ${errText.slice(0, 200)}` };
    }
  } catch (err: any) {
    console.error(`❌ [FacebookPublisher] Reel upload network error (${brand}): ${err.message}`);
    return { success: false, error: `reel-upload network: ${err.message}` };
  }

  // ── Phase 3 — Finish (publish or schedule) ────────────────────────
  try {
    const finishParams = new URLSearchParams({
      access_token: token,
      video_id: videoId,
      upload_phase: "finish",
      description,
    });
    if (scheduledFor !== null) {
      finishParams.set("video_state", "SCHEDULED");
      finishParams.set("scheduled_publish_time", String(scheduledFor));
    } else {
      finishParams.set("video_state", "PUBLISHED");
    }
    const finishUrl = `${FB_API}/${pageId}/video_reels?${finishParams.toString()}`;
    const finishRes = await fetch(finishUrl, { method: "POST" });
    const finishData = (await finishRes.json()) as any;

    if (finishData.success === true || finishData.post_id) {
      const mode = scheduledFor !== null
        ? `🗓️ STAGED Reel for ${new Date(scheduledFor * 1000).toISOString()}`
        : `✅ Reel posted live`;
      const idForResult = finishData.post_id || videoId;
      const reelUrl = `https://www.facebook.com/reel/${videoId}`;
      console.log(`${mode} to ${brand}: ${idForResult} — ${reelUrl}`);
      return scheduledFor !== null
        ? { success: true, postId: idForResult, scheduled: true, scheduledFor, postUrl: reelUrl }
        : { success: true, postId: idForResult, postUrl: reelUrl };
    }

    const errCode = finishData.error?.code || "unknown";
    const errSubcode = finishData.error?.error_subcode || "";
    const errMsg = finishData.error?.message || JSON.stringify(finishData).slice(0, 300);
    console.error(`❌ [FacebookPublisher] Reel finish error (${brand}): code=${errCode} subcode=${errSubcode} - ${errMsg}`);
    if (isFacebookTokenFailure(finishData)) await alertFacebookAuthFailure(brand, errMsg);
    await alertFacebookPublishFailure(brand, "reel", `finish: ${errMsg}`, errCode, classifyFacebookPublishError(finishData));
    return { success: false, error: `reel-finish: ${errMsg} (code=${errCode})` };
  } catch (err: any) {
    console.error(`❌ [FacebookPublisher] Reel finish network error (${brand}): ${err.message}`);
    return { success: false, error: `reel-finish network: ${err.message}` };
  }
}
