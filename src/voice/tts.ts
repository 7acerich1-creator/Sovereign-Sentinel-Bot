// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Text-to-Speech
// Three-tier fallback: ElevenLabs → Edge TTS (FREE) → OpenAI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";

export type TTSProvider = "openai" | "elevenlabs" | "edge";

export interface TTSOptions {
  provider?: TTSProvider;
  speed?: number; // 0.5-2.0 for OpenAI, maps to stability for ElevenLabs
}

/**
 * Three-tier TTS with automatic fallback.
 * Chain: ElevenLabs (best quality) → Edge TTS (FREE, no auth) → OpenAI (last resort)
 *
 * If a specific provider is requested via opts.provider, only that provider is used.
 * Otherwise, the full fallback chain fires automatically.
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
    return callProvider(opts.provider, text, opts.speed);
  }

  // ── AUTOMATIC FALLBACK CHAIN ──
  // Priority: Edge TTS (FREE, unlimited) → ElevenLabs (paid, if credits available) → OpenAI (last resort)
  // Edge TTS is promoted to primary to prevent burning paid credits on routine pipeline runs.
  // Set FORCE_ELEVENLABS=true env var to restore ElevenLabs as primary when credits are replenished.
  const chain: TTSProvider[] = [];
  const forceElevenLabs = process.env.FORCE_ELEVENLABS === "true";

  if (forceElevenLabs && config.voice.elevenLabsApiKey) {
    chain.push("elevenlabs"); // Only first if explicitly forced
  }
  chain.push("edge"); // FREE — always primary unless forced otherwise
  if (!forceElevenLabs && config.voice.elevenLabsApiKey) {
    chain.push("elevenlabs"); // Demoted to fallback
  }
  if (config.voice.whisperApiKey) chain.push("openai");

  let lastError: Error | null = null;

  for (const provider of chain) {
    try {
      const buffer = await callProvider(provider, text, opts.speed);
      if (buffer.length < 1000) {
        console.warn(`[TTS] ${provider} returned suspiciously small audio (${buffer.length}B), trying next...`);
        lastError = new Error(`${provider} returned ${buffer.length}B audio`);
        continue;
      }
      return buffer;
    } catch (err: any) {
      console.warn(`[TTS] ${provider} failed: ${err.message?.slice(0, 200)}`);
      lastError = err;
      // Continue to next provider in chain
    }
  }

  throw lastError || new Error("All TTS providers failed");
}

async function callProvider(provider: TTSProvider, text: string, speed?: number): Promise<Buffer> {
  switch (provider) {
    case "elevenlabs":
      return elevenLabsTTS(text, speed);
    case "edge":
      return edgeTTS(text, speed);
    case "openai":
      return openaiTTS(text, speed);
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider 1: ElevenLabs (best quality, paid)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function elevenLabsTTS(text: string, speed?: number): Promise<Buffer> {
  const apiKey = config.voice.elevenLabsApiKey;
  if (!apiKey) throw new Error("ElevenLabs API key not configured");

  // Voice: Adam Brooding — dark, tough, weathered American male.
  // THE Sovereign Synthesis voice. Locked Session 28.
  // Old defaults: Rachel (female, wrong brand), stock Adam (too warm/PBS).
  const voiceId = config.voice.elevenLabsVoiceId || "IRHApOXLvnW57QJPQH2P"; // Adam Brooding, Dark & Tough

  // VOICE EXPRESSIVENESS (Session 28 fix):
  // Old: stability=0.80 made the voice rigid and monotone. Like reading a textbook.
  // Reference channels (Grim Grit) have DYNAMIC delivery — emphasis, pauses, vocal variation.
  // stability: 0.45 = expressive but still controlled (not chaotic)
  // style: 0.60 = dramatic delivery with emphasis on key words
  // similarity_boost: 0.75 = keeps the voice character but allows variation
  const stability = speed && speed < 1.0 ? 0.45 : 0.50;

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
          similarity_boost: 0.75,
          style: 0.60,
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
// No API key, no auth, no billing. Unlimited.
// Uses Python edge-tts CLI (pip install edge-tts) — battle-tested, 10M+ installs.
// The Node.js edge-tts-node WebSocket library was unreliable on Railway.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Edge TTS voice mapping — deep male voice for sovereignty / dark psychology brand
// Session 28: switched from AriaNeural (female) to GuyNeural (deep male)
const EDGE_VOICE = "en-US-GuyNeural"; // Deep natural male, matches brand voice

async function edgeTTS(text: string, speed?: number): Promise<Buffer> {
  const ts = Date.now();
  const tmpInput = `/tmp/edge_tts_input_${ts}.txt`;
  const tmpOutput = `/tmp/edge_tts_output_${ts}.mp3`;

  // Write text to temp file (avoids shell escaping issues with quotes, apostrophes, etc.)
  writeFileSync(tmpInput, text.slice(0, 10000));

  // Map speed param: 0.9 = "-10%", 1.0 = "+0%", 1.1 = "+10%"
  const rateStr = speed && speed !== 1.0
    ? `${speed < 1.0 ? "-" : "+"}${Math.round(Math.abs(1.0 - speed) * 100)}%`
    : "+0%";

  try {
    execSync(
      `edge-tts --voice "${EDGE_VOICE}" --rate="${rateStr}" --file "${tmpInput}" --write-media "${tmpOutput}"`,
      { timeout: 90_000, stdio: "pipe" }
    );

    if (!existsSync(tmpOutput)) {
      throw new Error("Edge TTS produced no output file");
    }

    const buffer = readFileSync(tmpOutput);

    if (buffer.length === 0) {
      throw new Error("Edge TTS returned empty audio file");
    }

    console.log(`🔊 [EdgeTTS] Generated ${(buffer.length / 1024).toFixed(0)}KB audio via ${EDGE_VOICE} (Python CLI)`);
    return buffer;
  } finally {
    // Cleanup temp files
    try { unlinkSync(tmpInput); } catch {}
    try { unlinkSync(tmpOutput); } catch {}
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider 3: OpenAI TTS (paid, last resort)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function openaiTTS(text: string, speed?: number): Promise<Buffer> {
  const apiKey = config.voice.whisperApiKey; // Same OpenAI key
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
      voice: "onyx", // Deep, authoritative voice for the sentinel
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
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.60, use_speaker_boost: true },
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
