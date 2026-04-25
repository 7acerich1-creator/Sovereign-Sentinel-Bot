// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Voice Reply Helper
// Session 114 — 2026-04-24
//
// Outbound TTS for Sapphire's PA mode. Uses the existing XTTS server with a
// distinct built-in feminine speaker (NOT cloned-Ace voice). Same infra,
// no new dependencies, no rule violations against Session 106's
// "everything through XTTS" purge.
//
// Falls back to text if XTTS_SERVER_URL is unset OR a synthesis call fails —
// Ace never silently misses a brief because the GPU was offline.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";

const SAPPHIRE_XTTS_SPEAKER = process.env.SAPPHIRE_XTTS_SPEAKER || "Tammie Ema";
// Built-in XTTS-v2 feminine speakers known to be present:
//   "Tammie Ema", "Daisy Studious", "Gracie Wise", "Alison Dietlinde",
//   "Brenda Stern", "Henriette Usha", "Sofia Hellen", "Tammy Grit"

export type VoicePreference = "voice" | "text" | "voice_brief_only";

interface SendSapphireReplyOpts {
  // 'reply' | 'brief' — briefs are voiced when preference is "voice_brief_only"
  kind?: "reply" | "brief";
  // Hard-override the global voice preference for this one call
  forceMode?: "voice" | "text";
}

async function synthesizeSapphire(text: string): Promise<Buffer | null> {
  const baseUrl = process.env.XTTS_SERVER_URL;
  if (!baseUrl) return null;

  const trimmed = text.length > 1500 ? text.slice(0, 1500) + "..." : text;

  try {
    const url = new URL("/api/tts", baseUrl);
    url.searchParams.set("text", trimmed);
    url.searchParams.set("language_id", "en");
    url.searchParams.set("speaker_id", SAPPHIRE_XTTS_SPEAKER);

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "audio/wav" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      console.warn(`[SapphireVoice] XTTS ${resp.status} — falling back to text`);
      return null;
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch (e: any) {
    console.warn(`[SapphireVoice] synthesis failed: ${e.message} — falling back to text`);
    return null;
  }
}

// ── Main exported reply helper ──────────────────────────────────────────────
//
// Resolves voice preference, attempts synthesis, falls back to text on any
// failure. Always sends *something* to Ace.
export async function sendSapphireReply(
  channel: Channel,
  chatId: string,
  text: string,
  opts: SendSapphireReplyOpts = {},
): Promise<void> {
  const { getVoicePreference } = await import("../agent/sapphire-pa-commands");
  const pref = (opts.forceMode as VoicePreference) || (getVoicePreference() as VoicePreference);

  const shouldVoice =
    pref === "voice"
    || (pref === "voice_brief_only" && opts.kind === "brief");

  if (!shouldVoice) {
    await channel.sendMessage(chatId, text);
    return;
  }

  const audio = await synthesizeSapphire(text);
  if (!audio) {
    // Soft fallback: still deliver as text
    await channel.sendMessage(chatId, text);
    return;
  }

  // sendVoice may not exist on every Channel impl — TelegramChannel does.
  if (typeof (channel as any).sendVoice === "function") {
    try {
      await (channel as any).sendVoice(chatId, audio, "audio/wav");
      // Always include a short text caption so the message is searchable in chat
      const caption = text.length > 240 ? text.slice(0, 240) + "..." : text;
      await channel.sendMessage(chatId, caption);
      return;
    } catch (e: any) {
      console.warn(`[SapphireVoice] sendVoice failed: ${e.message} — text fallback`);
    }
  }
  await channel.sendMessage(chatId, text);
}
