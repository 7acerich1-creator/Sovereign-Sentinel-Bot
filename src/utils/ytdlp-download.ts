// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW — Bulletproof yt-dlp Download Utility
// Cookie-authenticated + multi-strategy fallback
// Single source of truth — used by whisper-extract, vid-rush, clip-generator
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";

const COOKIES_PATH = "/tmp/yt-cookies.txt";

/** Strategies to try, in order. Each rotates the YouTube player client. */
const STRATEGIES = [
  { name: "with-cookies",     args: "" },  // cookies alone should be enough
  { name: "cookies+android",  args: '--extractor-args "youtube:player_client=android_vr"' },
  { name: "cookies+web_creator", args: '--extractor-args "youtube:player_client=web_creator"' },
  { name: "cookies+mweb",    args: '--extractor-args "youtube:player_client=mweb"' },
  { name: "no-cookies",      args: "" },   // last resort: try without cookies
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
 * Decode YOUTUBE_COOKIES_BASE64 env var to a file on disk.
 * Called once at first download. Returns true if cookies are available.
 */
function ensureCookiesFile(): boolean {
  if (existsSync(COOKIES_PATH)) return true;

  const b64 = process.env.YOUTUBE_COOKIES_BASE64;
  if (!b64) {
    console.warn("⚠️ [yt-dlp] No YOUTUBE_COOKIES_BASE64 env var set — YouTube will likely block downloads.");
    return false;
  }

  try {
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    mkdirSync("/tmp", { recursive: true });
    writeFileSync(COOKIES_PATH, decoded, "utf-8");
    console.log(`🍪 [yt-dlp] Cookies file written to ${COOKIES_PATH} (${decoded.length} bytes)`);
    return true;
  } catch (err: any) {
    console.error(`❌ [yt-dlp] Failed to decode cookies: ${err.message}`);
    return false;
  }
}

/**
 * Downloads a YouTube video via yt-dlp with cookie authentication
 * and automatic retry across multiple player client strategies.
 * Throws only if ALL strategies fail.
 */
export function ytdlpDownload(opts: YtdlpDownloadOpts): void {
  const { youtubeUrl, outputPath, label = "yt-dlp", timeout = 300_000 } = opts;

  // Already downloaded — skip
  if (existsSync(outputPath)) {
    console.log(`📦 [${label}] Source already exists, skipping download.`);
    return;
  }

  const hasCookies = ensureCookiesFile();
  const cookieFlag = hasCookies ? `--cookies "${COOKIES_PATH}"` : "";

  const baseCmd =
    `yt-dlp --js-runtimes node ` +
    `--user-agent "${USER_AGENT}" ` +
    `--no-check-certificates ` +
    `--extractor-retries 3 ` +
    `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" ` +
    `--merge-output-format mp4`;

  const errors: string[] = [];

  for (const strategy of STRATEGIES) {
    // Skip cookie strategies if no cookies available
    const useCookies = strategy.name !== "no-cookies";
    if (useCookies && !hasCookies) continue;

    const thisCookieFlag = useCookies ? cookieFlag : "";

    try {
      const cmd = `${baseCmd} ${thisCookieFlag} ${strategy.args} -o "${outputPath}" "${youtubeUrl}"`.replace(/\s+/g, " ").trim();
      console.log(`📥 [${label}] Strategy: ${strategy.name}...`);
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
    `All yt-dlp strategies failed for ${youtubeUrl}:\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}` +
    (!hasCookies ? "\n\n💡 FIX: Set YOUTUBE_COOKIES_BASE64 env var in Railway. Export cookies from Chrome with a browser extension, base64-encode the file, and paste it as the env var value." : "")
  );
}
