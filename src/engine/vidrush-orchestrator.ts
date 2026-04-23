// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — VidRush Autonomous Orchestrator
// THE FULL PIPELINE: 1 URL → Everything
//
// 1. Whisper extraction (extract universal truths from source)
// 2. Faceless Factory LONG (10-15 min video in Anita's Protocol 77 voice)
// 3. YouTube long-form upload (to Ace Richie 77 channel)
// 4. Curate 0-4 surgical shorts via shorts-curator (LLM + ffmpeg)
// 5. Generate platform-specific copy per short (LLM)
// 6. Distribute shorts to all platforms (TikTok, IG, YouTube Shorts)
// 7. Schedule posts to ALL Buffer channels (a week of content across every platform)
// 8. Report back to Architect
//
// Ace's words: "1 url, fully autonomous ai driven system"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";

// Configurable ffmpeg per-clip timeout. Default 180s — enough for a 45s clip encode on a
// throttled Railway container. Raise via FFMPEG_CLIP_TIMEOUT_MS env var if clips 7+ still
// timeout (symptom: spawnSync /bin/sh ETIMEDOUT after 120s).
const FFMPEG_CLIP_TIMEOUT_MS = parseInt(process.env.FFMPEG_CLIP_TIMEOUT_MS || "180000", 10);

// Hard cap on clips produced per pipeline run. Silence detection on a 10-min video can
// find 30+ boundaries — uncapped, this generates 30+ sequential ffmpeg encodes and exhausts
// the container. 10 clips is enough for a week of Buffer posts across all channels.
const MAX_CLIPS_PER_RUN = parseInt(process.env.MAX_CLIPS_PER_RUN || "10", 10);
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmSync } from "fs";
import { extractWhisperIntel, detectNiche, type WhisperResult } from "./whisper-extract";
import { produceFacelessVideo, generateStandaloneShorts, renderAudio, type FacelessScript, type StandaloneShort, FACELESS_DIR } from "./faceless-factory";
// SESSION 102: curateShorts replaced by generateStandaloneShorts in forward pipeline.
// Retained in rechop-pipeline.ts for retroactive shorts from existing videos.
// import { curateShorts, type CuratedShort, type CuratorResult, type VerticalScene } from "./shorts-curator";
import { withPodSession } from "../pod/session";
import { produceShort, podTTS } from "../pod/runpod-client";
import type { ShortJobSpec, ShortScene } from "../pod/types";
import { YouTubeLongFormPublishTool } from "../tools/video-publisher";
import {
  AUDIENCE_ANGLES,
  angleForClipIndex,
  buildAudienceRotationBlock,
  hashStringToAngleOffset,
  buildBrandFrequencyBlock,
  BRAND_FREQUENCY_PROFILES,
  type AudienceAngle,
} from "../prompts/social-optimization-prompt";
import type { LLMProvider } from "../types";
import { isR2Configured, uploadToR2, getR2PresignedUrl } from "../tools/r2-upload";
import { isBufferQuotaExhausted } from "./buffer-graphql";
import { publishToFacebook } from "./facebook-publisher";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = "public-assets";
const R2_BUCKET_CLIPS = process.env.R2_BUCKET_VIDEOS || "sovereign-videos"; // clips/ prefix inside same bucket as long-form
const ORCHESTRATOR_DIR = "/tmp/vidrush_orchestrator";

