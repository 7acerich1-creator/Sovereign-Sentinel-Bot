// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Text-to-Speech (NON-PIPELINE ONLY)
// Three-tier fallback: XTTS (sovereign) → ElevenLabs → Edge TTS (FREE)
//
// Phase 4 Migration (S68): Pipeline TTS is now handled by the RunPod GPU
// worker (pod/pipelines/xtts.py). This module is ONLY used for non-pipeline
// callers (Telegram voice replies, ad-hoc bot TTS). OpenAI removed from chain.
//
// Session 48 — Brand Routing Matrix:
//   - `brand` option bifurcates physical audio assets end-to-end.
//   - ElevenLabs: ace_richie → primary key FIRST (Adam Brooding, original DNA)
//                 containment_field → alt key FIRST (fresh credits)
//     Legacy order (alt → primary) is preserved when no brand is supplied.
//   - Edge TTS failover is brand-routed: ace_richie → en-GB-ArthurNeural
//                                        containment_field → en-US-ChristopherNeural
//   - The entire ElevenLabs call is wrapped in a try/catch that detects
//     quota/insufficient-credits errors and triggers a zero-cost Edge TTS
//     failover WITH the correct brand-routed voice — no dead pipelines when
//     credits dry up.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";

export type TTSProvider = "openai" | "elevenlabs" | "edge" | "xtts";
export type TTSBrand = "ace_richie" | "containment_field";

export interface TTSOptions {
  provider?: TTSProvider;
  speed?: number; // 0.5-2.0 for OpenAI, maps to stability for ElevenLabs
  /**
   * Session 48 Brand Routing Matrix.
   * Bifurcates ElevenLabs key order AND edge-tts voice selection.
   * Undefined = legacy behavior (alt-first EL, en-US-AndrewMultilingualNeural Edge).
   */
  brand?: TTSBrand;
}

// ── Session 48: Brand Routing Matrix — voice maps ──────────────────────────
// Edge TTS voices per brand. These fire when ElevenLabs quota is exhausted
// OR when Edge is promoted to primary (FORCE_ELEVENLABS unset). Zero cost.
const EDGE_VOICE_BY_BRAND: Record<TTSBrand, string> = {
  ace_richie:        "en-GB-ArthurNeural",        // refined, oracular, UK gravitas
  containment_field: "en-US-ChristopherNeural",   // clinical, low-cadence, corporate noir
};
// Fallback when no brand is supplied (legacy pipelines). Kept for backward compat.
const EDGE_VOICE_DEFAULT = "en-US-AndrewMultilingualNeural";

function resolveEdgeVoice(brand?: TTSBrand): string {
  if (brand && EDGE_VOICE_BY_BRAND[brand]) return EDGE_VOICE_BY_BRAND[brand];
  return EDGE_VOICE_DEFAULT;
}

/**
 * Three-tier TTS with automatic fallback.
 * Chain: Edge TTS (FREE) → ElevenLabs (if credits) → OpenAI (last resort)
 *
 * When `opts.brand` is supplied, the chain routes per the Brand Routing Matrix:
 *   - ace_richie → ElevenLabs primary key first + en-GB-ArthurNeural edge voice
 *   - containment_field → ElevenLabs alt key first + en-US-ChristopherNeural edge voice
 *
 * If a specific provider is requested via opts.provider, only that provider is used.
 */
export async function textToSpeech(
  text: string,
  providerOrOpts?: TTSProvider | TTSOptions
): Promise<Buffer> {
  const opts: TTSOptions = typeof providerOrOpts === "string"
    ? { provider: providerOrOpts }
    : providerOrOpts || {};

  // If a specific provider is forced, use only that one (no fallback)
  if (opts.provider) {
    return callProvider(opts.provider, text, opts.speed, opts.brand);
  }

  // ── AUTOMATIC FALLBACK CHAIN ──
  // Priority: XTTS (sovereign, free) → ElevenLabs (paid) → Edge TTS (free) → OpenAI (last resort)
  // Set FORCE_ELEVENLABS=true env var to promote ElevenLabs above XTTS when desired.
  const chain: TTSProvider[] = [];
  const forceElevenLabs = process.env.FORCE_ELEVENLABS === "true";
  const xttsUrl = process.env.XTTS_SERVER_URL;

  // XTTS sovereign engine — top of chain when available (zero per-character cost)
  if (xttsUrl && !forceElevenLabs) {
    chain.push("xtts");
  }
  if (forceElevenLabs && config.voice.elevenLabsApiKey) {
    chain.push("elevenlabs"); // Only first if explicitly forced
  }
  if (xttsUrl && forceElevenLabs) {
    chain.push("xtts"); // Demoted behind EL when forced
  }
  chain.push("edge"); // FREE — always present as safety net
  if (!forceElevenLabs && config.voice.elevenLabsApiKey) {
    chain.push("elevenlabs"); // Demoted to fallback behind XTTS + Edge
  }
  // Phase 4: OpenAI TTS removed from chain. Pipeline TTS is on the pod (XTTSv2).
  // This module only serves non-pipeline callers now. XTTS + Edge cover that.

  let lastError: Error | null = null;

  for (const provider of chain) {
    try {
      const buffer = await callProvider(provider, text, opts.speed, opts.brand);
      if (buffer.length < 1000) {
        console.warn(`[TTS] ${provider} returned suspiciously small audio (${buffer.length}B), trying next...`);
        lastError = new Error(`${provider} returned ${buffer.length}B audio`);
        continue;
      }
      return buffer;
    } catch (err: any) {
      console.warn(`[TTS] ${provider} failed: ${err.message?.slice(0, 200)}`);
      lastError = err;
      // Session 48: if ElevenLabs hit a quota/insufficient-credits wall,
      // the wrapper below has already tried every key. Continue falling
      // through the chain — the next iteration will hit Edge TTS with the
      // correct brand voice and produce a zero-cost output.
    }
  }

  throw lastError || new Error("All TTS providers failed");
}

