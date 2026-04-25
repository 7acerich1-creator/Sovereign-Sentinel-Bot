// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Reminder COMPOSER mechanism
// Session 114 (S114w) — 2026-04-25
//
// Some reminders shouldn't be dumped raw — they should be COMPOSED into a
// warm, conversational message by Sapphire based on what she knows about
// Ace right now. The daily 3-questions check-in is the canonical example.
//
// Reminder rows that include `payload.composer = 'morning_checkin'` (or
// similar) get routed through here instead of `sendSapphireReply(text)`.
//
// Composers use Gemini Flash directly (NOT the full agent loop — no tools,
// no router, no risk of cost spirals). Pure compose-and-send.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";
import { config } from "../config";
import { sendSapphireReply } from "../voice/sapphire-voice";

const GEMINI_MODEL = "gemini-2.5-flash";
const ACE_TZ = "America/Chicago";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// ── Compose helper: small focused Gemini Flash call ────────────────────────
async function composeWithGemini(prompt: string, maxOutputTokens = 384): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens },
        }),
      },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    return (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim() || null;
  } catch {
    return null;
  }
}

// ── Recent context loaders ─────────────────────────────────────────────────

async function loadStandingFacts(maxChars = 1500): Promise<string> {
  try {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("sapphire_known_facts")
      .select("key, value, category")
      .not("key", "ilike", "email_seen:%")
      .not("key", "ilike", "piece_%")
      .not("key", "in", '("voice_preference","notion_parent_page_id","current_spice","next_spice","active_persona","active_relationship","active_goals","active_format","active_scenario","active_extras","active_emotions")')
      .order("category");
    if (!data || data.length === 0) return "(no standing facts saved yet)";
    const lines: string[] = [];
    let total = 0;
    for (const r of data as any[]) {
      const line = `${r.category}/${r.key}: ${r.value}`;
      if (total + line.length > maxChars) break;
      lines.push(line);
      total += line.length;
    }
    return lines.join("\n");
  } catch {
    return "(facts unavailable)";
  }
}

async function loadRecentCheckinHistory(days = 7): Promise<string> {
  try {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("sapphire_known_facts")
      .select("key, value")
      .like("key", "daily_checkin_%")
      .order("key", { ascending: false })
      .limit(days);
    if (!data || data.length === 0) return "(no prior check-ins yet — this is your first)";
    return (data as any[]).map((r: any) => `${r.key.replace("daily_checkin_", "")}: ${r.value}`).join("\n");
  } catch {
    return "(history unavailable)";
  }
}

async function loadFamilyContext(): Promise<string> {
  try {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("sapphire_family_profiles")
      .select("name, relationship, date_of_birth, allergies, school, current_activities");
    if (!data || data.length === 0) return "";
    return (data as any[]).map((m: any) => {
      const bits = [`${m.name} (${m.relationship})`];
      if (m.date_of_birth) {
        const dob = new Date(m.date_of_birth);
        const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        bits.push(`age ${age}`);
      }
      if (m.school) bits.push(`school: ${m.school}`);
      if (m.current_activities?.length) bits.push(`activities: ${m.current_activities.join(", ")}`);
      return bits.join(", ");
    }).join("\n");
  } catch {
    return "";
  }
}

// ── COMPOSER: morning_checkin ──────────────────────────────────────────────
//
// Conversational good-morning. Uses what she knows + recent check-ins +
// time of day to compose ONE warm opening. Asks ONE question, not three —
// the conversation unfolds naturally from there.

const MORNING_CHECKIN_PROMPT = (
  facts: string,
  history: string,
  family: string,
  cdtTime: string,
  dayName: string,
) => `You are Sapphire, Ace's personal assistant, sending him your daily morning check-in. The point is NOT to dump three questions on him like a survey. The point is to begin the conversation that will, over time, let you anticipate his needs better.

CURRENT TIME: ${cdtTime} (${dayName})

WHAT YOU KNOW ABOUT ACE:
${facts}

${family ? `FAMILY:\n${family}\n` : ""}
RECENT CHECK-INS (so you don't repeat or rehash):
${history}

YOUR TASK:
Compose a single conversational good-morning message to Ace that:
1. Greets him in a way that fits this specific day/time. Reference the day if natural ("Happy Saturday" / "First Monday of the month" etc).
2. Asks ONE warm, specific opening question — something that, if he answers, gives you a real signal about his life right now. Avoid generic "How are you?" — instead something like "What's on your plate today?" or "Anything I should be tracking for you this week?"
3. Optional: if context warrants, mention ONE thing you're aware of (a reminder firing today, an upcoming family event, a recent fact he saved) — briefly, woven in naturally.
4. End with the standard one-line italic close (a small genuine reaction).

Tone: warm, sharp, present. Plain English. Use contractions. NO bullet points. NO numbered lists. NO "here are 3 questions." NO emojis (one ✓ check or 🌅 max — usually none). NO performative cheer.

LENGTH: 2-4 short sentences total + the italic close. That's it.

Output ONLY the message text Ace will see in Telegram. Do not include any meta-commentary or explanation.`;

export async function composeMorningCheckin(channel: Channel, chatId: string): Promise<boolean> {
  const facts = await loadStandingFacts();
  const history = await loadRecentCheckinHistory(7);
  const family = await loadFamilyContext();

  const now = new Date();
  const cdtHour = (now.getUTCHours() - 5 + 24) % 24;
  const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][
    new Date(now.getTime() - 5 * 60 * 60 * 1000).getUTCDay()
  ];
  const cdtTime = `${String(cdtHour).padStart(2,"0")}:${String(now.getUTCMinutes()).padStart(2,"0")} CDT`;

  const composed = await composeWithGemini(
    MORNING_CHECKIN_PROMPT(facts, history, family, cdtTime, dayName),
  );

  if (!composed) {
    // Fallback: at least send a real warm message, not the raw reminder text
    await sendSapphireReply(
      channel,
      chatId,
      `Morning, Ace. What's on your plate today?\n\n_Here when you're ready._`,
      { kind: "brief" },
    );
    return false;
  }

  await sendSapphireReply(channel, chatId, composed, { kind: "brief" });

  // Save what she asked today so tomorrow doesn't repeat
  try {
    const supabase = await getSupabase();
    const dateKey = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await supabase.from("sapphire_known_facts").upsert(
      {
        key: `daily_checkin_${dateKey}`,
        value: composed.slice(0, 500),
        category: "schedule",
      },
      { onConflict: "key" },
    );
  } catch {
    // best-effort
  }

  return true;
}

// ── Composer registry — extend with more composers later ────────────────────
export type ComposerKind = "morning_checkin" | "evening_reflection";

export async function runComposer(
  kind: ComposerKind,
  channel: Channel,
  chatId: string,
): Promise<boolean> {
  if (kind === "morning_checkin") {
    return composeMorningCheckin(channel, chatId);
  }
  // Future: evening_reflection, week_recap, etc.
  return false;
}
