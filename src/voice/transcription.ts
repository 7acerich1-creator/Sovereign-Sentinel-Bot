// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Voice Transcription (Whisper)
// Transcribe voice messages via OpenAI Whisper API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

export async function transcribeAudio(audioBuffer: Buffer, mimeType = "audio/ogg"): Promise<string> {
  // S114q: Groq Whisper-large-v3 PRIMARY (free), OpenAI fallback (paid).
  // OpenAI quota exceeded 2026-04-25 — Groq has GROQ_API_KEY already set.
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = config.voice.whisperApiKey;

  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp3") ? "mp3" : mimeType.includes("wav") ? "wav" : "webm";
  const filename = `audio.${ext}`;

  function buildBody() {
    const boundary = `----FormBoundary${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    return { boundary, header, footer };
  }

  // Try Groq first (free)
  if (groqKey) {
    try {
      const { boundary, header, footer } = buildBody();
      const modelPart = Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `whisper-large-v3`
      );
      const body = Buffer.concat([header, audioBuffer, modelPart, footer]);
      const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body,
      });
      if (resp.ok) {
        const data: any = await resp.json();
        if (data.text) return data.text;
      } else {
        console.warn(`[Whisper] Groq ${resp.status} — falling back to OpenAI`);
      }
    } catch (e: any) {
      console.warn(`[Whisper] Groq error: ${e.message} — falling back to OpenAI`);
    }
  }

  if (!openaiKey) throw new Error("No transcription provider available (GROQ_API_KEY + OPENAI_API_KEY both unset).");

  const { boundary, header, footer } = buildBody();
  const modelPart = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-1`
  );
  const body = Buffer.concat([header, audioBuffer, modelPart, footer]);

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper API error ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data: any = await resp.json();
  return data.text || "";
}

export async function downloadTelegramFile(fileUrl: string): Promise<Buffer> {
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error(`Failed to download file: HTTP ${resp.status}`);
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
