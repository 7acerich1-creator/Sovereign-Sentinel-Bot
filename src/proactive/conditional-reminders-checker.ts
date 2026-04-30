// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Conditional Reminders Checker — S125+ Phase 2 (2026-04-30)
//
// Reads public.conditional_reminders every 15 min, evaluates each active row's
// condition against the current value of its metric_source, fires Telegram
// alerts when crossings occur, marks them 'fired'.
//
// Architecture:
//   1. Sweep expired rows (status='expired' if past expires_at).
//   2. Read all status='active' rows.
//   3. Group by metric_source (so we hit each source ONCE per run, not once
//      per row — matters when multiple reminders watch the same metric).
//   4. For each unique metric_source, fetch current value via METRIC_FETCHERS.
//   5. Evaluate each row against the value. On cross: atomic UPDATE to
//      status='fired' (the WHERE clause has status='active' to prevent
//      double-fire from concurrent runs), then send Telegram via Sapphire's
//      channel.
//
// Adding a new metric: extend METRIC_FETCHERS + the METRIC_SOURCES list in
// src/tools/sapphire/conditional_reminders.ts (must match).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

// ── Types ───────────────────────────────────────────────────────────────────

interface ReminderRow {
  id: string;
  chat_id: string;
  metric_source: string;
  comparison_op: string;
  threshold: number;
  message: string;
  last_observed_value: number | null;
  expires_at: string | null;
}

// ── Supabase helper ─────────────────────────────────────────────────────────

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// ── Stripe helper ───────────────────────────────────────────────────────────
// Direct fetch with Stripe's nested-key filter syntax (created[gte]={epoch}).
// URLSearchParams doesn't nest natively, so we build the URL by hand.

async function stripeRevenueSince(epochSeconds: number): Promise<number> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured.");
  // Direct fetch with proper nested-key syntax for Stripe's filter.
  const url = `https://api.stripe.com/v1/charges?created%5Bgte%5D=${epochSeconds}&limit=100`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Stripe ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data: any = await resp.json();
  const charges: any[] = data?.data || [];
  let total = 0;
  for (const c of charges) {
    if (c.status === "succeeded") total += (Number(c.amount) || 0) / 100;
  }
  return total;
}

// ── Metric Fetchers ─────────────────────────────────────────────────────────
// Each fetcher returns the current numeric value or throws on error. The
// runner catches errors per-fetcher so one bad source doesn't break the run.

const METRIC_FETCHERS: Record<string, () => Promise<number>> = {
  // ── Stripe — financial coordinate-tracking ──
  stripe_revenue_total: async () => {
    // Lifetime gross — Stripe doesn't have a single "lifetime revenue" endpoint.
    // We approximate via /charges with no time filter (returns recent 100 by default).
    // For real lifetime, use Reporting API or aggregate over multiple paginated calls.
    // For S125+ Phase 2 launch, "trailing 365 days" is a reasonable proxy.
    const since = Math.floor(Date.now() / 1000) - (365 * 86400);
    return stripeRevenueSince(since);
  },
  stripe_revenue_30d: async () => stripeRevenueSince(Math.floor(Date.now() / 1000) - (30 * 86400)),
  stripe_revenue_today: async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return stripeRevenueSince(Math.floor(start.getTime() / 1000));
  },
  // ── YouTube — top-of-funnel attention ──
  youtube_subs_total: async () => {
    const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("YOUTUBE_API_KEY/GOOGLE_API_KEY not set.");
    const ssChannelId = process.env.YT_SS_CHANNEL_ID;
    const tcfChannelId = process.env.YT_TCF_CHANNEL_ID;
    if (!ssChannelId && !tcfChannelId) throw new Error("Neither YT_SS_CHANNEL_ID nor YT_TCF_CHANNEL_ID set.");

    let total = 0;
    for (const id of [ssChannelId, tcfChannelId].filter(Boolean)) {
      const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${id}&key=${apiKey}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) continue;
      const data: any = await resp.json();
      const subs = Number(data?.items?.[0]?.statistics?.subscriberCount || 0);
      total += subs;
    }
    return total;
  },
  youtube_views_28d: async () => {
    // YouTube Data API doesn't expose 28d views without the Analytics API + OAuth.
    // For Phase 2 launch, we use the Supabase-cached values written by the existing
    // youtube-stats-fetcher proactive job. If that job hasn't populated yet, return 0.
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("youtube_stats_cache")
      .select("views_28d, channel")
      .order("captured_at", { ascending: false })
      .limit(2);
    return (data || []).reduce((sum: number, row: any) => sum + (Number(row.views_28d) || 0), 0);
  },
  // ── Funnel — lead capture ──
  initiates_count: async () => {
    const supabase = await getSupabase();
    const { count } = await supabase
      .from("initiates")
      .select("id", { count: "exact", head: true });
    return count || 0;
  },
  // ── Self-monitoring — agent_spend (Phase 1's spend logger feeds this) ──
  agent_spend_today: async () => {
    const supabase = await getSupabase();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("agent_spend")
      .select("total_cost_usd")
      .gte("created_at", start.toISOString());
    return (data || []).reduce((sum: number, row: any) => sum + (Number(row.total_cost_usd) || 0), 0);
  },
  agent_spend_this_month: async () => {
    const supabase = await getSupabase();
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("agent_spend")
      .select("total_cost_usd")
      .gte("created_at", start.toISOString());
    return (data || []).reduce((sum: number, row: any) => sum + (Number(row.total_cost_usd) || 0), 0);
  },
  // ── Sovereign metrics — the mission counters ──
  sovereign_metrics_fiscal_sum: async () => {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("sovereign_metrics")
      .select("fiscal_sum")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return Number(data?.fiscal_sum || 0);
  },
  sovereign_metrics_mindset_count: async () => {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("sovereign_metrics")
      .select("mindset_count")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return Number(data?.mindset_count || 0);
  },
  sovereign_metrics_elite_count: async () => {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("sovereign_metrics")
      .select("elite_count")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return Number(data?.elite_count || 0);
  },
  sovereign_metrics_velocity: async () => {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("sovereign_metrics")
      .select("velocity")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return Number(data?.velocity || 0);
  },
};

