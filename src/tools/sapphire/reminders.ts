// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Reminder Tools
// Session 114 — 2026-04-24
//
// Three tools: set_reminder, list_reminders, cancel_reminder.
// All persist to Supabase sapphire_reminders, polled every 60s by the
// scheduler in src/index.ts (Phase 5).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

function getSupabase() {
  return import("@supabase/supabase-js").then((m) =>
    m.createClient(config.memory.supabaseUrl!, (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!),
  );
}

// Use config source (same fallback chain as the rest of the bot)
const ACE_CHAT_ID = String(config.telegram.authorizedUserIds[0] || "");

// ── Helper: validate + normalize ISO datetime, with smart correction ───────
//
// If fire_at is in the past AND a recurrence_rule is given (e.g., "daily"),
// auto-roll it forward to the next valid occurrence. This prevents Gemini's
// "I think it's still 2024" hallucinations from causing infinite retry loops.
function normalizeFireAt(
  input: string,
  recurrence: string | null,
): { ok: true; iso: string; corrected?: boolean } | { ok: false; err: string } {
  if (!input || typeof input !== "string") return { ok: false, err: "fire_at must be an ISO 8601 string." };
  let d = new Date(input);
  if (isNaN(d.getTime())) return { ok: false, err: `fire_at "${input}" is not a valid date.` };

  const nowMs = Date.now();
  const grace = 60_000; // 60s grace for clock drift

  // If in the past, try to auto-correct based on intent
  if (d.getTime() < nowMs - grace) {
    let corrected = false;

    // Case 1: just the year is wrong (off by >180 days but matches today's month/day pattern)
    // Bump year forward until it's in the future.
    const currentYear = new Date().getUTCFullYear();
    if (d.getUTCFullYear() < currentYear) {
      d.setUTCFullYear(currentYear);
      if (d.getTime() < nowMs) d.setUTCFullYear(currentYear + 1);
      corrected = true;
    }
    // Case 2: still in the past after year fix, AND we have a recurrence — roll to next occurrence
    if (d.getTime() < nowMs - grace && recurrence) {
      const r = recurrence.toLowerCase().trim();
      if (r === "daily") {
        while (d.getTime() < nowMs) d.setUTCDate(d.getUTCDate() + 1);
        corrected = true;
      } else if (r === "weekday" || r === "weekend" || r.startsWith("weekly:")) {
        // Add 7 days at a time until in the future
        while (d.getTime() < nowMs) d.setUTCDate(d.getUTCDate() + 7);
        corrected = true;
      } else if (r.startsWith("monthly:")) {
        while (d.getTime() < nowMs) d.setUTCMonth(d.getUTCMonth() + 1);
        corrected = true;
      }
    }
    // Case 3: still in the past, no recurrence — just bump to tomorrow same time
    if (d.getTime() < nowMs - grace && !recurrence) {
      const orig = new Date(input);
      d = new Date(nowMs + 24 * 60 * 60 * 1000);
      d.setUTCHours(orig.getUTCHours(), orig.getUTCMinutes(), 0, 0);
      if (d.getTime() < nowMs) d.setUTCDate(d.getUTCDate() + 1);
      corrected = true;
    }

    if (d.getTime() < nowMs - grace) {
      return { ok: false, err: `fire_at "${input}" is in the past and could not be auto-corrected. Compute the date based on the current time injected in your context.` };
    }
    return { ok: true, iso: d.toISOString(), corrected };
  }

  return { ok: true, iso: d.toISOString() };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SET REMINDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class SetReminderTool implements Tool {
  definition: ToolDefinition = {
    name: "set_reminder",
    description:
      "Schedule a reminder DM to Ace at a specific future time. Persists across bot restarts. " +
      "Convert natural language ('Friday at 2pm', 'in 2 days', 'tomorrow at 9am') to ISO 8601 BEFORE calling. Ace is CDT (UTC-5).\n\n" +
      "Examples:\n" +
      "• 'remind me to call mom Friday 2pm' → set_reminder(message='Call mom', fire_at='2026-04-25T19:00:00Z')\n" +
      "• 'remind me in 2 days to renew insurance' → set_reminder(message='Renew insurance', fire_at='<now+2d ISO>')\n" +
      "• 'every weekday at 7am remind me to take vitamins' → set_reminder(message='Take vitamins', fire_at='<tomorrow 7am ISO>', recurrence_rule='weekday')\n" +
      "• 'every morning at 8 ask me 3 personal questions' → set_reminder(message='Ask Ace 3 personal questions today', fire_at='<tomorrow 8am ISO>', recurrence_rule='daily')",
    parameters: {
      message: {
        type: "string",
        description: "The reminder text Sapphire will DM to Ace at fire_at. Plain English, friendly. Example: 'Birthday party for the girls — leave by 1:30pm.'",
      },
      fire_at: {
        type: "string",
        description: "ISO 8601 timestamp for when the reminder should fire. Example: '2026-04-25T20:00:00.000Z' (which is 3pm CDT on April 25).",
      },
      recurrence_rule: {
        type: "string",
        description:
          "Optional. 'daily' | 'weekly:mon,wed,fri' | 'monthly:15' | 'weekday' | 'weekend'. Leave empty for one-off reminders.",
      },
    },
    required: ["message", "fire_at"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const message = String(args.message || "").trim();
    const fireAtRaw = String(args.fire_at || "");
    const recurrence = args.recurrence_rule ? String(args.recurrence_rule).trim() : null;

    if (!message) return "set_reminder: message is required.";
    const norm = normalizeFireAt(fireAtRaw, recurrence);
    if (!norm.ok) return `set_reminder: ${norm.err}`;
    const correctedNote = norm.corrected ? " (auto-corrected past date to next valid occurrence)" : "";

    if (!ACE_CHAT_ID) return "set_reminder: TELEGRAM_AUTHORIZED_USER_ID is not set; cannot route reminder DM.";

    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("sapphire_reminders")
      .insert({
        message,
        fire_at: norm.iso,
        recurrence_rule: recurrence,
        chat_id: ACE_CHAT_ID,
        source: "user_request",
        status: "pending",
      })
      .select("id, fire_at")
      .single();

    if (error) return `set_reminder: Supabase error — ${error.message}`;

    const friendlyDate = new Date(norm.iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return `Reminder set for ${friendlyDate}: "${message.slice(0, 80)}"${recurrence ? ` (recurring: ${recurrence})` : ""}. ID: ${data.id}.${correctedNote}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIST REMINDERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ListRemindersTool implements Tool {
  definition: ToolDefinition = {
    name: "list_reminders",
    description: "List Ace's pending reminders. ONLY call when he explicitly asks 'what reminders do I have', 'what's coming up', 'do I have anything for X day', or similar. Do NOT call as a default check on every message — the count is already in the context prefix.",
    parameters: {
      window_hours: {
        type: "number",
        description: "Optional time window in hours from now. Default 168 (one week).",
      },
      query: {
        type: "string",
        description: "Optional keyword to search for in reminder messages.",
      },
      include_all_statuses: {
        type: "boolean",
        description: "If true, searches fired/cancelled/failed reminders too. Use for troubleshooting.",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const windowHours = Number(args.window_hours) || 168;
    const query = args.query ? String(args.query).trim() : null;
    const includeAll = !!args.include_all_statuses;
    const horizon = new Date(Date.now() + windowHours * 60 * 60 * 1000).toISOString();

    const supabase = await getSupabase();
    let q = supabase
      .from("sapphire_reminders")
      .select("id, fire_at, message, recurrence_rule, source, status")
      .order("fire_at", { ascending: true })
      .limit(25);

    if (!includeAll) {
      q = q.eq("status", "pending").lte("fire_at", horizon);
    }
    if (query) {
      q = q.ilike("message", `%${query}%`);
    }

    const { data, error } = await q;

    if (error) return `list_reminders: ${error.message}`;
    if (!data || data.length === 0) return `No pending reminders in the next ${windowHours} hours.`;

    const lines = data.map((r: any) => {
      const friendly = new Date(r.fire_at).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const tag = r.recurrence_rule ? ` (${r.recurrence_rule})` : "";
      return `• ${friendly}${tag} — ${r.message}  [id: ${r.id.slice(0, 8)}]`;
    });
    return `Pending reminders (next ${windowHours}h):\n${lines.join("\n")}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CANCEL REMINDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CancelReminderTool implements Tool {
  definition: ToolDefinition = {
    name: "cancel_reminder",
    description: "Cancel a pending reminder. Use when Ace says 'cancel that reminder' or 'never mind, drop the X reminder'. Use list_reminders first to find the ID.",
    parameters: {
      reminder_id: {
        type: "string",
        description: "Full UUID or 8-char prefix of the reminder to cancel.",
      },
    },
    required: ["reminder_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idRaw = String(args.reminder_id || "").trim();
    if (!idRaw) return "cancel_reminder: reminder_id is required.";

    const supabase = await getSupabase();
    let q = supabase.from("sapphire_reminders").update({ status: "cancelled" });
    // Allow 8-char prefix match
    if (idRaw.length === 8) {
      // No native prefix update — pull then update
      const { data: matches } = await supabase
        .from("sapphire_reminders")
        .select("id, message")
        .eq("status", "pending")
        .ilike("id", `${idRaw}%`)
        .limit(2);
      if (!matches || matches.length === 0) return `No pending reminder matches prefix "${idRaw}".`;
      if (matches.length > 1) return `Prefix "${idRaw}" is ambiguous — multiple matches. Use the full UUID.`;
      const fullId = matches[0].id;
      const { error } = await supabase
        .from("sapphire_reminders")
        .update({ status: "cancelled" })
        .eq("id", fullId);
      if (error) return `cancel_reminder: ${error.message}`;
      return `Cancelled: "${matches[0].message.slice(0, 80)}"`;
    }
    const { data, error } = await q.eq("id", idRaw).select("message").single();
    if (error) return `cancel_reminder: ${error.message}`;
    return `Cancelled: "${(data as any)?.message?.slice(0, 80) || idRaw}"`;
  }
}
