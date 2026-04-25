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

// S114t: Now ALSO prepends the assembled-prompt block (persona + goals +
// scenario + emotions + extras + spice) — replaces the static personality.
// This is the ddxfish/sapphire pattern: dynamic, fresh, swappable per-piece.
//
// Then the lightweight memory hint + semantic recall (auth status, counts,
// Pinecone-relevant facts for THIS message) follows.
export async function buildPersonalContextPrefix(userMessage = ""): Promise<string> {
  const parts: string[] = [];

  // ── 1. Assembled identity prompt (ddxfish pattern) ──
  // Pulls library pieces + active selection + spice with lookahead.
  // Replaces the static personality wall-of-text. Includes IDENTITY / GOALS /
  // FORMAT / CURRENT MOMENT / RULES / URGENT ALERT (spice) sections.
  try {
    const { buildAssembledPrompt, mergePiecesFromDB } = await import("./sapphire-prompt-builder");
    await mergePiecesFromDB(); // No-op after first call — loads AI-created pieces
    const assembled = await buildAssembledPrompt();
    if (assembled) parts.push(assembled);
  } catch (e: any) {
    console.warn(`[SapphirePA] Assembled prompt failed: ${e.message} — using fallback`);
    parts.push(`[CONTEXT: DM from Ace. PA mode. Warm, sharp, plain English.]`);
  }

  // ── 2. Live state hints ──
  parts.push(`# LIVE STATE (this message)`);

  // Auth status — small but critical for routing decisions
  try {
    const auth = await getSapphireAuthStatus();
    const flags: string[] = [];
    flags.push(auth.google.empoweredservices2013 ? "empoweredservices2013✓" : "empoweredservices2013✗");
    flags.push(auth.google["7ace.rich1"] ? "7ace.rich1✓" : "7ace.rich1✗");
    flags.push(auth.notion ? "Notion✓" : "Notion✗");
    parts.push(`[CONNECTED: ${flags.join(" | ")}. ✓ = tools usable now. ✗ = not yet authed.]`);
  } catch (e: any) {
    console.warn(`[SapphirePA] auth status fetch failed: ${e.message}`);
  }

  // Memory counts ONLY — not the contents. She queries when she needs them.
  try {
    const supabase = await getSupabase();
    const now = new Date();
    const todayHorizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const weekHorizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const [factsCount, reminders24h, reminders7d] = await Promise.all([
      supabase.from("sapphire_known_facts").select("key", { count: "exact", head: true }),
      supabase.from("sapphire_reminders").select("id", { count: "exact", head: true })
        .eq("status", "pending").lte("fire_at", todayHorizon),
      supabase.from("sapphire_reminders").select("id", { count: "exact", head: true })
        .eq("status", "pending").gt("fire_at", todayHorizon).lte("fire_at", weekHorizon),
    ]);
    parts.push(`[MEMORY: ${factsCount.count || 0} standing facts saved | ${reminders24h.count || 0} reminders queued today | ${reminders7d.count || 0} more this week. Call recall_facts / list_reminders to read specifics when needed.]`);
  } catch (e: any) {
    console.warn(`[SapphirePA] counts fetch failed: ${e.message}`);
  }

  // ── SEMANTIC RECALL — query sapphire-personal namespace against THIS message ──
  // This is what makes her feel like a real assistant: "what was the gift budget"
  // surfaces "girls_birthday_parties: $25" because of similarity, not exact match.
  // Only fires when the user's message is substantive (>10 chars).
  if (userMessage && userMessage.length > 10) {
    try {
      const { recallSapphireFacts } = await import("../tools/sapphire/_pinecone");
      const matches = await recallSapphireFacts(userMessage, 4, 0.65);
      if (matches.length > 0) {
        const lines = matches.map((m) => `  • ${m.key} (${m.category}, sim ${m.score.toFixed(2)}): ${m.value}`);
        parts.push(`[RELEVANT TO THIS MESSAGE — pulled from your personal memory]:\n${lines.join("\n")}`);
      }
    } catch (e: any) {
      console.warn(`[SapphirePA] semantic recall failed: ${e.message}`);
    }
  }

  // (Behavioral rules now live in the assembled prompt's extras section —
  // discernment, memory_routing, what_you_can_do, family_first, no_loops.
  // Don't duplicate them here.)

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
