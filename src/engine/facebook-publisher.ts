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

const FB_API = "https://graph.facebook.com/v25.0";
const META_MIN_SCHEDULE_LEAD_MIN = 11; // Meta requires > 10 min lead

export type FacebookBrand = "sovereign_synthesis" | "containment_field";

interface FacebookPostResult {
  success: boolean;
  postId?: string;
  error?: string;
  /** True when this post was staged in Planner instead of going live. */
  scheduled?: boolean;
  /** Unix timestamp (seconds) when the staged post will auto-publish. */
  scheduledFor?: number;
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

  try {
    // Detect video URLs (.mp4, .mov, .webm, etc.) and route to /videos
    // instead of /photos. Prior to this fix, content_engine_queue rows with
    // R2-hosted .mp4 in media_url were being POSTed to /photos as `url=...mp4`,
    // which Meta rejected with "Invalid parameter (code=100)".
    if (options?.imageUrl) {
      const lowerUrl = options.imageUrl.toLowerCase().split("?")[0];
      const videoExts = [".mp4", ".mov", ".webm", ".m4v", ".avi"];
      if (videoExts.some(ext => lowerUrl.endsWith(ext))) {
        return await postVideo(pageId, token, text, options.imageUrl, scheduledFor, brand);
      }
      return await postPhoto(pageId, token, text, options.imageUrl, scheduledFor, brand);
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
      return scheduledFor !== null
        ? { success: true, postId: data.id, scheduled: true, scheduledFor }
        : { success: true, postId: data.id };
    }

    const errCode = data.error?.code || "unknown";
    const errSubcode = data.error?.error_subcode || "";
    const errMsg = data.error?.message || JSON.stringify(data);
    console.error(`❌ [FacebookPublisher] API error (${brand}): code=${errCode} subcode=${errSubcode} - ${errMsg}`);
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
  return { success: false, error: `${errMsg} (code=${errCode})` };
}

/**
 * S115c — Post a video with description to the Page via /PAGE_ID/videos endpoint.
 * Accepts a hosted file_url (R2 .mp4 in our case). FB pulls the file server-side
 * and auto-generates a thumbnail from frame 0. Returns the video ID + post ID.
 * S118c — When `scheduledFor` is provided, the video is staged in Planner.
 */
async function postVideo(
  pageId: string,
  token: string,
  description: string,
  videoUrl: string,
  scheduledFor: number | null = null,
  brand: FacebookBrand = "sovereign_synthesis"
): Promise<FacebookPostResult> {
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
  return { success: false, error: `${errMsg} (code=${errCode})` };
}
