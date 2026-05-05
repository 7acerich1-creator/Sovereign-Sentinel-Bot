// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW — YouTube Analytics Stats Fetcher
// S114 (2026-04-24) — Fix B for the 30-Video A/B/C Performance Test.
//
// The existing Supabase Edge Function `fetch-youtube-stats` populates
// views/likes/comments/engagement using Data API v3 + an API key. That gets us
// outlier scores but NOT CTR or retention — those metrics require YouTube
// Analytics API v2, which requires OAuth.
//
// The bot already has owner OAuth refresh tokens for both channels (added for
// the S58 comment-watcher). This module reuses that auth + writes the
// analytics-only fields (`retention`, `ctr`, `impressions`) into the existing
// `youtube_analytics` rows. The Data API v3 fetcher remains the source of truth
// for `views`, so we only ever PATCH the analytics-specific columns.
//
// Required OAuth scope: https://www.googleapis.com/auth/yt-analytics.readonly
// If existing tokens were granted with `youtube.readonly` only, the call returns
// 403 "Insufficient scope" and the architect must re-consent. The error is logged
// loudly with a re-consent URL so the failure is actionable.
//
// Cadence: every 6 hours via scheduler in src/index.ts. YouTube Analytics has
// ~24h-48h reporting lag so polling more often is wasteful.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

type Brand = "sovereign_synthesis" | "containment_field";

const BRAND_CONFIG: Record<Brand, { label: string; channelId: string; channelName: string }> = {
  sovereign_synthesis: {
    label: "Sovereign Synthesis",
    channelId: "UCbj9a6brDL9hNIY1BpxOJfQ",
    // S130m (2026-05-04): channelName was "Ace Richie" — the original YouTube
    // channel display name. The channel has since been renamed to "Sovereign
    // Synthesis", and the 210 historical youtube_analytics rows were backfilled
    // ('Ace Richie' → 'Sovereign Synthesis'). Code + DB now agree on the live name.
    channelName: "Sovereign Synthesis",
  },
  containment_field: {
    label: "The Containment Field",
    channelId: "UCLHJIIEjavmrS3R70xnCD1Q",
    channelName: "The Containment Field",
  },
};

// Look-back window for analytics. 90 days gives plenty of headroom for the
// 30-video A/B/C test while keeping payload sizes reasonable.
const LOOKBACK_DAYS = 90;
const RE_CONSENT_HINT =
  "Re-consent required: visit https://console.cloud.google.com/apis/credentials, " +
  "regenerate refresh tokens with scope " +
  "'https://www.googleapis.com/auth/yt-analytics.readonly' added " +
  "(in addition to the existing youtube.readonly), then update " +
  "YOUTUBE_REFRESH_TOKEN and YOUTUBE_REFRESH_TOKEN_TCF in Railway env.";

// ── OAuth helper (mirrors pattern in proactive/youtube-comment-watcher.ts) ──
async function getYouTubeToken(brand: Brand): Promise<string | null> {
  const directToken = process.env.YOUTUBE_ACCESS_TOKEN;
  if (directToken) return directToken;

  const refreshToken =
    brand === "containment_field"
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
    if (!resp.ok) {
      console.warn(
        `[YTStatsFetcher] ${brand} token refresh failed: status=${resp.status} body=${(
          await resp.text().catch(() => "")
        ).slice(0, 200)}`,
      );
      return null;
    }
    const data = (await resp.json()) as { access_token?: string };
    return data.access_token || null;
  } catch (err: any) {
    console.warn(`[YTStatsFetcher] ${brand} token refresh error: ${err?.message}`);
    return null;
  }
}

// ── Generic Analytics report fetch ──
async function fetchAnalyticsReport(
  token: string,
  metrics: string,
  startDate: string,
  endDate: string,
  sortKey: string,
): Promise<{ ok: boolean; status: number; body?: any; errText?: string }> {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("metrics", metrics);
  url.searchParams.set("dimensions", "video");
  url.searchParams.set("maxResults", "200");
  url.searchParams.set("sort", sortKey);

  try {
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const errText = (await resp.text().catch(() => "")).slice(0, 400);
      return { ok: false, status: resp.status, errText };
    }
    const body = await resp.json();
    return { ok: true, status: resp.status, body };
  } catch (err: any) {
    return { ok: false, status: 0, errText: err?.message };
  }
}

