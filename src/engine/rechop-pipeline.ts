// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 94 — Rechop Pipeline
// Retroactively generates native vertical shorts from existing
// long-form videos stored in R2. Flow:
//
//   1. List R2 long-forms → cross-ref with clips/ to find unprocessed
//   2. Download video from R2
//   3. Extract audio → Whisper transcribe (Groq primary, OpenAI fallback)
//   4. Build synthetic FacelessScript from Whisper segments
//   5. Run shorts-curator → get 3-6 curated short candidates
//   6. Extract per-short audio → upload to R2
//   7. Open single pod session → produceShort() for each
//   8. Rendered shorts land in R2 clips/ prefix → backlog-drainer distributes
//
// Does NOT touch the running batch pipeline. Standalone entry point.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from "fs";
import { S3Client, ListObjectsV2Command, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { curateShorts, type CuratorResult, type VerticalScene } from "./shorts-curator";
import { detectNiche } from "./whisper-extract";
import { withPodSession } from "../pod/session";
import { produceShort } from "../pod/runpod-client";
import { uploadToR2, isR2Configured, getR2PresignedUrl } from "../tools/r2-upload";
import type { ShortJobSpec, ShortScene } from "../pod/types";
import type { FacelessScript, ScriptSegment, Brand } from "./faceless-factory";
import type { LLMProvider } from "../types";
import { config } from "../config";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const RECHOP_DIR = "/tmp/rechop_pipeline";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL_BASE = process.env.R2_PUBLIC_URL_BASE;
const R2_BUCKET = process.env.R2_BUCKET_VIDEOS || "sovereign-videos";
const FFMPEG_TIMEOUT_MS = 180_000;

// ── Quality gate: only rechop videos produced AFTER all major quality fixes shipped.
// Videos from 2026-04-18 onward have XTTS voice, working captions, CTA, and
// proper audio levels. Anything before April 18 is pre-fix garbage.
// Override with /rechop N --force.
const RECHOP_MIN_DATE = new Date("2026-04-18T00:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface R2LongForm {
  key: string;
  publicUrl: string;
  brand: Brand;
  jobId: string;
  sizeBytes: number;
  lastModified: Date | null;
}

export interface RechopProgress {
  (step: string, detail: string): Promise<void>;
}

export interface RechopResult {
  videoKey: string;
  brand: Brand;
  shortsRendered: number;
  shortsFailed: number;
  clipKeys: string[];
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 Client (lazy)
// ─────────────────────────────────────────────────────────────────────────────

let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error("R2 env vars missing — cannot list/download videos");
    }
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase dedup — track which videos have been rechopped
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

/** Get set of video jobIds that have already been rechopped. */
async function getRechoppedJobIds(): Promise<Set<string>> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return new Set();
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/rechop_completed?select=video_job_id`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );
    if (!resp.ok) {
      // Table may not exist yet — treat all as un-rechopped
      console.warn(`⚠️ [Rechop] rechop_completed query failed (${resp.status}) — treating all as un-rechopped`);
      return new Set();
    }
    const rows = (await resp.json()) as any[];
    return new Set(rows.map((r) => r.video_job_id));
  } catch {
    return new Set();
  }
}

/** Mark a video as rechopped in Supabase. */
async function markRechopped(videoJobId: string, shortsCount: number, clipKeys: string[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rechop_completed`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        video_job_id: videoJobId,
        shorts_count: shortsCount,
        clip_keys: clipKeys,
        completed_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-critical — worst case we re-rechop (expensive but not destructive)
  }
}

/** SESSION 101: Remove a video from rechop_completed so it can be retried. */
export async function unmarkRechopped(videoJobId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/rechop_completed?video_job_id=eq.${encodeURIComponent(videoJobId)}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "return=minimal",
        },
      },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: List R2 long-forms without corresponding clips
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all long-form videos in R2. Optionally filter to only those
 * that haven't been rechopped (checked via Supabase rechop_completed table).
 * By default applies a quality gate: videos older than RECHOP_MIN_DATE are
 * skipped because they used Edge TTS (robotic audio). Override with force=true.
 */
