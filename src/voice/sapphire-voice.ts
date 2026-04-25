// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Voice Reply Helper
// Session 114 — 2026-04-24 (S114f: Google Translate TTS — verified live 200 audio/mpeg)
//
// Outbound TTS for Sapphire's PA mode. Uses Google Translate's TTS endpoint
// — totally free, no API key, no GPU pod spin-up. Handles long text via
// chunking (~180-char limit per request). Returns concatenated MP3.
//
// Falls back to text on any failure so Ace never silently misses a brief.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";

const GTTS_URL = "https://translate.google.com/translate_tts";
// Voice options: tl=en-US (American), en-GB (British), en-AU (Australian)
const SAPPHIRE_LANG = process.env.SAPPHIRE_TTS_LANG || "en-US";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Google Translate TTS hard-caps ~200 chars per request. Chunk on sentence
// boundaries when possible, fall back to word boundaries.
const CHUNK_LIMIT = 180;

export type VoicePreference = "voice" | "text" | "voice_brief_only";

interface SendSapphireReplyOpts {
  kind?: "reply" | "brief";
  forceMode?: "voice" | "text";
}

function chunkText(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= CHUNK_LIMIT) return [cleaned];

  const chunks: string[] = [];
  // Split on sentence-ish boundaries first
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length <= CHUNK_LIMIT) {
      cur = (cur ? cur + " " : "") + s;
      continue;
    }
    if (cur) chunks.push(cur);
    if (s.length <= CHUNK_LIMIT) {
      cur = s;
    } else {
      // Sentence longer than CHUNK_LIMIT — word-split
      const words = s.split(" ");
      cur = "";
      for (const w of words) {
        if ((cur + " " + w).trim().length <= CHUNK_LIMIT) {
          cur = (cur ? cur + " " : "") + w;
        } else {
          if (cur) chunks.push(cur);
          cur = w;
        }
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function fetchOneChunk(text: string): Promise<Buffer | null> {
  try {
    const url = `${GTTS_URL}?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(SAPPHIRE_LANG)}&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "audio/mpeg" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.warn(`[SapphireVoice] gTTS chunk ${resp.status}`);
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 100) {
      console.warn(`[SapphireVoice] gTTS chunk too small (${buf.length}b) — likely empty`);
      return null;
    }
    return buf;
  } catch (e: any) {
    console.warn(`[SapphireVoice] gTTS chunk error: ${e.message}`);
    return null;
  }
}

async function synthesizeSapphire(text: string): Promise<Buffer | null> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return null;

  // For long briefs, cap at 8 chunks (~1440 chars max audio) to keep voice
  // notes under ~2 min. Text caption still carries full content.
  const limited = chunks.slice(0, 8);

  const buffers: Buffer[] = [];
  for (const chunk of limited) {
    const b = await fetchOneChunk(chunk);
    if (!b) {
      // Partial failure — return what we have if any, else null
      return buffers.length > 0 ? Buffer.concat(buffers) : null;
    }
    buffers.push(b);
  }
  return Buffer.concat(buffers);
}

// ── Main exported reply helper ──────────────────────────────────────────────
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
      const caption = text.length > 240 ? text.slice(0, 240) + "..." : text;
      await channel.sendMessage(chatId, caption);
      return;
    } catch (e: any) {
      console.warn(`[SapphireVoice] sendVoice failed: ${e.message} — text fallback`);
    }
  }
  await channel.sendMessage(chatId, text);
}
