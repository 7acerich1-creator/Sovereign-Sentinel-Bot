// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Channel Milestone Sync (Vector layer)
// Session 117 (2026-04-25) — Patches channel_milestones.current_value from
// live data sources and auto-advances to the next sub-milestone when a
// target is hit.
//
// Per MAVEN-CREW-DIRECTIVES.md §10.1 + §7 — Vector owns the measurement
// layer; this module IS that measurement for the milestone tracker. Runs
// inside Vector's daily 17:00 UTC sweep cron (registered separately in
// index.ts).
//
// Metrics handled today:
//   - subs                  → YouTube Data API v3 channels.list?part=statistics
//   - watch_hours           → youtube_analytics aggregate over channel
//   - video_views           → youtube_analytics MAX(views) per channel
//   - cross_traffic_leads   → initiates count where source LIKE 'tcf-%'
//
// When a milestone closes (current_value >= target_value): status='achieved',
// achieved_at = NOW(), and the next 'future' sub-milestone in the same
// parent_id (lowest display_order) is activated.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";
import { voicedDM } from "../channels/agent-voice";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

type ChannelKey = "sovereign_synthesis" | "containment_field";

const CHANNEL_IDS: Record<ChannelKey, string> = {
  sovereign_synthesis: "UCbj9a6brDL9hNIY1BpxOJfQ",
  containment_field: "UCLHJIIEjavmrS3R70xnCD1Q",
};

// ── OAuth helper (mirrors youtube-stats-fetcher pattern) ──
async function getYouTubeToken(channel: ChannelKey): Promise<string | null> {
  const direct = process.env.YOUTUBE_ACCESS_TOKEN;
  if (direct) return direct;
  const refresh =
    channel === "containment_field"
      ? process.env.YOUTUBE_REFRESH_TOKEN_TCF
      : process.env.YOUTUBE_REFRESH_TOKEN;
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) return null;
  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { access_token?: string };
    return data.access_token || null;
  } catch {
    return null;
  }
}

// ── Live subscriber count from YT Data API ──
async function fetchSubscriberCount(channel: ChannelKey): Promise<number | null> {
  const token = await getYouTubeToken(channel);
  if (!token) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL_IDS[channel]}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const subs = data?.items?.[0]?.statistics?.subscriberCount;
    return subs != null ? Number(subs) : null;
  } catch {
    return null;
  }
}

// ── Watch hours from YouTube Analytics API (12-month rolling window) ──
// AdSense Gate uses rolling-12-month watch hours, so we query that exact
// window. Endpoint: youtubeanalytics.googleapis.com/v2/reports with
// metric=estimatedMinutesWatched, dimensionless (channel-total).
async function fetchWatchHours(channel: ChannelKey): Promise<number | null> {
  const token = await getYouTubeToken(channel);
  if (!token) return null;
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    url.searchParams.set("ids", "channel==MINE");
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
    url.searchParams.set("metrics", "estimatedMinutesWatched");
    const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      const errText = (await resp.text().catch(() => "")).slice(0, 200);
      console.warn(`[MilestoneSync] watch_hours fetch failed for ${channel}: ${resp.status} ${errText}`);
      return null;
    }
    const data = (await resp.json()) as any;
    // Response shape: { columnHeaders: [...], rows: [[<minutes>]] }
    const minutes = Number(data?.rows?.[0]?.[0]);
    if (!Number.isFinite(minutes)) return null;
    return Math.round(minutes / 60);
  } catch {
    return null;
  }
}

// ── Top video views (single best video) from youtube_analytics ──
async function fetchTopVideoViews(channel: ChannelKey): Promise<number | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const channelName = channel === "containment_field" ? "The Containment Field" : "Ace Richie";
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/youtube_analytics?select=views&channel_name=eq.${encodeURIComponent(channelName)}&order=views.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{ views: number | null }>;
    return rows[0]?.views != null ? Number(rows[0].views) : 0;
  } catch {
    return null;
  }
}

// ── Cross-traffic lead count from initiates ──
async function fetchCrossTrafficLeads(): Promise<number | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    // Count initiates where source indicates Containment Field origin.
    // sovereign-landing rewrite tags TCF traffic as `tcf-%` or via UTM.
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/initiates?select=id&source=ilike.tcf%25`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "count=exact",
        },
      },
    );
    if (!resp.ok) return null;
    const contentRange = resp.headers.get("content-range") || "";
    const total = parseInt(contentRange.split("/")[1] || "0", 10);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return null;
  }
}

interface MilestoneRow {
  id: string;
  channel: ChannelKey;
  tier: number;
  parent_id: string | null;
  name: string;
  target_metric: string;
  target_value: number;
  current_value: number;
  status: string;
  display_order: number;
}

async function loadActiveMilestones(): Promise<MilestoneRow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_milestones?select=id,channel,tier,parent_id,name,target_metric,target_value,current_value,status,display_order&status=eq.active`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!resp.ok) return [];
    return (await resp.json()) as MilestoneRow[];
  } catch {
    return [];
  }
}

