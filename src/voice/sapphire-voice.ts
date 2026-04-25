// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Voice Reply Helper
// Session 114 — 2026-04-24 (S114b: free TTS, no pod)
//
// Outbound TTS for Sapphire's PA mode. Uses StreamElements TTS — totally free,
// no API key, no GPU pod spin-up, single HTTP call per voice note.
// Voice: "Salli" (warm US female) — natural, conversational tone.
//
// Falls back to text on any failure so Ace never silently misses a brief.
//
// Note re Session 106 XTTS-only directive: that rule scopes to PIPELINE TTS
// (videos that need Ace's cloned voice). Sapphire's PA replies are a different
// surface (DM voice notes, distinct identity) — free TTS is the correct call
// to avoid GPU pod spin-up cost on every reply.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";

// StreamElements voice list at:
//   https://api.streamelements.com/kappa/v2/speech/voices
// Warm female options: "Salli" (US), "Joanna" (US), "Kimberly" (US),
//   "Amy" (UK), "Emma" (UK), "Ivy" (US child-safe).
const SAPPHIRE_VOICE = process.env.SAPPHIRE_TTS_VOICE || "Salli";
const SE_TTS_URL = "https://api.streamelements.com/kappa/v2/speech";

export type VoicePreference = "voice" | "text" | "voice_brief_only";

interface SendSapphireReplyOpts {
  // 'reply' | 'brief' — briefs are voiced when preference is "voice_brief_only"
  kind?: "reply" | "brief";
  // Hard-override the global voice preference for this one call
  forceMode?: "voice" | "text";
}

async function synthesizeSapphire(text: string): Promise<Buffer | null> {
  // StreamElements caps text at ~3000 chars per call. Trim long briefs.
  const trimmed = text.length > 2800 ? text.slice(0, 2800) + "..." : text;

  try {
    const url = `${SE_TTS_URL}?voice=${encodeURIComponent(SAPPHIRE_VOICE)}&text=${encodeURIComponent(trimmed)}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "audio/mpeg" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
      console.warn(`[SapphireVoice] StreamElements ${resp.status} — falling back to text`);
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
    await channel.sendMessage(chatId, text);
    return;
  }

  if (typeof (channel as any).sendVoice === "function") {
    try {
      await (channel as any).sendVoice(chatId, audio, "audio/mpeg");
      // Always include a short text caption so chat is searchable
      const caption = text.length > 240 ? text.slice(0, 240) + "..." : text;
      await channel.sendMessage(chatId, caption);
      return;
    } catch (e: any) {
      console.warn(`[SapphireVoice] sendVoice failed: ${e.message} — text fallback`);
    }
  }
  await channel.sendMessage(chatId, text);
}
