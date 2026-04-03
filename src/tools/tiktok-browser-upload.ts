// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — TikTok Browser Upload
// Bypasses TikTok's gated Content Posting API entirely.
// Uses Puppeteer to drive the TikTok web uploader.
// Session 11 — sovereign workaround for platform gatekeeping.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { config } from "../config";
import { getBrowser, saveCookies, loadCookies } from "./browser";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import type { Page } from "puppeteer-core";

const TIKTOK_UPLOAD_URL = "https://www.tiktok.com/upload";
const TIKTOK_LOGIN_URL = "https://www.tiktok.com/login";
const COOKIE_DOMAIN = "tiktok";

// ── Download video from URL to local /tmp file ──
async function downloadToTmp(videoUrl: string): Promise<string> {
  const resp = await fetch(videoUrl);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} from ${videoUrl}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const tmpPath = `/tmp/tiktok_upload_${Date.now()}.mp4`;
  writeFileSync(tmpPath, buffer);
  return tmpPath;
}

// ── Check if logged in by looking for upload elements ──
async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // If we can see the upload area, we're logged in
    const hasUpload = await page.$('input[type="file"]');
    const hasLoginPrompt = await page.$('[data-e2e="login-modal"]');
    return !!hasUpload && !hasLoginPrompt;
  } catch {
    return false;
  }
}

export class TikTokBrowserUploadTool implements Tool {
  definition: ToolDefinition = {
    name: "tiktok_browser_upload",
    description:
      "Upload a video to TikTok using browser automation (bypasses API gatekeeping). " +
      "Requires prior login session (cookies). Use /api/browser/tiktok-login for initial setup. " +
      "Provide a public video URL (from Supabase storage) and caption text. " +
      "The tool downloads the video, navigates to TikTok's web uploader, attaches the file, " +
      "fills the caption, and clicks Post.",
    parameters: {
      video_url: {
        type: "string",
        description: "Public URL of the video file (MP4, from Supabase storage)",
      },
      caption: {
        type: "string",
        description: "Video caption. Include hooks, hashtags, CTA. Max ~2200 chars.",
      },
      niche: {
        type: "string",
        description: "Content niche for logging: dark_psychology, self_improvement, burnout, quantum",
      },
      brand: {
        type: "string",
        description: "Which brand account to use: 'ace_richie' (default) or 'containment_field'. Maps to the correct cookie set.",
      },
    },
    required: ["video_url", "caption"],
  };

  // Map brand label to cookie account identifier
  private static brandToAccount(brand: string): string {
    return brand === "containment_field" ? "tcf" : "acerichie";
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!config.tools.browserEnabled) {
      return "⬚ Browser automation disabled. Set BROWSER_ENABLED=true to enable TikTok browser uploads.";
    }

    const videoUrl = String(args.video_url);
    const caption = String(args.caption);
    const niche = args.niche ? String(args.niche) : "unknown";
    const brand = args.brand ? String(args.brand) : "ace_richie";
    const account = TikTokBrowserUploadTool.brandToAccount(brand);
    let tmpPath = "";