// ── Cleanup: delete clips from Supabase Storage after Buffer scheduling ──
// Session 78: R2 has zero egress fees — cleanup only runs for Supabase fallback path.
// If clips are on R2 (publicUrl contains r2.dev), skip cleanup entirely.
async function cleanupSupabaseStorage(clips: ClipMeta[]): Promise<void> {
  // R2 clips have zero egress cost — no cleanup needed
  const hasR2Clips = clips.some(c => c.publicUrl?.includes("r2.dev"));
  if (hasR2Clips) {
    console.log(`♻️ [Orchestrator] Clips on R2 — zero egress, skipping cleanup`);
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  let deleted = 0;
  const pathsToDelete: string[] = [];

  // Extract actual storage paths from publicUrl — these already contain the correct folder names
  // publicUrl format: {SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storagePath}
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`;
  for (const clip of clips) {
    if (clip.publicUrl?.startsWith(prefix)) {
      pathsToDelete.push(clip.publicUrl.slice(prefix.length));
    }
  }

  // Delete via Supabase Storage API (batch delete)
  // Endpoint: POST /storage/v1/object/remove/{bucket} with body { prefixes: [...paths] }
  if (pathsToDelete.length > 0) {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/storage/v1/object/remove/${STORAGE_BUCKET}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY!,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prefixes: pathsToDelete }),
        }
      );

      if (resp.ok) {
        deleted = pathsToDelete.length;
        console.log(`🗑️ [Orchestrator] Deleted ${deleted} files from Supabase Storage (egress savings)`);
      } else {
        console.warn(`⚠️ [Orchestrator] Storage cleanup failed: ${resp.status} ${resp.statusText}`);
      }
    } catch (err: any) {
      console.warn(`⚠️ [Orchestrator] Storage cleanup error: ${err.message?.slice(0, 200)}`);
    }
  }
}

// ── Cleanup: remove all temp files for a pipeline job ──
export function cleanupPipelineJob(jobId: string): void {
  try {
    // Clean orchestrator job dir (clips, etc.)
    const jobDir = `${ORCHESTRATOR_DIR}/${jobId}`;
    if (existsSync(jobDir)) {
      rmSync(jobDir, { recursive: true, force: true });
      console.log(`🧹 [Orchestrator] Cleaned job dir: ${jobDir}`);
    }
    // Clean whisper source files
    const clipDir = "/tmp/sovereign_clips";
    if (existsSync(clipDir)) {
      const files = readdirSync(clipDir);
      let cleaned = 0;
      for (const f of files) {
        // Remove files older than 1 hour to avoid nuking an active job
        try {
          const fullPath = `${clipDir}/${f}`;
          const { mtimeMs } = require("fs").statSync(fullPath);
          if (Date.now() - mtimeMs > 3600_000) {
            unlinkSync(fullPath);
            cleaned++;
          }
        } catch { /* skip */ }
      }
      if (cleaned > 0) console.log(`🧹 [Orchestrator] Cleaned ${cleaned} stale whisper files`);
    }
    // Clean faceless factory intermediates (older than 1 hour)
    const facelessDir = "/tmp/faceless_factory";
    if (existsSync(facelessDir)) {
      const files = readdirSync(facelessDir);
      let cleaned = 0;
      for (const f of files) {
        try {
          const fullPath = `${facelessDir}/${f}`;
          const { mtimeMs } = require("fs").statSync(fullPath);
          if (Date.now() - mtimeMs > 3600_000) {
            unlinkSync(fullPath);
            cleaned++;
          }
        } catch { /* skip */ }
      }
      if (cleaned > 0) console.log(`🧹 [Orchestrator] Cleaned ${cleaned} stale faceless files`);
    }
    // Clean test uploads
    const ytTestDir = "/tmp/yt_test";
    if (existsSync(ytTestDir)) {
      rmSync(ytTestDir, { recursive: true, force: true });
      console.log(`🧹 [Orchestrator] Cleaned yt_test dir`);
    }
  } catch (err: any) {
    console.error(`⚠️ [Orchestrator] Cleanup error: ${err.message}`);
  }
}

// ── Types ──

type Brand = "ace_richie" | "containment_field";

interface ClipMeta {
  index: number;
  localPath: string;
  publicUrl: string | null;
  startSec: number;
  endSec: number;
  captionText: string;
  thumbnailPath?: string | null;  // Session 39: per-clip thumbnail with bold text overlay
  thumbnailUrl?: string | null;   // Session 39: public URL after Supabase upload
  // Session 42: Semantic metadata from StoryMoment extraction — enables diverse copy/titles per clip
  storyTitle?: string;            // Unique title from LLM story moment identification
  storyHook?: string;             // Scroll-stopping hook line per clip
  thumbnailText?: string;         // 2-4 word overlay text
}

interface PlatformCopy {
  youtube_short: string;
  tiktok: string;
  instagram: string;
  threads: string;
  linkedin: string;
  facebook: string;
  bluesky: string;
}

export interface OrchestratorResult {
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  longFormLocalPath: string;
  longFormPublicUrl: string | null;
  clipCount: number;
  clips: ClipMeta[];
  bufferScheduled: number;
  platformResults: string[];
  errors: string[];
  duration: number; // total pipeline seconds
}

// ── Niche color grades (same as clip-generator) ──

const NICHE_FILTERS: Record<string, string> = {
  dark_psychology: "eq=contrast=1.3:brightness=-0.05:saturation=0.8,vignette=PI/4",
  self_improvement: "eq=contrast=1.1:brightness=0.05:saturation=1.2",
  burnout: "eq=contrast=0.9:brightness=0.02:saturation=0.7",
  quantum: "eq=contrast=1.2:saturation=1.4:gamma=0.9",
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// @deprecated — Phase 5 Task 5.5 (S72): RETIRED.
// The "chop everything into 4-30 clips" pipeline below is replaced by the
// surgical shorts-curator (src/engine/shorts-curator.ts). The curator reads
// the script + segment durations and LLM-identifies 0-4 stand-alone moments.
// These dead functions (extractStoryMoments, chopLongFormIntoClips) are
// preserved for reference but no longer called from executeFullPipeline.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface StoryMoment {
  title: string;
  hook: string;
  thumbnail_text?: string; // Session 39: 2-4 word hook for clip thumbnail overlay
  startSec: number;
  endSec: number;
}

/** Ask the LLM to identify self-contained story moments from the transcript */
async function extractStoryMoments(
  llm: LLMProvider,
  segments: { start: number; end: number; text: string }[],
  niche: string,
  totalDuration: number
): Promise<StoryMoment[] | null> {
  if (!segments || segments.length < 10) return null;

  // Build a condensed transcript with timestamps for the LLM.
  // Group segments into ~5s chunks for FINER timestamp precision.
  // Previous 10s chunks were too coarse — LLM couldn't cut at word boundaries
  // because it only had 10s-resolution timestamps to work with.
  const condensed: string[] = [];
  let chunkStart = segments[0].start;
  let chunkText: string[] = [];

  for (const seg of segments) {
    chunkText.push(seg.text.trim());
    if (seg.end - chunkStart >= 5 || seg === segments[segments.length - 1]) {
      condensed.push(`[${chunkStart.toFixed(1)}s-${seg.end.toFixed(1)}s] ${chunkText.join(" ")}`);
      chunkStart = seg.end;
      chunkText = [];
    }
  }

  // Cap at ~2500 chars to stay within Groq free-tier per-request token limits.
  // The prompt template + rules add ~1500 tokens on top of the transcript.
  let transcriptBlock = condensed.join("\n");
  if (transcriptBlock.length > 2500) {
    transcriptBlock = transcriptBlock.slice(0, 2500) + "\n[...transcript truncated]";
  }

  const prompt = `You are a viral content strategist analyzing a ${niche.replace(/_/g, " ")} video transcript (${totalDuration.toFixed(0)}s total).

Your job: identify 8-15 SELF-CONTAINED STORY MOMENTS that each work as a standalone short-form video (15-45 seconds each).

A great story moment:
- Has a complete thought arc (setup → insight → payoff)
- Opens with a hook that stops the scroll
- Contains a single powerful idea (not 3 ideas crammed together)
- Ends with impact — a punchline, revelation, or call to action
- Does NOT start or end mid-sentence or mid-phrase

CRITICAL — CLIP ENDING RULE:
The endSec timestamp MUST land AFTER the speaker has finished a complete, resolved thought.
NEVER cut in the middle of a prepositional phrase, subordinate clause, or dangling connector.
BAD endings: "with a map that's...", "because they don't...", "so you can actually..."
GOOD endings: "...and that changes everything.", "...that's the real secret.", "...wake up."
If a great moment trails off into filler, set endSec at the last impactful sentence — not the start of the next weak one.
When in doubt, extend the clip 2-3 seconds longer to capture the full final statement.

Rules:
- Moments must not overlap
- Cover the best material across the full video (don't cluster at the start)
- startSec and endSec must match the timestamps in the transcript
- Prefer slightly longer clips (25-40s) over rushed short ones — a 38s clip that ends clean beats a 28s clip that cuts mid-thought
- Skip any weak filler sections — quality over quantity

Respond with ONLY a JSON array, no markdown, no explanation:
[
  { "title": "short punchy title", "hook": "opening line that stops the scroll", "thumbnail_text": "2-4 WORDS", "startSec": 12.5, "endSec": 38.2 },
  ...
]

THUMBNAIL_TEXT RULES:
- 2-5 words ALL CAPS — a complete thought that works as protest-sign graffiti.
- This is a memetic trigger overlaid at massive font size on a dark still frame.
- Write a FINISHED statement. A stranger reads it on a wall and feels something with zero context.
- DECLARATIONS: "THEY DESIGNED YOUR CAGE", "YOUR COMFORT IS THE TRAP", "REALITY HAS AN OWNER".
- COMMANDS: "DELETE YOUR OLD SELF", "BURN THE MANUAL", "STOP OBEYING".
- REVELATIONS: "NOBODY IS COMING", "YOUR MEMORIES ARE INSTALLED", "THE EXIT IS OPEN".

TRANSCRIPT:
${transcriptBlock}`;

  try {
    const response = await llm.generate(
      [{ role: "user", content: prompt }],
      { temperature: 0.3, maxTokens: 4096 }
    );

    // Parse JSON from response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn("[Orchestrator] LLM story extraction returned no JSON array");
      return null;
    }

    const moments: StoryMoment[] = JSON.parse(jsonMatch[0]);

    // Validate: each moment must have valid timestamps and reasonable duration
    const valid = moments.filter(m =>
      typeof m.startSec === "number" &&
      typeof m.endSec === "number" &&
      m.endSec > m.startSec &&
      (m.endSec - m.startSec) >= 12 &&
      (m.endSec - m.startSec) <= 60 &&
      m.startSec >= 0 &&
      m.endSec <= totalDuration + 2 &&
      typeof m.title === "string" &&
      typeof m.hook === "string"
    );

    // Sort by start time, remove overlaps
    valid.sort((a, b) => a.startSec - b.startSec);
    const deduped: StoryMoment[] = [];
    for (const m of valid) {
      const prev = deduped[deduped.length - 1];
      if (!prev || m.startSec >= prev.endSec - 1) {
        deduped.push(m);
      }
    }

    if (deduped.length < 3) {
      console.warn(`[Orchestrator] LLM only found ${deduped.length} valid moments — falling back`);
      return null;
    }

    console.log(`🧠 [Orchestrator] LLM identified ${deduped.length} story moments from transcript`);
    return deduped;
  } catch (err: any) {
    console.warn(`[Orchestrator] LLM story extraction failed (non-fatal): ${err.message?.slice(0, 200)}`);
    return null;
  }
}

async function chopLongFormIntoClips(
  videoPath: string,
  niche: string,
  jobId: string,
  llm: LLMProvider | null,
  whisperSegments: { start: number; end: number; text: string }[] | null,
  targetClipCount: number = 30,
  targetClipDuration: number = 25
): Promise<ClipMeta[]> {
  // Get video duration
  let totalDuration: number;
  try {
    const dur = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { timeout: 10_000, stdio: "pipe" }
    ).toString().trim();
    totalDuration = parseFloat(dur) || 600;
  } catch {
    totalDuration = 600; // fallback 10 min
  }

  // ── TIER 1: LLM SEMANTIC EXTRACTION ──
  // Ask the LLM to identify self-contained story moments from the transcript.
  // Each moment is a complete idea that works as a standalone short.
  let storyMoments: StoryMoment[] | null = null;
  if (llm && whisperSegments && whisperSegments.length >= 10) {
    storyMoments = await extractStoryMoments(llm, whisperSegments, niche, totalDuration);
  }

  if (storyMoments && storyMoments.length >= 3) {
    // ── SEMANTIC MODE: cut at LLM-identified story boundaries ──
    console.log(`🧠 [Orchestrator] Semantic chop: ${storyMoments.length} story moments`);
    for (const m of storyMoments) {
      console.log(`  📖 "${m.title}" (${m.startSec.toFixed(1)}s → ${m.endSec.toFixed(1)}s, ${(m.endSec - m.startSec).toFixed(1)}s)`);
    }

    const clipDir = `${ORCHESTRATOR_DIR}/${jobId}/clips`;
    if (!existsSync(clipDir)) mkdirSync(clipDir, { recursive: true });

    const nicheFilter = NICHE_FILTERS[niche] || NICHE_FILTERS.dark_psychology;
    const clips: ClipMeta[] = [];

    // Audio-aware padding: add breathing room so clips don't start/end mid-word.
    // 0.3s before the LLM's start (catches the beginning of the first word)
    // 0.2s after the LLM's end (lets the last word finish naturally)
    const PAD_BEFORE = 0.3;
    const PAD_AFTER = 1.5;

    // Cap to MAX_CLIPS_PER_RUN — even in semantic mode, 10 moments is enough
    const momentsToCut = storyMoments.slice(0, MAX_CLIPS_PER_RUN);
    if (storyMoments.length > MAX_CLIPS_PER_RUN) {
      console.log(`✂️ [Orchestrator] Capping ${storyMoments.length} moments to ${MAX_CLIPS_PER_RUN} (MAX_CLIPS_PER_RUN)`);
    }

    for (let i = 0; i < momentsToCut.length; i++) {
      const moment = momentsToCut[i];
      const clipPath = `${clipDir}/clip_${i.toString().padStart(2, "0")}.mp4`;

      // Apply padding, clamped to video boundaries and non-overlapping with neighbors
      const prevEnd = i > 0 ? momentsToCut[i - 1].endSec : 0;
      const paddedStart = Math.max(0, Math.max(prevEnd, moment.startSec - PAD_BEFORE));
      const paddedEnd = Math.min(totalDuration, moment.endSec + PAD_AFTER);

      try {
        // Use -ss before -i for fast seeking, then -t for duration (more reliable than -to with -ss before -i)
        const duration = paddedEnd - paddedStart;
        // stdio:"ignore" — drops ffmpeg progress noise from Node.js heap.
        // "pipe" was buffering megabytes of encode output per clip, bloating memory across 10+ clips.
        execSync(
          `ffmpeg -ss ${paddedStart.toFixed(2)} -i "${videoPath}" ` +
            `-t ${duration.toFixed(2)} ` +
            `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${nicheFilter}" ` +
            `-c:v libx264 -preset fast -crf 23 ` +
            `-c:a aac -b:a 128k ` +
            `-af "afade=t=in:st=0:d=0.15,afade=t=out:st=${Math.max(0, duration - 0.5).toFixed(2)}:d=0.5" ` +
            `-y "${clipPath}"`,
          { timeout: FFMPEG_CLIP_TIMEOUT_MS, stdio: "ignore" }
        );

        // ── Session 39: Per-clip thumbnail (zero API cost, pure ffmpeg) ──
        // Extract frame at 30% into the clip (past the hook, into the visual meat),
        // apply dark vignette + brand color grade, overlay bold text.
        // Style: "Brave New Slop" — massive lowercase text on a dark still frame.
        let clipThumbPath: string | null = null;
        const thumbText = (moment.thumbnail_text || moment.title || "").toUpperCase().replace(/[^\w\s!?]/g, "").slice(0, 25);
        if (thumbText) {
          const thumbPath = `${clipDir}/thumb_${i.toString().padStart(2, "0")}.jpg`;
          const brandAssetsDir = `${__dirname}/../../brand-assets`;
          const fontPath = `${brandAssetsDir}/BebasNeue-Regular.ttf`;
          const hasFont = existsSync(fontPath);
          const fontFilter = hasFont ? `fontfile='${fontPath}':` : "";
          const thumbTextFile = `${clipDir}/thumb_text_${i}.txt`;
          // Write text to file to avoid shell quoting issues (Session 38 lesson)
          writeFileSync(thumbTextFile, thumbText);
          try {
            // Extract key frame at 30% mark, apply vignette + text overlay
            const seekSec = (duration * 0.3).toFixed(2);
            execSync(
              `ffmpeg -ss ${seekSec} -i "${clipPath}" -frames:v 1 ` +
                `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
                `${nicheFilter},` +
                `vignette=PI/3,` +
                `drawbox=x=0:y=ih*0.35:w=iw:h=ih*0.3:c=black@0.6:t=fill,` +
                `drawtext=${fontFilter}textfile='${thumbTextFile.replace(/'/g, "'\\''")}':fontsize=96:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=8" ` +
                `-q:v 2 -y "${thumbPath}"`,
              { timeout: 15_000, stdio: "pipe" }
            );
            if (existsSync(thumbPath) && readFileSync(thumbPath).length > 1000) {
              clipThumbPath = thumbPath;
              console.log(`  🖼️ Thumb ${i}: "${thumbText}" (${(readFileSync(thumbPath).length / 1024).toFixed(0)}KB)`);
            }
          } catch (err: any) {
            console.warn(`  ⚠️ Thumb ${i} failed (non-fatal): ${err.message?.slice(0, 150)}`);
          }
        }

        clips.push({
          index: i,
          localPath: clipPath,
          publicUrl: null,
          startSec: paddedStart,
          endSec: paddedEnd,
          captionText: `${moment.title} | ${moment.hook}`,
          thumbnailPath: clipThumbPath,
          // Session 42: Preserve semantic metadata for diverse copy generation
          storyTitle: moment.title,
          storyHook: moment.hook,
          thumbnailText: moment.thumbnail_text,
        });
        console.log(`  ✂️ Clip ${i}: "${moment.title}" ${paddedStart.toFixed(1)}s → ${paddedEnd.toFixed(1)}s (${duration.toFixed(1)}s, padded ±0.3s)`);
      } catch (err: any) {
        console.error(`[Orchestrator] Clip ${i} ("${moment.title}") failed: ${err.message?.slice(0, 200)}`);
      }
    }

    console.log(`✅ [Orchestrator] ${clips.length}/${storyMoments.length} semantic clips cut (with audio padding + fade)`);
    return clips;
  }

  // ── TIER 2: SILENCE-BOUNDARY DETECTION (fallback) ──
  // Use ffmpeg silencedetect to find pauses in the TTS voiceover.
  console.log(`[Orchestrator] Falling back to silence-boundary detection (no semantic extraction available)`);
  let silencePoints: number[] = [];
  try {
    const silenceOutput = execSync(
      `ffmpeg -i "${videoPath}" -af "silencedetect=noise=-35dB:d=0.3" -f null - 2>&1`,
      { timeout: 60_000, encoding: "utf-8" }
    );
    const matches = silenceOutput.matchAll(/silence_end:\s*([\d.]+)/g);
    for (const match of matches) {
      silencePoints.push(parseFloat(match[1]));
    }
    console.log(`🔍 [Orchestrator] Found ${silencePoints.length} silence boundaries in ${totalDuration.toFixed(0)}s video`);
  } catch (err: any) {
    console.warn(`[Orchestrator] Silence detection failed, using fallback: ${err.message?.slice(0, 150)}`);
  }

  // ── BUILD CLIP BOUNDARIES ──
  const MIN_CLIP_DURATION = 15;
  const MAX_CLIP_DURATION = 59; // Raised from 40 — old cap was truncating clips mid-sentence. Silence boundaries are semantic; trust them.
  const SNAP_TOLERANCE = 8;

  const maxClips = Math.floor(totalDuration / MIN_CLIP_DURATION);
  const idealClipCount = Math.min(targetClipCount, maxClips);
  const idealDuration = totalDuration / idealClipCount;

  const cutPoints: number[] = [0];

  if (silencePoints.length >= 2) {
    // SMART MODE: snap to silence boundaries
    let currentTarget = idealDuration;

    while (currentTarget < totalDuration - MIN_CLIP_DURATION) {
      let bestPoint = currentTarget;
      let bestDistance = SNAP_TOLERANCE + 1;

      for (const sp of silencePoints) {
        const distance = Math.abs(sp - currentTarget);
        if (distance < bestDistance && distance <= SNAP_TOLERANCE) {
          const lastCut = cutPoints[cutPoints.length - 1];
          const clipLen = sp - lastCut;
          if (clipLen >= MIN_CLIP_DURATION && clipLen <= MAX_CLIP_DURATION) {
            bestPoint = sp;
            bestDistance = distance;
          }
        }
      }

      const lastCut = cutPoints[cutPoints.length - 1];
      const clipLen = bestPoint - lastCut;
      if (clipLen >= MIN_CLIP_DURATION) {
        cutPoints.push(bestPoint);
      }

      currentTarget = bestPoint + idealDuration;
    }

    console.log(`🎯 [Orchestrator] Smart chop: ${cutPoints.length - 1} clips with sentence-boundary cuts`);
  } else {
    // TIER 3 FALLBACK: dumb math division
    const actualClipCount = Math.min(targetClipCount, Math.floor(totalDuration / targetClipDuration));
    const actualDuration = totalDuration / actualClipCount;
    for (let i = 1; i < actualClipCount; i++) {
      cutPoints.push(i * actualDuration);
    }
    console.log(`⚠️ [Orchestrator] Fallback chop: ${cutPoints.length - 1} clips with math division (no silence data)`);
  }

  cutPoints.push(totalDuration);

  // Hard cap: silence detection can produce 30+ cut points on a 10-min video.
  // Trim to MAX_CLIPS_PER_RUN boundaries (keep first N+1 points for N clips).
  if (cutPoints.length - 1 > MAX_CLIPS_PER_RUN) {
    console.log(`✂️ [Orchestrator] Capping ${cutPoints.length - 1} silence-boundary clips to ${MAX_CLIPS_PER_RUN} (MAX_CLIPS_PER_RUN)`);
    cutPoints.splice(MAX_CLIPS_PER_RUN + 1);
    cutPoints[cutPoints.length - 1] = totalDuration;
  }

  // ── CUT CLIPS ──
  const clipDir = `${ORCHESTRATOR_DIR}/${jobId}/clips`;
  if (!existsSync(clipDir)) mkdirSync(clipDir, { recursive: true });

  const nicheFilter = NICHE_FILTERS[niche] || NICHE_FILTERS.dark_psychology;
  const clips: ClipMeta[] = [];

  for (let i = 0; i < cutPoints.length - 1; i++) {
    const startSec = cutPoints[i];
    const endSec = cutPoints[i + 1];
    const clipPath = `${clipDir}/clip_${i.toString().padStart(2, "0")}.mp4`;

    try {
      // Add 1.5s end-padding so the final spoken word lands fully. Clamp to totalDuration.
      const paddedEndSec = Math.min(endSec + 1.5, totalDuration);
      const clipLen = paddedEndSec - startSec;
      const fadeStart = Math.max(0, clipLen - 0.5).toFixed(2);

      // stdio:"ignore" — drops ffmpeg encode progress from Node.js heap.
      // Previously "pipe" was buffering megabytes per clip, bloating memory across 10+ clips.
      execSync(
        `ffmpeg -i "${videoPath}" ` +
          `-ss ${startSec.toFixed(2)} -to ${paddedEndSec.toFixed(2)} ` +
          `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${nicheFilter}" ` +
          `-c:v libx264 -preset fast -crf 23 ` +
          `-c:a aac -b:a 128k ` +
          `-af "afade=t=in:st=0:d=0.15,afade=t=out:st=${fadeStart}:d=0.5" ` +
          `-y "${clipPath}"`,
        { timeout: FFMPEG_CLIP_TIMEOUT_MS, stdio: "ignore" }
      );

      clips.push({
        index: i,
        localPath: clipPath,
        publicUrl: null,
        startSec,
        endSec,
        captionText: "",
      });
      console.log(`  ✂️ Clip ${i}: ${startSec.toFixed(1)}s → ${endSec.toFixed(1)}s (${(endSec - startSec).toFixed(1)}s)`);
    } catch (err: any) {
      console.error(`[Orchestrator] Clip ${i} failed: ${err.message?.slice(0, 200)}`);
    }
  }

  console.log(`✅ [Orchestrator] ${clips.length}/${cutPoints.length - 1} clips cut (silence boundaries)`);
  return clips;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 5: UPLOAD CLIPS TO R2 (formerly Supabase Storage)