async function callProvider(
  provider: TTSProvider,
  text: string,
  speed?: number,
  brand?: TTSBrand
): Promise<Buffer> {
  switch (provider) {
    case "xtts":
      return xttsTTS(text, speed, brand);
    case "elevenlabs":
      return elevenLabsTTS(text, speed, brand);
    case "edge":
      return edgeTTS(text, speed, brand);
    case "openai":
      return openaiTTS(text, speed);
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider 0: XTTS — Sovereign TTS Engine (RunPod GPU, zero per-character cost)
// Session 49 — Self-hosted XTTSv2 on RunPod RTX A5000.
// Voice cloning from reference WAV files stored on the pod's /workspace volume.
// Brand routing:
//   ace_richie         → XTTS_SPEAKER_WAV_ACE (TBD — distinct voice)
//   containment_field  → XTTS_SPEAKER_WAV_TCF (Adam Brooding clone)
//   (no brand)         → XTTS_SPEAKER_ID built-in speaker or TCF default
// Env vars:
//   XTTS_SERVER_URL      — RunPod proxy URL
//   XTTS_SPEAKER_WAV_ACE — server-side path to Ace Richie voice ref on pod
//   XTTS_SPEAKER_WAV_TCF — server-side path to TCF voice ref on pod
//   XTTS_SPEAKER_ID      — fallback built-in speaker name (default: "Marcos Rudaski")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function xttsTTS(text: string, _speed?: number, brand?: TTSBrand): Promise<Buffer> {
  const baseUrl = process.env.XTTS_SERVER_URL;
  if (!baseUrl) throw new Error("XTTS_SERVER_URL not configured");

  const url = new URL("/api/tts", baseUrl);

  // Brand-routed voice reference
  const aceWav = process.env.XTTS_SPEAKER_WAV_ACE;
  const tcfWav = process.env.XTTS_SPEAKER_WAV_TCF;
  const speakerId = process.env.XTTS_SPEAKER_ID || "Marcos Rudaski";

  // Resolve speaker: prefer cloned voice WAV, fall back to built-in speaker
  let useSpeakerWav: string | undefined;
  if (brand === "ace_richie" && aceWav) {
    useSpeakerWav = aceWav;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider 1: ElevenLabs (best quality, paid)
// Session 48 — Brand routing of key order:
//   ace_richie         → primary key first (Adam Brooding original DNA, full credits)
//   containment_field  → alt key first (fresh credits, TCF voice signature)
//   (no brand)         → alt → primary (legacy behavior)
// The entire call is wrapped in a try/catch inside textToSpeech's outer loop,
// so a quota/402/insufficient error cascades into the next provider in the
// fallback chain (Edge TTS with the correct brand-routed voice).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function elevenLabsTTS(text: string, speed?: number, brand?: TTSBrand): Promise<Buffer> {
  const altKey = config.voice.elevenLabsApiKeyAlt;   // Fresh credits
  const primaryKey = config.voice.elevenLabsApiKey;   // Original key (Adam Brooding)

  if (!primaryKey && !altKey) throw new Error("ElevenLabs API key not configured");

  // ── Session 48: Brand-routed key order ─────────────────────────────────
  // ace_richie wants the Adam Brooding DNA on the PRIMARY key first.
  // containment_field wants the fresh credits on the ALT key first.
  // Legacy (no brand) keeps the old alt→primary order.
  let keysToTry: string[];
  if (brand === "ace_richie") {
    keysToTry = [primaryKey, altKey].filter(Boolean) as string[];
  } else if (brand === "containment_field") {
    keysToTry = [altKey, primaryKey].filter(Boolean) as string[];
  } else {
    keysToTry = [altKey, primaryKey].filter(Boolean) as string[];
  }

  let lastError: Error | null = null;

  for (const apiKey of keysToTry) {
    try {
      const result = await elevenLabsCallWithKey(apiKey, text, speed);
      return result;
    } catch (err: any) {
      const msg = err.message || "";
      // Session 48: broaden quota detection — any of these means "try the
      // next key, or if none remain, let it throw so the outer fallback
      // chain spins up Edge TTS for free."
      const isQuotaError =
        msg.includes("401") ||
        msg.includes("402") ||
        msg.includes("403") ||
        msg.includes("quota") ||
        msg.includes("insufficient") ||
        msg.includes("credits") ||
        msg.includes("exceeded");
      if (isQuotaError) {
        console.warn(`[ElevenLabs] Key exhausted/invalid (${msg.slice(0, 80)}), trying next key...`);
        lastError = err;
        continue;
      }
      throw err; // Non-quota error — don't swallow it
    }
  }

  // All keys exhausted — throw so the outer chain falls through to Edge TTS.
  // The edgeTTS call that follows will route to the brand-correct voice.
  throw lastError || new Error("All ElevenLabs keys exhausted (quota)");
}

async function elevenLabsCallWithKey(apiKey: string, text: string, speed?: number): Promise<Buffer> {
  // Voice: Adam Brooding — dark, tough, weathered American male.
  // THE Sovereign Synthesis voice. Locked Session 28.
  void speed; // HIGH EMOTION profile ignores speed override
  const voiceId = config.voice.elevenLabsVoiceId || "IRHApOXLvnW57QJPQH2P"; // Adam Brooding

  // HIGH EMOTION profile (Session 46 lock-in):
  //   stability 0.30 = volatile / dramatic swings
  //   style     0.85 = max emphasis variation
  //   similarity_boost 0.70 = looser DNA lock for emotion headroom
  const stability = 0.30;

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 5000),
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability,
          similarity_boost: 0.70,
          style: 0.85,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider 2: Edge TTS (FREE — Microsoft's neural voices)
// Session 48 — Brand routing of voice selection:
//   ace_richie         → en-GB-ArthurNeural (oracular, UK gravitas)
//   containment_field  → en-US-ChristopherNeural (clinical corporate noir)
//   (no brand)         → en-US-AndrewMultilingualNeural (legacy default)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function edgeTTS(text: string, speed?: number, brand?: TTSBrand): Promise<Buffer> {
  const voice = resolveEdgeVoice(brand);
  const ts = Date.now();
  const tmpInput = `/tmp/edge_tts_input_${ts}.txt`;
  const tmpOutput = `/tmp/edge_tts_output_${ts}.mp3`;

  writeFileSync(tmpInput, text.slice(0, 10000));

  // Map speed param: 0.9 = "-10%", 1.0 = "+0%", 1.1 = "+10%"
  const rateStr = speed && speed !== 1.0
    ? `${speed < 1.0 ? "-" : "+"}${Math.round(Math.abs(1.0 - speed) * 100)}%`
    : "+0%";

  try {
    execSync(
      `edge-tts --voice "${voice}" --rate="${rateStr}" --file "${tmpInput}" --write-media "${tmpOutput}"`,
      { timeout: 90_000, stdio: "pipe" }
    );

    if (!existsSync(tmpOutput)) {
      throw new Error("Edge TTS produced no output file");
    }

    const buffer = readFileSync(tmpOutput);

    if (buffer.length === 0) {
      throw new Error("Edge TTS returned empty audio file");
    }

    console.log(
      `🔊 [EdgeTTS] Generated ${(buffer.length / 1024).toFixed(0)}KB audio via ${voice}` +
      (brand ? ` (brand=${brand})` : "") +
      ` (Python CLI)`
    );
    return buffer;
  } finally {
    try { unlinkSync(tmpInput); } catch {}
    try { unlinkSync(tmpOutput); } catch {}
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider 3: OpenAI TTS (paid, last resort)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function openaiTTS(text: string, speed?: number): Promise<Buffer> {
  const apiKey = config.voice.whisperApiKey;
  if (!apiKey) throw new Error("OpenAI API key not configured for TTS");

  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.voice.openaiTtsModel || "tts-1",
      input: text.slice(0, 4096),
      voice: "onyx",
      response_format: "opus",
      speed: speed || 1.0,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI TTS error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Streaming (ElevenLabs only — used for voice replies)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function elevenLabsStreamTTS(
  text: string,
  onChunk: (chunk: Buffer) => void
): Promise<void> {
  const apiKey = config.voice.elevenLabsApiKey;
  if (!apiKey) throw new Error("ElevenLabs API key not configured");

  const voiceId = config.voice.elevenLabsVoiceId || "IRHApOXLvnW57QJPQH2P"; // Adam Brooding

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 5000),
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.30, similarity_boost: 0.70, style: 0.85, use_speaker_boost: true },
      }),
    }
  );

  if (!resp.ok) throw new Error(`ElevenLabs stream error: ${resp.status}`);
  if (!resp.body) throw new Error("No response body for streaming");

  const reader = resp.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(Buffer.from(value));
  }
}