    try {
      // Step 1: Download video to /tmp
      console.log(`[TikTok Upload] Downloading video from: ${videoUrl}`);
      tmpPath = await downloadToTmp(videoUrl);
      console.log(`[TikTok Upload] Video saved to: ${tmpPath}`);

      // Step 2: Launch browser + restore cookies
      const browser = await getBrowser();
      const page = await browser.newPage();

      // Desktop viewport for TikTok web uploader
      await page.setViewport({ width: 1280, height: 900 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
      );

      // Restore TikTok cookies for the correct account
      const cookies = loadCookies(COOKIE_DOMAIN, account);
      if (cookies && cookies.length > 0) {
        await page.setCookie(...cookies);
        console.log(`[TikTok Upload] Restored ${cookies.length} session cookies for account: ${account}`);
      } else {
        await page.close();
        return (
          "❌ No TikTok session cookies found. Initial login required.\n" +
          "Hit POST /api/browser/tiktok-login to start a manual login flow, " +
          "then retry this upload after cookies are saved."
        );
      }

      // Step 3: Navigate to upload page
      console.log("[TikTok Upload] Navigating to upload page...");
      await page.goto(TIKTOK_UPLOAD_URL, { waitUntil: "networkidle2", timeout: 45_000 });

      // Check if we're actually logged in
      await new Promise((r) => setTimeout(r, 3000));
      const loggedIn = await isLoggedIn(page);
      if (!loggedIn) {
        // Save screenshot for debugging
        const ss = await page.screenshot({ type: "png" }) as Buffer;
        writeFileSync("/tmp/tiktok_login_check.png", ss);
        await page.close();
        return (
          "❌ TikTok session expired or login required.\n" +
          "Screenshot saved to /tmp/tiktok_login_check.png\n" +
          "Hit POST /api/browser/tiktok-login to re-authenticate."
        );
      }

      // Step 4: Upload the video file
      console.log("[TikTok Upload] Attaching video file...");
      const fileInput = await page.$('input[type="file"]');
      if (!fileInput) {
        await page.close();
        return "❌ Could not find file input on TikTok upload page. UI may have changed.";
      }
      await fileInput.uploadFile(tmpPath);

      // Step 5: Wait for upload processing
      console.log("[TikTok Upload] Waiting for video processing...");
      // TikTok shows a progress bar / processing indicator
      await new Promise((r) => setTimeout(r, 10_000)); // Initial wait for upload start

      // Wait for the caption/editor area to become available (indicates upload processed)
      // TikTok uses various selectors — try common ones
      const captionSelectors = [
        '[data-e2e="upload-caption"]',
        '.DraftEditor-root',
        '[contenteditable="true"]',
        '.public-DraftEditor-content',
        'div[aria-label*="caption"]',
        'div[role="textbox"]',
      ];

      let captionElement = null;
      for (const sel of captionSelectors) {
        try {
          captionElement = await page.waitForSelector(sel, { timeout: 30_000 });
          if (captionElement) break;
        } catch {
          continue;
        }
      }

      // Step 6: Fill caption
      if (captionElement) {
        console.log("[TikTok Upload] Filling caption...");
        await captionElement.click({ clickCount: 3 }); // Select all
        await page.keyboard.press("Backspace"); // Clear
        await page.keyboard.type(caption.slice(0, 2200), { delay: 10 });
      } else {
        console.warn("[TikTok Upload] Caption field not found — proceeding without caption");
      }

      // Step 7: Wait for video to finish processing before posting
      await new Promise((r) => setTimeout(r, 5_000));

      // Step 8: Click Post button
      console.log("[TikTok Upload] Clicking Post...");
      const postSelectors = [
        '[data-e2e="upload-btn"]',
        'button[type="submit"]',
        'button:has-text("Post")',
        'div[data-e2e="post-button"]',
      ];

      let posted = false;
      for (const sel of postSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            posted = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!posted) {
        // Fallback: try clicking any button with "Post" text via page JS
        try {
          posted = await page.evaluate(`
            (() => {
              const buttons = Array.from(document.querySelectorAll("button"));
              const postBtn = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === "post");
              if (postBtn) { postBtn.click(); return true; }
              return false;
            })()
          `) as boolean;
        } catch {
          // screenshot for debug
        }
      }

      // Step 9: Wait for confirmation
      await new Promise((r) => setTimeout(r, 8_000));

      // Save cookies for next session (account-aware)
      const updatedCookies = await page.cookies();
      saveCookies(COOKIE_DOMAIN, updatedCookies, account);

      // Screenshot for verification
      const confirmSS = await page.screenshot({ type: "png" }) as Buffer;
      const ssPath = `/tmp/tiktok_post_confirm_${Date.now()}.png`;
      writeFileSync(ssPath, confirmSS);

      const currentUrl = page.url();
      await page.close();

      // Log to Supabase
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseKey) {
        try {
          await fetch(`${supabaseUrl}/rest/v1/content_transmissions`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              source: "tiktok_browser",
              intent_tag: niche,
              status: posted ? "published" : "uncertain",
              strategy_json: {
                video_url: videoUrl,
                platform: "tiktok",
                method: "browser_upload",
                final_url: currentUrl,
              },
              linkedin_post: caption.slice(0, 500),
            }),
          });
        } catch {}
      }

      return (
        `${posted ? "✅" : "⚠️"} TikTok browser upload ${posted ? "completed" : "attempted"}.\n` +
        `Video: ${videoUrl}\n` +
        `Caption: ${caption.slice(0, 100)}...\n` +
        `Niche: ${niche}\n` +
        `Confirmation screenshot: ${ssPath}\n` +
        `Final URL: ${currentUrl}\n` +
        `Cookies updated: ${updatedCookies.length}\n` +
        (posted
          ? "Note: TikTok may take a few minutes to process and display the video."
          : "⚠️ Post button click uncertain. Check screenshot and TikTok profile manually.")
      );
    } catch (err: any) {
      return `❌ TikTok browser upload failed: ${err.message}`;
    } finally {
      // Cleanup temp file
      if (tmpPath && existsSync(tmpPath)) {
        try { unlinkSync(tmpPath); } catch {}
      }
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TikTok Login Flow — One-time setup endpoint
// Launches browser, navigates to login, waits for manual auth,
// then saves cookies for future automated uploads.
// Called via POST /api/browser/tiktok-login
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function tiktokLoginFlow(): Promise<string> {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );

    await page.goto(TIKTOK_LOGIN_URL, { waitUntil: "networkidle2", timeout: 30_000 });

    // Take screenshot of login page for Ace to see via Telegram
    const loginSS = await page.screenshot({ type: "png" }) as Buffer;
    writeFileSync("/tmp/tiktok_login_page.png", loginSS);

    // Wait up to 120 seconds for login completion
    // Check every 5 seconds if we're now on a logged-in page
    let loggedIn = false;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const currentUrl = page.url();
      // After login, TikTok redirects away from /login
      if (!currentUrl.includes("/login") && !currentUrl.includes("/signup")) {
        loggedIn = true;
        break;
      }

      // Also check for profile elements
      const hasAvatar = await page.$('[data-e2e="profile-icon"]').catch(() => null);
      if (hasAvatar) {
        loggedIn = true;
        break;
      }
    }

    // Save cookies regardless (login flow saves to default account)
    const cookies = await page.cookies();
    saveCookies(COOKIE_DOMAIN, cookies);

    const finalSS = await page.screenshot({ type: "png" }) as Buffer;
    writeFileSync("/tmp/tiktok_login_final.png", finalSS);

    await page.close();

    if (loggedIn) {
      return JSON.stringify({
        status: "ok",
        message: `TikTok login successful. ${cookies.length} cookies saved.`,
        cookies_saved: cookies.length,
        screenshots: ["/tmp/tiktok_login_page.png", "/tmp/tiktok_login_final.png"],
      });
    } else {
      return JSON.stringify({
        status: "timeout",
        message: "Login window timed out after 120s. Cookies saved in current state — may need retry.",
        cookies_saved: cookies.length,
        screenshots: ["/tmp/tiktok_login_page.png", "/tmp/tiktok_login_final.png"],
      });
    }
  } catch (err: any) {
    return JSON.stringify({ status: "error", message: err.message });
  }
}
