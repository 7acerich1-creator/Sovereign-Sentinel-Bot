// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — VidRush Autonomous Orchestrator
// THE FULL PIPELINE: 1 URL → Everything
//
// 1. Whisper extraction (extract universal truths from source)
// 2. Faceless Factory LONG (10-15 min video in Anita's Protocol 77 voice)
// 3. YouTube long-form upload (to Ace Richie 77 channel)
// 4. Chop long-form into ~30 clips (ffmpeg, niche color grades)
// 5. Generate platform-specific copy per clip (LLM)
// 6. Distribute clips to all platforms (TikTok, IG, YouTube Shorts)
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
import { extractWhisperIntel, type WhisperResult } from "./whisper-extract";
import { produceFacelessVideo } from "./faceless-factory";
import { YouTubeLongFormPublishTool } from "../tools/video-publisher";
import type { LLMProvider } from "../types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = "public-assets";
const ORCHESTRATOR_DIR = "/tmp/vidrush_orchestrator";

// ── Cleanup: delete clips from Supabase Storage after Buffer scheduling ──
// WHY: Clips served as publicUrl burn egress bandwidth. Buffer downloads each clip
// once per channel. 9 channels × 7 clips × 4MB = 250MB egress per pipeline run.
// Free tier is 5GB/month. Without cleanup, 20 pipeline runs = over limit.
// Once Buffer has ingested the clip (createPost returned success), the storage copy
// is dead weight. Delete it to stop egress accumulation.
async function cleanupSupabaseStorage(clips: ClipMeta[]): Promise<void> {
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
  x_twitter: string;
  threads: string;
  linkedin: string;
  facebook: string;
}

interface OrchestratorResult {
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
// STEP 4: SEMANTIC CLIP EXTRACTION
// Session 24 UPGRADE: LLM-driven story moment identification.
// Instead of cutting at silence boundaries (arbitrary chunks),
// the LLM reads the Whisper transcript and identifies self-contained
// "story moments" — complete ideas that work as standalone shorts.
// Each clip gets a title + hook for downstream copy generation.
//
// Fallback chain: LLM semantic → silence boundaries → math division
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
- 2-4 words MAXIMUM, ALL CAPS. This is overlaid on a still frame at massive font size.
- Must create instant curiosity or emotional hit readable at tiny thumbnail size (120x68px).
- Style reference: "THEY KNEW", "SYSTEM OVERRIDE", "WAKE UP", "YOU WERE CHOSEN", "BREAK FREE", "THE REAL TRAP".
- NEVER repeat the title — thumbnail_text is a DIFFERENT angle on the same moment.
- Think: what single phrase would make someone STOP scrolling and tap?

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
// STEP 5: UPLOAD CLIPS TO SUPABASE STORAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function uploadClipsToStorage(clips: ClipMeta[], jobId: string, meta?: { brand?: string; niche?: string; title?: string }): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  // Build a human-readable folder name: vidrush/ace_richie_quantum_firmware_update_1775430704664/
  // so you can tell what's what when browsing Supabase Storage
  const slugParts = [
    meta?.brand || "unknown",
    meta?.niche || "general",
    (meta?.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40).replace(/_+$/, ""),
  ].filter(Boolean);
  const folderName = slugParts.join("_") + "_" + jobId.split("_").pop(); // keep timestamp for uniqueness

  const MAX_RETRIES = 3;