// ── Patch analytics-only fields onto an existing youtube_analytics row ──
async function patchVideoStats(
  videoId: string,
  patchBody: Record<string, any>,
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  if (Object.keys(patchBody).length === 0) return false;

  // Always include updated_at so the dashboard "last fetched" widget moves.
  patchBody.updated_at = new Date().toISOString();

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/youtube_analytics?video_id=eq.${encodeURIComponent(videoId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(patchBody),
      },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Main entry: poll both brands' analytics, patch youtube_analytics rows ──
export async function pollYouTubeStats(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[YTStatsFetcher] Supabase env not configured — skipping run");
    return;
  }

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  for (const brand of Object.keys(BRAND_CONFIG) as Brand[]) {
    const cfg = BRAND_CONFIG[brand];
    const token = await getYouTubeToken(brand);
    if (!token) {
      console.log(
        `[YTStatsFetcher] ${cfg.label}: no OAuth token (env not set or refresh failed) — skipping`,
      );
      continue;
    }

    // ── Pass 1: views + retention (averageViewPercentage) ──
    const retentionReport = await fetchAnalyticsReport(
      token,
      "views,averageViewPercentage,averageViewDuration",
      startDate,
      endDate,
      "-views",
    );

    if (!retentionReport.ok) {
      const status = retentionReport.status;
      const body = retentionReport.errText || "";
      // 403 with "scope" or "insufficient" → tokens missing yt-analytics.readonly.
      if (status === 403 && /scope|insufficient/i.test(body)) {
        console.error(
          `[YTStatsFetcher] ${cfg.label}: OAuth tokens missing yt-analytics.readonly scope. ${RE_CONSENT_HINT}`,
        );
      } else {
        console.error(
          `[YTStatsFetcher] ${cfg.label} retention fetch failed: status=${status} body=${body}`,
        );
      }
      continue;
    }

    const rData = retentionReport.body || {};
    const rHeaders: string[] = (rData.columnHeaders || []).map((h: any) => h.name);
    const rVideoIdx = rHeaders.indexOf("video");
    const rPctIdx = rHeaders.indexOf("averageViewPercentage");
    const rDurIdx = rHeaders.indexOf("averageViewDuration");
    const rRows: any[][] = rData.rows || [];

    let retentionPatched = 0;
    for (const row of rRows) {
      const videoId = String(row[rVideoIdx] ?? "");
      if (!videoId) continue;
      const avgPct = rPctIdx >= 0 ? Number(row[rPctIdx]) : null;
      const avgDur = rDurIdx >= 0 ? Number(row[rDurIdx]) : null;

      const patchBody: Record<string, any> = {};
      if (avgPct !== null && Number.isFinite(avgPct)) {
        // averageViewPercentage is already 0-100. youtube_analytics.retention
        // is numeric — store as percentage value to match existing convention.
        patchBody.retention = Math.round(avgPct * 100) / 100;
      }
      // averageViewDuration goes nowhere yet — the youtube_analytics table has
      // no watch_time_s column. Skip until the column is added.
      void avgDur;

      if (await patchVideoStats(videoId, patchBody)) retentionPatched += 1;
    }

    console.log(
      `[YTStatsFetcher] ${cfg.label}: retention patched ${retentionPatched}/${rRows.length} videos`,
    );

    // ── Pass 2: impressions + CTR (impressionClickThroughRate) ──
    const ctrReport = await fetchAnalyticsReport(
      token,
      "impressions,impressionClickThroughRate",
      startDate,
      endDate,
      "-impressions",
    );

    if (!ctrReport.ok) {
      // CTR/impressions are sometimes restricted on small channels or recently
      // created channels even when retention works. Log warn, don't bail.
      console.warn(
        `[YTStatsFetcher] ${cfg.label} CTR fetch non-fatal: status=${ctrReport.status} body=${ctrReport.errText}`,
      );
      continue;
    }

    const cData = ctrReport.body || {};
    const cHeaders: string[] = (cData.columnHeaders || []).map((h: any) => h.name);
    const cVideoIdx = cHeaders.indexOf("video");
    const cImpIdx = cHeaders.indexOf("impressions");
    const cCtrIdx = cHeaders.indexOf("impressionClickThroughRate");
    const cRows: any[][] = cData.rows || [];

    let ctrPatched = 0;
    for (const row of cRows) {
      const videoId = String(row[cVideoIdx] ?? "");
      if (!videoId) continue;
      const impressions = cImpIdx >= 0 ? Number(row[cImpIdx]) : null;
      const ctr = cCtrIdx >= 0 ? Number(row[cCtrIdx]) : null;

      const patchBody: Record<string, any> = {};
      if (impressions !== null && Number.isFinite(impressions) && impressions >= 0) {
        patchBody.impressions = Math.round(impressions);
      }
      if (ctr !== null && Number.isFinite(ctr) && ctr >= 0) {
        // impressionClickThroughRate is returned as a percentage already (0-100).
        patchBody.ctr = Math.round(ctr * 100) / 100;
      }

      if (await patchVideoStats(videoId, patchBody)) ctrPatched += 1;
    }

    console.log(
      `[YTStatsFetcher] ${cfg.label}: ctr/impressions patched ${ctrPatched}/${cRows.length} videos`,
    );
  }
}
