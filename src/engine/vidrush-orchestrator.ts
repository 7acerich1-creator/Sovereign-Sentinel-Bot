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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmSync } from "fs";
import { extractWhisperIntel, type WhisperResult } from "./whisper-extract";
import { produceFacelessVideo } from "./faceless-factory";
import { YouTubeLongFormPublishTool } from "../tools/video-publisher";
import type { LLMProvider } from "../types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = "public-assets";
const ORCHESTRATOR_DIR = "/tmp/vidrush_orchestrator";

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
// STEP 4: CHOP LONG-FORM INTO CLIPS
// Evenly divides the long-form video into ~30 clips (20-30s each)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function chopLongFormIntoClips(
  videoPath: string,
  niche: string,
  jobId: string,
  targetClipCount: number = 30,
  clipDurationSec: number = 25
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

  // Calculate actual clip count and duration
  const maxClips = Math.floor(totalDuration / clipDurationSec);
  const actualClipCount = Math.min(targetClipCount, maxClips);
  const actualDuration = totalDuration / actualClipCount;

  console.log(`🔪 [Orchestrator] Chopping ${totalDuration.toFixed(0)}s video into ${actualClipCount} clips of ~${actualDuration.toFixed(0)}s each`);

  const clipDir = `${ORCHESTRATOR_DIR}/${jobId}/clips`;
  if (!existsSync(clipDir)) mkdirSync(clipDir, { recursive: true });

  const nicheFilter = NICHE_FILTERS[niche] || NICHE_FILTERS.dark_psychology;
  const clips: ClipMeta[] = [];

  for (let i = 0; i < actualClipCount; i++) {
    const startSec = i * actualDuration;
    const endSec = Math.min(startSec + actualDuration, totalDuration);
    const clipPath = `${clipDir}/clip_${i.toString().padStart(2, "0")}.mp4`;

    try {
      // Cut + scale to 9:16 + niche color grade
      execSync(
        `ffmpeg -i "${videoPath}" ` +
          `-ss ${startSec.toFixed(2)} -to ${endSec.toFixed(2)} ` +
          `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${nicheFilter}" ` +
          `-c:v libx264 -preset fast -crf 23 ` +
          `-c:a aac -b:a 128k ` +
          `-y "${clipPath}"`,
        { timeout: 120_000, stdio: "pipe" }
      );

      clips.push({
        index: i,
        localPath: clipPath,
        publicUrl: null,
        startSec,
        endSec,
        captionText: "",
      });
    } catch (err: any) {
      console.error(`[Orchestrator] Clip ${i} failed: ${err.message?.slice(0, 200)}`);
    }
  }

  console.log(`✅ [Orchestrator] ${clips.length}/${actualClipCount} clips cut`);
  return clips;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 5: UPLOAD CLIPS TO SUPABASE STORAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function uploadClipsToStorage(clips: ClipMeta[], jobId: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const MAX_RETRIES = 3;

  for (const clip of clips) {
    let uploaded = false;

    for (let attempt = 1; attempt <= MAX_RETRIES && !uploaded; attempt++) {
      try {
        const fileBuffer = readFileSync(clip.localPath);
        const storagePath = `vidrush/${jobId}/clip_${clip.index.toString().padStart(2, "0")}.mp4`;

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
    const clipDescriptions = batch.map(c =>
      `Clip ${c.index + 1} (${c.startSec.toFixed(0)}s-${c.endSec.toFixed(0)}s): Segment from "${sourceTitle}"`
    ).join("\n");

    const prompt = `You are the social media distribution engine for ${brand === "ace_richie" ? "Sovereign Synthesis (Ace Richie)" : "The Containment Field"}.

SOURCE VIDEO TITLE: "${sourceTitle}"
NICHE: ${niche.replace(/_/g, " ")}
TRANSCRIPT EXCERPT: ${transcript.slice(0, 1500)}

Generate platform-specific captions for ${batch.length} clips. Each platform has different requirements:

- YOUTUBE_SHORT: Title + description for YouTube Shorts. Include #Shorts in title. Hook-first, max 100 chars title.
- TIKTOK: Casual, hook-driven. 2-3 lines + 5 hashtags. Pattern-interrupt energy.
- INSTAGRAM: Caption for Reels. Hook + value + CTA. 3-5 lines + 10 relevant hashtags.
- X_TWITTER: Punchy 1-2 lines. Provocative. Max 280 chars including hashtags.
- THREADS: Conversational, slightly longer. 2-3 lines. Thought-provoking angle.
- LINKEDIN: Professional tone. 2-3 sentences. Frame as insight/expertise. 3-5 hashtags.
- FACEBOOK: Engaging, shareable. 2-3 lines + CTA.

CLIPS:
${clipDescriptions}

Return ONLY valid JSON — an array of objects, one per clip, each with keys: youtube_short, tiktok, instagram, x_twitter, threads, linkedin, facebook.
All values are strings (the caption text for that platform).`;

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
// Distribute text+image posts across ALL connected Buffer channels over 7 days.
// Buffer supports every connected channel — X, Threads, LinkedIn, Facebook,
// YouTube (community posts), Instagram, TikTok, etc. NO channels are excluded.
// Strategy: Round-robin clips across channels. Each (clip, channel) pair
// gets its own unique time slot so nothing overlaps.
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

  // Use ALL channels — Buffer handles every connected platform
  // Only skip channels with paused queues
  const activeChannels = channels.filter((c: any) => !c.queuePaused);

  if (activeChannels.length === 0) {
    console.error("[Orchestrator] All Buffer channel queues are paused");
    return 0;
  }

  console.log(`📡 [Orchestrator] Scheduling across ${activeChannels.length} active Buffer channels: ${activeChannels.map((c: any) => `${c.service}/${c.name}`).join(", ")}`);

  const postTool = new SocialSchedulerPostTool();
  let scheduledCount = 0;

  // Time slots: 4 per day — 4AM, 7AM, 10AM, 1PM CT (= 09:00, 12:00, 15:00, 18:00 UTC)
  const timeSlots = ["09:00:00", "12:00:00", "15:00:00", "18:00:00"];
  const now = new Date();

  // Strategy: Round-robin clips across channels.
  // Each clip is sent to EACH channel, one at a time.
  // Each (clip, channel) gets its own time slot.
  let globalSlotIndex = 0;

  for (let clipIdx = 0; clipIdx < clips.length; clipIdx++) {
    const copy = copyMap.get(clips[clipIdx].index);
    if (!copy) continue;

    for (const channel of activeChannels) {
      const dayOffset = Math.floor(globalSlotIndex / timeSlots.length);
      const slotIdx = globalSlotIndex % timeSlots.length;

      // Cap at 7 days of content
      if (dayOffset >= 7) break;

      const schedDate = new Date(now);
      schedDate.setDate(schedDate.getDate() + dayOffset + 1);
      const isoDate = schedDate.toISOString().split("T")[0];
      const scheduledAt = `${isoDate}T${timeSlots[slotIdx]}Z`;

      // Pick platform-specific copy based on the channel's service type
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
          console.log(`  📌 Clip ${clipIdx} → ${channel.service}/${channel.name} @ ${scheduledAt}`);
        }
      } catch (err: any) {
        console.error(`[Orchestrator] Buffer schedule failed for clip ${clipIdx} → ${channel.service}: ${err.message?.slice(0, 200)}`);
      }

      globalSlotIndex++;
      await new Promise(r => setTimeout(r, 500));
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
          `🔗 Full Protocol: https://sovereign-synthesis.com\n` +
          `📡 Join the Inner Circle: https://sovereign-synthesis.com/inner-circle\n\n` +
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

  // ── STEP 4: CHOP INTO CLIPS ──
  await progress("STEP 4/8", "Chopping long-form into ~30 clips...");
  let clips: ClipMeta[];
  try {
    clips = await chopLongFormIntoClips(
      facelessResult.localPath,
      whisperResult.niche,
      jobId,
      30,
      25 // ~25s per clip
    );
    await progress("STEP 4/8", `✅ ${clips.length} clips cut from long-form video`);
  } catch (err: any) {
    throw new Error(`Clip chopping failed: ${err.message}`);
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
      await uploadClipsToStorage(clips, jobId);
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

  // ── STEP 7: DISTRIBUTE CLIPS TO VIDEO PLATFORMS ──
  let platformResults: string[] = [];
  if (dryRun) {
    await progress("STEP 7/8", `[DRY RUN] Simulating distribution for ${clips.length} clips...`);
    platformResults = clips.map((c) => `Clip ${c.index + 1}: ✅ [DRY RUN] Would distribute to TikTok, IG, YouTube Shorts`);
    await progress("STEP 7/8", `✅ [DRY RUN] Distribution simulated — ${platformResults.length}/${clips.length} would succeed`);
  } else {
    await progress("STEP 7/8", "Distributing clips to TikTok, Instagram, YouTube Shorts...");
    try {
      platformResults = await distributeClips(clips, copyMap, whisperResult.niche, brand);
      const successCount = platformResults.filter(r => r.includes("✅")).length;
      await progress("STEP 7/8", `✅ Distribution complete — ${successCount}/${platformResults.length} succeeded`);
    } catch (err: any) {
      errors.push(`Distribution failed: ${err.message}`);
      await progress("STEP 7/8", `⚠️ Distribution failed: ${err.message?.slice(0, 150)}`);
    }
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