// ── Condition evaluator ─────────────────────────────────────────────────────

function evaluateCondition(observed: number, op: string, threshold: number): boolean {
  switch (op) {
    case ">=": return observed >= threshold;
    case ">": return observed > threshold;
    case "=": return observed === threshold;
    case "<": return observed < threshold;
    case "<=": return observed <= threshold;
    default: return false;
  }
}

// ── Main runner ─────────────────────────────────────────────────────────────

export async function runConditionalRemindersCheck(channel: any): Promise<void> {
  const supabase = await getSupabase();
  const startedAt = Date.now();

  // 1. Expire any past-expires_at active rows
  await supabase
    .from("conditional_reminders")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString())
    .not("expires_at", "is", null);

  // 2. Read all currently-active rows
  const { data: activeRows, error: readErr } = await supabase
    .from("conditional_reminders")
    .select("id, chat_id, metric_source, comparison_op, threshold, message, last_observed_value, expires_at")
    .eq("status", "active");

  if (readErr) {
    console.error(`[ConditionalReminders] read error: ${readErr.message}`);
    return;
  }
  const rows = (activeRows || []) as ReminderRow[];
  if (rows.length === 0) return; // nothing to do

  // 3. Group by metric_source for batched reads
  const bySource = new Map<string, ReminderRow[]>();
  for (const r of rows) {
    if (!bySource.has(r.metric_source)) bySource.set(r.metric_source, []);
    bySource.get(r.metric_source)!.push(r);
  }

  let firedCount = 0;
  let checkedCount = 0;
  let errorCount = 0;

  // 4. For each unique metric, fetch once and evaluate against all rows watching it
  for (const [metric, watchers] of bySource.entries()) {
    const fetcher = METRIC_FETCHERS[metric];
    if (!fetcher) {
      console.warn(`[ConditionalReminders] no fetcher for metric '${metric}', skipping ${watchers.length} reminder(s)`);
      continue;
    }

    let observed: number;
    try {
      observed = await fetcher();
    } catch (e: any) {
      console.warn(`[ConditionalReminders] fetcher '${metric}' threw: ${e.message}`);
      errorCount += watchers.length;
      continue;
    }

    // Touch last_checked_at + last_observed_value for all watchers of this metric
    await supabase
      .from("conditional_reminders")
      .update({ last_checked_at: new Date().toISOString(), last_observed_value: observed })
      .eq("status", "active")
      .eq("metric_source", metric);

    for (const r of watchers) {
      checkedCount++;
      const crossed = evaluateCondition(observed, r.comparison_op, r.threshold);
      if (!crossed) continue;

      // 5. Atomic UPDATE — only fires if still active. Prevents double-fire.
      const { data: updateRes, error: updErr } = await supabase
        .from("conditional_reminders")
        .update({
          status: "fired",
          fired_at: new Date().toISOString(),
          last_observed_value: observed,
        })
        .eq("id", r.id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();

      if (updErr) {
        console.warn(`[ConditionalReminders] update failed for ${r.id}: ${updErr.message}`);
        continue;
      }
      if (!updateRes) {
        // Row was already moved out of 'active' by another concurrent run — skip
        continue;
      }

      // 6. Fire the Telegram alert
      try {
        const opSymbol = r.comparison_op;
        const text =
          `🔔 *Conditional alert fired*\n\n` +
          `${r.message}\n\n` +
          `_${r.metric_source} ${opSymbol} ${r.threshold} (observed: ${observed})_`;
        await channel.sendMessage(r.chat_id, text, { parseMode: "Markdown" });
        firedCount++;
      } catch (sendErr: any) {
        console.error(`[ConditionalReminders] Telegram send failed for ${r.id}: ${sendErr.message}`);
        // Don't revert status — the row WAS evaluated, just the notify failed.
        // Next-pass will skip (it's now 'fired'). Architect can recreate if needed.
      }
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[ConditionalReminders] checked ${checkedCount} rows across ${bySource.size} metrics, ` +
    `fired ${firedCount}, errors ${errorCount}, ${elapsed}s`,
  );
}
