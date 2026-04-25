// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Google Calendar Tools
// Session 114 — 2026-04-24
//
// Read events, create events, reschedule events. Across both Google accounts.
// All times default to America/Chicago (Ace's timezone) when not specified.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { getValidGoogleAccessToken, type SapphireAccountLabel } from "../../proactive/sapphire-oauth";

const CAL_API = "https://www.googleapis.com/calendar/v3";
const ACE_TZ = "America/Chicago";

function parseAccountLabel(input: unknown): SapphireAccountLabel | null {
  const s = String(input || "").toLowerCase().trim();
  if (s.includes("empower") || s === "primary" || s === "personal") return "empoweredservices2013";
  if (s.includes("7ace") || s.includes("ace") || s === "secondary" || s === "sovereign") return "7ace.rich1";
  if (s === "empoweredservices2013") return "empoweredservices2013";
  if (s === "7ace.rich1") return "7ace.rich1";
  return null;
}

async function calFetch(
  account: SapphireAccountLabel,
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const tokenRes = await getValidGoogleAccessToken(account);
  if (!tokenRes.ok) return { ok: false, error: tokenRes.error };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenRes.token}`,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const opts: RequestInit = { ...init, headers };
  if (init.jsonBody !== undefined) opts.body = JSON.stringify(init.jsonBody);

  let resp: Response;
  try {
    resp = await fetch(`${CAL_API}${path}`, opts);
  } catch (e: any) {
    return { ok: false, error: `Calendar network error: ${e.message}` };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unreadable>");
    return { ok: false, error: `Calendar ${resp.status}: ${body.slice(0, 300)}` };
  }
  const data = await resp.json();
  return { ok: true, data };
}

function formatEvent(e: any): string {
  const summary = e.summary || "(no title)";
  const location = e.location ? ` @ ${e.location}` : "";
  const start = e.start?.dateTime || e.start?.date;
  const end = e.end?.dateTime || e.end?.date;
  const startFriendly = start
    ? new Date(start).toLocaleString("en-US", { timeZone: ACE_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  const endFriendly = end && e.end?.dateTime
    ? new Date(end).toLocaleString("en-US", { timeZone: ACE_TZ, hour: "numeric", minute: "2-digit" })
    : "";
  const timeStr = endFriendly ? `${startFriendly} – ${endFriendly}` : startFriendly;
  return `${timeStr} — ${summary}${location}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIST EVENTS (today / week / range)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CalendarListTool implements Tool {
  definition: ToolDefinition = {
    name: "calendar_list",
    description:
      "List Ace's calendar events in a time range. Use for the morning brief and 'what's on my calendar' questions. " +
      "Defaults to today + tomorrow if no range given.",
    parameters: {
      account: { type: "string", description: "'primary', 'secondary', or 'both'. Default 'both'." },
      time_min: { type: "string", description: "ISO 8601 start. Optional, default = now." },
      time_max: { type: "string", description: "ISO 8601 end. Optional, default = 48h from now." },
      max: { type: "number", description: "Max events per account. Default 20." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const accountInput = String(args.account || "both").toLowerCase();
    const max = Math.min(Number(args.max) || 20, 50);
    const timeMin = args.time_min ? new Date(String(args.time_min)).toISOString() : new Date().toISOString();
    const timeMax = args.time_max
      ? new Date(String(args.time_max)).toISOString()
      : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const accounts: SapphireAccountLabel[] = accountInput === "both"
      ? ["empoweredservices2013", "7ace.rich1"]
      : ((): SapphireAccountLabel[] => {
          const a = parseAccountLabel(accountInput);
          return a ? [a] : ["empoweredservices2013", "7ace.rich1"];
        })();

    const out: string[] = [];
    for (const account of accounts) {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        maxResults: String(max),
        singleEvents: "true",
        orderBy: "startTime",
      });
      const r = await calFetch(account, `/calendars/primary/events?${params.toString()}`);
      if (!r.ok) { out.push(`[${account}] ${r.error}`); continue; }
      const items = (r.data.items as any[]) || [];
      if (items.length === 0) { out.push(`[${account}] No events.`); continue; }
      const lines = [`[${account}] ${items.length} event${items.length === 1 ? "" : "s"}:`];
      for (const e of items) lines.push(`  ${formatEvent(e)}`);
      out.push(lines.join("\n"));
    }
    return out.join("\n\n");
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CREATE EVENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CalendarCreateEventTool implements Tool {
  definition: ToolDefinition = {
    name: "calendar_create_event",
    description: "Create a new calendar event. Use when Ace asks to add something to his calendar.",
    parameters: {
      account: { type: "string", description: "'primary' or 'secondary'. Default 'primary'." },
      summary: { type: "string", description: "Event title." },
      start: { type: "string", description: "ISO 8601 start datetime." },
      end: { type: "string", description: "ISO 8601 end datetime. If omitted, 1 hour after start." },
      location: { type: "string", description: "Optional location." },
      description: { type: "string", description: "Optional notes." },
    },
    required: ["summary", "start"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const account = parseAccountLabel(args.account) || "empoweredservices2013";
    const summary = String(args.summary || "").slice(0, 200);
    const startIso = String(args.start || "");
    const startDate = new Date(startIso);
    if (isNaN(startDate.getTime())) return "calendar_create_event: invalid start datetime.";
    const endIso = args.end
      ? new Date(String(args.end)).toISOString()
      : new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();

    const event: any = {
      summary,
      start: { dateTime: startDate.toISOString(), timeZone: ACE_TZ },
      end: { dateTime: endIso, timeZone: ACE_TZ },
    };
    if (args.location) event.location = String(args.location);
    if (args.description) event.description = String(args.description);

    const r = await calFetch(account, `/calendars/primary/events`, {
      method: "POST",
      jsonBody: event,
    });
    if (!r.ok) return `calendar_create_event: ${r.error}`;
    return `Event created on ${account}: ${formatEvent(r.data)}. Link: ${r.data.htmlLink}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESCHEDULE EVENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CalendarRescheduleTool implements Tool {
  definition: ToolDefinition = {
    name: "calendar_reschedule",
    description: "Move an existing calendar event to a new time. First find the event with calendar_list to get its ID.",
    parameters: {
      account: { type: "string", description: "'primary' or 'secondary'." },
      event_id: { type: "string", description: "Calendar event ID." },
      new_start: { type: "string", description: "New ISO 8601 start datetime." },
      new_end: { type: "string", description: "New ISO 8601 end datetime. Optional, preserves duration if omitted." },
    },
    required: ["event_id", "new_start"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const account = parseAccountLabel(args.account) || "empoweredservices2013";
    const eventId = String(args.event_id || "").trim();
    if (!eventId) return "calendar_reschedule: event_id required.";

    // Read existing event to preserve duration if new_end not given
    const existing = await calFetch(account, `/calendars/primary/events/${encodeURIComponent(eventId)}`);
    if (!existing.ok) return `calendar_reschedule: cannot fetch event — ${existing.error}`;

    const newStart = new Date(String(args.new_start));
    if (isNaN(newStart.getTime())) return "calendar_reschedule: invalid new_start.";

    let newEnd: Date;
    if (args.new_end) {
      newEnd = new Date(String(args.new_end));
    } else {
      const oldStart = new Date(existing.data.start?.dateTime || existing.data.start?.date);
      const oldEnd = new Date(existing.data.end?.dateTime || existing.data.end?.date);
      const durationMs = oldEnd.getTime() - oldStart.getTime();
      newEnd = new Date(newStart.getTime() + durationMs);
    }

    const r = await calFetch(account, `/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      jsonBody: {
        start: { dateTime: newStart.toISOString(), timeZone: ACE_TZ },
        end: { dateTime: newEnd.toISOString(), timeZone: ACE_TZ },
      },
    });
    if (!r.ok) return `calendar_reschedule: ${r.error}`;
    return `Rescheduled: ${formatEvent(r.data)}.`;
  }
}

// ── Internal helper for morning brief ──────────────────────────────────────
export async function getCalendarSummaryForBrief(): Promise<string> {
  const tool = new CalendarListTool();
  // Today + tomorrow window
  const now = new Date();
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setDate(now.getDate() + 2);
  endOfTomorrow.setHours(23, 59, 59, 999);
  return await tool.execute({
    account: "both",
    time_min: now.toISOString(),
    time_max: endOfTomorrow.toISOString(),
    max: 15,
  });
}
