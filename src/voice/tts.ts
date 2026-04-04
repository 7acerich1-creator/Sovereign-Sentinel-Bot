// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Text-to-Speech
// OpenAI TTS + ElevenLabs integration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

export type TTSProvider = "openai" | "elevenlabs";

export interface TTSOptions {
  provider?: TTSProvider;
  speed?: number; // 0.5-2.0 for OpenAI, maps to stability for ElevenLabs
}

export async function textToSpeech(
  text: string,
  providerOrOpts?: TTSProvider | TTSOptions
): Promise<Buffer> {
  const opts: TTSOptions = typeof providerOrOpts === "string"
    ? { provider: providerOrOpts }
    : providerOrOpts || {};

  const selectedProvider = opts.provider || (config.voice.elevenLabsApiKey ? "elevenlabs" : "openai");

  switch (selectedProvider) {
    case "elevenlabs":
      return elevenLabsTTS(text, opts.speed);
    case "openai":
      return openaiTTS(text, opts.speed);
    default:
      throw new Error(`Unknown TTS provider: ${selectedProvider}`);
  }
}

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
      speed: speed || 1.0, // 0.25-4.0, lower = slower
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI TTS error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function elevenLabsTTS(text: string, speed?: number): Promise<Buffer> {
  const apiKey = config.voice.elevenLabsApiKey;
  if (!apiKey) throw new Error("ElevenLabs API key not configured");

  const voiceId = config.voice.elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM";

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
          // Sovereign Synthesis brand voice settings:
          // Authoritative, measured, documentary-style delivery
          stability,
          similarity_boost: 0.80,
          style: 0.35, // Reduced from 0.45 — less dramatic, more measured
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
