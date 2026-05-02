// ============================================================
// BOT HEALTH CANARY — SELF-HEALING LAYER 4
// S126 — 2026-04-30
//
// Runs every 10 minutes via pg_cron (or external scheduler).
// Catches the "container alive but bot dead" failure mode:
// Railway shows the build green, but Sapphire stopped answering.
//
// Two pulses per run:
//   1. getMe pulse — hits Telegram's `getMe` endpoint with
//      Sapphire's bot token. Confirms her token is valid AND
//      Telegram's API is reachable. Latency-tracked.
//   2. spend-freshness pulse — checks for any agent_spend row
//      from any agent in the last `STALE_THRESHOLD_MIN` minutes.
//      No spend rows means no agent has answered any message —
//      either dead or no traffic. Combined with getMe ok, this
//      is "alive but silent" — we alert if it's been >2h with
//      no inbound traffic AND it's during waking hours (Ace
//      wakes ~2pm CDT, sleeps ~6-8am CDT — see user_schedule.md
//      memory).
//
// Alerts go through Sapphire's bot to Architect's chat. Each alert
// kind is rate-limited to one per hour so the canary itself can
// never become spam.
//
// All pulses logged to public.bot_health_pulses for trend analysis.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const STALE_SPEND_MIN = 120;       // 2h without ANY agent activity = suspicious
const ALERT_RATE_LIMIT_MIN = 60;   // don't re-alert same kind within 60min

type PulseStatus = "ok" | "degraded" | "dead";

type PulseResult = {
  pulse_kind: string;
  status: PulseStatus;
  latency_ms?: number;
  details?: Record<string, unknown>;
};

// ── Utilities ──

async function alreadyAlertedRecently(
  supabase: SupabaseClient,
  bot: string,
  pulseKind: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - ALERT_RATE_LIMIT_MIN * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("bot_health_pulses")
    .select("id")
    .eq("bot_name", bot)
    .eq("pulse_kind", pulseKind)
    .eq("alerted", true)
    .gte("created_at", cutoff)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function logPulse(
  supabase: SupabaseClient,
  bot: string,
  pulse: PulseResult,
  alerted: boolean,
): Promise<void> {
  try {
    await supabase.from("bot_health_pulses").insert({
      bot_name: bot,
      pulse_kind: pulse.pulse_kind,
      status: pulse.status,
      latency_ms: pulse.latency_ms ?? null,
      details: pulse.details ?? null,
      alerted,
    });
  } catch (e) {
    console.error("[Canary] logPulse failed:", e);
  }
}

async function sendTelegramAlert(text: string): Promise<boolean> {
  const token =
    Deno.env.get("SAPPHIRE_TOKEN") ||
    Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId =
    Deno.env.get("ARCHITECT_CHAT_ID") ||
    Deno.env.get("TELEGRAM_AUTHORIZED_USER_ID") ||
    "8593700720";
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        parse_mode: "Markdown",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Pulse 1: getMe ──
async function getMePulse(): Promise<PulseResult> {
  const token =
    Deno.env.get("SAPPHIRE_TOKEN") ||
    Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) {
    return { pulse_kind: "getMe", status: "dead", details: { reason: "no_telegram_bot_token" } };
  }
  const startedAt = Date.now();
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "GET",
      // 10s timeout via AbortSignal
      signal: AbortSignal.timeout(10000),
    });
    const latency_ms = Date.now() - startedAt;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        pulse_kind: "getMe",
        status: "dead",
        latency_ms,
        details: { http: res.status, body: body.slice(0, 200) },
      };
    }
    const json = await res.json().catch(() => ({}));
    if (!json?.ok) {
      return {
        pulse_kind: "getMe",
        status: "dead",
        latency_ms,
        details: { telegram_response: json },
      };
    }
    // Slow but reachable
    if (latency_ms > 5000) {
      return {
        pulse_kind: "getMe",
        status: "degraded",
        latency_ms,
        details: { username: json?.result?.username },
      };
    }
    return {
      pulse_kind: "getMe",
      status: "ok",
      latency_ms,
      details: { username: json?.result?.username },
    };
  } catch (e: any) {
    return {
      pulse_kind: "getMe",
      status: "dead",
      latency_ms: Date.now() - startedAt,
      details: { error: String(e).slice(0, 200) },
    };
  }
}

