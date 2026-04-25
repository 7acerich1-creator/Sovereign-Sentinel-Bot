// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire PA Scheduled Jobs
// Session 114 — 2026-04-24
//
// Three jobs:
//   1. runReminderPoll()    — every 60s
//   2. runMorningBrief()    — 16:00 UTC = 11:00 AM CDT
//   3. runEveningWrap()     — 06:15 UTC = 01:15 AM CDT next day
//
// All jobs are idempotent and skip silently if creds aren't yet configured.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";
import { config } from "../config";
import { getCalendarSummaryForBrief } from "../tools/sapphire/calendar";
import { getInboxSummaryForBrief } from "../tools/sapphire/gmail";
import { findOrCreateDailyPage, getNotionParentPageId } from "../tools/sapphire/notion";
import { NotionAppendToPageTool } from "../tools/sapphire/notion";
import { sendSapphireReply } from "../voice/sapphire-voice";
import { getSapphireAuthStatus } from "./sapphire-oauth";

const ACE_TZ = "America/Chicago";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(config.memory.supabaseUrl!, (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. REMINDER POLLER — runs every 60s
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let reminderPollRunning = false;

// Compute next occurrence for a recurrence_rule. Returns null for one-off.
function nextOccurrence(currentFireAt: Date, rule: string | null): Date | null {
  if (!rule) return null;
  const r = rule.toLowerCase().trim();

  if (r === "daily") {
    return new Date(currentFireAt.getTime() + 24 * 60 * 60 * 1000);
  }
  if (r === "weekday") {
    let next = new Date(currentFireAt.getTime() + 24 * 60 * 60 * 1000);
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
      next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    }
    return next;
  }
  if (r === "weekend") {
    let next = new Date(currentFireAt.getTime() + 24 * 60 * 60 * 1000);
    while (next.getUTCDay() !== 0 && next.getUTCDay() !== 6) {
      next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    }
    return next;
  }
  if (r.startsWith("weekly:")) {
    const days = r.slice(7).split(",").map((d) => d.trim());
    const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const targets = days.map((d) => dayMap[d.slice(0, 3)]).filter((d) => d !== undefined);
    if (targets.length === 0) return null;
    let next = new Date(currentFireAt.getTime() + 24 * 60 * 60 * 1000);
    for (let i = 0; i < 14; i++) {
      if (targets.includes(next.getUTCDay())) return next;
      next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    }
    return null;
  }
  if (r.startsWith("monthly:")) {
    const day = parseInt(r.slice(8), 10);
    if (isNaN(day) || day < 1 || day > 31) return null;
    const next = new Date(currentFireAt);
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(Math.min(day, 28)); // safe day
    return next;
  }
  return null;
}

export async function runReminderPoll(channel: Channel): Promise<void> {
  if (reminderPollRunning) return;
  reminderPollRunning = true;
  try {
    const supabase = await getSupabase();
    const nowIso = new Date().toISOString();

    const { data: due, error } = await supabase
      .from("sapphire_reminders")
      .select("id, fire_at, message, recurrence_rule, chat_id, source")
      .eq("status", "pending")
      .lte("fire_at", nowIso)
      .order("fire_at", { ascending: true })
      .limit(20);

    if (error) {
      console.error(`[SapphirePA] Reminder poll fetch failed: ${error.message}`);
      return;
    }
    if (!due || due.length === 0) return;

    for (const r of due as any[]) {
      try {
        const friendly = new Date(r.fire_at).toLocaleString("en-US", {
          timeZone: ACE_TZ,
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        });
        const text = `Reminder for ${friendly}: ${r.message}`;
        await sendSapphireReply(channel, r.chat_id, text);

        // Mark fired
        await supabase
          .from("sapphire_reminders")
          .update({ status: "fired", fired_at: new Date().toISOString() })
          .eq("id", r.id);

        // Schedule next occurrence if recurring
        const next = nextOccurrence(new Date(r.fire_at), r.recurrence_rule);
        if (next) {
          await supabase.from("sapphire_reminders").insert({
            fire_at: next.toISOString(),
            message: r.message,
            recurrence_rule: r.recurrence_rule,
            chat_id: r.chat_id,
            source: r.source,
            status: "pending",
          });
        }
      } catch (e: any) {
        console.error(`[SapphirePA] Failed to fire reminder ${r.id}: ${e.message}`);
        await supabase
          .from("sapphire_reminders")
          .update({ status: "failed", error_msg: e.message })
          .eq("id", r.id);
      }
    }
  } finally {
    reminderPollRunning = false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. MORNING BRIEF — 16:00 UTC daily (11 AM CDT)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runMorningBrief(channel: Channel, chatId: string): Promise<void> {
  // Skip if Google not yet authorized
  const auth = await getSapphireAuthStatus();
  if (!auth.google.empoweredservices2013 && !auth.google["7ace.rich1"]) {
    console.log("[SapphirePA] Morning brief skipped — no Google accounts authorized yet");
    return;
  }

  const supabase = await getSupabase();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // Idempotency — skip if already sent today
  const { data: existing } = await supabase
    .from("sapphire_daily_pages")
    .select("morning_brief_at, notion_page_id")
    .eq("date", todayIso)
    .maybeSingle();
  if (existing?.morning_brief_at) {
    console.log("[SapphirePA] Morning brief already sent for", todayIso);
    return;
  }

  // ── Pull data in parallel — add news brief (Gap 7) ──
  const [calSummary, inboxSummary, reminders, newsBrief] = await Promise.all([
    getCalendarSummaryForBrief().catch((e) => `(calendar unavailable: ${e.message})`),
    getInboxSummaryForBrief(24).catch((e) => `(email unavailable: ${e.message})`),
    supabase
      .from("sapphire_reminders")
      .select("fire_at, message")
      .eq("status", "pending")
      .gte("fire_at", today.toISOString())
      .lte("fire_at", new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString())
      .order("fire_at", { ascending: true })
      .limit(15),
    import("../tools/sapphire/news").then((m) => m.getNewsForBrief()).catch(() => ""),
  ]);

  // ── Compose text ──
  const friendlyDate = today.toLocaleDateString("en-US", {
    timeZone: ACE_TZ, weekday: "long", month: "long", day: "numeric",
  });
  const sections: string[] = [`Good morning. Here's ${friendlyDate}.`, ""];

  sections.push("📅 CALENDAR");
  sections.push(calSummary || "Nothing on the books.");
  sections.push("");

  sections.push("✉️ EMAIL");
  sections.push(inboxSummary || "Inbox is quiet.");
  sections.push("");

  if (reminders.data && reminders.data.length > 0) {
    sections.push("⏰ REMINDERS TODAY");
    for (const r of reminders.data as any[]) {
      const t = new Date(r.fire_at).toLocaleString("en-US", { timeZone: ACE_TZ, hour: "numeric", minute: "2-digit" });
      sections.push(`• ${t} — ${r.message}`);
    }
    sections.push("");
  }

  if (newsBrief && newsBrief.trim().length > 20) {
    sections.push("📰 NEWS WORTH A LOOK");
    sections.push(newsBrief);
    sections.push("");
  }

  sections.push("Have a good one. I'll check back tonight.");
  const briefText = sections.join("\n");

  // ── Send to Telegram ──
  await sendSapphireReply(channel, chatId, briefText, { kind: "brief" });

  // ── Append to Notion daily page (best-effort) ──
  try {
    const parentPageId = await getNotionParentPageId();
    if (parentPageId) {
      const dailyRes = await findOrCreateDailyPage(today, parentPageId);
      if (dailyRes.ok) {
        const appendTool = new NotionAppendToPageTool();
        await appendTool.execute({
          page_id: dailyRes.pageId,
          heading: "🌅 Morning Brief",
          body: briefText,
          with_divider: true,
        });
      }
    }
  } catch (e: any) {
    console.warn(`[SapphirePA] Notion append (morning) failed: ${e.message}`);
  }

  // ── Mark sent ──
  await supabase
    .from("sapphire_daily_pages")
    .upsert(
      { date: todayIso, morning_brief_at: new Date().toISOString(), morning_brief_text: briefText, status: "morning_done" },
      { onConflict: "date" },
    );

  console.log(`[SapphirePA] Morning brief sent for ${todayIso}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. EVENING WRAP — 06:15 UTC daily (01:15 AM CDT next day)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runEveningWrap(channel: Channel, chatId: string): Promise<void> {
  const auth = await getSapphireAuthStatus();
  if (!auth.google.empoweredservices2013 && !auth.google["7ace.rich1"]) {
    console.log("[SapphirePA] Evening wrap skipped — no Google accounts authorized yet");
    return;
  }

  const supabase = await getSupabase();

  // The "day" we're wrapping is "yesterday" since we fire at 01:15 AM CDT next day.
  const wrapDate = new Date(Date.now() - 60 * 60 * 1000); // ~1 hour ago = still the previous calendar day in CDT
  const wrapDateCdt = new Date(wrapDate.toLocaleString("en-US", { timeZone: ACE_TZ }));
  // Actually we just want the DATE, so:
  const wrapIso = wrapDate.toLocaleDateString("sv-SE", { timeZone: ACE_TZ }); // YYYY-MM-DD CDT

  const { data: existing } = await supabase
    .from("sapphire_daily_pages")
    .select("evening_wrap_at")
    .eq("date", wrapIso)
    .maybeSingle();
  if (existing?.evening_wrap_at) {
    console.log("[SapphirePA] Evening wrap already sent for", wrapIso);
    return;
  }

  // Pull what fired today + tomorrow's preview
  const startOfDayUtc = new Date(`${wrapIso}T00:00:00-05:00`).toISOString(); // CDT day start
  const endOfDayUtc = new Date(`${wrapIso}T23:59:59-05:00`).toISOString();

  const [firedReminders, tomorrowCal] = await Promise.all([
    supabase
      .from("sapphire_reminders")
      .select("fire_at, message")
      .eq("status", "fired")
      .gte("fired_at", startOfDayUtc)
      .lte("fired_at", endOfDayUtc)
      .order("fired_at", { ascending: true })
      .limit(20),
    getCalendarSummaryForBrief().catch((e) => `(calendar unavailable: ${e.message})`),
  ]);

  const friendlyDate = new Date(wrapIso).toLocaleDateString("en-US", {
    timeZone: ACE_TZ, weekday: "long", month: "long", day: "numeric",
  });

  const sections: string[] = [`Wrapping ${friendlyDate}.`, ""];

  if (firedReminders.data && firedReminders.data.length > 0) {
    sections.push("✅ REMINDERS THAT FIRED");
    for (const r of firedReminders.data as any[]) {
      sections.push(`• ${r.message}`);
    }
    sections.push("");
  }

  sections.push("📅 TOMORROW");
  sections.push(tomorrowCal || "Light day ahead.");
  sections.push("");
  sections.push("Get some rest.");

  const wrapText = sections.join("\n");
  await sendSapphireReply(channel, chatId, wrapText, { kind: "brief" });

  // Notion append
  try {
    const parentPageId = await getNotionParentPageId();
    if (parentPageId) {
      const dailyRes = await findOrCreateDailyPage(new Date(wrapIso + "T12:00:00Z"), parentPageId);
      if (dailyRes.ok) {
        const appendTool = new NotionAppendToPageTool();
        await appendTool.execute({
          page_id: dailyRes.pageId,
          heading: "🌙 Evening Wrap",
          body: wrapText,
          with_divider: true,
        });
      }
    }
  } catch (e: any) {
    console.warn(`[SapphirePA] Notion append (evening) failed: ${e.message}`);
  }

  await supabase
    .from("sapphire_daily_pages")
    .upsert(
      { date: wrapIso, evening_wrap_at: new Date().toISOString(), evening_wrap_text: wrapText, status: "complete" },
      { onConflict: "date" },
    );

  console.log(`[SapphirePA] Evening wrap sent for ${wrapIso}`);
}
