// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v4.0 — Text-to-Speech (XTTS ONLY)
//
// Session 106: ElevenLabs, Edge TTS, and OpenAI TTS PURGED.
// Everything runs through the sovereign XTTS engine on RunPod GPU.
// Pipeline TTS uses podTTS() in pod/runpod-client.ts.
// This module serves non-pipeline callers (Telegram voice replies, ad-hoc bot TTS).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type TTSProvider = "xtts";
export type TTSBrand = "sovereign_synthesis" | "containment_field";

export interface TTSOptions {
  provider?: TTSProvider;
  speed?: number;
  brand?: TTSBrand;
}

/**
 * XTTS-only TTS. No fallback chain — sovereign engine or nothing.
 */
export async function textToSpeech(
  text: string,
  providerOrOpts?: TTSProvider | TTSOptions
): Promise<Buffer> {
  const opts: TTSOptions = typeof providerOrOpts === "string"
    ? { provider: providerOrOpts }
    : providerOrOpts || {};

  return xttsTTS(text, opts.speed, opts.brand);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// XTTS — Sovereign TTS Engine (RunPod GPU, zero per-character cost)
// Voice cloning from reference WAV files stored on the pod's /workspace volume.
// Brand routing:
//   sovereign_synthesis → XTTS_SPEAKER_WAV_ACE
//   containment_field   → XTTS_SPEAKER_WAV_TCF
//   (no brand)          → XTTS_SPEAKER_WAV_TCF or built-in speaker
// Env vars:
//   XTTS_SERVER_URL      — RunPod proxy URL
//   XTTS_SPEAKER_WAV_ACE — server-side path to Sovereign Synthesis voice ref on pod
//   XTTS_SPEAKER_WAV_TCF — server-side path to TCF voice ref on pod
//   XTTS_SPEAKER_ID      — fallback built-in speaker name (default: "Marcos Rudaski")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function xttsTTS(text: string, _speed?: number, brand?: TTSBrand): Promise<Buffer> {
  const baseUrl = process.env.XTTS_SERVER_URL;
  if (!baseUrl) throw new Error("XTTS_SERVER_URL not configured");

  const url = new URL("/api/tts", baseUrl);

  // Brand-routed voice reference
  const ssWav = process.env.XTTS_SPEAKER_WAV_ACE;
  const tcfWav = process.env.XTTS_SPEAKER_WAV_TCF;
  const speakerId = process.env.XTTS_SPEAKER_ID || "Marcos Rudaski";

  // Resolve speaker: prefer cloned voice WAV, fall back to built-in speaker
  let useSpeakerWav: string | undefined;
  if (brand === "sovereign_synthesis" && ssWav) {
    useSpeakerWav = ssWav;
  } else if (brand === "containment_field" && tcfWav) {
    useSpeakerWav = tcfWav;
  } else if (tcfWav) {
    useSpeakerWav = tcfWav; // Legacy: default to TCF voice if available
  }

  // Build query parameters
  url.searchParams.set("text", text.slice(0, 10000));
  url.searchParams.set("language_id", "en");
  if (useSpeakerWav) {
    url.searchParams.set("speaker_wav", useSpeakerWav);
  } else {
    url.searchParams.set("speaker_id", speakerId);
  }

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "audio/wav" },
    signal: AbortSignal.timeout(120_000), // 2min timeout for long scripts
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`XTTS error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(
    `\u{1F50A} [XTTS] Generated ${(buffer.length / 1024).toFixed(0)}KB audio` +
    (useSpeakerWav ? ` (cloned: ${useSpeakerWav})` : ` (speaker: ${speakerId})`) +
    (brand ? ` (brand=${brand})` : "") +
    ` — sovereign engine, $0 cost`
  );

  return buffer;
}