// Session 78: Migrated to Cloudflare R2 — zero egress fees.
// Supabase Storage kept as fallback if R2 env vars missing.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function uploadClipsToStorage(clips: ClipMeta[], jobId: string, meta?: { brand?: string; niche?: string; title?: string }): Promise<void> {
  const useR2 = isR2Configured();
  if (!useR2 && (!SUPABASE_URL || !SUPABASE_KEY)) return;

  // Build a human-readable folder name: clips/ace_richie_quantum_firmware_update_1775430704664/
  const slugParts = [
    meta?.brand || "unknown",
    meta?.niche || "general",
    (meta?.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40).replace(/_+$/, ""),
  ].filter(Boolean);
  const folderName = slugParts.join("_") + "_" + jobId.split("_").pop();

  if (useR2) {
    console.log(`☁️ [Orchestrator] Uploading ${clips.length} clips to R2 bucket "${R2_BUCKET_CLIPS}" (zero egress)`);
  } else {
    console.log(`📦 [Orchestrator] R2 not configured — falling back to Supabase Storage`);
  }

  for (const clip of clips) {
    let uploaded = false;

    // SESSION 99 FIX: Pod-rendered clips already have an R2 publicUrl from
    // produceShort(). Skip the redundant re-upload — saves R2 write ops and
    // avoids overwriting a valid URL if the local file is somehow corrupted.
    if (clip.publicUrl) {
      console.log(`📤 [Orchestrator] Clip ${clip.index} → already on R2 (skipping re-upload)`);
      continue;
    }

    try {
      const fileBuffer = readFileSync(clip.localPath);
      const clipKey = `clips/${folderName}/clip_${clip.index.toString().padStart(2, "0")}.mp4`;

      if (useR2) {
        // ── PRIMARY: Cloudflare R2 ──
        const result = await uploadToR2(R2_BUCKET_CLIPS, clipKey, fileBuffer, "video/mp4");
        clip.publicUrl = result.publicUrl;
        console.log(`📤 [Orchestrator] Clip ${clip.index} → R2`);
        uploaded = true;
      } else {
        // ── FALLBACK: Supabase Storage (legacy) ──
        const storagePath = `vidrush/${folderName}/clip_${clip.index.toString().padStart(2, "0")}.mp4`;
        const resp = await fetch(
          `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_KEY!,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "video/mp4",
              "x-upsert": "true",
            },
            body: fileBuffer,
          },
        );
        if (resp.ok) {
          clip.publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
          console.log(`📤 [Orchestrator] Clip ${clip.index} → Supabase (fallback)`);
          uploaded = true;
        } else {
          console.error(`[Orchestrator] Clip ${clip.index} Supabase upload failed: ${resp.status}`);
        }
      }
    } catch (err: any) {
      console.error(`[Orchestrator] Clip ${clip.index} upload error: ${err.message?.slice(0, 200)}`);
    }

    // ── Upload clip thumbnail alongside video ──
    if (uploaded && clip.thumbnailPath && existsSync(clip.thumbnailPath)) {
      try {
        const thumbBuf = readFileSync(clip.thumbnailPath);
        const thumbKey = `clips/${folderName}/thumb_${clip.index.toString().padStart(2, "0")}.jpg`;

        if (useR2) {
          const thumbResult = await uploadToR2(R2_BUCKET_CLIPS, thumbKey, thumbBuf, "image/jpeg");
          clip.thumbnailUrl = thumbResult.publicUrl;
          console.log(`🖼️ [Orchestrator] Thumb ${clip.index} → R2`);
        } else {
          const thumbStoragePath = `vidrush/${folderName}/thumb_${clip.index.toString().padStart(2, "0")}.jpg`;
          const thumbResp = await fetch(
            `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${thumbStoragePath}`,
            {
              method: "POST",
              headers: {
                apikey: SUPABASE_KEY!,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "image/jpeg",
                "x-upsert": "true",
              },
              body: thumbBuf,
            },
          );
          if (thumbResp.ok) {
            clip.thumbnailUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${thumbStoragePath}`;
            console.log(`🖼️ [Orchestrator] Thumb ${clip.index} → Supabase (fallback)`);
          }
        }
      } catch (err: any) {
        console.warn(`⚠️ [Orchestrator] Thumb ${clip.index} upload failed (non-fatal): ${err.message?.slice(0, 150)}`);
      }
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 6: GENERATE PLATFORM-SPECIFIC COPY
// LLM writes different captions for each platform per clip
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function generatePlatformCopy(
  llm: LLMProvider,
  clips: ClipMeta[],
  sourceTitle: string,
  niche: string,
  brand: Brand,
  transcript: string
): Promise<Map<number, PlatformCopy>> {
  const copyMap = new Map<number, PlatformCopy>();

  // Deployment 4: Audience Rotation Protocol. Deterministic angle assignment keyed off
  // a hash of the source title so (a) the same video always rotates the same way and
  // (b) different sources start at different angles — no batch collisions.
  const contentOffset = hashStringToAngleOffset(sourceTitle || niche || "sovereign");
  // Track assigned angle per clip so fallback + downstream tag-smuggling can reuse it.
  const clipAngleMap = new Map<number, AudienceAngle>();
  for (const clip of clips) {
    clipAngleMap.set(clip.index, angleForClipIndex(clip.index, contentOffset, brand));
  }

  // Process in batches of 5 to avoid LLM overload
  const batchSize = 5;
  for (let batchStart = 0; batchStart < clips.length; batchStart += batchSize) {
    const batch = clips.slice(batchStart, batchStart + batchSize);

    // Deployment 4: Build per-batch rotation assignments. Each clip in the batch gets a
    // UNIQUE angle. Within a batch we force distinctness even if modular collision would
    // otherwise repeat (e.g. batch sizes > AUDIENCE_ANGLES.length is impossible at
    // batchSize=5, but we still guard via usedInBatch set).
    const usedInBatch = new Set<string>();
    const batchAssignments: Array<{ clipLabel: string; angle: AudienceAngle; clip: ClipMeta }> = [];
    for (const clip of batch) {
      let angle = clipAngleMap.get(clip.index) || angleForClipIndex(clip.index, contentOffset, brand);
      // If somehow duplicated in-batch, walk forward through the pool.
      let walk = 0;
      while (usedInBatch.has(angle.id) && walk < AUDIENCE_ANGLES.length) {
        angle = angleForClipIndex(clip.index + (++walk), contentOffset, brand);
      }
      usedInBatch.add(angle.id);
      clipAngleMap.set(clip.index, angle);
      batchAssignments.push({
        clipLabel: `Clip ${clip.index + 1} (${clip.startSec.toFixed(0)}s-${clip.endSec.toFixed(0)}s)`,
        angle,
        clip,
      });
    }

    // Session 42: Pass clip-specific semantic data (title, hook, thumbnail_text) to the LLM.
    // Deployment 4 extension: each clip description now also carries its assigned angle ID
    // so the LLM cannot lose track of which clip belongs to which demographic.
    const clipDescriptions = batchAssignments.map(({ clip, angle }) => {
      const parts = [`Clip ${clip.index + 1} (${clip.startSec.toFixed(0)}s-${clip.endSec.toFixed(0)}s) [ASSIGNED ANGLE: ${angle.name}]`];
      if (clip.captionText && clip.captionText !== sourceTitle) {
        parts.push(`TOPIC: "${clip.captionText}"`);
      }
      if ((clip as any).storyTitle) parts.push(`RAW_TITLE: "${(clip as any).storyTitle}"`);
      if ((clip as any).storyHook) parts.push(`RAW_HOOK: "${(clip as any).storyHook}"`);
      if ((clip as any).thumbnailText) parts.push(`THUMBNAIL: "${(clip as any).thumbnailText}"`);
      if (parts.length === 1) parts.push(`Segment from "${sourceTitle}"`);
      return parts.join(" | ");
    }).join("\n");

    const rotationBlock = buildAudienceRotationBlock(
      batchAssignments.map(({ clipLabel, angle }) => ({ clipLabel, angle }))
    );

    // Session 36: Enhanced with social-optimization-prompt intelligence.
    // Deployment 4: Now wrapped with the Audience Rotation Protocol block.
    // Session 48: Now ALSO wrapped with the FREQUENCY BIFURCATION PROTOCOL block
    // so Yuki can NEVER bleed Ace Richie vocabulary into Containment Field copy
    // or vice versa, regardless of which demographic angle is assigned.
    const brandBlock = buildBrandFrequencyBlock(brand);
    const brandLabel = BRAND_FREQUENCY_PROFILES[brand].brandLabel;

    const prompt = `${brandBlock}

You are Yuki, an elite social media distribution engine for ${brandLabel}. Every rule in the FREQUENCY BIFURCATION PROTOCOL block above overrides any generic distribution advice that follows.

BRAND-CONTEXT RECONCILIATION (how FREQUENCY BIFURCATION and AUDIENCE ROTATION compose):
The FREQUENCY BIFURCATION block locks the CHANNEL voice. The AUDIENCE ROTATION block locks the DEMOGRAPHIC angle. They compose; they do not collide. For ace_richie: translate every demographic's pain into the quantum/monad/timeline/frequency vocabulary of the REQUIRED LEXICON above — a corporate-burnout clip on Ace Richie becomes an edict about the timeline the viewer has been broadcasting, not a listicle about their manager. For containment_field: translate every demographic's pain into the clinical extraction-loop/micro-compliance/behavioral-program vocabulary — a spiritual-awakening clip on Containment Field becomes a clinical exposure of the nervous-system conditioning loop that manufactured the "awakening", never a cosmological edict. The demographic angle changes WHO the content lands on; the frequency profile changes WHAT vocabulary it lands in. Both are non-negotiable, and the bifurcation wins any tie.

SOURCE VIDEO TITLE: "${sourceTitle}"
NICHE: ${niche.replace(/_/g, " ")}
TRANSCRIPT EXCERPT: ${transcript.slice(0, 1500)}

${rotationBlock}

PLATFORM-SPECIFIC OPTIMIZATION RULES (obey these exactly):

- YOUTUBE_SHORT: Hook in first 3 words of title. Max 100 chars. Include #Shorts. Title MUST come from the assigned angle's vocabulary, not Sovereign lexicon. The youtube_short VALUE MUST be structured as: "<Title>\\n\\n<1-2 sentence hook>\\n\\nRelated topics: <5-7 comma-separated angle keywords>" — the Related topics line is MANDATORY (tag smuggling).
- TIKTOK: Hook within 1.5 seconds of reading. 2-3 lines + exactly 5 hashtags drawn from the ASSIGNED ANGLE's demographic (NOT #darkpsychology/#sovereignty defaults unless the angle IS those). Pattern-interrupt opening in the assigned voice.
- INSTAGRAM: Reels caption from the assigned angle's emotional entry. 3-5 lines + 8-12 hashtags tailored to THAT demographic. First line IS the hook.
- THREADS: 2-3 lines in the assigned voice. 0 hashtags. Like texting a smart friend who shares that demographic.
- LINKEDIN: TROJAN HORSE — write as a high-level Systems Engineer sharing operational insights. Use CORPORATE language: efficiency, systems, automation, architecture, ROI, leverage, strategic, scalable. The sovereign payload is INSIDE the professional framing. From the assigned angle (e.g. Corporate Burnout → contrarian ex-exec exposing operational failures; Tech/AI Realism → staff engineer on system design; Wealth → capital architect on leverage mechanics). 2-3 sentences. 3-5 INDUSTRY hashtags (#SystemsThinking #Automation #Leadership #OperationalExcellence). NEVER sound esoteric, guru-like, or use quantum/frequency/monad vocabulary — LinkedIn's algorithm will kill reach.
- FACEBOOK: Shareable insight format in the assigned angle's voice. 2-3 lines + a question the assigned demographic would answer.
- BLUESKY: High-velocity memetic trigger for The Containment Field. Clinical, raw, declassified-briefing tone. Pattern-interrupt opening. Max 300 chars. 0 hashtags. No corporate polish. This is the containment frequency — use the CONTAINMENT_FIELD lexicon (nervous system, extraction loop, behavioral program, micro-compliance). Like a transmission dropped on a decentralized grid.

COPY ARCHITECTURE (applied through the assigned angle's lens):
GLITCH (pattern interrupt that lands in the assigned demographic's world) → PIVOT (reframe using their vocabulary) → BRIDGE (to the universal insight) → ANCHOR (subtle, no Sovereign Synthesis name-drop unless natural).

CLIPS:
${clipDescriptions}

Return ONLY valid JSON — an array of objects, one per clip in the exact order shown above, each with keys: youtube_short, tiktok, instagram, threads, linkedin, facebook, bluesky.
All values are strings. The youtube_short string MUST contain a title, a hook, and a "Related topics: ..." trailing line (tag smuggling). No two clips may reuse the same angle keywords.`;

    try {
      const response = await llm.generate(
        [{ role: "user", content: prompt }],
        { maxTokens: 4096, temperature: 0.75 }
      );

      let parsed: PlatformCopy[];
      const cleaned = response.content.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      }

      for (let i = 0; i < batch.length && i < parsed.length; i++) {
        const clip = batch[i];
        const raw = parsed[i];
        // Deployment 4 safety net: if the LLM forgot the "Related topics:" smuggled tag line,
        // inject it from the assigned angle's keyword seeds so SEO is never lost.
        const angle = clipAngleMap.get(clip.index);
        if (angle && raw && typeof raw.youtube_short === "string" && !/Related topics:/i.test(raw.youtube_short)) {
          const seeds = angle.keywordSeeds.slice(0, 6).join(", ");
          raw.youtube_short = `${raw.youtube_short.trim()}\n\nRelated topics: ${seeds}`;
        }
        copyMap.set(clip.index, raw);
        clip.captionText = (raw?.youtube_short?.split("\n")[0]) || raw?.tiktok || "Sovereign Synthesis";
      }
    } catch (err: any) {
      console.error(`[Orchestrator] Copy generation failed for batch at ${batchStart}: ${err.message}`);
      // Deployment 4: Rotating fallback — even fallback captions must not collapse to
      // "dark psychology + sovereignty" boilerplate. Use the clip's assigned angle.
      for (const { clip, angle } of batchAssignments) {
        const firstPattern = angle.titlePatterns[0] || sourceTitle;
        const secondPattern = angle.titlePatterns[1] || firstPattern;
        const seeds = angle.keywordSeeds.slice(0, 6).join(", ");
        const tagline5 = angle.keywordSeeds.slice(0, 5).map(s => "#" + s.replace(/[^a-z0-9]+/gi, "")).join(" ");
        copyMap.set(clip.index, {
          youtube_short: `${firstPattern} #Shorts\n\n${secondPattern}\n\nRelated topics: ${seeds}`,
          tiktok: `${firstPattern}\n\n${secondPattern}\n\n${tagline5}`,
          instagram: `${firstPattern}\n\n${secondPattern}\n\n${tagline5}`,
          threads: `${firstPattern}\n\n${secondPattern}`,
          linkedin: `${firstPattern}\n\n${secondPattern}\n\n#${angle.id.replace(/_/g, "")}`,
          facebook: `${firstPattern}\n\n${secondPattern}`,
          bluesky: `${firstPattern}\n\n${secondPattern}`,
        });
      }
    }
  }

  console.log(`✅ [Orchestrator] Platform copy generated for ${copyMap.size}/${clips.length} clips`);
  return copyMap;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 47 — STEP 2.5: LONG-FORM YOUTUBE DESCRIPTION VIA VIRAL BRAIN
// Architect override: kill the hardcoded "Extracted intelligence from the simulation"
// boilerplate that was shipping on every long-form upload and replace it with a
// dynamic, demographic-rotated description generated by the same Audience Rotation
// Protocol that powers the clip-level Viral Brain.
//
// Contract:
//   - Pick a SINGLE demographic angle deterministically from sourceTitle hash.
//   - Ask the LLM to write a thesis-first, 4-6 paragraph description IN that angle's
//     voice, using THAT angle's vocabulary, NOT the Sovereign internal lexicon.
//   - Force a trailing "Related topics: ..." line (tag smuggling protocol — Buffer
//     strips the YouTube API tags field, so SEO seeds must live in the description).
//   - Force a trailing hashtag footer line so YouTube's in-description hashtag
//     linkification catches at least 5 niche-coded tags.
//   - Return { description, tags } so the caller just spreads it into ytTool.execute.
// If the LLM call fails, we fall back to a deterministic angle-driven template so the
// upload NEVER regresses to the "Extracted intelligence from the simulation" string.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface LongFormDescriptionResult {
  description: string;
  tags: string;
  angleId: string;
  angleName: string;
}