export async function listR2LongForms(opts?: { onlyUnchopped?: boolean; force?: boolean }): Promise<R2LongForm[]> {
  const s3 = getS3();
  const base = (R2_PUBLIC_URL_BASE || "").replace(/^https?:\/\//, "");

  // List all videos/
  const videos: R2LongForm[] = [];
  let token: string | undefined;
  let listResp: ListObjectsV2CommandOutput;
  do {
    listResp = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: "videos/",
      MaxKeys: 500,
      ContinuationToken: token,
    }));
    for (const obj of listResp.Contents || []) {
      if (!obj.Key?.endsWith(".mp4")) continue;
      if ((obj.Size || 0) < 50_000) continue; // Skip tiny/corrupt files

      // Parse brand + jobId from key: videos/ace_richie/fv_ace_richie_xyz_123.mp4
      const parts = obj.Key.split("/");
      const brand = (parts[1] as Brand) || "ace_richie";
      const filename = parts[parts.length - 1].replace(".mp4", "");

      videos.push({
        key: obj.Key,
        publicUrl: `https://${base}/${obj.Key}`,
        brand,
        jobId: filename,
        sizeBytes: obj.Size || 0,
        lastModified: obj.LastModified || null,
      });
    }
    token = listResp.NextContinuationToken;
  } while (token);

  // ── Quality gate: skip pre-XTTS videos unless forced ──
  if (!opts?.force) {
    const before = videos.length;
    const filtered = videos.filter((v) => {
      if (!v.lastModified) return false; // No date = unknown era, skip
      return v.lastModified >= RECHOP_MIN_DATE;
    });
    const skipped = before - filtered.length;
    if (skipped > 0) {
      console.log(`🚫 [Rechop] Quality gate: skipped ${skipped} pre-XTTS videos (before ${RECHOP_MIN_DATE.toISOString().slice(0, 10)})`);
    }
    // Replace videos array with filtered
    videos.length = 0;
    videos.push(...filtered);
  }

  if (!opts?.onlyUnchopped) return videos;

  // Check Supabase for already-rechopped videos
  const rechopped = await getRechoppedJobIds();
  if (rechopped.size > 0) {
    console.log(`📋 [Rechop] ${rechopped.size} videos already rechopped (Supabase)`);
  }

  return videos.filter((v) => !rechopped.has(v.jobId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Download a video from R2
// ─────────────────────────────────────────────────────────────────────────────

async function downloadVideo(publicUrl: string, localPath: string): Promise<void> {
  console.log(`📥 [Rechop] Downloading ${publicUrl.slice(0, 80)}...`);
  execSync(`curl -sL -o "${localPath}" "${publicUrl}"`, {
    timeout: 600_000, // 10 min — large files
    stdio: "pipe",
  });
  const stat = statSync(localPath);
  console.log(`📥 [Rechop] Downloaded ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Extract audio + Whisper transcribe
// ─────────────────────────────────────────────────────────────────────────────

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

async function transcribeVideo(
  videoPath: string,
  jobId: string,
): Promise<{ segments: WhisperSegment[]; transcript: string; totalDuration: number }> {
  const audioPath = `${RECHOP_DIR}/${jobId}/audio.mp3`;

  // Extract audio at 16kHz mono for Whisper
  console.log(`🎵 [Rechop] Extracting audio...`);
  execSync(
    `ffmpeg -i "${videoPath}" -ar 16000 -ac 1 -c:a libmp3lame -b:a 64k -y "${audioPath}"`,
    { timeout: 120_000, stdio: "pipe" },
  );

  // Check file size — Whisper API limit is 25MB
  const audioStat = statSync(audioPath);
  const sizeMB = audioStat.size / (1024 * 1024);

  // If too large, re-encode at lower bitrate
  if (sizeMB > 24) {
    console.log(`⚠️ [Rechop] Audio ${sizeMB.toFixed(1)}MB > 25MB limit. Re-encoding at 32k...`);
    const audioPath2 = `${RECHOP_DIR}/${jobId}/audio_small.mp3`;
    execSync(
      `ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -c:a libmp3lame -b:a 32k -y "${audioPath2}"`,
      { timeout: 120_000, stdio: "pipe" },
    );
    // Replace
    unlinkSync(audioPath);
    execSync(`mv "${audioPath2}" "${audioPath}"`, { stdio: "pipe" });
  }

  // Get total duration via ffprobe
  let totalDuration = 0;
  try {
    const durationStr = execSync(
      `ffprobe -i "${videoPath}" -show_entries format=duration -v quiet -of csv="p=0"`,
      { timeout: 30_000, encoding: "utf-8" },
    ).trim();
    totalDuration = parseFloat(durationStr) || 0;
  } catch {
    console.warn(`⚠️ [Rechop] Could not probe duration`);
  }

  // Whisper transcription (Groq primary → OpenAI fallback)
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
    throw new Error("No Whisper API key (GROQ_API_KEY or OPENAI_API_KEY)");
  }

  console.log(`🗣️ [Rechop] Transcribing via ${providerName} (${whisperModel})...`);
  const audioBuffer = readFileSync(audioPath);

  const boundary = `----RechopBoundary${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n` +
    `Content-Type: audio/mpeg\r\n\r\n`,
  );
  const modelPart = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    whisperModel,
  );
  const formatPart = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
    `verbose_json`,
  );
  const langPart = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="language"\r\n\r\n` +
    `en`,
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
    console.warn(`⚠️ [Rechop] Groq Whisper failed (${resp.status}). Falling back to OpenAI...`);
    const oaiModelPart = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `whisper-1`,
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
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const raw: any = await resp.json();
  const segments: WhisperSegment[] = (raw.segments || []).map((s: any) => ({
    start: s.start,
    end: s.end,
    text: s.text?.trim() || "",
  }));

  // Use Whisper-reported duration if ffprobe failed
  if (!totalDuration && raw.duration) {
    totalDuration = raw.duration;
  }

  console.log(`✅ [Rechop] Whisper → ${segments.length} segments, ${totalDuration.toFixed(1)}s total`);
  return { segments, transcript: segments.map((s) => s.text).join(" "), totalDuration };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Build synthetic FacelessScript from Whisper output
// ─────────────────────────────────────────────────────────────────────────────

function buildSyntheticScript(
  whisperSegments: WhisperSegment[],
  brand: Brand,
  title: string,
  niche: string,
): { script: FacelessScript; segmentDurations: number[] } {
  // Group Whisper segments into ~20-30s logical chunks (matching typical scene durations)
  // This produces segments similar to what faceless-factory generates
  const TARGET_CHUNK_DURATION = 25; // seconds
  const chunks: { text: string; visual: string; duration: number }[] = [];
  let currentText = "";
  let currentStart = 0;
  let currentDuration = 0;

  for (const seg of whisperSegments) {
    const segDuration = seg.end - seg.start;
    currentText += (currentText ? " " : "") + seg.text;
    currentDuration += segDuration;

    if (currentDuration >= TARGET_CHUNK_DURATION) {
      chunks.push({
        text: currentText.trim(),
        visual: `Cinematic documentary scene illustrating: ${currentText.trim().slice(0, 150)}`,
        duration: currentDuration,
      });
      currentText = "";
      currentStart = seg.end;
      currentDuration = 0;
    }
  }

  // Flush remaining
  if (currentText.trim()) {
    chunks.push({
      text: currentText.trim(),
      visual: `Cinematic documentary scene illustrating: ${currentText.trim().slice(0, 150)}`,
      duration: currentDuration || 10,
    });
  }

  const segments: ScriptSegment[] = chunks.map((c) => ({
    voiceover: c.text,
    visual_direction: c.visual,
    duration_hint: c.duration,
  }));

  const segmentDurations = chunks.map((c) => c.duration);

  // Extract hook from first segment
  const hook = segments[0]?.voiceover?.split(/[.!?]/)[0]?.trim() || title;

  const script: FacelessScript = {
    title,
    niche,
    brand,
    hook,
    segments,
    cta: `Full video on the channel — ${brand === "containment_field" ? "@TheContainmentField" : "@ace_richie77"}`,
  };

  return { script, segmentDurations };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5-8: Rechop a single video end-to-end
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rechop a single long-form video into native vertical shorts.
 * This is the main entry point. Call with a video from listR2LongForms().
 */
export async function rechopVideo(
  video: R2LongForm,
  llm: LLMProvider,
  progress?: RechopProgress,
  externalPodHandle?: import("../pod/types").PodHandle,
): Promise<RechopResult> {
  const log = progress || (async (s: string, d: string) => console.log(`[Rechop] ${s}: ${d}`));
  const jobDir = `${RECHOP_DIR}/${video.jobId}`;
  if (!existsSync(jobDir)) mkdirSync(jobDir, { recursive: true });

  const result: RechopResult = {
    videoKey: video.key,
    brand: video.brand,
    shortsRendered: 0,
    shortsFailed: 0,
    clipKeys: [],
    errors: [],
  };

  try {
    // ── Step 1: Download video from R2 ──
    await log("STEP 1/5", `Downloading ${video.jobId} (${(video.sizeBytes / 1024 / 1024).toFixed(0)}MB)...`);
    const videoPath = `${jobDir}/source.mp4`;
    if (!existsSync(videoPath)) {
      await downloadVideo(video.publicUrl, videoPath);
    } else {
      console.log(`📦 [Rechop] Using cached download for ${video.jobId}`);
    }

    // ── Step 2: Whisper transcribe ──
    await log("STEP 2/5", "Transcribing with Whisper...");
    const whisper = await transcribeVideo(videoPath, video.jobId);

    if (whisper.segments.length < 3) {
      result.errors.push("Too few Whisper segments — video may be too short or silent");
      return result;
    }

    // ── Step 3: Build synthetic script + run shorts curator ──
    await log("STEP 3/5", "Running shorts curator...");
    const niche = detectNiche(whisper.transcript);
    const title = humanizeTitle(video.jobId, video.brand);

    const { script, segmentDurations } = buildSyntheticScript(
      whisper.segments,
      video.brand,
      title,
      niche,
    );

    const curatorResult: CuratorResult = await curateShorts(llm, script, segmentDurations);
    console.log(`🎬 [Rechop] Curator found ${curatorResult.shorts.length} shorts for ${video.jobId}`);

    if (curatorResult.shorts.length === 0) {
      await log("STEP 3/5", "⚠️ Curator found 0 worthy shorts — skipping");
      result.errors.push("Curator returned 0 shorts");
      return result;
    }

    // ── Step 4: Extract audio per-short + upload to R2 ──
    // SESSION 101b: DIAGNOSTIC TAG — if this line appears in Telegram, the new code is running.
    await log("STEP 4/5", `[S101b] Extracting audio for ${curatorResult.shorts.length} shorts (two-step WAV method)...`);
    const clipDir = `${jobDir}/clips`;
    if (!existsSync(clipDir)) mkdirSync(clipDir, { recursive: true });

    // SESSION 101: Two-step audio extraction — ROOT CAUSE FIX for silent shorts.
    // Extract the FULL audio track once, then seek within the WAV per-short.
    const fullAudioPath = `${jobDir}/full_audio.wav`;
    if (!existsSync(fullAudioPath)) {
      try {
        execSync(
          `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 48000 -ac 2 -y "${fullAudioPath}"`,
          { timeout: FFMPEG_TIMEOUT_MS, stdio: "pipe" },
        );
        const fullSize = statSync(fullAudioPath).size;
        console.log(`📦 [Rechop] Full audio extracted: ${(fullSize / 1024 / 1024).toFixed(1)}MB`);

        // DIAGNOSTIC: Verify the full WAV has audio, not silence
        try {
          const fullVol = execSync(
            `ffmpeg -i "${fullAudioPath}" -af volumedetect -f null /dev/null 2>&1 | grep mean_volume || true`,
            { timeout: 60_000, encoding: "utf-8" },
          );
          const fullVolMatch = fullVol.match(/mean_volume:\s*(-?\d+\.?\d*)/);
          const fullDb = fullVolMatch ? parseFloat(fullVolMatch[1]) : null;
          await log("STEP 4/5", `🔊 Full audio WAV: ${(fullSize / 1024 / 1024).toFixed(1)}MB, ${fullDb !== null ? fullDb.toFixed(1) + " dB" : "level unknown"}`);
          if (fullDb !== null && fullDb < -70) {
            result.errors.push(`Full audio WAV is SILENT (${fullDb.toFixed(1)} dB) — source video may have no audio`);
            return result;
          }
        } catch { /* non-fatal diagnostic */ }
      } catch (err: any) {
        console.error(`[Rechop] Full audio extraction FAILED: ${err.message?.slice(0, 300)}`);
        result.errors.push("Full audio extraction failed — cannot produce shorts");
        return result;
      }
    } else {
      await log("STEP 4/5", `📦 Using cached full_audio.wav (${(statSync(fullAudioPath).size / 1024 / 1024).toFixed(1)}MB)`);
    }

    interface PreparedShort {
      index: number;
      spec: ShortJobSpec;
      paddedStart: number;
      duration: number;
      hookText: string;
    }
    const podQueue: PreparedShort[] = [];

    // SESSION 101: Detect intro music offset — long-forms have a branded intro
    // with music-only before voice starts. Whisper's first segment tells us
    // where voice begins. Any short starting before this gets advanced past
    // the intro so viewers hear content immediately, not 4s of music.
    const voiceStartOffset = whisper.segments.length > 0 ? whisper.segments[0].start : 0;
    if (voiceStartOffset > 1) {
      console.log(`🎵 [Rechop] Intro music detected: voice starts at ${voiceStartOffset.toFixed(1)}s — shorts starting before this will be advanced`);
    }

    for (let i = 0; i < curatorResult.shorts.length; i++) {
      const short = curatorResult.shorts[i];

      // Extract audio segment with fade
      const PAD_BEFORE = 0.3;
      const PAD_AFTER = 1.5;
      const MAX_DURATION = 179;

      // SESSION 101: Skip intro music — if the short starts within the music-only
      // intro (before first voice segment), advance start_ts to where voice begins.
      let effectiveStart = short.start_ts;
      if (voiceStartOffset > 1 && effectiveStart < voiceStartOffset) {
        console.log(`  ⏩ Short ${i}: advancing start from ${effectiveStart.toFixed(1)}s → ${voiceStartOffset.toFixed(1)}s (skip intro music)`);
        effectiveStart = voiceStartOffset;
      }

      const paddedStart = Math.max(0, effectiveStart - PAD_BEFORE);
      const rawPaddedEnd = Math.min(whisper.totalDuration, short.end_ts + PAD_AFTER);
      const duration = Math.min(rawPaddedEnd - paddedStart, MAX_DURATION);

      const audioPath = `${clipDir}/audio_${i.toString().padStart(2, "0")}.wav`;
      const audioFilter = `afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0, duration - 0.5).toFixed(2)}:d=0.5`;

      try {
        // SESSION 101: Seek within the pre-extracted AUDIO-ONLY WAV.
        // WAV seeking is byte-exact — no container index issues.
        execSync(
          `ffmpeg -i "${fullAudioPath}" -ss ${paddedStart.toFixed(2)} -t ${duration.toFixed(2)} ` +
          `-acodec pcm_s16le -ar 48000 -ac 2 -af "${audioFilter}" -y "${audioPath}"`,
          { timeout: FFMPEG_TIMEOUT_MS, stdio: "pipe" },
        );
      } catch (err: any) {
        console.error(`[Rechop] Short ${i} audio extraction failed: ${err.message?.slice(0, 200)}`);
        result.shortsFailed++;
        result.errors.push(`Short ${i} audio extraction failed`);
        continue;
      }

      // SESSION 100: Post-extraction audio sanity check — detect silent extracts
      // BEFORE uploading to R2 and burning GPU render time on the pod.
      try {
        const volOut = execSync(
          `ffmpeg -i "${audioPath}" -af volumedetect -f null /dev/null 2>&1 | grep mean_volume || true`,
          { timeout: 30_000, encoding: "utf-8" },
        );
        const meanMatch = volOut.match(/mean_volume:\s*(-?\d+\.?\d*)/);
        const meanDb = meanMatch ? parseFloat(meanMatch[1]) : null;
        const fileSize = statSync(audioPath).size;
        console.log(`  🔊 Short ${i} audio: ${fileSize} bytes, ${meanDb !== null ? meanDb.toFixed(1) + " dB" : "level unknown"} (seek=${paddedStart.toFixed(1)}s, dur=${duration.toFixed(1)}s)`);
        if (meanDb !== null && meanDb < -70) {
          console.error(`[Rechop] ⚠️ Short ${i} audio is essentially SILENT (${meanDb.toFixed(1)} dB) — skipping to avoid Whisper hallucination`);
          result.shortsFailed++;
          result.errors.push(`Short ${i} audio silent at ${meanDb.toFixed(1)} dB`);
          continue;
        }
      } catch { /* non-fatal diagnostic */ }

      // Upload audio to R2
      let audioUrl: string | null = null;
      try {
        const r2Key = `rechop-audio/${video.jobId}/audio_${i.toString().padStart(2, "0")}.wav`;
        const audioBuf = readFileSync(audioPath);
        const r2Result = await uploadToR2(R2_BUCKET, r2Key, audioBuf, "audio/wav");
        audioUrl = await getR2PresignedUrl(R2_BUCKET, r2Key, 3600);
        console.log(`  📤 Short ${i} audio → R2 (presigned)`);
      } catch (err: any) {
        console.error(`[Rechop] Short ${i} R2 audio upload failed: ${err.message?.slice(0, 200)}`);
        result.shortsFailed++;
        result.errors.push(`Short ${i} R2 audio upload failed`);
        continue;
      }

      // Normalize scene durations to actual audio duration
      const rawSceneDurs = short.vertical_scenes.map((vs: VerticalScene) => vs.duration_s);
      const rawSum = rawSceneDurs.reduce((a: number, b: number) => a + b, 0);
      const driftRatio = rawSum > 0 ? duration / rawSum : 1;
      const normalizedDurs = rawSceneDurs.map((d: number) => Math.max(0.5, d * driftRatio));

      const vScenes: ShortScene[] = short.vertical_scenes.map((vs: VerticalScene, idx: number) => ({
        index: vs.index,
        image_prompt: vs.image_prompt,
        duration_s: normalizedDurs[idx],
      }));

      podQueue.push({
        index: i,
        spec: {
          brand: video.brand,
          audio_url: audioUrl,
          audio_duration_s: duration,
          scenes: vScenes,
          hook_text: short.hook_text?.slice(0, 200),
          cta_text: short.cta_overlay?.slice(0, 300),
          // Audio from rendered video (has music already) — pod should NOT add another music bed
          audio_is_raw_tts: false,
          client_job_id: `rechop_${video.jobId}_short_${i}`,
        },
        paddedStart,
        duration,
        hookText: short.hook_text,
      });
    }

    if (podQueue.length === 0) {
      await log("STEP 4/5", "⚠️ No shorts survived audio extraction — aborting");
      return result;
    }

    // ── Step 5: Render all shorts in single pod session ──
    await log("STEP 5/5", `Rendering ${podQueue.length} shorts on RunPod...`);

    // Compute clip folder ONCE — all shorts from this video go in the same folder.
    // Format: clips/{brand}_{niche}_{title}_{timestamp}/clip_XX.mp4
    // The folder name includes the original jobId so listR2LongForms() dedup
    // detects this video as "already chopped" and skips it on re-runs.
    // extractTitle() pops the last all-digit segment (timestamp), then shifts
    // the niche — remaining words become the human-readable title.
    // Clip folder format matches backlog-drainer's extractTitle() expectations:
    // {brand}_{niche}_{title_words}_{timestamp}
    // For dedup, we track rechopped videos in Supabase (rechop_completed table)
    // rather than trying to encode the source jobId in the folder name.
    const clipFolderName = `${video.brand}_${niche}_${sanitize(title)}_${Date.now()}`;

    // Inner render logic — runs with a PodHandle (either external or freshly created)
    const renderWithHandle = async (handle: import("../pod/types").PodHandle) => {
      for (const queued of podQueue) {
        try {
          const artifacts = await produceShort(handle, queued.spec);

          // Download rendered short from R2 (pod already uploaded it)
          const renderedClipPath = `${clipDir}/rendered_${queued.index.toString().padStart(2, "0")}.mp4`;
          execSync(`curl -sL -o "${renderedClipPath}" "${artifacts.videoUrl}"`, {
            timeout: 120_000,
            stdio: "pipe",
          });

          // Re-upload to clips/ prefix with proper naming for backlog-drainer.
          // All shorts from this video share one folder.
          const clipKey = `clips/${clipFolderName}/clip_${queued.index.toString().padStart(2, "0")}.mp4`;
          const clipBuf = readFileSync(renderedClipPath);
          const clipR2 = await uploadToR2(R2_BUCKET, clipKey, clipBuf, "video/mp4");

          result.shortsRendered++;
          result.clipKeys.push(clipR2.key);

          console.log(
            `  🎬 Short ${queued.index}: "${queued.hookText.slice(0, 50)}" ` +
            `${queued.duration.toFixed(1)}s → ${clipR2.publicUrl.slice(0, 80)}`,
          );
        } catch (podErr: any) {
          result.shortsFailed++;
          result.errors.push(`Short ${queued.index} pod render: ${podErr.message?.slice(0, 150)}`);
          console.error(`[Rechop] Short ${queued.index} FAILED: ${podErr.message?.slice(0, 300)}`);
          // Non-fatal — continue with next short in SAME pod session
        }
      }
    };

    try {
      if (externalPodHandle) {
        // Batch mode — caller owns the pod session, just render
        await renderWithHandle(externalPodHandle);
      } else {
        // Standalone mode — open our own pod session
        await withPodSession(renderWithHandle);
      }
    } catch (sessionErr: any) {
      result.errors.push(`Pod session failed: ${sessionErr.message?.slice(0, 200)}`);
      console.error(`[Rechop] Pod session FAILED: ${sessionErr.message?.slice(0, 300)}`);
    }

    // Mark as rechopped in Supabase — but ONLY if most shorts survived.
    // SESSION 101: If majority failed, DON'T mark as done so the video can be retried
    // after fixes are deployed. This prevents partial runs from permanently blocking retries.
    const totalAttempted = result.shortsRendered + result.shortsFailed;
    const successRate = totalAttempted > 0 ? result.shortsRendered / totalAttempted : 0;
    if (result.shortsRendered > 0 && successRate >= 0.5) {
      await markRechopped(video.jobId, result.shortsRendered, result.clipKeys);
    } else if (result.shortsRendered > 0) {
      console.log(`⚠️ [Rechop] Only ${result.shortsRendered}/${totalAttempted} shorts rendered (${(successRate * 100).toFixed(0)}%) — NOT marking as done (retry-eligible)`);
    }

    await log("DONE", `✅ ${result.shortsRendered}/${podQueue.length} shorts rendered for ${video.jobId}`);

  } finally {
    // Cleanup local files to free disk space
    try {
      const jobDirExists = existsSync(jobDir);
      if (jobDirExists) {
        execSync(`rm -rf "${jobDir}"`, { stdio: "pipe" });
      }
    } catch { /* non-fatal cleanup */ }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch rechop — process all unchopped videos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rechop ALL unchopped long-form videos in R2.
 * Processes sequentially to avoid pod contention with the main pipeline.
 */
export async function rechopAll(
  llm: LLMProvider,
  progress?: RechopProgress,
): Promise<RechopResult[]> {
  const log = progress || (async (s: string, d: string) => console.log(`[RechopAll] ${s}: ${d}`));

  const unchopped = await listR2LongForms({ onlyUnchopped: true });
  await log("SCAN", `Found ${unchopped.length} unchopped long-forms in R2`);

  if (unchopped.length === 0) return [];

  const results: RechopResult[] = [];
  for (let i = 0; i < unchopped.length; i++) {
    const video = unchopped[i];
    await log("BATCH", `Processing ${i + 1}/${unchopped.length}: ${video.jobId} (${video.brand})`);

    try {
      const result = await rechopVideo(video, llm, progress);
      results.push(result);
    } catch (err: any) {
      console.error(`[RechopAll] FATAL error on ${video.jobId}: ${err.message?.slice(0, 300)}`);
      results.push({
        videoKey: video.key,
        brand: video.brand,
        shortsRendered: 0,
        shortsFailed: 0,
        clipKeys: [],
        errors: [`Fatal: ${err.message?.slice(0, 200)}`],
      });
    }

    // 5s breathing room between videos
    if (i < unchopped.length - 1) {
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  const totalRendered = results.reduce((a, r) => a + r.shortsRendered, 0);
  const totalFailed = results.reduce((a, r) => a + r.shortsFailed, 0);
  await log("COMPLETE", `✅ ${totalRendered} shorts rendered, ${totalFailed} failed across ${results.length} videos`);

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch rechop — multiple selected videos in ONE pod session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rechop multiple videos sharing a SINGLE pod session.
 * Steps 1-4 (download, Whisper, curator, audio extract) run per-video BEFORE
 * the pod spins up. Then ONE withPodSession wraps ALL renders across all videos.
 * This eliminates cold-start waste: 1 pod spin-up instead of N.
 *
 * Each video still picks its own LLM (Ace vs TCF) — pass an llmForVideo resolver.
 */
export async function rechopBatch(
  videos: R2LongForm[],
  llmForVideo: (brand: Brand) => LLMProvider,
  progress?: RechopProgress,
): Promise<RechopResult[]> {
  const log = progress || (async (s: string, d: string) => console.log(`[RechopBatch] ${s}: ${d}`));

  // Phase 1: prep all videos (download + Whisper + curator + audio extraction)
  // This happens BEFORE any pod is started, so no GPU time is wasted on I/O.
  interface PreppedVideo {
    video: R2LongForm;
    result: RechopResult;
    podQueue: any[]; // PreparedShort[] — but keeping loose to avoid duplication
    clipDir: string;
    clipFolderName: string;
    jobDir: string;
  }
  const prepped: PreppedVideo[] = [];

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    await log("PREP", `[${i + 1}/${videos.length}] Preparing ${video.jobId.slice(0, 40)} (${video.brand})...`);

    try {
      // Use rechopVideo with a special sentinel to collect prep work but skip pod render.
      // Instead, we just call the prep steps directly here for clarity.
      const llm = llmForVideo(video.brand);
      const prepResult = await rechopVideoPrepOnly(video, llm, progress);
      if (prepResult) {
        prepped.push(prepResult);
      }
    } catch (err: any) {
      await log("PREP", `⚠️ ${video.jobId.slice(0, 40)} prep failed: ${err.message?.slice(0, 150)}`);
    }
  }

  if (prepped.length === 0) {
    await log("COMPLETE", "No videos survived prep phase — nothing to render.");
    return videos.map((v) => ({
      videoKey: v.key, brand: v.brand,
      shortsRendered: 0, shortsFailed: 0, clipKeys: [], errors: ["Prep failed"],
    }));
  }

  const totalShorts = prepped.reduce((a, p) => a + p.podQueue.length, 0);
  await log("RENDER", `🔥 Spinning up ONE pod for ${totalShorts} shorts across ${prepped.length} videos...`);

  // Phase 2: ONE pod session renders ALL shorts across ALL videos
  try {
    await withPodSession(async (handle) => {
      for (const p of prepped) {
        await log("RENDER", `Rendering ${p.podQueue.length} shorts for ${p.video.jobId.slice(0, 40)}...`);
        for (const queued of p.podQueue) {
          try {
            const artifacts = await produceShort(handle, queued.spec);

            const renderedClipPath = `${p.clipDir}/rendered_${queued.index.toString().padStart(2, "0")}.mp4`;
            execSync(`curl -sL -o "${renderedClipPath}" "${artifacts.videoUrl}"`, {
              timeout: 120_000,
              stdio: "pipe",
            });

            const clipKey = `clips/${p.clipFolderName}/clip_${queued.index.toString().padStart(2, "0")}.mp4`;
            const clipBuf = readFileSync(renderedClipPath);
            const clipR2 = await uploadToR2(R2_BUCKET, clipKey, clipBuf, "video/mp4");

            p.result.shortsRendered++;
            p.result.clipKeys.push(clipR2.key);

            console.log(
              `  🎬 Short ${queued.index}: "${queued.hookText.slice(0, 50)}" ` +
              `${queued.duration.toFixed(1)}s → ${clipR2.publicUrl.slice(0, 80)}`,
            );
          } catch (podErr: any) {
            p.result.shortsFailed++;
            p.result.errors.push(`Short ${queued.index} pod render: ${podErr.message?.slice(0, 150)}`);
            console.error(`[RechopBatch] Short ${queued.index} FAILED: ${podErr.message?.slice(0, 300)}`);
          }
        }

        // Mark video as rechopped — only if majority succeeded (SESSION 101)
        const batchTotal = p.result.shortsRendered + p.result.shortsFailed;
        const batchRate = batchTotal > 0 ? p.result.shortsRendered / batchTotal : 0;
        if (p.result.shortsRendered > 0 && batchRate >= 0.5) {
          await markRechopped(p.video.jobId, p.result.shortsRendered, p.result.clipKeys);
        } else if (p.result.shortsRendered > 0) {
          console.log(`⚠️ [RechopBatch] ${p.video.jobId}: ${p.result.shortsRendered}/${batchTotal} — NOT marking done`);
        }
      }
    });
  } catch (sessionErr: any) {
    await log("RENDER", `❌ Pod session failed: ${sessionErr.message?.slice(0, 200)}`);
    for (const p of prepped) {
      if (p.result.shortsRendered === 0) {
        p.result.errors.push(`Pod session failed: ${sessionErr.message?.slice(0, 200)}`);
      }
    }
  }

  // Phase 3: Cleanup
  for (const p of prepped) {
    try {
      if (existsSync(p.jobDir)) execSync(`rm -rf "${p.jobDir}"`, { stdio: "pipe" });
    } catch { /* non-fatal */ }
  }

  const results = prepped.map((p) => p.result);
  const totalRendered = results.reduce((a, r) => a + r.shortsRendered, 0);
  const totalFailed = results.reduce((a, r) => a + r.shortsFailed, 0);
  await log("COMPLETE", `✅ ${totalRendered} shorts rendered, ${totalFailed} failed across ${prepped.length} videos (1 pod session)`);

  return results;
}

/**
 * Internal: Run steps 1-4 of rechopVideo (download, Whisper, curator, audio extract)
 * WITHOUT starting a pod. Returns the prepped data for batch rendering.
 */
async function rechopVideoPrepOnly(
  video: R2LongForm,
  llm: LLMProvider,
  progress?: RechopProgress,
): Promise<{
  video: R2LongForm;
  result: RechopResult;
  podQueue: any[];
  clipDir: string;
  clipFolderName: string;
  jobDir: string;
} | null> {
  const log = progress || (async (s: string, d: string) => console.log(`[RechopPrep] ${s}: ${d}`));
  const jobDir = `${RECHOP_DIR}/${video.jobId}`;
  if (!existsSync(jobDir)) mkdirSync(jobDir, { recursive: true });

  const result: RechopResult = {
    videoKey: video.key,
    brand: video.brand,
    shortsRendered: 0,
    shortsFailed: 0,
    clipKeys: [],
    errors: [],
  };

  // Step 1: Download
  await log("PREP 1/4", `Downloading ${video.jobId.slice(0, 40)} (${(video.sizeBytes / 1024 / 1024).toFixed(0)}MB)...`);
  const videoPath = `${jobDir}/source.mp4`;
  if (!existsSync(videoPath)) {
    await downloadVideo(video.publicUrl, videoPath);
  }

  // Step 2: Whisper
  await log("PREP 2/4", `Transcribing ${video.jobId.slice(0, 40)}...`);
  const whisper = await transcribeVideo(videoPath, video.jobId);
  if (whisper.segments.length < 3) {
    result.errors.push("Too few Whisper segments");
    return null;
  }

  // Step 3: Curator
  await log("PREP 3/4", `Running curator for ${video.jobId.slice(0, 40)}...`);
  const niche = detectNiche(whisper.transcript);
  const title = humanizeTitle(video.jobId, video.brand);
  const { script, segmentDurations } = buildSyntheticScript(whisper.segments, video.brand, title, niche);
  const curatorResult: CuratorResult = await curateShorts(llm, script, segmentDurations);

  if (curatorResult.shorts.length === 0) {
    result.errors.push("Curator returned 0 shorts");
    return null;
  }

  // Step 4: Audio extraction per short
  await log("PREP 4/4", `Extracting audio for ${curatorResult.shorts.length} shorts...`);
  const clipDir = `${jobDir}/clips`;
  if (!existsSync(clipDir)) mkdirSync(clipDir, { recursive: true });

  const podQueue: any[] = [];

  for (let i = 0; i < curatorResult.shorts.length; i++) {
    const short = curatorResult.shorts[i];
    const PAD_BEFORE = 0.3;
    const PAD_AFTER = 1.5;
    const MAX_DURATION = 179;
    const paddedStart = Math.max(0, short.start_ts - PAD_BEFORE);
    const rawPaddedEnd = Math.min(whisper.totalDuration, short.end_ts + PAD_AFTER);
    const duration = Math.min(rawPaddedEnd - paddedStart, MAX_DURATION);

    const audioPath = `${clipDir}/audio_${i.toString().padStart(2, "0")}.wav`;
    const audioFilter = `afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0, duration - 0.5).toFixed(2)}:d=0.5`;

    try {
      // Output seeking (-ss AFTER -i) — accurate at all seek positions.
      execSync(
        `ffmpeg -i "${videoPath}" -ss ${paddedStart.toFixed(2)} -t ${duration.toFixed(2)} ` +
        `-vn -acodec pcm_s16le -ar 48000 -ac 2 -af "${audioFilter}" -y "${audioPath}"`,
        { timeout: FFMPEG_TIMEOUT_MS, stdio: "pipe" },
      );
    } catch (err: any) {
      result.shortsFailed++;
      result.errors.push(`Short ${i} audio extraction failed`);
      continue;
    }

    let audioUrl: string | null = null;
    try {
      const r2Key = `rechop-audio/${video.jobId}/audio_${i.toString().padStart(2, "0")}.wav`;
      const audioBuf = readFileSync(audioPath);
      const r2Result = await uploadToR2(R2_BUCKET, r2Key, audioBuf, "audio/wav");
      audioUrl = await getR2PresignedUrl(R2_BUCKET, r2Key, 3600);
    } catch (err: any) {
      result.shortsFailed++;
      result.errors.push(`Short ${i} R2 audio upload failed`);
      continue;
    }

    const rawSceneDurs = short.vertical_scenes.map((vs: VerticalScene) => vs.duration_s);
    const rawSum = rawSceneDurs.reduce((a: number, b: number) => a + b, 0);
    const driftRatio = rawSum > 0 ? duration / rawSum : 1;
    const normalizedDurs = rawSceneDurs.map((d: number) => Math.max(0.5, d * driftRatio));

    const vScenes: ShortScene[] = short.vertical_scenes.map((vs: VerticalScene, idx: number) => ({
      index: vs.index,
      image_prompt: vs.image_prompt,
      duration_s: normalizedDurs[idx],
    }));

    podQueue.push({
      index: i,
      spec: {
        brand: video.brand,
        audio_url: audioUrl,
        audio_duration_s: duration,
        scenes: vScenes,
        hook_text: short.hook_text?.slice(0, 200),
        cta_text: short.cta_overlay?.slice(0, 300),
        audio_is_raw_tts: false,
        client_job_id: `rechop_${video.jobId}_short_${i}`,
      },
      paddedStart,
      duration,
      hookText: short.hook_text,
    });
  }

  if (podQueue.length === 0) {
    result.errors.push("No shorts survived audio extraction");
    return null;
  }

  const clipFolderName = `${video.brand}_${niche}_${sanitize(title)}_${Date.now()}`;

  return { video, result, podQueue, clipDir, clipFolderName, jobDir };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert R2 filename like fv_ace_richie_architecture_collapse_your_1776477930087 into a readable title */
function humanizeTitle(jobId: string, brand: Brand): string {
  let clean = jobId
    .replace(/^fv_/, "")
    .replace(/^job_[\da-f]+$/, "") // job_xxx format has no title info
    .replace(`${brand}_`, "")
    .replace(/_\d{10,}$/, ""); // trailing timestamp

  if (!clean) return "Sovereign Synthesis";

  // Remove niche prefix (first word)
  const parts = clean.split("_");
  if (parts.length > 2) parts.shift();

  return parts
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .slice(0, 90);
}

/** Sanitize a string for use as an R2 key segment */
function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}
