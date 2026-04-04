// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW — Bulletproof yt-dlp Download Utility
// Multi-strategy retry: rotates player clients to bypass
// YouTube bot detection on datacenter IPs (Railway, etc.)
// Single source of truth — used by whisper-extract, vid-rush, clip-generator
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync } from "fs";

/** Strategies to try, in order. Each rotates the YouTube player client. */
const STRATEGIES = [
  { name: "android_vr",      args: '--extractor-args "youtube:player_client=android_vr"' },
  { name: "web_creator",     args: '--extractor-args "youtube:player_client=web_creator"' },
  { name: "android_creator", args: '--extractor-args "youtube:player_client=android_creator"' },
  { name: "mweb",            args: '--extractor-args "youtube:player_client=mweb"' },
  { name: "ios",             args: '--extractor-args "youtube:player_client=ios"' },
  { name: "default",         args: "" },
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface YtdlpDownloadOpts {
  youtubeUrl: string;
  outputPath: string;
  /** Label for logs, e.g. "WhisperExtract", "VidRush", "ClipGen" */
  label?: string;
  /** Timeout in ms (default 300000 = 5 min) */
  timeout?: number;
}

/**
 * Downloads a YouTube video via yt-dlp with automatic retry across
 * multiple player client strategies. Throws only if ALL strategies fail.
 */
export function ytdlpDownload(opts: YtdlpDownloadOpts): void {
  const { youtubeUrl, outputPath, label = "yt-dlp", timeout = 300_000 } = opts;

  // Already downloaded — skip
  if (existsSync(outputPath)) {
    console.log(`📦 [${label}] Source already exists, skipping download.`);
    return;
  }

  const baseCmd =
    `yt-dlp --js-runtimes node ` +
    `--user-agent "${USER_AGENT}" ` +
    `--no-check-certificates ` +
    `--extractor-retries 3 ` +
    `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" ` +
    `--merge-output-format mp4`;

  const errors: string[] = [];

  for (const strategy of STRATEGIES) {
    try {
      const cmd = `${baseCmd} ${strategy.args} -o "${outputPath}" "${youtubeUrl}"`;
      console.log(`📥 [${label}] Trying strategy: ${strategy.name}...`);
      execSync(cmd, { timeout, stdio: "pipe" });

      // Verify file actually landed
      if (existsSync(outputPath)) {
        console.log(`✅ [${label}] Download succeeded with strategy: ${strategy.name}`);
        return;
      }
      errors.push(`${strategy.name}: command exited 0 but file not found`);
    } catch (err: any) {
      const msg = err.stderr?.toString().slice(0, 300) || err.message?.slice(0, 300) || "unknown error";
      console.warn(`⚠️ [${label}] Strategy ${strategy.name} failed: ${msg}`);
      errors.push(`${strategy.name}: ${msg}`);
    }
  }

  throw new Error(
    `All yt-dlp strategies failed for ${youtubeUrl}:\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`
  );
}
