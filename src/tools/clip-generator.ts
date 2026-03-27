// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sovereign Clip Generator
// In-house clip pipeline: yt-dlp + ffmpeg + drawtext
// Zero third-party SaaS. Full sovereign ownership.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import type { Tool, ToolDefinition } from "../types";

const CLIP_DIR = "/tmp/sovereign_clips";

// Niche-specific ffmpeg color grades
const NICHE_FILTERS: Record<string, string> = {
  dark_psychology: "eq=contrast=1.3:brightness=-0.05:saturation=0.8,vignette=PI/4",
  self_improvement: "eq=contrast=1.1:brightness=0.05:saturation=1.2",
  burnout: "eq=contrast=0.9:brightness=0.02:saturation=0.7,colorchannelmixer=.3:.4:.1:0:.2:.5:.3:0:.1:.2:.7",
  quantum: "eq=contrast=1.2:saturation=1.4:gamma=0.9,hue=h=240:s=0.3",
};

export class ClipGeneratorTool implements Tool {
  definition: ToolDefinition = {
    name: "generate_clips",
    description:
      "Sovereign clip generation pipeline. Downloads a YouTube video via yt-dlp, cuts clips at specified timestamps " +
      "using ffmpeg, applies niche-specific color grades, burns captions, and writes to Supabase vid_rush_queue. " +
      "No third-party SaaS — full in-house ownership via yt-dlp + ffmpeg.",
    parameters: {
      youtube_url: {
        type: "string",
        description: "YouTube video URL to process",
      },
      timestamps: {
        type: "string",
        description: 'JSON array of {start_seconds, end_seconds} objects. Example: [{"start_seconds":30,"end_seconds":60}]',
      },
      niche: {
        type: "string",
        description: "Content niche: dark_psychology, self_improvement, burnout, or quantum",
      },
      captions: {
        type: "string",
        description: "JSON array of caption strings, one per clip. Must match timestamps length.",
      },
    },
    required: ["youtube_url", "timestamps", "niche"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const youtubeUrl = String(args.youtube_url);
    const niche = String(args.niche || "dark_psychology");

    let timestamps: Array<{ start_seconds: number; end_seconds: number }>;
    try {
      timestamps = typeof args.timestamps === "string" ? JSON.parse(args.timestamps) : (args.timestamps as any);
    } catch {
      return "❌ Invalid timestamps format. Provide JSON array of {start_seconds, end_seconds}.";
    }

    let captions: string[] = [];
    try {
      if (args.captions) {
        captions = typeof args.captions === "string" ? JSON.parse(args.captions) : (args.captions as any);
      }
    } catch {
      captions = [];
    }

    if (!existsSync(CLIP_DIR)) mkdirSync(CLIP_DIR, { recursive: true });

    const nicheFilter = NICHE_FILTERS[niche] || NICHE_FILTERS.dark_psychology;
    const results: string[] = [];

    // STEP 1 — Download source video
    const videoId = youtubeUrl.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1] || "unknown";
    const sourcePath = `${CLIP_DIR}/source_${videoId}.mp4`;

    try {
      if (!existsSync(sourcePath)) {
        console.log(`📥 [ClipGen] Downloading ${youtubeUrl}...`);
        execSync(
          `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" ` +
            `--merge-output-format mp4 ` +
            `-o "${sourcePath}" ` +
            `"${youtubeUrl}"`,
          { timeout: 300_000, stdio: "pipe" }
        );
      }
    } catch (err: any) {
      return `❌ Download failed: ${err.message?.slice(0, 300)}`;
    }

    if (!existsSync(sourcePath)) {
      return "❌ Source video not found after download.";
    }

    // STEP 2+3 — Cut clips + apply niche filter + burn captions
    const clipPaths: string[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const caption = captions[i] || "";
      const clipRaw = `${CLIP_DIR}/clip_${videoId}_${i}.mp4`;
      const clipFinal = caption
        ? `${CLIP_DIR}/clip_${videoId}_${i}_captioned.mp4`
        : clipRaw;

      try {
        // Cut + scale to 9:16 + apply niche color grade
        const scaleFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${nicheFilter}`;
        execSync(
          `ffmpeg -i "${sourcePath}" ` +
            `-ss ${ts.start_seconds} -to ${ts.end_seconds} ` +
            `-vf "${scaleFilter}" ` +
            `-c:v libx264 -preset fast -crf 23 ` +
            `-c:a aac -b:a 128k ` +
            `-y "${clipRaw}"`,
          { timeout: 120_000, stdio: "pipe" }
        );

        // Burn captions if provided
        if (caption) {
          const safeCaption = caption.replace(/'/g, "'\\''").replace(/:/g, "\\:");
          execSync(
            `ffmpeg -i "${clipRaw}" ` +
              `-vf "drawtext=text='${safeCaption}':fontsize=48:fontcolor=white:` +
              `x=(w-text_w)/2:y=h-150:box=1:boxcolor=black@0.5:boxborderw=10" ` +
              `-codec:a copy -y "${clipFinal}"`,
            { timeout: 60_000, stdio: "pipe" }
          );
        }

        clipPaths.push(clipFinal);
        results.push(
          `✅ Clip ${i + 1}: ${ts.start_seconds}s–${ts.end_seconds}s | ${caption || "no caption"}`
        );
      } catch (err: any) {
        results.push(`❌ Clip ${i + 1} failed: ${err.message?.slice(0, 200)}`);
      }
    }

    // STEP 4 — Write to Supabase vid_rush_queue
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      for (let i = 0; i < clipPaths.length; i++) {
        try {
          await fetch(`${supabaseUrl}/rest/v1/vid_rush_queue`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              title: captions[i] || `Clip ${i + 1} from ${videoId}`,
              topic: niche,
              niche,
              youtube_url: youtubeUrl,
              script: captions[i] || null,
              status: "ready",
              audio_path: clipPaths[i],
            }),
          });
        } catch {
          results.push(`⚠️ Clip ${i + 1}: Supabase write failed (clip still exists locally)`);
        }
      }
    }

    // STEP 5 — Return summary
    const successCount = clipPaths.length;
    return (
      `🎬 SOVEREIGN CLIP PIPELINE — COMPLETE\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Source: ${youtubeUrl}\n` +
      `Niche: ${niche}\n` +
      `Clips generated: ${successCount}/${timestamps.length}\n` +
      `Color grade: ${niche}\n` +
      `Format: 9:16 (1080x1920) MP4\n` +
      `Queue: vid_rush_queue updated\n\n` +
      results.join("\n")
    );
  }
}
