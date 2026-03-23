// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Text-to-Speech
// OpenAI TTS + ElevenLabs integration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

export type TTSProvider = "openai" | "elevenlabs";

export async function textToSpeech(
  text: string,
  provider?: TTSProvider
): Promise<Buffer> {
  const selectedProvider = provider || (config.voice.elevenLabsApiKey ? "elevenlabs" : "openai");

  switch (selectedProvider) {
    case "elevenlabs":
      return elevenLabsTTS(text);
    case "openai":
      return openaiTTS(text);
    default:
      throw new Error(`Unknown TTS provider: ${selectedProvider}`);
  }
}

async function openaiTTS(text: string): Promise<Buffer> {
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
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI TTS error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function elevenLabsTTS(text: string): Promise<Buffer> {
  const apiKey = config.voice.elevenLabsApiKey;
  if (!apiKey) throw new Error("ElevenLabs API key not configured");

  const voiceId = config.voice.elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM";

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
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
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
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
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
