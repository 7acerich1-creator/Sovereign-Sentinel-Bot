// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 94 — Rechop Pipeline
// Retroactively generates native vertical shorts from existing
// long-form videos stored in R2. Flow:
//
//   1. List R2 long-forms → cross-ref with clips/ to find unprocessed
//   2. Download video from R2
//   3. Extract audio → Whisper transcribe (Groq primary, OpenAI fallback)
//   4. Generate 4 STANDALONE short scripts from the transcript thesis
//      (each is a complete self-contained story — NO chopping)
//   5. TTS each standalone short → upload audio to R2
//   6. Open single pod session → produceShort() for each
//   7. Rendered shorts land in R2 clips/ prefix → backlog-drainer distributes
//
// SESSION 103b: Replaced curateShorts() chop approach with generateStandaloneShorts().
// The curator was picking segment ranges that cut mid-thought, producing incoherent
// shorts. Standalone generation creates each short as a complete narrative from the
// same thesis — one LLM call, 4 perfect shorts, no chopping math.
//
// Does NOT touch the running batch pipeline. Standalone entry point.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from "fs";
import { S3Client, ListObjectsV2Command, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { detectNiche } from "./whisper-extract";
import { withPodSession } from "../pod/session";
import { produceShort, podTTS } from "../pod/runpod-client";
import { uploadToR2, isR2Configured, getR2PresignedUrl } from "../tools/r2-upload";
import type { ShortJobSpec, ShortScene } from "../pod/types";
import type { Brand } from "./faceless-factory";
import { generateStandaloneShorts, renderAudio, type StandaloneShort, type TTSFunction } from "./faceless-factory";
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
// Rechop a single video end-to-end
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

    // ── Step 3: Generate standalone shorts from transcript thesis ──
    // SESSION 103b: Replaced curateShorts() chopping with generateStandaloneShorts().
    // Each short is a complete self-contained story — no mid-thought cuts.
    await log("STEP 3/6", "Generating standalone shorts from thesis...");
    const niche = detectNiche(whisper.transcript);
    const title = humanizeTitle(video.jobId, video.brand);

    // Use the Whisper transcript as source intelligence for standalone generation.
    // The LLM draws INSPIRATION from the long-form content but writes 4 complete,
    // self-contained short scripts — each one a standalone story.
    const standaloneShorts = await generateStandaloneShorts(
      llm,
      whisper.transcript,
      niche,
      video.brand as Brand,
    );
    console.log(`🎬 [Rechop] Generated ${standaloneShorts.length} standalone shorts for ${video.jobId}`);

    if (standaloneShorts.length === 0) {
      await log("STEP 3/6", "⚠️ Standalone generation returned 0 shorts — skipping");
      result.errors.push("Standalone shorts generation failed");
      return result;
    }

    // ── Step 4: TTS each standalone short ──
    // SESSION 103b: Each short gets its own TTS — complete fresh audio, no chopping.
    // SESSION 105: TTS runs on pod (XTTS) — Edge TTS chain broken since XTTS_SERVER_URL purged.
    await log("STEP 4/6", `TTS for ${standaloneShorts.length} standalone shorts (XTTS on pod)...`);
    const clipDir = `${jobDir}/clips`;
    if (!existsSync(clipDir)) mkdirSync(clipDir, { recursive: true });

    interface PreparedShort {
      index: number;
      spec: ShortJobSpec;
      duration: number;
      hookText: string;
    }
    const podQueue: PreparedShort[] = [];

    // SESSION 105: Pod TTS function — wraps podTTS for renderAudio's TTSFunction signature
    const podTTSForRender = async (ttsHandle: import("../pod/types").PodHandle): Promise<TTSFunction> => {
      return async (text: string, brand: Brand): Promise<Buffer> => {
        const { audioBuffer } = await podTTS(ttsHandle, { text, brand });
        return audioBuffer;
      };
    };

    // TTS + render share ONE pod session — no double cold-start
    const runTTSAndRender = async (handle: import("../pod/types").PodHandle) => {
      const ttsFn = await podTTSForRender(handle);

      for (let i = 0; i < standaloneShorts.length; i++) {
        const standalone = standaloneShorts[i];
        const shortJobId = `rechop_${video.jobId}_standalone_${i}`;

        // ── Step A: TTS the standalone short script ──
        await log("STEP 4/6", `TTS short ${i + 1}/${standaloneShorts.length}: "${standalone.script.title.slice(0, 40)}..."`);
        let ttsAudioPath: string;
        let audioDuration: number;
        let segDurations: number[];
        try {
          const audioResult = await renderAudio(standalone.script, shortJobId, ttsFn);
          ttsAudioPath = audioResult.audioPath;
        segDurations = audioResult.segmentDurations;
        audioDuration = segDurations.reduce((a, b) => a + b, 0);
        console.log(`  🎤 Short ${i} TTS complete: ${audioDuration.toFixed(1)}s (${segDurations.length} segments)`);
      } catch (ttsErr: any) {
        console.error(`[Rechop] Short ${i} TTS FAILED: ${ttsErr.message?.slice(0, 200)}`);
        result.shortsFailed++;
        result.errors.push(`Short ${i} TTS failed: ${ttsErr.message?.slice(0, 100)}`);
        continue;
      }

      // ── Step B: Convert to WAV (pod expects WAV) and upload to R2 ──
      await log("STEP 5/6", `Uploading short ${i + 1} audio to R2...`);
      const wavPath = `${clipDir}/standalone_audio_${i.toString().padStart(2, "0")}.wav`;
      try {
        execSync(
          `ffmpeg -i "${ttsAudioPath}" -vn -acodec pcm_s16le -ar 48000 -ac 2 -y "${wavPath}"`,
          { timeout: 30_000, stdio: "pipe" },
        );
      } catch (convErr: any) {
        console.error(`[Rechop] Short ${i} WAV conversion failed: ${convErr.message?.slice(0, 200)}`);
        result.shortsFailed++;
        result.errors.push(`Short ${i} WAV conversion failed`);
        continue;
      }

      let audioUrl: string | null = null;
      try {
        const r2Key = `rechop-audio/${video.jobId}/standalone_${i.toString().padStart(2, "0")}.wav`;
        const audioBuf = readFileSync(wavPath);
        await uploadToR2(R2_BUCKET, r2Key, audioBuf, "audio/wav");
        audioUrl = await getR2PresignedUrl(R2_BUCKET, r2Key, 3600);
        console.log(`  📤 Short ${i} audio → R2 (presigned)`);
      } catch (err: any) {
        console.error(`[Rechop] Short ${i} R2 audio upload failed: ${err.message?.slice(0, 200)}`);
        result.shortsFailed++;
        result.errors.push(`Short ${i} R2 audio upload failed`);
        continue;
      }

      if (!audioUrl) {
        console.warn(`  ⚠️ Short ${i}: no R2 audio URL — skipping`);
        result.shortsFailed++;
        continue;
      }

      // ── Step C: Build pod job spec ──
      // Normalize vertical_scene durations to match actual TTS audio duration
      const rawSceneDurs = standalone.vertical_scenes.map(vs => vs.duration_s);
      const rawSum = rawSceneDurs.reduce((a, b) => a + b, 0);
      const driftRatio = rawSum > 0 ? audioDuration / rawSum : 1;

      const vScenes: ShortScene[] = standalone.vertical_scenes.map((vs, idx) => ({
        index: vs.index,
        image_prompt: vs.image_prompt,
        duration_s: Math.max(0.5, rawSceneDurs[idx] * driftRatio),
      }));

      podQueue.push({
        index: i,
        spec: {
          brand: video.brand,
          audio_url: audioUrl,
          audio_duration_s: audioDuration,
          scenes: vScenes,
          hook_text: standalone.script.hook?.slice(0, 200),
          cta_text: standalone.cta_overlay?.slice(0, 300),
          audio_is_raw_tts: true, // Standalone shorts = fresh TTS, pod adds music bed
          client_job_id: shortJobId,
        },
        duration: audioDuration,
        hookText: standalone.script.hook || standalone.script.title,
      });
      }

      if (podQueue.length === 0) {
        await log("STEP 5/6", "⚠️ No shorts survived TTS — aborting");
        return;
      }

      // ── Step 5: Render all shorts (same pod session as TTS) ──
      await log("STEP 5/5", `Rendering ${podQueue.length} shorts on RunPod...`);

      for (const queued of podQueue) {
        try {
          const artifacts = await produceShort(handle, queued.spec);

          const renderedClipPath = `${clipDir}/rendered_${queued.index.toString().padStart(2, "0")}.mp4`;
          execSync(`curl -sL -o "${renderedClipPath}" "${artifacts.videoUrl}"`, {
            timeout: 120_000,
            stdio: "pipe",
          });

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
        }
      }
    }; // end runTTSAndRender

    // Clip folder for backlog-drainer — format: {brand}_{niche}_{title}_{timestamp}
    const clipFolderName = `${video.brand}_${niche}_${sanitize(title)}_${Date.now()}`;

    try {
      if (externalPodHandle) {
        await runTTSAndRender(externalPodHandle);
      } else {
        await withPodSession(runTTSAndRender);
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
 * Steps 1-4 (download, Whisper, standalone generation, TTS) run per-video BEFORE
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

  // Phase 1: prep all videos (download + Whisper + standalone generation + TTS)
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
 * Internal: Run steps 1-4 of rechopVideo (download, Whisper, standalone generation, TTS)
 * WITHOUT starting a pod. Returns the prepped data for batch rendering.
 * SESSION 103b: Uses generateStandaloneShorts() — same as main rechopVideo.
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

  // Step 3: Generate standalone shorts from transcript thesis
  // SESSION 103b: Same standalone approach as main rechopVideo — no curator chopping.
  await log("PREP 3/5", `Generating standalone shorts for ${video.jobId.slice(0, 40)}...`);
  const niche = detectNiche(whisper.transcript);
  const title = humanizeTitle(video.jobId, video.brand);

  const standaloneShorts = await generateStandaloneShorts(
    llm,
    whisper.transcript,
    niche,
    video.brand as Brand,
  );
  console.log(`🎬 [RechopPrep] Generated ${standaloneShorts.length} standalone shorts for ${video.jobId}`);

  if (standaloneShorts.length === 0) {
    result.errors.push("Standalone shorts generation failed");
    return null;
  }

  // Step 4: TTS each standalone short + upload audio to R2
  // SESSION 105: TTS runs on the GPU pod (XTTS) via withPodSession.
  // XTTS_SERVER_URL was purged — the fallback chain (Edge TTS) crashes on Railway.
  // Pod session manager reuses the same pod for the render phase that follows.
  await log("PREP 4/5", `TTS for ${standaloneShorts.length} standalone shorts (XTTS on pod)...`);
  const clipDir = `${jobDir}/clips`;
  if (!existsSync(clipDir)) mkdirSync(clipDir, { recursive: true });

  const podQueue: any[] = [];

  // Open pod session for TTS — session manager reuses this pod for render phase
  await withPodSession(async (ttsHandle) => {
    // Build a TTSFunction that routes through the pod's /tts endpoint
    const podTTSFn: TTSFunction = async (text, brand) => {
      const { audioBuffer } = await podTTS(ttsHandle, { text, brand });
      return audioBuffer;
    };

    for (let i = 0; i < standaloneShorts.length; i++) {
      const standalone = standaloneShorts[i];
      const shortJobId = `rechop_${video.jobId}_standalone_${i}`;

      // ── TTS the standalone short script ──
      let ttsAudioPath: string;
      let audioDuration: number;
      let segDurations: number[];
      try {
        const audioResult = await renderAudio(standalone.script, shortJobId, podTTSFn);
        ttsAudioPath = audioResult.audioPath;
      segDurations = audioResult.segmentDurations;
      audioDuration = segDurations.reduce((a, b) => a + b, 0);
      console.log(`  🎤 PrepOnly Short ${i} TTS complete: ${audioDuration.toFixed(1)}s (${segDurations.length} segments)`);
    } catch (ttsErr: any) {
      console.error(`[RechopPrep] Short ${i} TTS FAILED: ${ttsErr.message?.slice(0, 200)}`);
      result.shortsFailed++;
      result.errors.push(`Short ${i} TTS failed: ${ttsErr.message?.slice(0, 100)}`);
      continue;
    }

    // ── Convert to WAV (pod expects WAV) and upload to R2 ──
    const wavPath = `${clipDir}/standalone_audio_${i.toString().padStart(2, "0")}.wav`;
    try {
      execSync(
        `ffmpeg -i "${ttsAudioPath}" -vn -acodec pcm_s16le -ar 48000 -ac 2 -y "${wavPath}"`,
        { timeout: 30_000, stdio: "pipe" },
      );
    } catch (convErr: any) {
      console.error(`[RechopPrep] Short ${i} WAV conversion failed: ${convErr.message?.slice(0, 200)}`);
      result.shortsFailed++;
      result.errors.push(`Short ${i} WAV conversion failed`);
      continue;
    }

    let audioUrl: string | null = null;
    try {
      const r2Key = `rechop-audio/${video.jobId}/standalone_${i.toString().padStart(2, "0")}.wav`;
      const audioBuf = readFileSync(wavPath);
      await uploadToR2(R2_BUCKET, r2Key, audioBuf, "audio/wav");
      audioUrl = await getR2PresignedUrl(R2_BUCKET, r2Key, 3600);
      console.log(`  📤 PrepOnly Short ${i} audio → R2 (presigned)`);
    } catch (err: any) {
      console.error(`[RechopPrep] Short ${i} R2 audio upload failed: ${err.message?.slice(0, 200)}`);
      result.shortsFailed++;
      result.errors.push(`Short ${i} R2 audio upload failed`);
      continue;
    }

    if (!audioUrl) {
      console.warn(`  ⚠️ PrepOnly Short ${i}: no R2 audio URL — skipping`);
      result.shortsFailed++;
      continue;
    }

    // ── Build pod job spec ──
    const rawSceneDurs = standalone.vertical_scenes.map(vs => vs.duration_s);
    const rawSum = rawSceneDurs.reduce((a, b) => a + b, 0);
    const driftRatio = rawSum > 0 ? audioDuration / rawSum : 1;

    const vScenes: ShortScene[] = standalone.vertical_scenes.map((vs, idx) => ({
      index: vs.index,
      image_prompt: vs.image_prompt,
      duration_s: Math.max(0.5, rawSceneDurs[idx] * driftRatio),
    }));

    podQueue.push({
      index: i,
      spec: {
        brand: video.brand,
        audio_url: audioUrl,
        audio_duration_s: audioDuration,
        scenes: vScenes,
        hook_text: standalone.script.hook?.slice(0, 200),
        cta_text: standalone.cta_overlay?.slice(0, 300),
        audio_is_raw_tts: true, // Standalone shorts = fresh TTS, pod adds music bed
        client_job_id: shortJobId,
      },
      duration: audioDuration,
      hookText: standalone.script.hook || standalone.script.title,
    });
    }
  }); // end withPodSession for TTS

  if (podQueue.length === 0) {
    result.errors.push("No shorts survived TTS");
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
