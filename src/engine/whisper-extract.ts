// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Whisper Extraction Utility
// Lightweight: yt-dlp download + Groq/OpenAI Whisper
// Shared by Faceless Factory (default) and Clip Ripper (on-demand)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { config } from "../config";

const CLIP_DIR = "/tmp/sovereign_clips";

export interface WhisperResult {
  videoId: string;
  transcript: string;
  segments: { start: number; end: number; text: string }[];
  sourcePath: string;
  audioPath: string;
  whisperPath: string;
  niche: string;
}

/**
 * Downloads a YouTube video and runs Whisper transcription.
 * Returns the transcript text + segments + detected niche.
 * Caches results — safe to call multiple times for same videoId.
 */
export async function extractWhisperIntel(youtubeUrl: string): Promise<WhisperResult> {
  if (!existsSync(CLIP_DIR)) mkdirSync(CLIP_DIR, { recursive: true });

  const videoId = youtubeUrl.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1] || "unknown";
  const sourcePath = `${CLIP_DIR}/source_${videoId}.mp4`;
  const audioPath = `${CLIP_DIR}/audio_${videoId}.mp3`;
  const whisperPath = `${CLIP_DIR}/whisper_${videoId}.json`;

  // ── STEP 1: Download video via yt-dlp ──
  if (!existsSync(sourcePath)) {
    console.log(`📥 [WhisperExtract] Downloading ${youtubeUrl}...`);
    execSync(
      `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" ` +
        `--merge-output-format mp4 -o "${sourcePath}" "${youtubeUrl}"`,
      { timeout: 300_000, stdio: "pipe" }
    );
  }

  // ── STEP 2: Extract audio for Whisper ──
  if (!existsSync(audioPath)) {
    console.log(`🎵 [WhisperExtract] Extracting audio...`);
    execSync(
      `ffmpeg -i "${sourcePath}" -ar 16000 -ac 1 -c:a libmp3lame -b:a 64k -y "${audioPath}"`,
      { timeout: 120_000, stdio: "pipe" }
    );
  }

  // ── STEP 3: Run Whisper (Groq primary, OpenAI fallback) ──
  let segments: { start: number; end: number; text: string }[] = [];

  if (!existsSync(whisperPath)) {
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = config.voice.whisperApiKey;

    let whisperApiKey: string;
    let whisperEndpoint: string;
    let whisperModel: string;
    let providerName: string;

    if (groqKey) {
      whisperApiKey = groqKey;
      whisperEndpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
      whisperModel = "whisper-large-v3-turbo";
      providerName = "Groq";
    } else if (openaiKey) {
      whisperApiKey = openaiKey;
      whisperEndpoint = "https://api.openai.com/v1/audio/transcriptions";
      whisperModel = "whisper-1";
      providerName = "OpenAI";
    } else {
      throw new Error("No Whisper API key configured. Set GROQ_API_KEY (preferred) or OPENAI_API_KEY.");
    }

    console.log(`🗣️ [WhisperExtract] Transcribing via ${providerName} (${whisperModel})...`);
    const audioBuffer = readFileSync(audioPath);

    const fileSizeMB = audioBuffer.length / (1024 * 1024);
    if (fileSizeMB > 25) {
      throw new Error(`Audio file too large (${fileSizeMB.toFixed(1)}MB). Whisper limit is 25MB.`);
    }

    const boundary = `----FormBoundary${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n` +
      `Content-Type: audio/mpeg\r\n\r\n`
    );
    const modelPart = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      whisperModel
    );
    const formatPart = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `verbose_json`
    );
    const langPart = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `en`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, audioBuffer, modelPart, formatPart, langPart, footer]);

    let resp = await fetch(whisperEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whisperApiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    // Groq fail → OpenAI fallback
    if (!resp.ok && providerName === "Groq" && openaiKey) {
      console.warn(`⚠️ [WhisperExtract] Groq failed (${resp.status}). Falling back to OpenAI...`);
      const oaiModelPart = Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `whisper-1`
      );
      const oaiBody = Buffer.concat([header, audioBuffer, oaiModelPart, formatPart, langPart, footer]);

      resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: oaiBody,
      });
      providerName = "OpenAI (fallback)";
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Whisper API error (${providerName}) ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const raw: any = await resp.json();
    segments = (raw.segments || []).map((s: any) => ({
      start: s.start,
      end: s.end,
      text: s.text?.trim() || "",
    }));

    writeFileSync(whisperPath, JSON.stringify(raw, null, 2));
    console.log(`✅ [WhisperExtract] ${providerName} Whisper → ${segments.length} segments`);
  } else {
    const raw = JSON.parse(readFileSync(whisperPath, "utf-8"));
    segments = (raw.segments || []).map((s: any) => ({
      start: s.start,
      end: s.end,
      text: s.text?.trim() || "",
    }));
    console.log(`📦 [WhisperExtract] Using cached Whisper (${segments.length} segments)`);
  }

  const transcript = segments.map((s) => s.text).join(" ");
  const niche = detectNiche(transcript);

  return { videoId, transcript, segments, sourcePath, audioPath, whisperPath, niche };
}

// ── Niche detection (shared logic) ──
function detectNiche(text: string): string {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {
    dark_psychology: 0,
    self_improvement: 0,
    burnout: 0,
    quantum: 0,
  };

  const nicheKeywords: Record<string, string[]> = {
    dark_psychology: ["dark", "psychology", "manipulation", "influence", "control", "power", "narciss", "exploit"],
    self_improvement: ["mindset", "growth", "discipline", "habit", "success", "goal", "motivation", "improve"],
    burnout: ["burnout", "exhaustion", "stress", "overwhelm", "recovery", "rest", "fatigue", "boundary"],
    quantum: ["quantum", "physics", "energy", "frequency", "vibration", "consciousness", "dimension", "wave"],
  };

  for (const [niche, keywords] of Object.entries(nicheKeywords)) {
    for (const kw of keywords) {
      const regex = new RegExp(kw, "gi");
      const matches = lower.match(regex);
      if (matches) scores[niche] += matches.length;
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] > 0 ? sorted[0][0] : "dark_psychology";
}
