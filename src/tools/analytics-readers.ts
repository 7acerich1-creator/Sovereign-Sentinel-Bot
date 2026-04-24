// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Supabase Analytics Reader Tools
// Session 108: Vector had Stripe + Buffer tools but couldn't
// read the youtube_analytics or landing_analytics tables that
// the Edge Functions populate daily. Now he can.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function supabaseQuery(table: string, params: string = ""): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase not configured (SUPABASE_URL or key missing).");
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const resp = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Supabase ${resp.status}: ${errText.slice(0, 300)}`);
  }
  return resp.json() as Promise<any[]>;
}

// ── YouTube Analytics Reader ──
export class YouTubeAnalyticsReaderTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_analytics",
    description:
      "Read YouTube video performance data from the youtube_analytics table. " +
      "Returns views, likes, comments, impressions, CTR, retention, outlier scores " +
      "for both channels (Sovereign Synthesis + The Containment Field). " +
      "Data is fetched daily from YouTube Data API v3 by an Edge Function.",
    parameters: {
      report: {
        type: "string",
        description:
          "Report type: 'summary' (aggregate stats per channel), " +
          "'top_videos' (best performers by views), " +
          "'outliers' (highest outlier scores — viral potential), " +
          "'recent' (most recently published videos). Default: summary",
      },
      channel: {
        type: "string",
        description:
          "Filter by channel: 'sovereign_synthesis', 'containment_field', or 'all' (default: all)",
      },
      limit: {
        type: "number",
        description: "Number of videos to return for non-summary reports (default 10, max 50)",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return "❌ Supabase not configured. Cannot read YouTube analytics.";
    }

    const report = String(args.report || "summary");
    const channel = String(args.channel || "all");
    const limit = Math.min(Number(args.limit) || 10, 50);

    try {
      // Build channel filter
      let channelFilter = "";
      if (channel === "sovereign_synthesis") {
        channelFilter = "&channel_name=neq.The Containment Field";
      } else if (channel === "containment_field") {
        channelFilter = "&channel_name=eq.The Containment Field";
      }

      switch (report) {
        case "summary": {
          const rows = await supabaseQuery(
            "youtube_analytics",
            `select=channel_name,views,likes,comments,impressions,ctr,retention,outlier_score${channelFilter}`
          );
          if (rows.length === 0) return "No YouTube analytics data found.";

          // Aggregate by channel
          const channels: Record<string, {
            videos: number; totalViews: number; totalLikes: number;
            totalComments: number; totalImpressions: number;
            avgCTR: number; avgRetention: number; avgOutlier: number;
            ctrCount: number; retCount: number; outlierCount: number;
          }> = {};

          for (const r of rows) {
            const ch = r.channel_name || "Unknown";
            if (!channels[ch]) {
              channels[ch] = {
                videos: 0, totalViews: 0, totalLikes: 0, totalComments: 0,
                totalImpressions: 0, avgCTR: 0, avgRetention: 0, avgOutlier: 0,
                ctrCount: 0, retCount: 0, outlierCount: 0,
              };
            }
            const c = channels[ch];
            c.videos++;
            c.totalViews += r.views || 0;
            c.totalLikes += r.likes || 0;
            c.totalComments += r.comments || 0;
            c.totalImpressions += r.impressions || 0;
            if (r.ctr != null) { c.avgCTR += Number(r.ctr); c.ctrCount++; }
            if (r.retention != null) { c.avgRetention += Number(r.retention); c.retCount++; }
            if (r.outlier_score != null) { c.avgOutlier += Number(r.outlier_score); c.outlierCount++; }
          }

          const lines: string[] = ["📊 YOUTUBE ANALYTICS SUMMARY"];
          for (const [name, c] of Object.entries(channels)) {
            lines.push(`\n── ${name} ──`);
            lines.push(`Videos tracked: ${c.videos}`);
            lines.push(`Total views: ${c.totalViews.toLocaleString()}`);
            lines.push(`Total likes: ${c.totalLikes.toLocaleString()}`);
            lines.push(`Total comments: ${c.totalComments.toLocaleString()}`);
            lines.push(`Total impressions: ${c.totalImpressions.toLocaleString()}`);
            if (c.ctrCount > 0) lines.push(`Avg CTR: ${(c.avgCTR / c.ctrCount).toFixed(2)}%`);
            if (c.retCount > 0) lines.push(`Avg retention: ${(c.avgRetention / c.retCount).toFixed(1)}%`);
            if (c.outlierCount > 0) lines.push(`Avg outlier score: ${(c.avgOutlier / c.outlierCount).toFixed(2)}`);
          }
          return lines.join("\n");
        }

        case "top_videos": {
          const rows = await supabaseQuery(
            "youtube_analytics",
            `select=title,channel_name,views,likes,comments,outlier_score,published_at${channelFilter}&order=views.desc&limit=${limit}`
          );
          if (rows.length === 0) return "No videos found.";
          const lines = [`📊 TOP ${rows.length} VIDEOS BY VIEWS`];
          for (const r of rows) {
            lines.push(`\n• "${r.title}" [${r.channel_name}]`);
            lines.push(`  Views: ${(r.views || 0).toLocaleString()} | Likes: ${r.likes || 0} | Comments: ${r.comments || 0}`);
            if (r.outlier_score != null) lines.push(`  Outlier: ${Number(r.outlier_score).toFixed(2)}`);
          }
          return lines.join("\n");
        }

        case "outliers": {
          const rows = await supabaseQuery(
            "youtube_analytics",
            `select=title,channel_name,views,outlier_score,impressions,ctr${channelFilter}&outlier_score=not.is.null&order=outlier_score.desc&limit=${limit}`
          );
          if (rows.length === 0) return "No outlier data available.";
          const lines = [`🔥 TOP ${rows.length} OUTLIER VIDEOS (viral potential)`];
          for (const r of rows) {
            lines.push(`\n• "${r.title}" [${r.channel_name}]`);
            lines.push(`  Outlier: ${Number(r.outlier_score).toFixed(2)} | Views: ${(r.views || 0).toLocaleString()}`);
            if (r.impressions) lines.push(`  Impressions: ${r.impressions.toLocaleString()} | CTR: ${r.ctr || "N/A"}%`);
          }
          return lines.join("\n");
        }

        case "recent": {
          const rows = await supabaseQuery(
            "youtube_analytics",
            `select=title,channel_name,views,likes,published_at,video_type${channelFilter}&order=published_at.desc&limit=${limit}`
          );
          if (rows.length === 0) return "No recent videos found.";
          const lines = [`📅 MOST RECENT ${rows.length} VIDEOS`];
          for (const r of rows) {
            const pubDate = r.published_at ? new Date(r.published_at).toLocaleDateString() : "Unknown";
            lines.push(`\n• "${r.title}" [${r.channel_name}] (${r.video_type || "video"})`);
            lines.push(`  Published: ${pubDate} | Views: ${(r.views || 0).toLocaleString()} | Likes: ${r.likes || 0}`);
          }
          return lines.join("\n");
        }

        default:
          return `Unknown report type: ${report}. Use: summary, top_videos, outliers, recent`;
      }
    } catch (err: any) {
      return `❌ YouTube analytics query failed: ${err.message}`;
    }
  }
}

// ── Landing/Vercel Analytics Reader ──
export class LandingAnalyticsReaderTool implements Tool {
  definition: ToolDefinition = {
    name: "landing_analytics",
    description:
      "Read landing page analytics from the landing_analytics table. " +
      "Returns page views, visitors, bounce rate, avg session duration, referrers, " +
      "countries, and devices for sovereign-synthesis.com. " +
      "Data is fetched daily from Vercel Web Analytics by an Edge Function.",
    parameters: {
      report: {
        type: "string",
        description:
          "Report type: 'summary' (aggregate totals), " +
          "'pages' (top pages by views), " +
          "'referrers' (traffic sources), " +
          "'recent' (latest data points). Default: summary",
      },
      days: {
        type: "number",
        description: "Look-back period in days (default 7, max 30)",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return "❌ Supabase not configured. Cannot read landing analytics.";
    }

    const report = String(args.report || "summary");
    const days = Math.min(Number(args.days) || 7, 30);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
      switch (report) {
        case "summary": {
          const rows = await supabaseQuery(
            "landing_analytics",
            `select=page_path,visitors,page_views,bounce_rate,avg_duration_seconds&fetched_at=gte.${since}`
          );
          if (rows.length === 0) return `No landing analytics data in the last ${days} days.`;

          let totalVisitors = 0, totalPageViews = 0;
          let totalBounce = 0, bounceCount = 0;
          let totalDuration = 0, durationCount = 0;
          const pages = new Set<string>();

          for (const r of rows) {
            totalVisitors += r.visitors || 0;
            totalPageViews += r.page_views || 0;
            if (r.bounce_rate != null) { totalBounce += Number(r.bounce_rate); bounceCount++; }
            if (r.avg_duration_seconds != null) { totalDuration += Number(r.avg_duration_seconds); durationCount++; }
            if (r.page_path) pages.add(r.page_path);
          }

          const lines = [
            `🌐 LANDING ANALYTICS SUMMARY (last ${days} days)`,
            `Total visitors: ${totalVisitors.toLocaleString()}`,
            `Total page views: ${totalPageViews.toLocaleString()}`,
            `Unique pages tracked: ${pages.size}`,
          ];
          if (bounceCount > 0) lines.push(`Avg bounce rate: ${(totalBounce / bounceCount).toFixed(1)}%`);
          if (durationCount > 0) lines.push(`Avg session duration: ${(totalDuration / durationCount).toFixed(1)}s`);
          return lines.join("\n");
        }

        case "pages": {
          const rows = await supabaseQuery(
            "landing_analytics",
            `select=page_path,visitors,page_views,bounce_rate,avg_duration_seconds&fetched_at=gte.${since}&order=page_views.desc&limit=20`
          );
          if (rows.length === 0) return "No page data available.";
          const lines = [`📄 TOP PAGES (last ${days} days)`];
          for (const r of rows) {
            lines.push(`\n• ${r.page_path}`);
            lines.push(`  Views: ${r.page_views || 0} | Visitors: ${r.visitors || 0} | Bounce: ${r.bounce_rate != null ? Number(r.bounce_rate).toFixed(1) + "%" : "N/A"}`);
          }
          return lines.join("\n");
        }

        case "referrers": {
          const rows = await supabaseQuery(
            "landing_analytics",
            `select=referrer,visitors,page_views&fetched_at=gte.${since}&referrer=not.is.null&order=visitors.desc&limit=15`
          );
          if (rows.length === 0) return "No referrer data available.";
          const lines = [`🔗 TOP REFERRERS (last ${days} days)`];
          for (const r of rows) {
            lines.push(`• ${r.referrer || "Direct"}: ${r.visitors || 0} visitors, ${r.page_views || 0} views`);
          }
          return lines.join("\n");
        }

        case "recent": {
          const rows = await supabaseQuery(
            "landing_analytics",
            `select=page_path,visitors,page_views,fetched_at&order=fetched_at.desc&limit=10`
          );
          if (rows.length === 0) return "No recent landing data.";
          const lines = ["📅 MOST RECENT LANDING DATA"];
          for (const r of rows) {
            const date = new Date(r.fetched_at).toLocaleDateString();
            lines.push(`• ${date} — ${r.page_path}: ${r.page_views || 0} views, ${r.visitors || 0} visitors`);
          }
          return lines.join("\n");
        }

        default:
          return `Unknown report type: ${report}. Use: summary, pages, referrers, recent`;
      }
    } catch (err: any) {
      return `❌ Landing analytics query failed: ${err.message}`;
    }
  }
}
