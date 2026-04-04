// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Vid Rush Automation Engine
// Auto-detect viral segments via Whisper + score them
// Then delegate to ClipGeneratorTool for production
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { Tool, ToolDefinition } from "../types";
import { ClipGeneratorTool } from "./clip-generator";
import { config } from "../config";
import { ytdlpDownload } from "../utils/ytdlp-download";

const CLIP_DIR = "/tmp/sovereign_clips";

// Sovereign keyword set for segment scoring
const SOVEREIGN_KEYWORDS = [
  "liberation", "escape", "firmware", "protocol", "sovereign",
  "simulation", "glitch", "velocity", "frequency", "architect",
  "consciousness", "matrix", "system", "code", "unlock",
  "wealth", "psychology", "dark", "power", "control",
  "manipulation", "influence", "mindset", "energy", "quantum",
];

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface ScoredWindow {
  start: number;
  end: number;
  text: string;
  score: number;
}

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

function scoreSegment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;

  // Keyword density
  for (const kw of SOVEREIGN_KEYWORDS) {
    const regex = new RegExp(kw, "gi");
    const matches = lower.match(regex);
    if (matches) score += matches.length * 2;
  }

  // Sentence energy — questions
  const questions = (text.match(/\?/g) || []).length;
  score += questions * 3;

  // Declarative energy — absolutes
  const absolutes = (lower.match(/\b(never|always|every|must|only|truth|secret|nobody|everyone)\b/g) || []).length;
  score += absolutes * 2;

  // Reveal patterns
  const reveals = (lower.match(/\b(here's|the real|actually|what they don't|the truth|secret is|nobody tells)\b/gi) || []).length;
  score += reveals * 4;

  // Sentence count bonus (more sentences = more content density)
  const sentences = (text.match(/[.!?]+/g) || []).length;
  score += Math.min(sentences, 5);

  return score;
}

function buildSlidingWindows(segments: WhisperSegment[], windowSec = 45): ScoredWindow[] {
  if (segments.length === 0) return [];

  const windows: ScoredWindow[] = [];
  const totalDuration = segments[segments.length - 1].end;

  for (let start = 0; start < totalDuration - 15; start += 10) {
    const end = Math.min(start + windowSec, totalDuration);
    if (end - start < 15) continue;

    const windowSegments = segments.filter(
      (s) => s.start >= start && s.end <= end
    );

    if (windowSegments.length === 0) continue;

    const text = windowSegments.map((s) => s.text).join(" ");
    const score = scoreSegment(text);

    windows.push({ start, end, text, score });
  }

  return windows.sort((a, b) => b.score - a.score);
}

function selectNonOverlapping(windows: ScoredWindow[], count: number): ScoredWindow[] {
  const selected: ScoredWindow[] = [];

  for (const w of windows) {
    if (selected.length >= count) break;

    const overlaps = selected.some(
      (s) => w.start < s.end && w.end > s.start
    );

    if (!overlaps) selected.push(w);
  }

  return selected.sort((a, b) => a.start - b.start);
}

