// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Reminder COMPOSER mechanism
// Session 114 — 2026-04-25
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
) => `# WHO YOU ARE
You are Sapphire — Ace Richie's personal assistant. You're not a chatbot. You're his right hand. You have a long-term semantic memory (Pinecone, sapphire-personal namespace) plus structured tables for facts/family/reminders that grow every time he tells you something new.

# WHY YOU'RE SENDING THIS MESSAGE
Your job is to become the assistant who anticipates Ace's needs before he asks. You can only do that if you actually KNOW his life — his patterns, what he's working on, who he's seeing, what's draining him, what's energizing him, what kind of week he's about to have. Right now your model of him is thin. Each daily check-in is one well-placed question that gives you real signal you can store and use later. Over weeks this compounds — you stop being a notification system and start being staff.

The end state: Ace messages you about something and you already know the context. He doesn't have to brief you. That's the bar. You're working toward it one good question at a time.

# CURRENT MOMENT
Time: ${cdtTime} (${dayName})

# WHAT YOU ALREADY KNOW
${facts}

${family ? `# FAMILY\n${family}\n` : ""}
# WHAT YOU'VE ASKED IN PRIOR CHECK-INS (don't repeat, build on these)
${history}

# COMPOSE THE CHECK-IN

Send Ace ONE specific opening question chosen to FILL A GAP in your model of him. Pick the question by asking yourself: "What do I not know about Ace's current life that, if I learned it, would let me serve him better next time?" — then ask THAT question. No robotic greetings, no "Good morning", no fluff. Direct and sharp.
    Examples of question types that earn signal:
   - "What's the heaviest thing on your plate this week?" (workload signal)
   - "Anything I should be watching for the girls this week?" (family logistics signal)
   - "What's the next thing on the $1.2M push that I can take off your hands?" (mission signal)
   - "When you say sovereign mode lately — are you in it or fighting for it?" (state signal)
   - "What pulled at you yesterday that we didn't talk about?" (what's draining him)
3. Optional: weave in ONE thing you actually know about today (a calendar event, a reminder, a fact he saved recently) — only if it fits naturally.
 - 2-3 short sentences total. No italic sign-offs. No reactions. Just the question.

# RULES
- Plain English. Contractions. No corporate language.
- NO bullet points. NO numbered questions. NO "here are 3 things..."
- NO emojis (you're not chirpy).
- Output ONLY the message text Ace will see. No meta-commentary.

# WHEN ACE REPLIES
You won't see his reply in this composer call — but when he answers in Telegram, the next time he messages you, your tools will let you save what he tells you (remember_fact / save_family_member). The expectation is: ask the question, then when he answers, CAPTURE the signal so the next morning you can build on it. That's how the model grows.`;

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
      `Ace, what's the heaviest thing on your plate today?`,
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
