// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Text-to-Speech
// Three-tier fallback: ElevenLabs → Edge TTS (FREE) → OpenAI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

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
  // 1. ElevenLabs (if key exists)
  // 2. Edge TTS (FREE — always available)
  // 3. OpenAI (if key exists — last resort)
  const chain: TTSProvider[] = [];
  if (config.voice.elevenLabsApiKey) chain.push("elevenlabs");
  chain.push("edge"); // Always in chain — free, no auth
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

  const voiceId = config.voice.elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM"; // Rachel

  // Higher stability = more consistent, measured pacing (0.0 = variable, 1.0 = rigid)
  // For documentary narration, we want high stability + moderate style for gravitas
  const stability = speed && speed < 1.0 ? 0.80 : 0.65;

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
          similarity_boost: 0.80,
          style: 0.35,
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
// Uses edge-tts-node package (WebSocket to speech.platform.bing.com)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Edge TTS voice mapping — closest matches to our brand voices
const EDGE_VOICE = "en-US-AriaNeural"; // Natural female, closest to Rachel

async function edgeTTS(text: string, speed?: number): Promise<Buffer> {
  // Dynamic import — only loads when needed (keeps bundle light if ElevenLabs works)
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("edge-tts-node");

  const tts = new MsEdgeTTS({});
  await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  // Map speed param: 0.9 = "-10%", 1.0 = "+0%", 1.1 = "+10%"
  const rateStr = speed && speed !== 1.0
    ? `${speed < 1.0 ? "-" : "+"}${Math.round(Math.abs(1.0 - speed) * 100)}%`
    : "+0%";

  const readable = tts.toStream(text.slice(0, 10000), { rate: rateStr }); // Edge TTS has generous limits

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      readable.destroy();
      reject(new Error("Edge TTS timed out after 60s"));
    }, 60_000);

    readable.on("data", (chunk: Buffer) => {
      // edge-tts-node emits objects with audio property or raw buffers
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (chunk && (chunk as any).audio) {
        chunks.push(Buffer.from((chunk as any).audio));
      }
    });

    readable.on("end", () => {
      clearTimeout(timeout);
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        reject(new Error("Edge TTS returned empty audio"));
      } else {
        console.log(`🔊 [EdgeTTS] Generated ${(buf.length / 1024).toFixed(0)}KB audio via ${EDGE_VOICE}`);
        resolve(buf);
      }
    });

    readable.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`Edge TTS stream error: ${err.message}`));
    });
  });
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

  const voiceId = config.voice.elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM";

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
        voice_settings: { stability: 0.65, similarity_boost: 0.80, style: 0.45, use_speaker_boost: true },
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