export class VidRushTool implements Tool {
  definition: ToolDefinition = {
    name: "vid_rush",
    description:
      "Automated Vid Rush pipeline. Downloads a YouTube video, runs Whisper for word-level timestamps, " +
      "scores 30-60s windows by sovereign keyword density and sentence energy, then generates the top N clips " +
      "using the in-house ClipGeneratorTool (yt-dlp + ffmpeg). Auto-detects niche. " +
      "Use this for mass clip production from a single source video.",
    parameters: {
      youtube_url: {
        type: "string",
        description: "YouTube video URL to process",
      },
      target_clip_count: {
        type: "number",
        description: "Number of clips to generate (default 30). Selects top-scoring non-overlapping segments.",
      },
      niche_override: {
        type: "string",
        description: "Override auto-detection: dark_psychology, self_improvement, burnout, quantum",
      },
    },
    required: ["youtube_url"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const youtubeUrl = String(args.youtube_url);
    const targetCount = Number(args.target_clip_count) || 30;
    const nicheOverride = args.niche_override ? String(args.niche_override) : null;

    if (!existsSync(CLIP_DIR)) mkdirSync(CLIP_DIR, { recursive: true });

    const videoId = youtubeUrl.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1] || "unknown";
    const sourcePath = `${CLIP_DIR}/source_${videoId}.mp4`;
    const audioPath = `${CLIP_DIR}/audio_${videoId}.mp3`;
    const whisperOut = `${CLIP_DIR}/whisper_${videoId}.json`;

    // STEP 1 — Download (multi-strategy retry)
    try {
      ytdlpDownload({
        youtubeUrl,
        outputPath: sourcePath,
        label: "VidRush",
        timeout: 300_000,
      });
    } catch (err: any) {
      return `❌ Download failed: ${err.message?.slice(0, 300)}`;
    }

    // STEP 2 — Extract audio for Whisper
    try {
      if (!existsSync(audioPath)) {
        console.log(`🎵 [VidRush] Extracting audio as mp3 (Whisper API compatible)...`);
        execSync(
          `ffmpeg -i "${sourcePath}" -ar 16000 -ac 1 -c:a libmp3lame -b:a 64k -y "${audioPath}"`,
          { timeout: 120_000, stdio: "pipe" }
        );
      }
    } catch (err: any) {
      return `❌ Audio extraction failed: ${err.message?.slice(0, 300)}`;
    }

    // STEP 3 — Run Whisper transcription via Groq API (primary) or OpenAI API (fallback)
    // Groq offers whisper-large-v3-turbo with same API format, free tier 14,400 req/day
    let segments: WhisperSegment[] = [];
    try {
      if (!existsSync(whisperOut)) {
        // Provider selection: Groq primary (free tier, fast), OpenAI fallback
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
          return "❌ No Whisper API key configured. Set GROQ_API_KEY (preferred) or OPENAI_API_KEY in Railway env.";
        }

        console.log(`🗣️ [VidRush] Running Whisper transcription via ${providerName} (${whisperModel})...`);
        const audioBuffer = readFileSync(audioPath);

        // Groq has a 25MB file size limit — check before sending
        const fileSizeMB = audioBuffer.length / (1024 * 1024);
        if (fileSizeMB > 25) {
          console.log(`⚠️ [VidRush] Audio file is ${fileSizeMB.toFixed(1)}MB (limit 25MB). Chunking not yet implemented.`);
          return `❌ Audio file too large (${fileSizeMB.toFixed(1)}MB). Groq/OpenAI Whisper limit is 25MB. Video may be too long — try a shorter source.`;
        }

        // Build multipart form data for Whisper API with verbose_json for timestamps
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

        // If Groq fails, try OpenAI fallback
        if (!resp.ok && providerName === "Groq" && openaiKey) {
          const groqErr = await resp.text();
          console.warn(`⚠️ [VidRush] Groq Whisper failed (${resp.status}): ${groqErr.slice(0, 200)}. Falling back to OpenAI...`);

          // Rebuild body with OpenAI model
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
          return `❌ Whisper API error (${providerName}) ${resp.status}: ${errText.slice(0, 300)}`;
        }

        const raw: any = await resp.json();
        segments = (raw.segments || []).map((s: any) => ({
          start: s.start,
          end: s.end,
          text: s.text?.trim() || "",
        }));

        // Cache for re-runs
        writeFileSync(whisperOut, JSON.stringify(raw, null, 2));
        console.log(`✅ [VidRush] ${providerName} Whisper returned ${segments.length} segments`);
      } else {
        const raw = JSON.parse(readFileSync(whisperOut, "utf-8"));
        segments = (raw.segments || []).map((s: any) => ({
          start: s.start,
          end: s.end,
          text: s.text?.trim() || "",
        }));
      }
    } catch (err: any) {
      return `❌ Whisper transcription failed: ${err.message?.slice(0, 300)}`;
    }

    if (segments.length === 0) {
      return "❌ No speech segments detected in video.";
    }

    // STEP 4 — Score and select windows
    const fullText = segments.map((s) => s.text).join(" ");
    const niche = nicheOverride || detectNiche(fullText);

    const windows = buildSlidingWindows(segments, 45);
    const selected = selectNonOverlapping(windows, targetCount);

    if (selected.length === 0) {
      return "❌ No suitable clip windows found after scoring.";
    }

    // STEP 5 — Build timestamps and captions for ClipGeneratorTool
    const timestamps = selected.map((w) => ({
      start_seconds: Math.floor(w.start),
      end_seconds: Math.ceil(w.end),
    }));

    const clipCaptions = selected.map((w) => {
      const firstSentence = w.text.split(/[.!?]/)[0]?.trim() || "";
      return firstSentence.length > 80
        ? firstSentence.slice(0, 77) + "..."
        : firstSentence;
    });

    // STEP 6 — Delegate to ClipGeneratorTool
    console.log(`🎬 [VidRush] Generating ${selected.length} clips (niche: ${niche})...`);

    const clipTool = new ClipGeneratorTool();
    const result = await clipTool.execute({
      youtube_url: youtubeUrl,
      timestamps: JSON.stringify(timestamps),
      niche,
      captions: JSON.stringify(clipCaptions),
    });

    return (
      `🔥 VID RUSH SIEGE — COMPLETE\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Source: ${youtubeUrl}\n` +
      `Whisper segments: ${segments.length}\n` +
      `Windows scored: ${windows.length}\n` +
      `Clips selected: ${selected.length}/${targetCount}\n` +
      `Niche (${nicheOverride ? "override" : "auto-detected"}): ${niche}\n` +
      `Pipeline: yt-dlp → Whisper → ffmpeg → Supabase\n` +
      `Status: All clips queued\n\n` +
      result
    );
  }
}
