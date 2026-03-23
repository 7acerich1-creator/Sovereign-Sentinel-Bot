// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Voice Transcription (Whisper)
// Transcribe voice messages via OpenAI Whisper API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

export async function transcribeAudio(audioBuffer: Buffer, mimeType = "audio/ogg"): Promise<string> {
  const apiKey = config.voice.whisperApiKey;
  if (!apiKey) throw new Error("Whisper API key not configured (OPENAI_API_KEY)");

  // Build multipart form data manually
  const boundary = `----FormBoundary${Date.now()}`;
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp3") ? "mp3" : "webm";
  const filename = `audio.${ext}`;

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );

  const modelPart = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-1`
  );

  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat([header, audioBuffer, modelPart, footer]);

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
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
