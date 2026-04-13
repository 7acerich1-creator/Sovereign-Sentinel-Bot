// ============================================================
// FETCH LANDING ANALYTICS — Vercel Web Analytics → Supabase
// Session 50 - 2026-04-13
// Runs on cron (daily) or manual invoke. Pulls last 24h of
// Vercel Web Analytics data and writes to landing_analytics.
// Requires: VERCEL_API_TOKEN, VERCEL_PROJECT_ID in Supabase
// Edge Function secrets.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERCEL_TOKEN = Deno.env.get("VERCEL_API_TOKEN");
const VERCEL_PROJECT = Deno.env.get("VERCEL_PROJECT_ID");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface VercelAnalyticsRow {
  key: string;
  total: number;
  devices?: number;
}

async function fetchVercelAnalytics(
  endpoint: string,
  params: Record<string, string>
): Promise<any> {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT) return null;

  const url = new URL(`https://vercel.com/api/web/insights/${endpoint}`);
  url.searchParams.set("projectId", VERCEL_PROJECT);
  url.searchParams.set("environment", "production");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });

  if (!resp.ok) {
    console.error(`Vercel API ${endpoint} failed: ${resp.status}`);
    return null;
  }

  return resp.json();
}

Deno.serve(async (req) => {
  try {
    if (!VERCEL_TOKEN || !VERCEL_PROJECT) {
      return new Response(
        JSON.stringify({ error: "VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Time window: last 24 hours
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const periodStart = yesterday.toISOString();
    const periodEnd = now.toISOString();
    const timeParams = { from: periodStart, to: periodEnd };

    // Fetch page views by path
    const pageData = await fetchVercelAnalytics("stats/path", timeParams);

    // Fetch referrers
    const refData = await fetchVercelAnalytics("stats/referrer", timeParams);

    // Fetch devices
    const deviceData = await fetchVercelAnalytics("stats/device", timeParams);

    // Fetch countries
    const countryData = await fetchVercelAnalytics("stats/country", timeParams);

    const rows: any[] = [];

    // Page-level rows
    if (pageData?.data) {
      for (const item of pageData.data as VercelAnalyticsRow[]) {
        rows.push({
          page_path: item.key || "/",
          page_views: item.total || 0,
          visitors: item.devices || 0,
          period_start: periodStart,
          period_end: periodEnd,
        });
      }
    }

    // If no page data, write a single summary row so dashboard always has data
    if (rows.length === 0) {
      rows.push({
        page_path: "/",
        page_views: 0,
        visitors: 0,
        period_start: periodStart,
        period_end: periodEnd,
      });
    }

    // Enrich first row with top referrer + device + country
    if (refData?.data?.[0]) {
      rows[0].referrer = refData.data[0].key || "direct";
    }
    if (deviceData?.data?.[0]) {
      rows[0].device = deviceData.data[0].key || "unknown";
    }
    if (countryData?.data?.[0]) {
      rows[0].country = countryData.data[0].key || "unknown";
    }

    // Write to Supabase
    const { error } = await supabase.from("landing_analytics").insert(rows);
    if (error) {
      console.error("Supabase insert error:", error.message);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        rows_written: rows.length,
        period: { start: periodStart, end: periodEnd },
        sample: rows[0],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