// ── Pulse 2: spend freshness ──
async function spendFreshnessPulse(supabase: SupabaseClient): Promise<PulseResult> {
  const cutoff = new Date(Date.now() - STALE_SPEND_MIN * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from("agent_spend")
      .select("agent_name, created_at")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      return {
        pulse_kind: "spend_freshness",
        status: "degraded",
        details: { error: error.message },
      };
    }

    const lastSpend = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!lastSpend) {
      return {
        pulse_kind: "spend_freshness",
        status: "degraded", // not "dead" — could just be quiet hours
        details: {
          stale_minutes: STALE_SPEND_MIN,
          interpretation: "no agent spend rows in the threshold window",
        },
      };
    }
    return {
      pulse_kind: "spend_freshness",
      status: "ok",
      details: {
        last_agent: lastSpend.agent_name,
        last_at: lastSpend.created_at,
      },
    };
  } catch (e: any) {
    return {
      pulse_kind: "spend_freshness",
      status: "degraded",
      details: { error: String(e).slice(0, 200) },
    };
  }
}

// Determine if quiet-hours suppression applies. Architect wakes ~2pm CDT
// (UTC-5) ≈ 19:00 UTC, sleeps ~6-8am CDT ≈ 11-13:00 UTC. Suppress
// spend-freshness alerts during 11-19 UTC since no traffic is expected.
function inQuietHours(date = new Date()): boolean {
  const utcHour = date.getUTCHours();
  return utcHour >= 11 && utcHour < 19;
}

// ── Entry point ──
Deno.serve(async (req: Request) => {
  // Cron-mode auth: pg_cron and external schedulers pass a shared secret.
  const url = new URL(req.url);
  const expected = Deno.env.get("CANARY_SECRET");
  const provided =
    url.searchParams.get("secret") || req.headers.get("x-canary-secret");
  if (expected && expected !== provided) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const bot = "sapphire";
  const out: { pulses: PulseResult[]; alerts_sent: string[] } = {
    pulses: [],
    alerts_sent: [],
  };

  // ── Run pulses in parallel ──
  const [getMe, spendFresh] = await Promise.all([
    getMePulse(),
    spendFreshnessPulse(supabase),
  ]);
  out.pulses.push(getMe, spendFresh);

  // ── getMe alert decision ──
  if (getMe.status === "dead") {
    if (!(await alreadyAlertedRecently(supabase, bot, "getMe"))) {
      const text =
        `🚨 *Bot Health Canary — Sapphire DEAD*\n` +
        `\`getMe\` pulse failed: \`${JSON.stringify(getMe.details).slice(0, 400)}\`\n\n` +
        `Either the container is down, the token rotated, or Telegram is unreachable. ` +
        `Check Railway dashboard.`;
      const sent = await sendTelegramAlert(text);
      await logPulse(supabase, bot, getMe, sent);
      if (sent) out.alerts_sent.push("getMe");
    } else {
      await logPulse(supabase, bot, getMe, false);
    }
  } else if (getMe.status === "degraded") {
    await logPulse(supabase, bot, getMe, false);
  } else {
    await logPulse(supabase, bot, getMe, false);
  }

  // ── spend-freshness alert decision ──
  // Only alert if (a) status=degraded, (b) NOT in quiet hours, (c) getMe was ok
  // (otherwise the getMe alert already covers the situation), (d) not rate-limited.
  if (
    spendFresh.status === "degraded" &&
    getMe.status === "ok" &&
    !inQuietHours()
  ) {
    if (!(await alreadyAlertedRecently(supabase, bot, "spend_freshness"))) {
      const text =
        `⚠️ *Bot Health Canary — Sapphire silent*\n` +
        `getMe is OK but no \`agent_spend\` writes in the last ${STALE_SPEND_MIN} minutes.\n` +
        `That means no agent has answered any message in 2h+ during waking hours. ` +
        `Could be: container alive but message router stuck, or bot got rate-limited.`;
      const sent = await sendTelegramAlert(text);
      await logPulse(supabase, bot, spendFresh, sent);
      if (sent) out.alerts_sent.push("spend_freshness");
    } else {
      await logPulse(supabase, bot, spendFresh, false);
    }
  } else {
    await logPulse(supabase, bot, spendFresh, false);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      bot,
      ...out,
      quiet_hours: inQuietHours(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