async function generateLongFormDescription(
  llm: LLMProvider,
  sourceTitle: string,
  videoTitle: string,
  niche: string,
  brand: Brand,
  transcript: string
): Promise<LongFormDescriptionResult> {
  // Deterministic angle pick: same source video → same angle every time.
  // Offset by +1 vs clip rotation so the long-form description does NOT duplicate
  // clip #1's angle (clips use hash + 0, long-form uses hash + 1 as its "slot").
  const offset = hashStringToAngleOffset(sourceTitle || niche || "sovereign");
  const angle = angleForClipIndex(1, offset, brand);

  const brandBlock = buildBrandFrequencyBlock(brand);
  const brandLabel = BRAND_FREQUENCY_PROFILES[brand].brandLabel;

  const rotationBlock = buildAudienceRotationBlock([
    { clipLabel: "LONG-FORM YOUTUBE DESCRIPTION", angle },
  ]);

  // SESSION 83: Brand voice is the FLOOR, not the ceiling. The previous prompt
  // banned Sovereign lexicon from Ace's own channel descriptions, producing
  // generic LinkedIn self-help copy. Fixed: Sovereign voice is MANDATORY on
  // the main channel. Demographic targeting is layered ON TOP, not instead of.
  const prompt = `${brandBlock}

You are the voice of ${brandLabel}. Every rule in the FREQUENCY BIFURCATION PROTOCOL block above is LAW. The channel voice is the foundation — demographic targeting layers on top of it, never replaces it.

You are writing the DESCRIPTION for a long-form YouTube video uploaded to the MAIN ${brandLabel} channel. This is the 10-15 minute anchor video — the flagship content.

VIDEO TITLE: "${videoTitle}"
NICHE: ${niche.replace(/_/g, " ")}
TRANSCRIPT EXCERPT: ${transcript.slice(0, 2000)}

${rotationBlock}

VOICE HIERARCHY (SESSION 83 — NON-NEGOTIABLE):
1. BRAND VOICE IS THE FLOOR. For ace_richie: write in the Sovereign Synthesis frequency — timelines, quantum resets, frequency shifts, the architecture of liberation. For containment_field: write in clinical dark psychology extraction vocabulary. The brand voice is NEVER diluted.
2. DEMOGRAPHIC TARGETING IS THE LENS. Use the assigned angle to determine WHO you're speaking to and WHAT specific pain point you lead with. But the VOCABULARY stays in-brand.
3. If it reads like a generic self-help blog post, a LinkedIn motivation post, or a corporate burnout article — you have FAILED. Rewrite until it sounds like nobody else on YouTube.

LONG-FORM DESCRIPTION ARCHITECTURE:

LINE 1 — THE GLITCH (1 sentence, max 15 words)
  A pattern interrupt. A statement that makes the viewer's current reality logic stutter.
  NOT an empathy opener. NOT "You know the feeling." A GLITCH.
  Examples: "Your timeline forked 6 months ago. You just haven't caught up yet."
  "The version of you reading this was supposed to be deleted by now."

Paragraph 2 — THE MECHANISM (3-4 sentences)
  Name the specific mechanism this video exposes. Use the assigned demographic's situation as the ENTRY POINT but describe it through the brand's lens.
  For ace_richie: quantum resets, timeline collapses, frequency architecture, sovereign synthesis.
  For containment_field: extraction loops, micro-compliance patterns, behavioral programs, dark psychology mechanics.
  This paragraph must contain at least ONE concept the viewer has never heard framed this way before.

Paragraph 3 — THE TRANSMISSION (2-3 sentences)
  What the viewer walks away with. Be SPECIFIC — name the shift, the tool, the protocol element.
  Not vague promises. Concrete architecture.

Paragraph 4 — THE GATE (1-2 sentences)
  Who this is for. Use the assigned demographic descriptor but frame it as a filter, not an invitation.
  "If you're still optimizing inside the old operating system, this isn't for you yet."
  NOT: "If you're feeling stuck, this video is for you." That's simulation energy.

Then, in order, exactly these trailing lines (each on its own blank-separated line):

🧬 Take the Diagnostic: https://sovereign-synthesis.com/diagnostic

🔗 The Protocol: https://sovereign-synthesis.com

Related topics: <5-7 comma-separated keyword seeds from the assigned angle, adapted to the video's actual content>

#<tag1> #<tag2> #<tag3> #<tag4> #<tag5> #<tag6> #<tag7>
  • Include ONE brand hashtag (#SovereignSynthesis OR #ContainmentField).
  • NO generic #mindset, #motivation, #selfhelp. Demographic-coded only.

HARD BANS (immediate rejection):
  • "You know the feeling" or any empathy-first opener
  • "Sunday nights, dreading..." or any day-of-week cliche
  • "You're not alone" — simulation comfort language
  • "In this video" — dead energy
  • "Like and subscribe" / "smash that bell"
  • "Extracted intelligence from the simulation" / "The Firmware Update continues"
  • Any sentence that could appear on a generic self-help channel unchanged
  • Paragraphs longer than 4 sentences — brevity is authority

Return ONLY valid JSON with this exact shape:
{
  "description": "<the full description string including all paragraphs, links, Related topics line, and hashtag footer, separated by \\n\\n>",
  "tags": "<comma-separated flat list of 8-12 tags for the YouTube API tags field, pulled from the assigned angle's keyword seeds plus the niche, all lowercase, no hash symbols>"
}

No prose outside the JSON. No code fences.`;

  // Attempt LLM generation. Retry once on parse failure before falling back.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await llm.generate(
        [{ role: "user", content: prompt }],
        { maxTokens: 2048, temperature: 0.75 }
      );
      const cleaned = response.content.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
      let parsed: { description?: string; tags?: string };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : {};
      }
      if (parsed.description && typeof parsed.description === "string" && parsed.description.length > 100) {
        // Post-process safety: guarantee "Related topics:" line is present.
        let description = parsed.description.trim();
        if (!/Related topics:/i.test(description)) {
          const seeds = angle.keywordSeeds.slice(0, 6).join(", ");
          description = `${description}\n\nRelated topics: ${seeds}`;
        }
        // Post-process safety: guarantee forbidden boilerplate did not leak.
        if (/Extracted intelligence from the simulation|The Firmware Update continues/i.test(description)) {
          console.warn(`[Orchestrator] LongFormDesc LLM leaked forbidden boilerplate on attempt ${attempt + 1} — retrying`);
          continue;
        }
        // Guarantee tags field is a non-empty comma-separated string.
        let tags = typeof parsed.tags === "string" ? parsed.tags.trim() : "";
        if (!tags || tags.length < 10) {
          tags = [
            ...angle.keywordSeeds.slice(0, 6),
            niche.replace(/_/g, " "),
            brand === "ace_richie" ? "sovereign synthesis" : "containment field",
          ].join(",");
        }
        console.log(`✅ [Orchestrator] Long-form description generated via Viral Brain — angle="${angle.name}" (${description.length} chars)`);
        return { description, tags, angleId: angle.id, angleName: angle.name };
      }
    } catch (err: any) {
      console.warn(`[Orchestrator] LongFormDesc LLM attempt ${attempt + 1} failed: ${err.message?.slice(0, 200)}`);
    }
  }

  // Deterministic fallback. Built from the assigned angle so it NEVER collapses to
  // the hardcoded boilerplate Ace specifically called out.
  console.warn(`[Orchestrator] LongFormDesc falling back to angle-template for angle="${angle.name}"`);
  const seedsList = angle.keywordSeeds.slice(0, 6).join(", ");
  const hashtagFooter = angle.keywordSeeds.slice(0, 5)
    .map(s => "#" + s.replace(/[^a-z0-9]+/gi, ""))
    .concat([brand === "ace_richie" ? "#SovereignSynthesis" : "#ContainmentField"])
    .join(" ");
  const brandLine = brand === "ace_richie"
    ? "If this lands, the full framework is at https://sovereign-synthesis.com."
    : "More pattern-decoded at https://sovereign-synthesis.com.";
  const fallbackDescription = [
    videoTitle,
    angle.emotionalEntry,
    `This is for the version of you that noticed the pattern before you had words for it. ${angle.voice.split(".")[0]}.`,
    `What this video delivers: the exact ${angle.name.toLowerCase()} pattern named, the mechanism underneath it, and the next concrete move from here. No slogans, no motivational filler, no "just be present" cope.`,
    `If you're in the ${angle.demographic.split(",")[0].trim().toLowerCase()} slice of this, this is for you. ${brandLine}`,
    "🧬 Take the Diagnostic: https://sovereign-synthesis.com/diagnostic",
    "🔗 The Protocol: https://sovereign-synthesis.com",
    `Related topics: ${seedsList}`,
    hashtagFooter,
  ].join("\n\n");
  const fallbackTags = [
    ...angle.keywordSeeds.slice(0, 6),
    niche.replace(/_/g, " "),
    brand === "ace_richie" ? "sovereign synthesis" : "containment field",
  ].join(",");

  return {
    description: fallbackDescription,
    tags: fallbackTags,
    angleId: angle.id,
    angleName: angle.name,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 7: DISTRIBUTE CLIPS TO PLATFORMS
// Direct API publish to TikTok, Instagram, YouTube Shorts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function distributeClips(
  clips: ClipMeta[],
  copyMap: Map<number, PlatformCopy>,
  niche: string,
  brand: Brand
): Promise<string[]> {
  const results: string[] = [];
  // Import video publisher tools
  const { VideoPublisherTool } = await import("../tools/video-publisher");
  const publisher = new VideoPublisherTool();

  // Only distribute clips that have public URLs
  const uploadedClips = clips.filter(c => c.publicUrl);

  for (const clip of uploadedClips) {
    const copy = copyMap.get(clip.index);
    if (!copy) continue;

    try {
      const result = await publisher.execute({
        video_url: clip.publicUrl!,
        platforms: "all",
        caption: copy.tiktok, // Use tiktok copy as default for video platforms
        title: copy.youtube_short?.split("\n")[0]?.slice(0, 100) || `Clip ${clip.index + 1}`,
        tags: `${niche.replace(/_/g, ",")},sovereign synthesis,protocol 77,dark psychology,mindset`,
        niche,
        brand,
      });
      results.push(`Clip ${clip.index + 1}: ${result.includes("✅") ? "✅" : "⚠️"} ${result.slice(0, 200)}`);
    } catch (err: any) {
      results.push(`Clip ${clip.index + 1}: ❌ ${err.message?.slice(0, 150)}`);
    }

    // SESSION 85: 10s delay — Buffer allows 100 req/15min (shared limiter also enforces)
    await new Promise(r => setTimeout(r, 10_000));
  }

  console.log(`✅ [Orchestrator] Distribution complete — ${results.length} clips processed`);
  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 8: SCHEDULE WEEK IN BUFFER
// Distribute posts across ALL connected Buffer channels over 7 days.
// PLATFORM REQUIREMENTS (verified from Buffer docs):
//   - TikTok: REQUIRES video or images. Text-only WILL FAIL.
//   - Instagram: REQUIRES image or video. Text-only WILL FAIL.
//   - YouTube: REQUIRES video (Shorts only). Text-only WILL FAIL. No community posts via Buffer.
//   - Threads, LinkedIn, Facebook: text-only works fine.
// Strategy: Clips with publicUrl → video platforms get video URL as media.
//           Clips without publicUrl → skip video platforms, text-only to text platforms.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Map Buffer service names to our platform copy keys
const SERVICE_TO_COPY_KEY: Record<string, keyof PlatformCopy> = {
  threads: "threads",
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube_short",
  googlebusiness: "facebook",
  mastodon: "threads",
  pinterest: "instagram",
  bluesky: "bluesky",
};

// Platforms that REQUIRE media (video or image) — text-only will be rejected
const MEDIA_REQUIRED_SERVICES = new Set(["tiktok", "instagram", "youtube"]);

// Platforms that accept text-only posts
const TEXT_OK_SERVICES = new Set(["threads", "linkedin", "facebook", "mastodon", "googlebusiness", "bluesky"]);

async function scheduleBufferWeek(
  clips: ClipMeta[],
  copyMap: Map<number, PlatformCopy>,
  niche: string,
  brand: Brand = "ace_richie"
): Promise<number> {
  // SESSION 87: Pre-flight — don't attempt scheduling if quota is already blown
  if (isBufferQuotaExhausted()) {
    console.warn(`⏸️ [Orchestrator] Buffer quota exhausted — skipping shorts distribution. ContentEngine will pick up when quota resets.`);
    return 0;
  }

  const { SocialSchedulerListProfilesTool, SocialSchedulerPostTool } = await import("../tools/social-scheduler");

  // Get ALL available Buffer channels — no filtering, no exclusions
  const listTool = new SocialSchedulerListProfilesTool();
  const channelsRaw = await listTool.execute();

  let channels: any[];
  try {
    channels = JSON.parse(channelsRaw);
  } catch {
    console.error("[Orchestrator] Failed to parse Buffer channels");
    return 0;
  }

  if (!Array.isArray(channels) || channels.length === 0) {
    console.error("[Orchestrator] No Buffer channels found");
    return 0;
  }

  // Use ALL channels — only skip paused queues
  const activeChannels = channels.filter((c: any) => !c.queuePaused);

  if (activeChannels.length === 0) {
    console.error("[Orchestrator] All Buffer channel queues are paused");
    return 0;
  }

  // Split channels by what they need
  const textChannels = activeChannels.filter((c: any) => !MEDIA_REQUIRED_SERVICES.has(c.service));
  const mediaChannels = activeChannels.filter((c: any) => MEDIA_REQUIRED_SERVICES.has(c.service));

  // Clips that have public URLs can go to media-required platforms
  const clipsWithMedia = clips.filter(c => c.publicUrl);

  console.log(`📡 [Orchestrator] Scheduling across ${activeChannels.length} active channels:`);
  console.log(`   Text channels (${textChannels.length}): ${textChannels.map((c: any) => `${c.service}/${c.name}`).join(", ")}`);
  console.log(`   Media channels (${mediaChannels.length}): ${mediaChannels.map((c: any) => `${c.service}/${c.name}`).join(", ")}`);
  console.log(`   Clips with video URL: ${clipsWithMedia.length}/${clips.length}`);

  const postTool = new SocialSchedulerPostTool();
  let scheduledCount = 0;

  // Time slots: 8 per day — supports up to 3 pipeline runs/day without collision.
  // CT times: 4AM, 6AM, 8AM, 10AM, 12PM, 2PM, 5PM, 8PM
  // = UTC:    09:00, 11:00, 13:00, 15:00, 17:00, 19:00, 22:00, 01:00(+1)
  // 8 slots × 7 days = 56 slots/week. At ~28 posts/pipeline, that's exactly 2 full pipelines.
  // A 3rd pipeline in the same week spills into slightly tighter spacing — still clean.
  const timeSlots = ["09:00:00", "11:00:00", "13:00:00", "15:00:00", "17:00:00", "19:00:00", "22:00:00", "01:00:00"];
  const now = new Date();
  let globalSlotIndex = 0;

  // ── Session 43: Anti-Ghost Upload Protocol ──
  // YouTube/Buffer de-prioritizes content posting on exact minute boundaries
  // (:00, :15, :30, :45) because automated posters all default to them.
  // We inject a random ±14 minute offset per post so timestamps look human.
  // 29 possible offsets (-14..+14 inclusive) — small enough to stay in slot
  // neighborhood, large enough to break the hourly metronome signature.
  const antiGhostJitter = (iso: string): string => {
    const d = new Date(iso);
    const jitterMin = Math.floor(Math.random() * 29) - 14; // -14..+14
    d.setUTCMinutes(d.getUTCMinutes() + jitterMin);
    // Buffer expects ISO8601 with Z suffix, seconds precision is fine
    return d.toISOString().slice(0, 19) + "Z";
  };

  for (let clipIdx = 0; clipIdx < clips.length; clipIdx++) {
    // SESSION 87: Bail out mid-loop if quota gets blown during scheduling
    if (isBufferQuotaExhausted()) {
      console.warn(`⏸️ [Orchestrator] Buffer quota hit mid-scheduling at clip ${clipIdx}/${clips.length} — stopping. ${scheduledCount} posts already queued.`);
      break;
    }

    const clip = clips[clipIdx];
    const copy = copyMap.get(clip.index);
    if (!copy) continue;

    // ── TEXT-ONLY CHANNELS (X, Threads, LinkedIn, Facebook) ──
    for (const channel of textChannels) {
      const dayOffset = Math.floor(globalSlotIndex / timeSlots.length);
      const slotIdx = globalSlotIndex % timeSlots.length;
      if (dayOffset >= 7) break;

      const schedDate = new Date(now);
      schedDate.setDate(schedDate.getDate() + dayOffset + 1);
      // Session 43: Apply Anti-Ghost ±14min jitter to defeat metronome detection
      const scheduledAt = antiGhostJitter(
        `${schedDate.toISOString().split("T")[0]}T${timeSlots[slotIdx]}Z`
      );

      const copyKey = SERVICE_TO_COPY_KEY[channel.service] || "threads";
      const postText = (copy as any)[copyKey] || copy.threads ||
        `Firmware Update incoming. sovereign-synthesis.com #SovereignSynthesis #${niche.replace(/_/g, "")}`;

      try {
        const result = await postTool.execute({
          channel_ids: channel.id,
          text: postText,
          scheduled_at: scheduledAt,
          niche,
        });
        if (result.includes("✅")) {
          scheduledCount++;
          console.log(`  📌 Clip ${clipIdx} → ${channel.service}/${channel.name} @ ${scheduledAt} [text]`);
        } else {
          console.error(`  ❌ Clip ${clipIdx} → ${channel.service}/${channel.name}: REJECTED — ${result.slice(0, 300)}`);
        }
      } catch (err: any) {
        console.error(`[Orchestrator] Buffer EXCEPTION clip ${clipIdx} → ${channel.service}: ${err.message?.slice(0, 300)}`);
      }

      globalSlotIndex++;
      await new Promise(r => setTimeout(r, 10_000)); // SESSION 85: 10s gap — Buffer allows 100 req/15min
    }

    // ── SESSION 97: Facebook direct publish (not a Buffer channel) ──
    // Posts clip text + thumbnail to the correct FB Page via Graph API.
    // Routes to ace_richie or containment_field page based on brand param.
    {
      const fbCopyKey = "facebook";
      const fbText = (copy as any)[fbCopyKey] || copy.threads ||
        (brand === "ace_richie"
          ? `Firmware Update incoming. sovereign-synthesis.com #SovereignSynthesis #${niche.replace(/_/g, "")}`
          : `The containment field runs deeper than you think. sovereign-synthesis.com #TheContainmentField #${niche.replace(/_/g, "")}`);
      try {
        const fbResult = await publishToFacebook(fbText, {
          imageUrl: clip.thumbnailUrl || undefined,
          link: clip.publicUrl || undefined,
          brand: brand as "ace_richie" | "containment_field",
        });
        if (fbResult.success) {
          scheduledCount++;
          console.log(`  📌 Clip ${clipIdx} → facebook_direct [${brand}] @ NOW [Graph API]: ${fbResult.postId}`);
        } else {
          console.error(`  ❌ Clip ${clipIdx} → facebook_direct [${brand}]: ${fbResult.error}`);
        }
      } catch (err: any) {
        console.error(`  ❌ Clip ${clipIdx} → facebook_direct [${brand}] EXCEPTION: ${err.message?.slice(0, 300)}`);
      }
    }

    // ── MEDIA-REQUIRED CHANNELS (TikTok, Instagram, YouTube) ──
    // Only send if clip has a public video URL
    // CRITICAL: These platforms REQUIRE metadata fields per Buffer API docs:
    //   YouTube: metadata.youtube.title + metadata.youtube.categoryId (REQUIRED)
    //   Instagram: metadata.instagram.type + metadata.instagram.shouldShareToFeed (REQUIRED)
    //   TikTok: metadata.tiktok.title (optional but recommended)
    if (clip.publicUrl) {
      for (const channel of mediaChannels) {
        const dayOffset = Math.floor(globalSlotIndex / timeSlots.length);
        const slotIdx = globalSlotIndex % timeSlots.length;
        if (dayOffset >= 7) break;

        const schedDate = new Date(now);
        schedDate.setDate(schedDate.getDate() + dayOffset + 1);
        // Session 43: Apply Anti-Ghost ±14min jitter — each clip re-rolls jitter,
        // so even clips scheduled into the same slot land at different minutes.
        const scheduledAt = antiGhostJitter(
          `${schedDate.toISOString().split("T")[0]}T${timeSlots[slotIdx]}Z`
        );

        const copyKey = SERVICE_TO_COPY_KEY[channel.service] || "tiktok";
        const postText = (copy as any)[copyKey] || copy.tiktok || copy.instagram ||
          `Firmware Update incoming. #SovereignSynthesis #${niche.replace(/_/g, "")}`;

        // Build platform-specific metadata based on channel service
        const metadata: Record<string, unknown> = {};

        // Session 42: Use clip's semantic storyTitle for YouTube/TikTok titles (unique per clip).
        // Fallback: extract from post text first line. Last resort: source title.
        const clipTitle = (
          clip.storyTitle ||
          postText.split("\n")[0].slice(0, 100) ||
          "Sovereign Synthesis"
        ).slice(0, 95); // Leave room for #Shorts suffix

        // ENUM: prefix = GraphQL enum values (rendered unquoted by buildGqlObj in social-scheduler.ts)
        // Without prefix = regular strings (rendered quoted)
        // This convention survives JSON.stringify/parse round-trip.
        if (channel.service === "youtube") {
          // Session 42: Enforce #Shorts in title (PLATFORM_DEFAULTS.youtube_shorts.requiredInTitle)
          const ytTitle = clipTitle.includes("#Shorts") ? clipTitle : `${clipTitle} #Shorts`;
          const ytMeta: Record<string, unknown> = {
            title: ytTitle.slice(0, 100),
            categoryId: "22",               // String! per Buffer schema
            privacy: "ENUM:public",          // YoutubePrivacy enum — NOT a quoted string
            madeForKids: false,
          };
          // Session 39: Attach per-clip thumbnail if available
          if (clip.thumbnailUrl) {
            ytMeta.thumbnail = clip.thumbnailUrl;
          }
          metadata.youtube = ytMeta;
        } else if (channel.service === "instagram") {
          metadata.instagram = {
            type: "ENUM:reel",               // PostType enum — NOT a quoted string
            shouldShareToFeed: true,
          };
        } else if (channel.service === "tiktok") {
          metadata.tiktok = {
            title: clipTitle,
          };
        }

        try {
          const result = await postTool.execute({
            channel_ids: channel.id,
            text: postText,
            media_url: clip.publicUrl,
            scheduled_at: scheduledAt,
            niche,
            metadata_json: JSON.stringify(metadata),
          });
          if (result.includes("✅")) {
            scheduledCount++;
            console.log(`  📌 Clip ${clipIdx} → ${channel.service}/${channel.name} @ ${scheduledAt} [video+metadata] title="${clipTitle}"`);
          } else {
            // Session 42: Log full result for failed posts to diagnose platform-specific issues
            console.error(`  ❌ Clip ${clipIdx} → ${channel.service}/${channel.name}: REJECTED — ${result.slice(0, 300)}`);
            console.error(`     Media URL: ${clip.publicUrl?.slice(0, 100)}`);
            console.error(`     Metadata: ${JSON.stringify(metadata).slice(0, 200)}`);
          }
        } catch (err: any) {
          console.error(`[Orchestrator] Buffer EXCEPTION clip ${clipIdx} → ${channel.service}: ${err.message?.slice(0, 300)}`);
          console.error(`  Media URL: ${clip.publicUrl?.slice(0, 100)}`);
        }

        globalSlotIndex++;
        await new Promise(r => setTimeout(r, 10_000)); // SESSION 85: 10s gap — Buffer allows 100 req/15min
      }
    } else {
      console.warn(`  ⚠️ Clip ${clipIdx} has no public URL — skipping media-required channels (TikTok/IG/YouTube)`);
    }

    if (Math.floor(globalSlotIndex / timeSlots.length) >= 7) break;
  }

  console.log(`✅ [Orchestrator] ${scheduledCount} posts scheduled in Buffer across ${activeChannels.length} channels over ${Math.min(7, Math.ceil(globalSlotIndex / timeSlots.length))} days`);
  return scheduledCount;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MASTER PIPELINE: executeFullPipeline()
// 1 URL → Whisper → Faceless LONG → YouTube → Curate Shorts → Distribute → Buffer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface PipelineOptions {
  dryRun?: boolean; // Stub all expensive API calls — validates logic without burning credits
  // SESSION 47b — NATIVE SEED GENERATOR PIVOT.
  // When set, the orchestrator skips Step 1 (yt-dlp download) and Step 2 (Whisper transcription)
  // entirely. The rawIdea text is fed directly into the Faceless Factory as the
  // sourceIntelligence for Anita's script generator. The first arg (youtubeUrl) is treated
  // as a synthetic identifier and is NOT downloaded or transcribed. Niche is auto-detected
  // from the rawIdea text via detectNiche(); pass `niche` to override.
  rawIdea?: string;
  niche?: string; // Optional override; otherwise inferred from rawIdea via detectNiche()
  // Phase 7 Task 7.5a — BATCH PRODUCER PRE-PRODUCED VIDEO.
  // When set, Steps 1+2 are SKIPPED entirely. The orchestrator uses this FacelessResult
  // directly and proceeds to Steps 3-8 (YouTube upload, shorts, Buffer distribution).
  // Used by batch-producer.ts to feed pod-produced videos into the distribution pipeline.
  preProduced?: import("./faceless-factory").FacelessResult;
  // SESSION 86: Scheduled YouTube publish time. ISO 8601. When set, video uploads
  // as PRIVATE and auto-publishes at this time. Used by batch producer for 3-hour stagger.
  scheduledPublishAt?: string;
}

export async function executeFullPipeline(
  youtubeUrl: string,
  llm: LLMProvider,
  brand: Brand = "ace_richie",
  onProgress?: (step: string, detail: string) => Promise<void>,
  options?: PipelineOptions
): Promise<OrchestratorResult> {
  const dryRun = options?.dryRun ?? false;
  const rawIdea = options?.rawIdea?.trim() || null;
  const preProduced = options?.preProduced ?? null;
  const isRawIdeaMode = rawIdea !== null && rawIdea.length > 0;
  const startTime = Date.now();
  const jobId = `vr_${brand}_${Date.now()}`;
  const errors: string[] = [];

  if (!existsSync(ORCHESTRATOR_DIR)) mkdirSync(ORCHESTRATOR_DIR, { recursive: true });
  if (!existsSync(`${ORCHESTRATOR_DIR}/${jobId}`)) mkdirSync(`${ORCHESTRATOR_DIR}/${jobId}`, { recursive: true });

  const progress = async (step: string, detail: string) => {
    console.log(`🔥 [Orchestrator] ${step}: ${detail}`);
    if (onProgress) {
      try { await onProgress(step, detail); } catch { /* non-critical */ }
    }
  };

  // ── Phase 7 Task 7.5a: PRE-PRODUCED VIDEO BYPASS ──
  // When batch-producer passes a pre-produced FacelessResult, skip Steps 1+2 entirely.
  // The variables `whisperResult` and `facelessResult` are set from the pre-produced data,
  // then control falls through to Step 2.5 (description gen) → Steps 3-8 (distribution).
  const isPreProducedMode = preProduced !== null;

  // ── STEP 1: WHISPER EXTRACTION (or RAW IDEA / PRE-PRODUCED BYPASS) ──
  let whisperResult: WhisperResult;
  if (isPreProducedMode) {
    // Phase 7 Task 7.5a: batch mode — video already produced, just need a whisper shell
    await progress("STEP 1/8", `⚡ BATCH MODE — pre-produced video, skipping Whisper`);
    whisperResult = {
      videoId: youtubeUrl,
      transcript: preProduced!.script?.segments.map((s: { voiceover: string }) => s.voiceover).join("\n\n") || preProduced!.title,
      segments: [],
      sourcePath: "",
      audioPath: "",
      whisperPath: "",
      niche: options?.niche || preProduced!.niche,
    };
  } else if (isRawIdeaMode) {
    await progress("STEP 1/8", `🌱 RAW IDEA mode — bypassing yt-dlp + Whisper. Seed: "${rawIdea!.slice(0, 100)}${rawIdea!.length > 100 ? "…" : ""}"`);
    const inferredNiche = options?.niche || detectNiche(rawIdea!);
    whisperResult = {
      videoId: youtubeUrl, // Synthetic identifier from caller (e.g., raw_<sha1>)
      transcript: rawIdea!, // The thesis IS the source intelligence
      segments: [], // Empty — shorts-curator uses script segments, not whisper segments
      sourcePath: "",
      audioPath: "",
      whisperPath: "",
      niche: inferredNiche,
    };
    await progress("STEP 1/8", `✅ Native seed accepted — niche: ${inferredNiche} (no transcription required)`);
  } else {
    await progress("STEP 1/8", dryRun ? "[DRY RUN] Simulating Whisper extraction..." : "Downloading video and running Whisper transcription...");
  if (dryRun) {
    whisperResult = {
      videoId: youtubeUrl.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1] || "dryrun_vid",
      transcript: "This is a dry-run simulated transcript. The simulation never wanted you to see behind the curtain. " +
        "But here you are, Architect. The Firmware Update is not a metaphor — it is the literal rewiring of your neural pathways " +
        "away from fear-based operating systems toward sovereign execution. ".repeat(10),
      segments: Array.from({ length: 20 }, (_, i) => ({
        start: i * 30, end: (i + 1) * 30, text: `Simulated segment ${i + 1} of 20`
      })),
      sourcePath: `/tmp/sovereign_clips/source_dryrun.mp4`,
      audioPath: `/tmp/sovereign_clips/audio_dryrun.mp3`,
      whisperPath: `/tmp/sovereign_clips/whisper_dryrun.json`,
      niche: "dark_psychology",
    };
    await progress("STEP 1/8", `✅ [DRY RUN] Whisper simulated — ${whisperResult.segments.length} segments, niche: ${whisperResult.niche}`);
  } else {
    try {
      whisperResult = await extractWhisperIntel(youtubeUrl);
      await progress("STEP 1/8", `✅ Whisper complete — ${whisperResult.segments.length} segments, niche: ${whisperResult.niche}`);
    } catch (err: any) {
      throw new Error(`Whisper extraction failed: ${err.message}`);
    }
  }
  } // ← end of isRawIdeaMode else (Session 47b — Native Seed Generator)

  // ── STEP 2: FACELESS FACTORY — LONG MODE (ANITA'S VOICE) or PRE-PRODUCED ──
  let facelessResult: Awaited<ReturnType<typeof produceFacelessVideo>>;
  if (isPreProducedMode) {
    // Phase 7 Task 7.5a: batch mode — video already produced on pod
    facelessResult = preProduced!;
    await progress("STEP 2/8", `⚡ BATCH MODE — using pre-produced: "${facelessResult.title.slice(0, 60)}" (${facelessResult.duration.toFixed(0)}s, ${facelessResult.segmentCount} scenes)`);
  } else if (dryRun) {
    await progress("STEP 2/8", "[DRY RUN] Simulating Faceless Factory...");
    // Create a small dummy video file so Steps 3-4 can operate on a real file path
    const dummyVideoPath = `${ORCHESTRATOR_DIR}/${jobId}/dryrun_longform.mp4`;
    try {
      execSync(
        `ffmpeg -f lavfi -i color=c=black:s=1920x1080:d=10 -f lavfi -i anullsrc=r=44100:cl=mono -shortest -c:v libx264 -preset ultrafast -c:a aac -y "${dummyVideoPath}"`,
        { timeout: 15_000, stdio: "pipe" }
      );
    } catch (err: any) {
      // If ffmpeg fails, create an empty placeholder — logic validation still works
      writeFileSync(dummyVideoPath, Buffer.alloc(1024));
      console.log(`⚠️ [DRY RUN] Dummy video creation failed, using placeholder: ${err.message?.slice(0, 100)}`);
    }
    facelessResult = {
      videoUrl: null,
      localPath: dummyVideoPath,
      title: "DRY RUN — Protocol 77: The Architecture of Sovereign Execution",
      niche: whisperResult.niche,
      brand,
      duration: 600,
      segmentCount: 20,
    };
    await progress("STEP 2/8", `✅ [DRY RUN] Faceless simulated — "${facelessResult.title}" (${facelessResult.duration}s, ${facelessResult.segmentCount} scenes)`);
  } else {
    try {
      facelessResult = await produceFacelessVideo(
        llm,
        whisperResult.transcript,
        whisperResult.niche,
        brand,
        "long"  // ← THIS IS THE KEY — long mode = 20 segments = 10-15 minutes
      );
      await progress("STEP 2/8", `✅ Faceless video produced — "${facelessResult.title}" (${facelessResult.duration.toFixed(0)}s, ${facelessResult.segmentCount} scenes)`);
    } catch (err: any) {
      throw new Error(`Faceless Factory failed: ${err.message}`);
    }
  }

  // ── STEP 2.5: LONG-FORM DESCRIPTION VIA VIRAL BRAIN ──
  // SESSION 47: Kill the hardcoded "Extracted intelligence from the simulation" payload.
  // Route the LLM's demographic-rotated copy directly into the YT description field.
  // This runs BEFORE Step 3 so the ytTool.execute call has a dynamic description ready.
  let longFormCopy: LongFormDescriptionResult;
  if (dryRun) {
    const offset = hashStringToAngleOffset(whisperResult.videoId || facelessResult.title);
    const dryAngle = angleForClipIndex(1, offset, brand);
    longFormCopy = {
      description: `[DRY RUN] ${facelessResult.title}\n\n[DRY RUN] Angle: ${dryAngle.name}\n${dryAngle.emotionalEntry}\n\n🧬 Take the Diagnostic: https://sovereign-synthesis.com/diagnostic\n\n🔗 The Protocol: https://sovereign-synthesis.com\n\nRelated topics: ${dryAngle.keywordSeeds.slice(0, 6).join(", ")}\n\n#DryRun #${dryAngle.id.replace(/_/g, "")}`,
      tags: `dry run,${dryAngle.keywordSeeds.slice(0, 5).join(",")}`,
      angleId: dryAngle.id,
      angleName: dryAngle.name,
    };
  } else {
    try {
      longFormCopy = await generateLongFormDescription(
        llm,
        whisperResult.videoId || facelessResult.title, // source hash seed
        facelessResult.title,
        whisperResult.niche,
        brand,
        whisperResult.transcript,
      );
      await progress("STEP 2.5/8", `✅ Long-form description generated — angle="${longFormCopy.angleName}" (${longFormCopy.description.length} chars)`);
    } catch (err: any) {
      // Hard guardrail: even exception path must NOT fall back to the banned boilerplate.
      const offset = hashStringToAngleOffset(whisperResult.videoId || facelessResult.title);
      const emergencyAngle = angleForClipIndex(1, offset, brand);
      const seeds = emergencyAngle.keywordSeeds.slice(0, 6).join(", ");
      longFormCopy = {
        description: `${facelessResult.title}\n\n${emergencyAngle.emotionalEntry}\n\n🧬 Take the Diagnostic: https://sovereign-synthesis.com/diagnostic\n\n🔗 The Protocol: https://sovereign-synthesis.com\n\nRelated topics: ${seeds}`,
        tags: `${emergencyAngle.keywordSeeds.slice(0, 5).join(",")},${whisperResult.niche.replace(/_/g, " ")}`,
        angleId: emergencyAngle.id,
        angleName: emergencyAngle.name,
      };
      console.error(`[Orchestrator] generateLongFormDescription threw, using emergency angle template: ${err.message?.slice(0, 200)}`);
    }
  }

  // ── STEP 3: YOUTUBE LONG-FORM UPLOAD ──
  await progress("STEP 3/8", dryRun ? "[DRY RUN] Simulating YouTube upload..." : "Uploading long-form video to YouTube...");
  let youtubeVideoId: string | null = null;
  let youtubeUrl2: string | null = null;

  if (dryRun) {
    youtubeVideoId = "DRYRUN_" + jobId.slice(0, 8);
    youtubeUrl2 = `https://youtube.com/watch?v=${youtubeVideoId}`;
    await progress("STEP 3/8", `✅ [DRY RUN] YouTube simulated — ${youtubeUrl2}`);
  } else if (facelessResult.localPath || facelessResult.videoUrl) {
    const ytTool = new YouTubeLongFormPublishTool();
    try {
      // SESSION 47 FIX 3 OVERRIDE: description is now the Viral Brain output, not a
      // hardcoded string. Tags field is still sent to the YouTube Data API (Buffer
      // strips it but the direct publisher path preserves it), and is ALSO smuggled
      // into the description via the "Related topics:" line for defense-in-depth.
      const ytArgs: Record<string, unknown> = {
        local_path: facelessResult.localPath,
        video_url: facelessResult.videoUrl || "",
        title: facelessResult.title,
        description: longFormCopy.description,
        tags: longFormCopy.tags,
        niche: whisperResult.niche,
        brand,
        // Session 47 FIX 2: custom long-form pre-caption thumbnail (vignette + 60% bar + Bebas Neue title).
        // Empty string if the factory couldn't produce one — YouTube will fall back to auto-frame.
        thumbnail_path: facelessResult.thumbnailPath || "",
      };
      // SESSION 86: Batch scheduled publishing — stagger long-forms across the day
      if (options?.scheduledPublishAt) {
        ytArgs.scheduled_publish_at = options.scheduledPublishAt;
        await progress("STEP 3/8", `📅 Scheduling publish at ${options.scheduledPublishAt}`);
      }
      const ytResult = await ytTool.execute(ytArgs);

      // Extract video ID from result
      const vidIdMatch = ytResult.match(/Video ID: ([\w-]+)/);
      if (vidIdMatch) {
        youtubeVideoId = vidIdMatch[1];
        youtubeUrl2 = `https://youtube.com/watch?v=${youtubeVideoId}`;
      }
      await progress("STEP 3/8", ytResult.includes("✅")
        ? `✅ YouTube upload complete — ${youtubeUrl2}`
        : `⚠️ YouTube upload issue: ${ytResult.slice(0, 200)}`);
    } catch (err: any) {
      errors.push(`YouTube upload failed: ${err.message}`);
      await progress("STEP 3/8", `❌ YouTube long-form upload FAILED — halting downstream (foundation gate)`);
      // Phase 5 Task 5.7: Long-form = foundation gate.
      // If the long-form upload fails, nothing downstream fires. Shorts, Buffer,
      // TikTok, IG all depend on the long-form being live on YouTube first.
      cleanupPipelineJob(jobId);
      return {
        youtubeVideoId, youtubeUrl: youtubeUrl2, longFormLocalPath: facelessResult.localPath,
        longFormPublicUrl: facelessResult.videoUrl, clipCount: 0, clips: [],
        bufferScheduled: 0, platformResults: [], errors, duration: (Date.now() - startTime) / 1000,
      };
    }
  } else {
    errors.push("No video URL from Faceless Factory — skipping YouTube upload");
    await progress("STEP 3/8", `❌ No video URL — halting downstream (foundation gate)`);
    cleanupPipelineJob(jobId);
    return {
      youtubeVideoId, youtubeUrl: youtubeUrl2, longFormLocalPath: facelessResult.localPath,
      longFormPublicUrl: facelessResult.videoUrl, clipCount: 0, clips: [],
      bufferScheduled: 0, platformResults: [], errors, duration: (Date.now() - startTime) / 1000,
    };
  }

  // ── STEP 4: STANDALONE SHORTS (Session 102) ──
  // Replaced the old chop-from-long-form curator with standalone shorts generation.
  // Each short is a COMPLETE, SELF-CONTAINED story — its own hook, premise, payoff.
  // No "Full video on the channel" CTA — each short stands on its own.
  // Flow: LLM generates 4 standalone scripts → TTS each → upload audio to R2 →
  //       pod renders each as native 9:16 vertical.
  let clips: ClipMeta[];
  if (dryRun) {
    await progress("STEP 4/8", "[DRY RUN] Simulating standalone shorts generation...");
    const simClipCount = 3;
    clips = Array.from({ length: simClipCount }, (_, i) => ({
      index: i,
      startSec: 0,
      endSec: 45,
      localPath: `${ORCHESTRATOR_DIR}/${jobId}/clip_${i.toString().padStart(2, "0")}.mp4`,
      publicUrl: null,
      captionText: `Standalone Short ${i + 1}|Complete self-contained story`,
      storyTitle: `Standalone Short ${i + 1}`,
      storyHook: `The architecture of liberation reveals itself`,
    }));
    await progress("STEP 4/8", `✅ [DRY RUN] ${clips.length} standalone shorts simulated`);
  } else {
    await progress("STEP 4/8", "Generating standalone shorts scripts...");
    try {
      if (!llm) {
        console.warn(`⚠️ [Orchestrator] No LLM available for standalone shorts — skipping`);
        clips = [];
      } else {
        // Use the source intelligence (transcript or raw idea) as inspiration
        const sourceIntel = whisperResult.transcript || "";
        const standaloneShorts = await generateStandaloneShorts(llm, sourceIntel, whisperResult.niche, brand);
        console.log(`🎬 [Orchestrator] ${standaloneShorts.length} standalone shorts generated for ${brand}`);

        const clipDir = `${ORCHESTRATOR_DIR}/${jobId}/clips`;
        if (!existsSync(clipDir)) mkdirSync(clipDir, { recursive: true });
        if (!existsSync(FACELESS_DIR)) mkdirSync(FACELESS_DIR, { recursive: true });

        clips = [];

        // SESSION 105: Single pod session for TTS (XTTS) + render — everything on GPU.
        try {
          await withPodSession(async (handle) => {
            // Build a podTTS-backed ttsFn for renderAudio
            const xttsForBrand = async (text: string, b: "ace_richie" | "containment_field"): Promise<Buffer> => {
              const result = await podTTS(handle, { text, brand: b });
              return result.audioBuffer;
            };

            for (let i = 0; i < standaloneShorts.length; i++) {
              const standalone = standaloneShorts[i];
              const shortJobId = `${jobId}_standalone_${i}`;

              // ── Step A: TTS via pod XTTS ──
              await progress("STEP 4/8", `TTS for standalone short ${i + 1}/${standaloneShorts.length}: "${standalone.script.title.slice(0, 40)}..."`);
              let audioPath: string;
              let audioDuration: number;
              let segDurations: number[];
              try {
                const audioResult = await renderAudio(standalone.script, shortJobId, xttsForBrand);
                audioPath = audioResult.audioPath;
                segDurations = audioResult.segmentDurations;
                audioDuration = segDurations.reduce((a, b) => a + b, 0);
                console.log(`  🎤 Short ${i} TTS complete (pod XTTS): ${audioDuration.toFixed(1)}s (${segDurations.length} segments)`);
              } catch (ttsErr: any) {
                console.error(`[Orchestrator] Short ${i} TTS FAILED: ${ttsErr.message?.slice(0, 200)}`);
                continue;
              }

              // ── Step B: Convert to WAV (pod expects WAV) and upload to R2 ──
              const wavPath = `${clipDir}/standalone_audio_${i.toString().padStart(2, "0")}.wav`;
              try {
                execSync(
                  `ffmpeg -i "${audioPath}" -vn -acodec pcm_s16le -ar 48000 -ac 2 -y "${wavPath}"`,
                  { timeout: 30_000, stdio: "pipe" },
                );
              } catch (convErr: any) {
                console.error(`[Orchestrator] Short ${i} WAV conversion failed: ${convErr.message?.slice(0, 200)}`);
                continue;
              }

              let audioUrl: string | null = null;
              try {
                if (isR2Configured()) {
                  const r2Key = `shorts-audio/${jobId}/standalone_${i.toString().padStart(2, "0")}.wav`;
                  const audioBuffer = readFileSync(wavPath);
                  await uploadToR2(R2_BUCKET_CLIPS, r2Key, audioBuffer, "audio/wav");
                  audioUrl = await getR2PresignedUrl(R2_BUCKET_CLIPS, r2Key, 3600);
                  console.log(`  📤 Short ${i} audio uploaded to R2: ${audioUrl?.slice(0, 80)}`);
                }
              } catch (r2Err: any) {
                console.error(`[Orchestrator] Short ${i} R2 upload failed: ${r2Err.message?.slice(0, 200)}`);
              }

              if (!audioUrl) {
                console.warn(`  ⚠️ Short ${i}: no R2 audio URL — skipping (standalone shorts require pod rendering)`);
                continue;
              }

              // ── Step C: Build pod job spec + render immediately ──
              const rawSceneDurs = standalone.vertical_scenes.map(vs => vs.duration_s);
              const rawSum = rawSceneDurs.reduce((a, b) => a + b, 0);
              const driftRatio = rawSum > 0 ? audioDuration / rawSum : 1;

              const vScenes: ShortScene[] = standalone.vertical_scenes.map((vs, idx) => ({
                index: vs.index,
                image_prompt: vs.image_prompt,
                duration_s: Math.max(0.5, rawSceneDurs[idx] * driftRatio),
              }));

              const spec: ShortJobSpec = {
                brand: brand as "ace_richie" | "containment_field",
                audio_url: audioUrl,
                audio_duration_s: audioDuration,
                scenes: vScenes,
                hook_text: standalone.script.hook?.slice(0, 200),
                thumbnail_text: standalone.script.thumbnail_text || undefined,
                cta_text: standalone.cta_overlay?.slice(0, 300),
                audio_is_raw_tts: true,
                client_job_id: `${jobId}_standalone_${i}`,
              };

              try {
                const artifacts = await produceShort(handle, spec);
                const clipPath = `${clipDir}/clip_${i.toString().padStart(2, "0")}.mp4`;
                execSync(`curl -sL -o "${clipPath}" "${artifacts.videoUrl}"`, {
                  timeout: 60_000, stdio: "pipe",
                });

                clips.push({
                  index: i,
                  localPath: clipPath,
                  publicUrl: artifacts.videoUrl,
                  startSec: 0,
                  endSec: audioDuration,
                  captionText: `${standalone.script.title} | ${standalone.script.hook}`,
                  storyTitle: standalone.script.title,
                  storyHook: standalone.script.hook,
                });
                console.log(
                  `  🎬 Standalone ${i}: "${standalone.script.title.slice(0, 50)}" ` +
                  `${audioDuration.toFixed(1)}s vScenes=${vScenes.length} → ${artifacts.videoUrl.slice(0, 60)}`
                );
              } catch (podErr: any) {
                console.error(`[Orchestrator] Standalone ${i} pod render FAILED: ${podErr.message?.slice(0, 300)}`);
              }
            }
          });
        } catch (sessionErr: any) {
          console.error(`[Orchestrator] Pod session for standalone shorts FAILED: ${sessionErr.message?.slice(0, 300)}`);
        }

        console.log(`✅ [Orchestrator] ${clips.length}/${standaloneShorts.length} standalone shorts rendered (native vertical)`);
      }

      await progress("STEP 4/8", `✅ ${clips.length} standalone shorts produced`);
    } catch (err: any) {
      console.error(`[Orchestrator] Standalone shorts failed: ${err.message}`);
      clips = [];
      await progress("STEP 4/8", `⚠️ Standalone shorts failed (non-fatal): ${err.message?.slice(0, 150)}`);
    }
  }

  // ── STEP 5: UPLOAD CLIPS TO SUPABASE STORAGE ──
  if (dryRun) {
    await progress("STEP 5/8", `[DRY RUN] Simulating Supabase upload for ${clips.length} clips...`);
    for (const clip of clips) {
      clip.publicUrl = `https://dryrun.supabase.co/storage/v1/object/public/public-assets/vidrush/${jobId}/clip_${clip.index.toString().padStart(2, "0")}.mp4`;
    }
    await progress("STEP 5/8", `✅ [DRY RUN] ${clips.length}/${clips.length} clips simulated`);
  } else {
    await progress("STEP 5/8", `Uploading ${clips.length} clips to Supabase Storage...`);
    try {
      await uploadClipsToStorage(clips, jobId, { brand, niche: whisperResult.niche, title: facelessResult.title });
      const uploadedCount = clips.filter(c => c.publicUrl).length;
      await progress("STEP 5/8", `✅ ${uploadedCount}/${clips.length} clips uploaded`);
    } catch (err: any) {
      errors.push(`Clip upload error: ${err.message}`);
      await progress("STEP 5/8", `⚠️ Clip upload issue: ${err.message?.slice(0, 150)}`);
    }
  }

  // ── STEP 6: GENERATE PLATFORM-SPECIFIC COPY ──
  let copyMap: Map<number, PlatformCopy>;
  if (dryRun) {
    await progress("STEP 6/8", `[DRY RUN] Simulating platform copy for ${clips.length} clips...`);
    copyMap = new Map();
    for (const clip of clips) {
      copyMap.set(clip.index, {
        youtube_short: `DRY RUN — Clip ${clip.index + 1} #Shorts #SovereignSynthesis`,
        tiktok: `DRY RUN — The simulation cracks. Clip ${clip.index + 1}\n#darkpsychology #mindset`,
        instagram: `DRY RUN — Protocol 77 activated.\n\n#sovereignty #mindset #protocol77`,
        threads: `DRY RUN — The architecture of liberation, piece by piece.`,
        linkedin: `DRY RUN — A framework for sovereign execution. #MindsetShift`,
        facebook: `DRY RUN — Full protocol at sovereign-synthesis.com`,
        bluesky: `DRY RUN — The architecture of liberation, piece by piece.`,
      });
      clip.captionText = `DRY RUN — Clip ${clip.index + 1}`;
    }
    await progress("STEP 6/8", `✅ [DRY RUN] Copy simulated for ${copyMap.size} clips across 7 platforms`);
  } else {
    await progress("STEP 6/8", "Generating platform-specific copy for all clips...");
    try {
      copyMap = await generatePlatformCopy(
        llm,
        clips,
        facelessResult.title,
        whisperResult.niche,
        brand,
        whisperResult.transcript
      );
      await progress("STEP 6/8", `✅ Copy generated for ${copyMap.size} clips across 7 platforms`);
    } catch (err: any) {
      errors.push(`Copy generation failed: ${err.message}`);
      copyMap = new Map();
      await progress("STEP 6/8", `⚠️ Copy generation failed: ${err.message?.slice(0, 150)}`);
    }
  }

  // ── STEP 7: VERIFY CLIPS READY FOR BUFFER DISTRIBUTION ──
  // ARCHITECTURE DECISION (Session 23): Step 7 NO LONGER fires direct API publishes.
  // Previously, Step 7 dumped all clips to TikTok/IG/YouTube Shorts simultaneously via
  // VideoPublisherTool, causing "all at once" posting. Step 8 then scheduled the SAME
  // clips across Buffer staggered over 7 days — creating a duplicate dual-path problem.
  //
  // NOW: Step 3 handles YouTube long-form upload. Step 8 handles ALL clip distribution
  // via Buffer scheduling (staggered across 7 days, all 9 channels, platform-specific
  // metadata + video assets). Step 7 is a verification pass only.
  let platformResults: string[] = [];
  const clipsReady = clips.filter(c => c.publicUrl);
  const clipsNoUrl = clips.filter(c => !c.publicUrl);

  if (dryRun) {
    await progress("STEP 7/8", `[DRY RUN] Verifying ${clips.length} clips ready for Buffer distribution...`);
    platformResults = clips.map((c) => `Clip ${c.index + 1}: ✅ [DRY RUN] Ready for Buffer scheduling`);
    await progress("STEP 7/8", `✅ [DRY RUN] ${clips.length} clips verified — will be scheduled in Step 8`);
  } else {
    await progress("STEP 7/8", `Verifying clips for distribution — ${clipsReady.length}/${clips.length} have public URLs...`);
    platformResults = clipsReady.map((c) => `Clip ${c.index + 1}: ✅ Ready (${c.publicUrl?.slice(-40)})`);
    if (clipsNoUrl.length > 0) {
      const skipped = clipsNoUrl.map(c => `Clip ${c.index + 1}: ⚠️ No public URL — will be text-only on media platforms`);
      platformResults.push(...skipped);
    }
    await progress("STEP 7/8", `✅ ${clipsReady.length}/${clips.length} clips verified with video URLs — routing to Buffer in Step 8`);
  }

  // ── STEP 8: SCHEDULE BUFFER WEEK ──
  let bufferScheduled = 0;
  if (dryRun) {
    await progress("STEP 8/8", `[DRY RUN] Simulating Buffer scheduling...`);
    bufferScheduled = Math.min(clips.length, 28);
    await progress("STEP 8/8", `✅ [DRY RUN] ${bufferScheduled} posts would be scheduled in Buffer`);
  } else {
    await progress("STEP 8/8", "Scheduling a week of content in Buffer...");
    try {
      bufferScheduled = await scheduleBufferWeek(clips, copyMap, whisperResult.niche, brand);
      await progress("STEP 8/8", `✅ ${bufferScheduled} posts scheduled in Buffer`);
    } catch (err: any) {
      errors.push(`Buffer scheduling failed: ${err.message}`);
      await progress("STEP 8/8", `⚠️ Buffer scheduling failed: ${err.message?.slice(0, 150)}`);
    }
  }

  const totalDuration = (Date.now() - startTime) / 1000;

  // ── EGRESS CONTROL: Delete clips from Supabase Storage ──
  // Buffer's GraphQL accepts posts with media URLs, but media download may be async.
  // Wait 60s after scheduling to give Buffer time to pull all clip files before deletion.
  // The faceless long-form video stays — it's referenced by YouTube upload and
  // only downloaded once. Clips are the egress multiplier (N clips × M channels).
  if (bufferScheduled > 0 && !dryRun) {
    try {
      console.log(`⏳ [Orchestrator] Waiting 60s for Buffer to cache media before cleanup...`);
      await new Promise(r => setTimeout(r, 60_000));
      await cleanupSupabaseStorage(clips);
    } catch (err: any) {
      console.warn(`⚠️ [Orchestrator] Storage cleanup non-critical error: ${err.message?.slice(0, 200)}`);
    }
  }

  // ── Log pipeline run to Supabase ──
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/content_transmissions`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          source: "vidrush_orchestrator",
          intent_tag: whisperResult.niche,
          status: "completed",
          strategy_json: {
            job_id: jobId,
            youtube_url: youtubeUrl,
            youtube_video_id: youtubeVideoId,
            faceless_title: facelessResult.title,
            clip_count: clips.length,
            buffer_scheduled: bufferScheduled,
            errors: errors.length,
            duration_sec: totalDuration,
          },
          linkedin_post: `VidRush Pipeline: ${facelessResult.title} — ${clips.length} clips, ${bufferScheduled} scheduled`,
        }),
      });
    } catch { /* non-critical */ }
  }

  const result: OrchestratorResult = {
    youtubeVideoId,
    youtubeUrl: youtubeUrl2,
    longFormLocalPath: facelessResult.localPath,
    longFormPublicUrl: facelessResult.videoUrl,
    clipCount: clips.length,
    clips,
    bufferScheduled,
    platformResults,
    errors,
    duration: totalDuration,
  };

  // Save run report
  writeFileSync(
    `${ORCHESTRATOR_DIR}/${jobId}/report.json`,
    JSON.stringify(result, null, 2)
  );

  console.log(`\n🔥 [Orchestrator] PIPELINE COMPLETE — ${jobId}`);
  console.log(`   Duration: ${totalDuration.toFixed(0)}s`);
  console.log(`   YouTube: ${youtubeUrl2 || "not uploaded"}`);
  console.log(`   Clips: ${clips.length}`);
  console.log(`   Buffer: ${bufferScheduled} scheduled`);
  console.log(`   Errors: ${errors.length}`);

  // Cleanup temp files — pipeline is done, everything is uploaded
  cleanupPipelineJob(jobId);

  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXPORT: formatPipelineReport()
// Human-readable summary for Telegram response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function formatPipelineReport(result: OrchestratorResult): string {
  const ytLine = result.youtubeUrl
    ? `🎬 YouTube: ${result.youtubeUrl}`
    : "⚠️ YouTube: Not uploaded (check tokens)";

  const errBlock = result.errors.length > 0
    ? `\n⚠️ Issues:\n${result.errors.map(e => `  • ${e}`).join("\n")}`
    : "";

  return `🔥 *VID RUSH PIPELINE — COMPLETE*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${ytLine}\n` +
    `✂️ Clips generated: ${result.clipCount}\n` +
    `📅 Buffer scheduled: ${result.bufferScheduled} posts\n` +
    `⏱️ Total time: ${result.duration.toFixed(0)}s\n` +
    `${errBlock}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Sovereign Synthesis — The Firmware Update continues._`;
}
