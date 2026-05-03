// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire PA Context + Vision
// Session 114 — 2026-04-24
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

// Now ALSO prepends the assembled-prompt block (persona + goals +
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

  // ── S125+ Phase 5A: CORE MEMORY (Sapphire-owned, Letta-style) ──
  // Always-visible state Sapphire maintains via memory(action='core_*') tools.
  // This is HER understanding of Architect's current world — distinct from the
  // static personal_intelligence_ace doctrine piece (which is identity/lens).
  // Hard-capped at ~6000 chars total across all slots (≈1500 tokens).
  try {
    const { readAllCoreMemory } = await import("../tools/sapphire/core_memory");
    const slots = await readAllCoreMemory();
    if (slots.length > 0) {
      const lines = slots.map((s) =>
        `[${s.slot}] (updated ${s.updated_at.slice(0, 10)})\n  ${s.content}`,
      );
      parts.push(`# CORE MEMORY (your current understanding — update via memory action='core_append'/'core_replace')\n${lines.join("\n\n")}`);
    }
  } catch (e: any) {
    console.warn(`[SapphirePA] core memory fetch failed: ${e.message}`);
  }

  // ── 2. Live state hints ──
  parts.push(`# LIVE STATE (this message)`);

  // TEAM ROSTER — single source of truth from PERSONA_REGISTRY.
  // Without this Sapphire hallucinates Buffer/X/CapCut/Munch/old role descriptions
  // because her training/baked picture is months out of date. Inject FRESH every turn.
    // Roster is only for crew-aware agents. Sapphire (PA) is focused on Ace's life/tasks.
    // If we need the roster back for specific COO tasks, we call recall_facts.
    // parts.push("[ROSTER REMOVED for token economy]"); 

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

    const [factsCount, reminders24h, reminders7d, activePlans] = await Promise.all([
      supabase.from("sapphire_known_facts").select("key", { count: "exact", head: true }),
      supabase.from("sapphire_reminders").select("id", { count: "exact", head: true })
        .eq("status", "pending").lte("fire_at", todayHorizon),
      supabase.from("sapphire_reminders").select("id", { count: "exact", head: true })
        .eq("status", "pending").gt("fire_at", todayHorizon).lte("fire_at", weekHorizon),
      supabase.from("sapphire_plans").select("id, goal, status").in("status", ["approved", "executing"]),
    ]);

    const planLines = (activePlans.data ?? []).map(p => `  • [${p.id.slice(0, 8)}] (${p.status}): ${p.goal}`);
    let planSummary = planLines.length > 0 
      ? `\n[ACTIVE PLANS — you are currently executing these]:\n${planLines.join("\n")}` 
      : "";

    // HARD EXECUTION MANDATE
    if (planLines.length > 0) {
      planSummary += `\n\n[HARD EXECUTIVE MANDATE]: You are in EXECUTION MODE for the active plans above. ` +
        `If Ace says 'do it', 'go', or similar, you are FORBIDDEN from replying with 'Ready' or 'I will begin'. ` +
        `You MUST immediately call a work-producing tool (web_search, web_fetch, research_brief, etc.) to complete Step 1. ` +
        `Deliverables (actual data/results) are the only acceptable output.`;
    }

    parts.push(`[MEMORY: ${factsCount.count || 0} standing facts saved | ${reminders24h.count || 0} reminders queued today | ${reminders7d.count || 0} more this week. Call recall_facts / list_reminders to read specifics when needed.]${planSummary}`);
  } catch (e: any) {
    console.warn(`[SapphirePA] counts/plans fetch failed: ${e.message}`);
  }

  // ── SEMANTIC RECALL — query sapphire-personal namespace against THIS message ──
  // This is what makes her feel like a real assistant: "what was the gift budget"
  // surfaces "girls_birthday_parties: $25" because of similarity, not exact match.
  // Only fires when the user's message is substantive (>10 chars).
  //
  // TIGHTENED. Was (6, 0.55) — the "wider net" was
  // actively polluting Sapphire's context. Smoke test post-Phase-1 ship surfaced
  // a turn where "is there a YouTube video showing this [briefcase]?" injected
  // three unrelated past Ace conversations about *uploading videos and content
  // strategy* (all sim 0.63), and Sapphire pattern-matched the polluted memory
  // instead of the actual briefcase context. New threshold 0.78 + cap 3 matches
  // filters out borderline-relevant cross-domain recalls. If a real-world
  // recall regresses, raise count to 4 before lowering threshold.
  if (userMessage && userMessage.length > 10) {
    try {
      const { recallSapphireFacts } = await import("../tools/sapphire/_pinecone");
      const matches = await recallSapphireFacts(userMessage, 3, 0.78);
      if (matches.length > 0) {
        const lines = matches.map((m) => {
          const value = m.value.length > 240 ? m.value.slice(0, 240) + "…" : m.value;
          return `  • [${m.namespace}] ${m.key || "(no key)"} (sim ${m.score.toFixed(2)}): ${value}`;
        });
        parts.push(`[RELEVANT TO THIS MESSAGE — pulled from your full semantic memory across namespaces]:\n${lines.join("\n")}`);
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
