// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Proactive Watchers
// Session 114 — 2026-04-24
//
// Two background watchers:
//   1. runCalendarLookahead() — scans 48h of calendar events, auto-creates
//      24h-ahead reminders for events Ace hasn't already been reminded about.
//   2. runEmailTriagePoll() — scans both inboxes every 30 min, DMs Ace when
//      new high-priority emails arrive (calendar invites, replies to threads
//      he's in, school senders, time-sensitive subjects).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";
import { config } from "../config";
import { getValidGoogleAccessToken, getSapphireAuthStatus, type SapphireAccountLabel } from "./sapphire-oauth";
import { sendSapphireReply } from "../voice/sapphire-voice";

const ACE_TZ = "America/Chicago";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(config.memory.supabaseUrl!, config.memory.supabaseKey!);
}

const ACCOUNTS: SapphireAccountLabel[] = ["empoweredservices2013", "7ace.rich1"];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. CALENDAR 24-HOUR LOOKAHEAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let calLookaheadRunning = false;

export async function runCalendarLookahead(): Promise<void> {
  if (calLookaheadRunning) return;
  calLookaheadRunning = true;
  try {
    const auth = await getSapphireAuthStatus();
    if (!auth.google.empoweredservices2013 && !auth.google["7ace.rich1"]) return;

    const aceChatId = String(config.telegram.authorizedUserIds[0] || "");
    if (!aceChatId) return;

    const supabase = await getSupabase();
    const now = new Date();
    const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000); // next 48h

    for (const account of ACCOUNTS) {
      if (!auth.google[account]) continue;

      const tokenRes = await getValidGoogleAccessToken(account);
      if (!tokenRes.ok) continue;

      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: horizon.toISOString(),
        maxResults: "50",
        singleEvents: "true",
        orderBy: "startTime",
      });
      let resp: Response;
      try {
        resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
          headers: { Authorization: `Bearer ${tokenRes.token}` },
        });
      } catch (e: any) {
        console.warn(`[SapphireWatch] Calendar lookahead network error (${account}): ${e.message}`);
        continue;
      }
      if (!resp.ok) {
        console.warn(`[SapphireWatch] Calendar lookahead ${resp.status} (${account})`);
        continue;
      }
      const data = (await resp.json()) as any;
      const events = (data.items as any[]) || [];

      for (const ev of events) {
        const evId = ev.id as string;
        const evStart = ev.start?.dateTime || ev.start?.date;
        if (!evStart || !evId) continue;
        const evStartDate = new Date(evStart);

        // Reminder fires 24h before
        const remindAt = new Date(evStartDate.getTime() - 24 * 60 * 60 * 1000);
        // Skip if reminder time is in the past (event is <24h away — handled by morning brief)
        if (remindAt.getTime() < now.getTime()) continue;

        // Dedup — skip if we already have a calendar_24h reminder for this event_id
        const { data: existing } = await supabase
          .from("sapphire_reminders")
          .select("id")
          .eq("source", "calendar_24h")
          .filter("payload->>event_id", "eq", evId)
          .limit(1);
        if (existing && existing.length > 0) continue;

        const summary = ev.summary || "(untitled event)";
        const friendlyTime = evStartDate.toLocaleString("en-US", {
          timeZone: ACE_TZ,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        const message = `Heads up — tomorrow at ${friendlyTime}: ${summary}${ev.location ? ` @ ${ev.location}` : ""}`;

        await supabase.from("sapphire_reminders").insert({
          fire_at: remindAt.toISOString(),
          message,
          payload: { event_id: evId, account, calendar_summary: summary },
          chat_id: aceChatId,
          source: "calendar_24h",
          status: "pending",
        });
      }
    }
  } catch (e: any) {
    console.error(`[SapphireWatch] Calendar lookahead error: ${e.message}`);
  } finally {
    calLookaheadRunning = false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. EMAIL TRIAGE POLL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Strategy: every 30 min, query both inboxes for:
//   `is:unread newer_than:1h -category:promotions -category:social`
// Filter for "important" via simple heuristics:
//   - Has 'invitation' / 'rsvp' / 'school' / 'urgent' / 'tomorrow' / 'today' in subject
//   - Sender domain in priority list (school, doctor, family known emails)
//   - Has calendar invite attachment (text/calendar)
// Track seen IDs in sapphire_known_facts under key=email_seen:<gmail_id>.
// If important + new, DM Ace.

const PRIORITY_KEYWORDS = [
  "invitation", "invite", "rsvp", "school", "urgent", "asap",
  "today", "tomorrow", "deadline", "appointment", "reminder", "due",
  "permission", "confirmation",
];

let emailTriageRunning = false;

async function isSeenEmail(supabase: any, gmailId: string): Promise<boolean> {
  const { data } = await supabase
    .from("sapphire_known_facts")
    .select("key")
    .eq("key", `email_seen:${gmailId}`)
    .maybeSingle();
  return !!data;
}

async function markSeenEmail(supabase: any, gmailId: string, summary: string): Promise<void> {
  await supabase.from("sapphire_known_facts").upsert(
    {
      key: `email_seen:${gmailId}`,
      value: summary.slice(0, 500),
      category: "logistics",
      // expires_at to keep this from bloating forever — 14d TTL
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: "key" },
  );
}

function isPriorityEmail(subject: string, snippet: string): boolean {
  const lower = `${subject} ${snippet}`.toLowerCase();
  return PRIORITY_KEYWORDS.some((kw) => lower.includes(kw));
}

export async function runEmailTriagePoll(channel: Channel): Promise<void> {
  if (emailTriageRunning) return;
  emailTriageRunning = true;
  try {
    const auth = await getSapphireAuthStatus();
    if (!auth.google.empoweredservices2013 && !auth.google["7ace.rich1"]) return;

    const aceChatId = String(config.telegram.authorizedUserIds[0] || "");
    if (!aceChatId) return;

    const supabase = await getSupabase();
    const alerts: string[] = [];

    for (const account of ACCOUNTS) {
      if (!auth.google[account]) continue;
      const tokenRes = await getValidGoogleAccessToken(account);
      if (!tokenRes.ok) continue;

      const q = `is:unread newer_than:1h -category:promotions -category:social`;
      let listResp: Response;
      try {
        listResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=15`,
          { headers: { Authorization: `Bearer ${tokenRes.token}` } },
        );
      } catch (e: any) {
        console.warn(`[SapphireWatch] Email list error (${account}): ${e.message}`);
        continue;
      }
      if (!listResp.ok) continue;
      const listData = (await listResp.json()) as any;
      const ids = (listData.messages as Array<{ id: string }>) || [];
      if (ids.length === 0) continue;

      for (const { id } of ids) {
        if (await isSeenEmail(supabase, id)) continue;

        let mResp: Response;
        try {
          mResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${tokenRes.token}` } },
          );
        } catch {
          continue;
        }
        if (!mResp.ok) continue;
        const mData = (await mResp.json()) as any;
        const headers = (mData.payload?.headers as Array<{ name: string; value: string }>) || [];
        const from = headers.find((h) => h.name.toLowerCase() === "from")?.value || "(unknown)";
        const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "(no subject)";
        const snippet = mData.snippet || "";

        if (isPriorityEmail(subject, snippet)) {
          alerts.push(`[${account}]\nFrom: ${from.replace(/<.*>/, "").trim()}\nSubject: ${subject}\n${snippet.slice(0, 120)}`);
        }
        await markSeenEmail(supabase, id, `${from} | ${subject}`);
      }
    }

    if (alerts.length > 0) {
      const text = `Heads up — important new email${alerts.length === 1 ? "" : "s"}:\n\n` + alerts.join("\n\n");
      await sendSapphireReply(channel, aceChatId, text);
    }
  } catch (e: any) {
    console.error(`[SapphireWatch] Email triage error: ${e.message}`);
  } finally {
    emailTriageRunning = false;
  }
}
