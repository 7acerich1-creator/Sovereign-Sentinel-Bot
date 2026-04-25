/**
 * facebook-publisher.ts — Direct Facebook Page publishing via Graph API v25.0
 * Bypasses Buffer entirely. Uses System User tokens with pages_manage_posts scope.
 *
 * Env vars required (Railway):
 *   FACEBOOK_PAGE_ACCESS_TOKEN    — Sovereign Synthesis page token
 *   FACEBOOK_PAGE_ID              — Sovereign Synthesis page ID (1064072003457963)
 *   FACEBOOK_CF_PAGE_ACCESS_TOKEN — The Containment Field page token
 *   FACEBOOK_CF_PAGE_ID           — The Containment Field page ID (987809164425935)
 */

const FB_API = "https://graph.facebook.com/v25.0";

export type FacebookBrand = "sovereign_synthesis" | "containment_field";

interface FacebookPostResult {
  success: boolean;
  postId?: string;
  error?: string;
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
 */
export async function publishToFacebook(
  text: string,
  options?: { link?: string; imageUrl?: string; brand?: FacebookBrand }
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
  // S115b: Always exchange the env-var token for a true Page Access Token before
  // calling /PAGE_ID/feed. Cached per pageId for 24h. Fallback-safe.
  const token = await resolvePageAccessToken(seedToken, pageId);

  try {
    // If there's an image, use /photos endpoint; otherwise /feed
    if (options?.imageUrl) {
      return await postPhoto(pageId, token, text, options.imageUrl);
    }

    const body: Record<string, string> = {
      message: text,
      access_token: token,
    };

    if (options?.link) {
      body.link = options.link;
    }

    const res = await fetch(`${FB_API}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as any;

    if (data.id) {
      console.log(`✅ [FacebookPublisher] Posted to ${brand}: ${data.id}`);
      return { success: true, postId: data.id };
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
 */
async function postPhoto(
  pageId: string,
  token: string,
  caption: string,
  imageUrl: string
): Promise<FacebookPostResult> {
  const body = {
    url: imageUrl,
    message: caption,
    access_token: token,
  };

  const res = await fetch(`${FB_API}/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as any;

  if (data.id || data.post_id) {
    const id = data.post_id || data.id;
    console.log(`✅ [FacebookPublisher] Photo posted: ${id}`);
    return { success: true, postId: id };
  }

  const errCode = data.error?.code || "unknown";
  const errSubcode = data.error?.error_subcode || "";
  const errMsg = data.error?.message || JSON.stringify(data);
  console.error(`❌ [FacebookPublisher] Photo API error: code=${errCode} subcode=${errSubcode} - ${errMsg}`);
  return { success: false, error: `${errMsg} (code=${errCode})` };
}
