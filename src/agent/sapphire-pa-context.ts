// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire PA Context + Vision
// Session 114 (S114j) — 2026-04-24
//
// Two exports:
//   1. buildPersonalContextPrefix() — composes a rich Mode A context block
//      that includes auth status + standing facts + upcoming reminders +
//      Notion link, so Sapphire FEELS like she remembers her state every
//      time Ace DMs her. Replaces the static prompt-only injection.
//
//   2. analyzeSapphireImage() — downloads a Telegram photo using Sapphire's
//      OWN bot token (bypasses the global-token bug in telegram.ts), sends
//      to Gemini 2.5 Flash with vision, returns plain-text extraction so the
//      agent loop can act on the image content (create event, set reminder,
//      append to Notion, etc.).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";
import { getSapphireAuthStatus } from "../proactive/sapphire-oauth";
import { loadFactsForContext } from "../tools/sapphire/facts";

const ACE_TZ = "America/Chicago";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// ── 1. CONTEXT PREFIX ──────────────────────────────────────────────────────

export async function buildPersonalContextPrefix(): Promise<string> {
  const parts: string[] = [
    `[CONTEXT: 1-on-1 DM from Ace. You are in MODE A — Personal Assistant.`,
    `Plain English only. No "Architect", no sovereign tone, no [inner state] stamp,`,
    `no memetic triggers. Talk like a warm, competent assistant.]`,
    ``,
  ];

  // Auth status — so she stops asking what's connected
  try {
    const auth = await getSapphireAuthStatus();
    const connected: string[] = [];
    if (auth.google.empoweredservices2013) connected.push("empoweredservices2013 Gmail+Calendar");
    if (auth.google["7ace.rich1"]) connected.push("7ace.rich1 Gmail+Calendar");
    if (auth.notion) connected.push("Notion");
    if (connected.length > 0) {
      parts.push(`[CONNECTED RIGHT NOW: ${connected.join(", ")}. You CAN call gmail_*, calendar_*, notion_* tools right now without re-auth.]`);
    } else {
      parts.push(`[NOT YET CONNECTED to Gmail/Calendar/Notion. If Ace asks you to do something requiring those, tell him to run /auth_status to set it up.]`);
    }
    parts.push(``);
  } catch (e: any) {
    // Silent — don't break message handling on context build failure
    console.warn(`[SapphirePA] auth status fetch failed: ${e.message}`);
  }

  // Upcoming reminders (next 24h) — so she knows what's queued
  try {
    const supabase = await getSupabase();
    const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: reminders } = await supabase
      .from("sapphire_reminders")
      .select("fire_at, message")
      .eq("status", "pending")
      .lte("fire_at", horizon)
      .order("fire_at", { ascending: true })
      .limit(8);
    if (reminders && reminders.length > 0) {
      const lines = reminders.map((r: any) => {
        const t = new Date(r.fire_at).toLocaleString("en-US", { timeZone: ACE_TZ, weekday: "short", hour: "numeric", minute: "2-digit" });
        return `  - ${t}: ${r.message}`;
      }).join("\n");
      parts.push(`[REMINDERS QUEUED FOR NEXT 24H — you set these for him]:\n${lines}`);
      parts.push(``);
    }
  } catch (e: any) {
    console.warn(`[SapphirePA] reminders fetch failed: ${e.message}`);
  }

  // Standing facts — Ace's prefs and recurring info
  try {
    const facts = await loadFactsForContext();
    if (facts && facts.trim().length > 0) {
      parts.push(`[STANDING FACTS YOU KNOW ABOUT ACE — use these to feel coherent]:\n${facts}`);
      parts.push(``);
    }
  } catch (e: any) {
    console.warn(`[SapphirePA] facts fetch failed: ${e.message}`);
  }

  // Capabilities reminder — keep it tight
  parts.push(`[YOU CAN: read/search/send Gmail, read/create/reschedule Calendar events, create/append/search Notion pages, set/list/cancel reminders (durable), remember/recall standing facts, analyze images Ace sends you. When he tells you something worth keeping (a person's name, a routine, a budget), call remember_fact silently before responding.]`);
  parts.push(``);

  return parts.join("\n");
}

// ── 2. IMAGE VISION ─────────────────────────────────────────────────────────

const GEMINI_VISION_MODEL = "gemini-2.5-flash";

export interface VisionResult {
  ok: boolean;
  description: string;
  error?: string;
}

// Download a Telegram file with the correct bot token (Sapphire's, not Veritas's
// global, which is what telegram.ts hardcodes in the URL — known bug).
async function downloadWithSapphireToken(fileId: string): Promise<{ buf: Buffer; mime: string } | null> {
  const sapphireToken = process.env.SAPPHIRE_TOKEN;
  if (!sapphireToken) return null;

  // Step 1 — getFile to get the file_path
  let getFileResp: Response;
  try {
    getFileResp = await fetch(`https://api.telegram.org/bot${sapphireToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
  } catch (e: any) {
    console.warn(`[SapphireVision] getFile network error: ${e.message}`);
    return null;
  }
  if (!getFileResp.ok) {
    console.warn(`[SapphireVision] getFile HTTP ${getFileResp.status}`);
    return null;
  }
  const getFileData = (await getFileResp.json()) as any;
  const filePath = getFileData?.result?.file_path;
  if (!filePath) return null;

  // Step 2 — download the actual file
  let fileResp: Response;
  try {
    fileResp = await fetch(`https://api.telegram.org/file/bot${sapphireToken}/${filePath}`);
  } catch (e: any) {
    console.warn(`[SapphireVision] file download error: ${e.message}`);
    return null;
  }
  if (!fileResp.ok) return null;

  const buf = Buffer.from(await fileResp.arrayBuffer());
  // Infer mime from extension
  const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { buf, mime };
}

export async function analyzeSapphireImage(
  fileId: string,
  caption: string,
): Promise<VisionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, description: "", error: "GEMINI_API_KEY not set." };

  const file = await downloadWithSapphireToken(fileId);
  if (!file) return { ok: false, description: "", error: "Could not download image from Telegram." };

  const base64 = file.buf.toString("base64");

  // Compose the vision prompt — pull EVERYTHING actionable out of the image
  const prompt = caption
    ? `Ace sent this image with the message: "${caption}". Extract all relevant information (dates, times, names, addresses, amounts, RSVP details, links). Be specific and complete. Plain text. No introduction.`
    : `Ace sent this image. Extract all relevant information (dates, times, names, addresses, amounts, RSVP details, links). Be specific and complete. Plain text. No introduction.`;

  let resp: Response;
  try {
    resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: file.mime, data: base64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      },
    );
  } catch (e: any) {
    return { ok: false, description: "", error: `Gemini Vision network error: ${e.message}` };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unreadable>");
    return { ok: false, description: "", error: `Gemini Vision ${resp.status}: ${body.slice(0, 300)}` };
  }

  const data = (await resp.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text.trim()) return { ok: false, description: "", error: "Vision returned empty response." };

  return { ok: true, description: text.trim() };
}