async function patchMilestoneValue(id: string, currentValue: number): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/channel_milestones?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ current_value: currentValue }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Mark closed + activate the next sibling sub-milestone in the same parent.
async function closeMilestoneAndAdvance(closed: MilestoneRow): Promise<{ closedName: string; nextActivatedName?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { closedName: closed.name };

  // 1. Mark closed
  await fetch(`${SUPABASE_URL}/rest/v1/channel_milestones?id=eq.${closed.id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ status: "achieved", achieved_at: new Date().toISOString() }),
  });

  // 2. Find next future sub-milestone in same parent (or next future at same tier if no parent)
  const parentClause = closed.parent_id
    ? `parent_id=eq.${closed.parent_id}`
    : `parent_id=is.null&channel=eq.${closed.channel}&tier=eq.${closed.tier + 1}`;
  const nextResp = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_milestones?select=id,name,display_order&${parentClause}&status=eq.future&order=display_order.asc&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!nextResp.ok) return { closedName: closed.name };
  const nextRows = (await nextResp.json()) as Array<{ id: string; name: string }>;
  if (nextRows.length === 0) return { closedName: closed.name };
  const next = nextRows[0];

  // 3. Activate it
  await fetch(`${SUPABASE_URL}/rest/v1/channel_milestones?id=eq.${next.id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      status: "active",
      hidden_until_active: false,
      activated_at: new Date().toISOString(),
    }),
  });

  return { closedName: closed.name, nextActivatedName: next.name };
}

// ── Main entry: run a full milestone sync sweep ──
export async function runMilestoneSync(opts: {
  alertChannel?: Channel;
  alertChatId?: string;
} = {}): Promise<{ patched: number; closed: number; details: string[] }> {
  const milestones = await loadActiveMilestones();
  if (milestones.length === 0) return { patched: 0, closed: 0, details: ["no active milestones"] };

  // Cache external metric pulls so we don't re-fetch per milestone
  const cache: Partial<Record<string, number>> = {};

  const getValue = async (m: MilestoneRow): Promise<number | null> => {
    const key = `${m.channel}:${m.target_metric}`;
    if (cache[key] != null) return cache[key]!;
    let v: number | null = null;
    switch (m.target_metric) {
      case "subs":
      case "subs_and_watch_hours":
        v = await fetchSubscriberCount(m.channel);
        break;
      case "watch_hours":
        v = await fetchWatchHours(m.channel);
        break;
      case "video_views":
        v = await fetchTopVideoViews(m.channel);
        break;
      case "cross_traffic_leads":
        v = await fetchCrossTrafficLeads();
        break;
    }
    if (v != null) cache[key] = v;
    return v;
  };

  let patched = 0;
  let closed = 0;
  const details: string[] = [];

  for (const m of milestones) {
    const newValue = await getValue(m);
    if (newValue == null) {
      details.push(`skip ${m.channel}/${m.name}: metric "${m.target_metric}" unavailable`);
      continue;
    }
    if (newValue !== Number(m.current_value)) {
      await patchMilestoneValue(m.id, newValue);
      patched++;
      details.push(`patched ${m.channel}/${m.name}: ${m.current_value} → ${newValue} / ${m.target_value}`);
    }
    if (newValue >= Number(m.target_value)) {
      const result = await closeMilestoneAndAdvance({ ...m, current_value: newValue });
      closed++;
      details.push(
        result.nextActivatedName
          ? `🎯 closed ${m.channel}/${result.closedName} → activated ${result.nextActivatedName}`
          : `🎯 closed ${m.channel}/${result.closedName} (no next milestone in parent)`,
      );
    }
  }

  // Optional alert if anything closed — voiced through Vector (S121)
  if (closed > 0 && opts.alertChannel && opts.alertChatId) {
    const closures = details.filter((d) => d.startsWith("🎯")).join("\n");
    const fallback = `🎯 *Milestone closures (${closed})*\n\n${closures}`;
    const voiced = await voicedDM("vector", {
      action: `${closed} channel milestone${closed === 1 ? "" : "s"} just closed`,
      detail: closures,
      metric: closed === 1 ? "subscribers" : "MRR",
    }, fallback);
    try {
      await opts.alertChannel.sendMessage(opts.alertChatId, voiced, { parseMode: "Markdown" });
    } catch {}
  }

  console.log(`[MilestoneSync] patched=${patched} closed=${closed} details=${details.join(" | ")}`);
  return { patched, closed, details };
}