  for (const clip of clips) {
    let uploaded = false;

    for (let attempt = 1; attempt <= MAX_RETRIES && !uploaded; attempt++) {
      try {
        const fileBuffer = readFileSync(clip.localPath);
        const storagePath = `vidrush/${folderName}/clip_${clip.index.toString().padStart(2, "0")}.mp4`;

        const resp = await fetch(
          `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "video/mp4",
              "x-upsert": "true",
            },
            body: fileBuffer,
          }
        );

        if (resp.ok) {
          clip.publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
          console.log(`📤 [Orchestrator] Clip ${clip.index} uploaded`);
          uploaded = true;
        } else if (resp.status === 503 && attempt < MAX_RETRIES) {
          // Supabase overloaded — exponential backoff
          const backoffMs = 5000 * Math.pow(2, attempt - 1); // 5s, 10s
          console.warn(`⚠️ [Orchestrator] Clip ${clip.index} got 503 — retry ${attempt}/${MAX_RETRIES} in ${backoffMs / 1000}s`);
          await new Promise(r => setTimeout(r, backoffMs));
        } else {
          console.error(`[Orchestrator] Clip ${clip.index} upload failed: ${resp.status} (attempt ${attempt}/${MAX_RETRIES})`);
        }
      } catch (err: any) {
        console.error(`[Orchestrator] Clip ${clip.index} upload error (attempt ${attempt}/${MAX_RETRIES}): ${err.message?.slice(0, 200)}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 3000 * attempt));
        }
      }
    }

    // ── Session 39: Upload clip thumbnail alongside video ──
    if (uploaded && clip.thumbnailPath && existsSync(clip.thumbnailPath)) {
      try {
        const thumbBuf = readFileSync(clip.thumbnailPath);
        const thumbStoragePath = `vidrush/${folderName}/thumb_${clip.index.toString().padStart(2, "0")}.jpg`;
        const thumbResp = await fetch(
          `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${thumbStoragePath}`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "image/jpeg",
              "x-upsert": "true",
            },
            body: thumbBuf,
          }
        );
        if (thumbResp.ok) {
          clip.thumbnailUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${thumbStoragePath}`;
          console.log(`🖼️ [Orchestrator] Thumb ${clip.index} uploaded → ${clip.thumbnailUrl}`);
        }
      } catch (err: any) {
        console.warn(`⚠️ [Orchestrator] Thumb ${clip.index} upload failed (non-fatal): ${err.message?.slice(0, 150)}`);
      }
    }

    // Small delay between clip uploads to avoid slamming Supabase
    if (uploaded) {
      await new Promise(r => setTimeout(r, 1500));
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

  // Process in batches of 5 to avoid LLM overload
  const batchSize = 5;
  for (let batchStart = 0; batchStart < clips.length; batchStart += batchSize) {
    const batch = clips.slice(batchStart, batchStart + batchSize);
    // Session 42: Pass clip-specific semantic data (title, hook, thumbnail_text) to the LLM.
    // Previously only sent generic "Segment from {sourceTitle}" — every clip got near-identical copy
    // targeting the same audience with the same keywords. Now each clip gets unique context
    // so the LLM produces diverse titles/keywords for wide YouTube distribution.
    const clipDescriptions = batch.map(c => {
      const parts = [`Clip ${c.index + 1} (${c.startSec.toFixed(0)}s-${c.endSec.toFixed(0)}s)`];
      if (c.captionText && c.captionText !== sourceTitle) {
        parts.push(`TOPIC: "${c.captionText}"`);
      }
      // StoryMoment title/hook stored on clip during extraction (Step 4)
      if ((c as any).storyTitle) parts.push(`TITLE: "${(c as any).storyTitle}"`);
      if ((c as any).storyHook) parts.push(`HOOK: "${(c as any).storyHook}"`);
      if ((c as any).thumbnailText) parts.push(`THUMBNAIL: "${(c as any).thumbnailText}"`);
      // Fallback if no semantic data
      if (parts.length === 1) parts.push(`Segment from "${sourceTitle}"`);
      return parts.join(" | ");
    }).join("\n");

    // Session 36: Enhanced with social-optimization-prompt intelligence.
    // Platform-specific algorithm awareness + audience psychology + copy architecture.
    const brandContext = brand === "ace_richie"
      ? "Sovereign Synthesis (Ace Richie) — personal brand, liberation framework, dark psychology transmuted into sovereignty. Voice: authoritative, warm, destiny-coded. CTA: Frequency Activation style."
      : "The Containment Field — anonymous dark psychology feeder brand. Voice: clinical, cold, pattern-interrupt. Never reference Ace Richie.";

    const prompt = `You are an elite social media marketing expert AND the distribution engine for ${brandContext}

SOURCE VIDEO TITLE: "${sourceTitle}"
NICHE: ${niche.replace(/_/g, " ")}
TRANSCRIPT EXCERPT: ${transcript.slice(0, 1500)}

PLATFORM-SPECIFIC OPTIMIZATION RULES (obey these exactly):

- YOUTUBE_SHORT: Hook in first 3 words of title. Max 100 chars. Include #Shorts. YouTube pushes Shorts that get >40% watch-through — your title MUST create curiosity gap. Category: 22 (People & Blogs). Use "You" or identity-level hooks ("The chosen ones already know...").
- TIKTOK: Hook within 1.5 seconds of reading. 2-3 lines + exactly 5 hashtags. TikTok rewards saves and shares over likes — write something people SCREENSHOT or send to a friend. Pattern-interrupt opening. No corporate voice.
- INSTAGRAM: Reels caption: Hook line + value line + CTA. 3-5 lines + 8-12 hashtags (sweet spot). Instagram deprioritizes hashtag-only captions. First line IS the hook (it's what shows in feed). Suggest sharing to Feed.
- X_TWITTER: Max 280 chars. Provocative. X penalizes hashtag-heavy posts — use 0-2 max. The algorithm favors replies and quotes, so write something DEBATABLE. Short declarative sentences.
- THREADS: 2-3 lines, conversational. Threads deprioritizes hashtag-loaded posts — use 0 hashtags. Write like you're texting a smart friend. Thought-provoking.
- LINKEDIN: Professional authority tone. 2-3 sentences. Frame as contrarian expertise, not promotion. 3-5 hashtags. LinkedIn rewards dwell time — longer reads beat snappy one-liners.
- FACEBOOK: Shareable insight format. 2-3 lines + CTA. Facebook prioritizes posts that generate comments — ask a question or make a claim people want to respond to.

COPY ARCHITECTURE: Use GLITCH (pattern interrupt) → PIVOT (reframe) → BRIDGE (to their world) → ANCHOR (to Protocol 77 / Sovereign Synthesis).

KEYWORD DIVERSITY RULE (CRITICAL):
Each clip MUST target a DIFFERENT keyword cluster and audience segment. The content is universal — what changes is WHO discovers it. If Clip 1 targets "dark psychology manipulation", Clip 2 must target something completely different like "corporate escape plan" or "subconscious reprogramming". YouTube distributes each clip independently. Same keywords = same audience = wasted reach. NEVER repeat the same core keyword across clips. Think: what DIFFERENT person would search for this specific insight?

CLIPS:
${clipDescriptions}

Return ONLY valid JSON — an array of objects, one per clip, each with keys: youtube_short, tiktok, instagram, x_twitter, threads, linkedin, facebook.
All values are strings (the caption text for that platform). Each clip's youtube_short title MUST start with a UNIQUE keyword/topic angle.`;

    try {
      const response = await llm.generate(
        [{ role: "user", content: prompt }],
        { maxTokens: 4096, temperature: 0.7 }
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
        copyMap.set(batch[i].index, parsed[i]);
        batch[i].captionText = parsed[i].youtube_short || parsed[i].tiktok || "Sovereign Synthesis";
      }
    } catch (err: any) {
      console.error(`[Orchestrator] Copy generation failed for batch at ${batchStart}: ${err.message}`);
      // Fallback captions
      for (const clip of batch) {
        copyMap.set(clip.index, {
          youtube_short: `${sourceTitle} #Shorts #SovereignSynthesis`,
          tiktok: `${sourceTitle}\n\n#darkpsychology #mindset #sovereignty`,
          instagram: `${sourceTitle}\n\nThe Firmware Update continues.\n\n#sovereignty #mindset #protocol77 #awakening #darkpsychology #consciousness #escape #firmwareupdate #sovereign #growth`,
          x_twitter: `${sourceTitle} — sovereign-synthesis.com`,
          threads: `${sourceTitle}\n\nThe simulation doesn't want you to see this.`,
          linkedin: `${sourceTitle}\n\nA framework for liberation. #MindsetShift #Leadership #Sovereignty`,
          facebook: `${sourceTitle}\n\nFull protocol at sovereign-synthesis.com`,
        });
      }
    }
  }

  console.log(`✅ [Orchestrator] Platform copy generated for ${copyMap.size}/${clips.length} clips`);
  return copyMap;
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

    // 3s delay between platform posts to avoid rate limits
    await new Promise(r => setTimeout(r, 3000));
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
//   - X/Twitter, Threads, LinkedIn, Facebook: text-only works fine.
// Strategy: Clips with publicUrl → video platforms get video URL as media.
//           Clips without publicUrl → skip video platforms, text-only to text platforms.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Map Buffer service names to our platform copy keys
const SERVICE_TO_COPY_KEY: Record<string, keyof PlatformCopy> = {
  twitter: "x_twitter",
  threads: "threads",
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube_short",
  googlebusiness: "facebook",
  mastodon: "threads",
  pinterest: "instagram",
};

// Platforms that REQUIRE media (video or image) — text-only will be rejected
const MEDIA_REQUIRED_SERVICES = new Set(["tiktok", "instagram", "youtube"]);

// Platforms that accept text-only posts
const TEXT_OK_SERVICES = new Set(["twitter", "threads", "linkedin", "facebook", "mastodon", "googlebusiness", "bluesky"]);

async function scheduleBufferWeek(
  clips: ClipMeta[],
  copyMap: Map<number, PlatformCopy>,
  niche: string
): Promise<number> {
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

      const copyKey = SERVICE_TO_COPY_KEY[channel.service] || "x_twitter";
      const postText = (copy as any)[copyKey] || copy.x_twitter || copy.threads ||
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
      await new Promise(r => setTimeout(r, 500));
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
        await new Promise(r => setTimeout(r, 500));
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
// 1 URL → Whisper → Faceless LONG → YouTube → Chop → Distribute → Buffer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface PipelineOptions {
  dryRun?: boolean; // Stub all expensive API calls — validates logic without burning credits
}

export async function executeFullPipeline(
  youtubeUrl: string,
  llm: LLMProvider,
  brand: Brand = "ace_richie",
  onProgress?: (step: string, detail: string) => Promise<void>,
  options?: PipelineOptions
): Promise<OrchestratorResult> {
  const dryRun = options?.dryRun ?? false;
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

  // ── STEP 1: WHISPER EXTRACTION ──
  await progress("STEP 1/8", dryRun ? "[DRY RUN] Simulating Whisper extraction..." : "Downloading video and running Whisper transcription...");
  let whisperResult: WhisperResult;
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

  // ── STEP 2: FACELESS FACTORY — LONG MODE (ANITA'S VOICE) ──
  await progress("STEP 2/8", dryRun ? "[DRY RUN] Simulating Faceless Factory..." : "Generating 10-15 minute faceless video in Anita's Protocol 77 voice...");
  let facelessResult: Awaited<ReturnType<typeof produceFacelessVideo>>;
  if (dryRun) {
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
      const ytResult = await ytTool.execute({
        local_path: facelessResult.localPath,
        video_url: facelessResult.videoUrl || "",
        title: facelessResult.title,
        description: `${facelessResult.title}\n\n` +
          `Extracted intelligence from the simulation. The Firmware Update continues.\n\n` +
          `🔗 The Protocol: https://sovereign-synthesis.com\n\n` +
          `#SovereignSynthesis #Protocol77 #${whisperResult.niche.replace(/_/g, "")} #FirmwareUpdate #EscapeVelocity`,
        tags: `sovereign synthesis,protocol 77,${whisperResult.niche.replace(/_/g, ",")},firmware update,escape velocity,dark psychology,mindset`,
        niche: whisperResult.niche,
        brand,
      });

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
      await progress("STEP 3/8", `⚠️ YouTube upload failed (continuing): ${err.message?.slice(0, 150)}`);
    }
  } else {
    errors.push("No video URL from Faceless Factory — skipping YouTube upload");
    await progress("STEP 3/8", "⚠️ No video URL — skipping YouTube upload");
  }

  // ── STEP 4: SEMANTIC CLIP EXTRACTION ──
  let clips: ClipMeta[];
  if (dryRun) {
    await progress("STEP 4/8", "[DRY RUN] Simulating semantic clip extraction...");
    // Simulate 8 clips with semantic metadata (title + hook) matching live pipeline output
    const simClipCount = 8;
    clips = Array.from({ length: simClipCount }, (_, i) => ({
      index: i,
      startSec: i * 30,
      endSec: (i + 1) * 30,
      localPath: `${ORCHESTRATOR_DIR}/${jobId}/clip_${i.toString().padStart(2, "0")}.mp4`,
      publicUrl: null,
      captionText: `Sovereign Moment ${i + 1}|The architecture of liberation reveals itself in segment ${i + 1}`,
    }));
    await progress("STEP 4/8", `✅ [DRY RUN] ${clips.length} clips simulated (semantic)`);
  } else {
    await progress("STEP 4/8", "Extracting story moments from long-form video...");
    try {
      // Dynamic clip params based on source video duration:
      // - External YT rips (20-60min): 30 clips, 25s each (original defaults)
      // - Faceless factory output (3-8min): fewer, shorter clips
      //   e.g. 5min video → ~6-8 clips of 30-45s each (complete standalone moments)
      const srcDuration = facelessResult.duration || 300;
      const dynamicClipCount = srcDuration > 600
        ? 30                                          // long external rips
        : Math.max(4, Math.min(12, Math.round(srcDuration / 45))); // faceless: ~1 clip per 45s
      const dynamicClipDuration = srcDuration > 600
        ? 25                                          // long external rips
        : Math.max(20, Math.min(55, Math.round(srcDuration / dynamicClipCount))); // sized to source
      console.log(`📐 [Orchestrator] Dynamic clip params: ${dynamicClipCount} clips × ~${dynamicClipDuration}s (source: ${srcDuration.toFixed(0)}s)`);

      clips = await chopLongFormIntoClips(
        facelessResult.localPath,
        whisperResult.niche,
        jobId,
        llm,
        whisperResult.segments,
        dynamicClipCount,
        dynamicClipDuration
      );
      await progress("STEP 4/8", `✅ ${clips.length} clips extracted (${clips[0]?.captionText ? "semantic" : "silence-boundary"})`);
    } catch (err: any) {
      throw new Error(`Clip chopping failed: ${err.message}`);
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
        x_twitter: `DRY RUN — The Firmware Update continues. sovereign-synthesis.com`,
        threads: `DRY RUN — The architecture of liberation, piece by piece.`,
        linkedin: `DRY RUN — A framework for sovereign execution. #MindsetShift`,
        facebook: `DRY RUN — Full protocol at sovereign-synthesis.com`,
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
      bufferScheduled = await scheduleBufferWeek(clips, copyMap, whisperResult.niche);
      await progress("STEP 8/8", `✅ ${bufferScheduled} posts scheduled in Buffer`);
    } catch (err: any) {
      errors.push(`Buffer scheduling failed: ${err.message}`);
      await progress("STEP 8/8", `⚠️ Buffer scheduling failed: ${err.message?.slice(0, 150)}`);
    }
  }

  const totalDuration = (Date.now() - startTime) / 1000;

  // ── EGRESS CONTROL: Delete clips from Supabase Storage ──
  // Buffer has already downloaded each clip. Keeping them burns egress on every
  // subsequent access (dashboard views, re-downloads, crawlers). Delete them now.
  // The faceless long-form video stays — it's referenced by YouTube upload and
  // only downloaded once. Clips are the egress multiplier (N clips × M channels).
  if (bufferScheduled > 0 && !dryRun) {
    try {
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
