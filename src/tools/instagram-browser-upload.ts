// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Instagram Browser Upload
// Bypasses Instagram's gated Graph API entirely.
// Uses Puppeteer with mobile viewport emulation to drive
// Instagram's web uploader (mobile-only upload flow).
// Session 11 — sovereign workaround for platform gatekeeping.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { config } from "../config";
import { getBrowser, saveCookies, loadCookies } from "./browser";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import type { Page } from "puppeteer-core";

const IG_BASE_URL = "https://www.instagram.com/";
const IG_LOGIN_URL = "https://www.instagram.com/accounts/login/";
const COOKIE_DOMAIN = "instagram";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// ── Download video from URL to local /tmp file ──
async function downloadToTmp(videoUrl: string): Promise<string> {
  const resp = await fetch(videoUrl);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} from ${videoUrl}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const tmpPath = `/tmp/ig_upload_${Date.now()}.mp4`;
  writeFileSync(tmpPath, buffer);
  return tmpPath;
}

// ── Set up mobile emulation ──
async function setupMobilePage(page: Page): Promise<void> {
  await page.setViewport({
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  await page.setUserAgent(MOBILE_UA);
}

export class InstagramBrowserUploadTool implements Tool {
  definition: ToolDefinition = {
    name: "instagram_browser_upload",
    description:
      "Upload a video/reel to Instagram using browser automation with mobile viewport emulation. " +
      "Bypasses the gated Graph API. Requires prior login session (cookies). " +
      "Use /api/browser/instagram-login for initial setup. " +
      "Provide a public video URL (from Supabase storage) and caption text.",
    parameters: {
      video_url: {
        type: "string",
        description: "Public URL of the video file (MP4, from Supabase storage)",
      },
      caption: {
        type: "string",
        description: "Reel caption. Include hooks, hashtags, CTA. Max ~2200 chars.",
      },
      niche: {
        type: "string",
        description: "Content niche for logging: dark_psychology, self_improvement, burnout, quantum",
      },
      brand: {
        type: "string",
        description: "Which brand account to use: 'sovereign_synthesis' (default) or 'containment_field'. Maps to the correct cookie set.",
      },
    },
    required: ["video_url", "caption"],
  };

  // Map brand label to cookie account identifier
  private static brandToAccount(brand: string): string {
    return brand === "containment_field" ? "tcf" : "acerichie";
  }

  async execute(args: Record<string, unknown>, _context?: any): Promise<string> {
    if (!config.tools.browserEnabled) {
      return "⬚ Browser automation disabled. Set BROWSER_ENABLED=true to enable Instagram browser uploads.";
    }

    const videoUrl = String(args.video_url);
    const caption = String(args.caption);
    const niche = args.niche ? String(args.niche) : "unknown";
    const brand = args.brand ? String(args.brand) : "sovereign_synthesis";
    const account = InstagramBrowserUploadTool.brandToAccount(brand);
    let tmpPath = "";

    try {
      // Step 1: Download video
      console.log(`[IG Upload] Downloading video from: ${videoUrl}`);
      tmpPath = await downloadToTmp(videoUrl);
      console.log(`[IG Upload] Video saved to: ${tmpPath}`);

      // Step 2: Launch browser with mobile emulation
      const browser = await getBrowser();
      const page = await browser.newPage();
      await setupMobilePage(page);

      // Restore Instagram cookies for the correct account
      const cookies = loadCookies(COOKIE_DOMAIN, account);
      if (cookies && cookies.length > 0) {
        await page.setCookie(...cookies);
        console.log(`[IG Upload] Restored ${cookies.length} session cookies for account: ${account}`);
      } else {
        await page.close();
        return (
          "❌ No Instagram session cookies found. Initial login required.\n" +
          "Hit POST /api/browser/instagram-login to start a manual login flow, " +
          "then retry this upload after cookies are saved."
        );
      }

      // Step 3: Navigate to Instagram
      console.log("[IG Upload] Navigating to Instagram...");
      await page.goto(IG_BASE_URL, { waitUntil: "networkidle2", timeout: 45_000 });
      await new Promise((r) => setTimeout(r, 3000));

      // Check login state
      const isLoginPage = page.url().includes("/accounts/login");
      if (isLoginPage) {
        const ss = await page.screenshot({ type: "png" }) as Buffer;
        writeFileSync("/tmp/ig_login_check.png", ss);
        await page.close();
        return (
          "❌ Instagram session expired or login required.\n" +
          "Screenshot saved to /tmp/ig_login_check.png\n" +
          "Hit POST /api/browser/instagram-login to re-authenticate."
        );
      }

      // Step 4: Click "New Post" / create button
      console.log("[IG Upload] Looking for create/new post button...");

      // Instagram mobile web — the "+" create button in nav
      const createSelectors = [
        'svg[aria-label="New post"]',
        '[aria-label="New post"]',
        'a[href="/create/style/"]',
        'a[href="/create/select/"]',
        '[data-testid="new-post-button"]',
        // Bottom nav create icon
        'svg[aria-label="New Post"]',
      ];

      let createClicked = false;
      for (const sel of createSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            createClicked = true;
            console.log(`[IG Upload] Clicked create button via: ${sel}`);
            break;
          }
        } catch {
          continue;
        }
      }

      if (!createClicked) {
        // Fallback: try JS click on create-like elements
        try {
          await page.evaluate(`
            (() => {
              const svgs = Array.from(document.querySelectorAll("svg"));
              const createSvg = svgs.find(s => {
                const label = s.getAttribute("aria-label");
                return label && label.toLowerCase().includes("new");
              });
              if (createSvg) {
                const parent = createSvg.closest("a, button, div[role='button']");
                if (parent) parent.click();
              }
            })()
          `);
          createClicked = true;
        } catch {}
      }

      if (!createClicked) {
        // Direct navigation to create page
        await page.goto("https://www.instagram.com/create/select/", {
          waitUntil: "networkidle2",
          timeout: 20_000,
        });
      }

      await new Promise((r) => setTimeout(r, 3000));

      // Step 5: Upload the video file
      console.log("[IG Upload] Attaching video file...");

      // Find file input
      let fileInput = await page.$('input[type="file"]');
      if (!fileInput) {
        // Wait a bit more for the dialog to appear
        await new Promise((r) => setTimeout(r, 3000));
        fileInput = await page.$('input[type="file"]');
      }

      if (!fileInput) {
        const ss = await page.screenshot({ type: "png" }) as Buffer;
        writeFileSync("/tmp/ig_no_file_input.png", ss);
        await page.close();
        return (
          "❌ Could not find file input on Instagram. UI may have changed.\n" +
          "Screenshot: /tmp/ig_no_file_input.png"
        );
      }

      await fileInput.uploadFile(tmpPath);
      console.log("[IG Upload] File attached. Waiting for processing...");

      // Step 6: Wait for processing + navigate through the flow
      await new Promise((r) => setTimeout(r, 8_000));

      // Instagram has a multi-step flow: Select → Crop → Filter → Caption
      // Click "Next" buttons to advance through steps
      const nextSelectors = [
        'button:has-text("Next")',
        '[aria-label="Next"]',
        'div[role="button"]:has-text("Next")',
      ];

      // Advance through 2-3 "Next" screens (crop, filter)
      for (let step = 0; step < 3; step++) {
        await new Promise((r) => setTimeout(r, 2000));

        let clicked = false;
        // Try button text matching via evaluate
        try {
          clicked = await page.evaluate(`
            (() => {
              const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
              const next = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === "next");
              if (next) { next.click(); return true; }
              return false;
            })()
          `) as boolean;
        } catch {}

        if (!clicked) {
          // Try aria-label
          for (const sel of nextSelectors) {
            try {
              const btn = await page.$(sel);
              if (btn) {
                await btn.click();
                clicked = true;
                break;
              }
            } catch {
              continue;
            }
          }
        }

        if (clicked) {
          console.log(`[IG Upload] Advanced through step ${step + 1}`);
        }
      }

      // Step 7: Fill caption
      await new Promise((r) => setTimeout(r, 2000));
      console.log("[IG Upload] Filling caption...");

      const captionSelectors = [
        'textarea[aria-label="Write a caption..."]',
        'textarea[aria-label*="caption"]',
        'div[aria-label*="caption"][contenteditable="true"]',
        'div[role="textbox"]',
        "textarea",
      ];

      let captionFilled = false;
      for (const sel of captionSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            await page.keyboard.type(caption.slice(0, 2200), { delay: 5 });
            captionFilled = true;
            console.log(`[IG Upload] Caption filled via: ${sel}`);
            break;
          }
        } catch {
          continue;
        }
      }

      if (!captionFilled) {
        console.warn("[IG Upload] Caption field not found — proceeding without caption");
      }

      // Step 8: Click Share/Post
      await new Promise((r) => setTimeout(r, 2000));
      console.log("[IG Upload] Clicking Share...");

      let shared = false;
      try {
        shared = await page.evaluate(`
          (() => {
            const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
            const shareBtn = buttons.find(b => {
              const text = b.textContent && b.textContent.trim().toLowerCase();
              return text === "share" || text === "post";
            });
            if (shareBtn) { shareBtn.click(); return true; }
            return false;
          })()
        `) as boolean;
      } catch {}

      // Step 9: Wait for post confirmation
      await new Promise((r) => setTimeout(r, 10_000));

      // Save cookies (account-aware)
      const updatedCookies = await page.cookies();
      saveCookies(COOKIE_DOMAIN, updatedCookies, account);

      // Screenshot for verification
      const confirmSS = await page.screenshot({ type: "png" }) as Buffer;
      const ssPath = `/tmp/ig_post_confirm_${Date.now()}.png`;
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
              source: "instagram_browser",
              intent_tag: niche,
              status: shared ? "published" : "uncertain",
              strategy_json: {
                video_url: videoUrl,
                platform: "instagram",
                method: "browser_upload",
                final_url: currentUrl,
              },
              linkedin_post: caption.slice(0, 500),
            }),
          });
        } catch {}
      }

      return (
        `${shared ? "✅" : "⚠️"} Instagram browser upload ${shared ? "completed" : "attempted"}.\n` +
        `Video: ${videoUrl}\n` +
        `Caption: ${caption.slice(0, 100)}...\n` +
        `Niche: ${niche}\n` +
        `Confirmation screenshot: ${ssPath}\n` +
        `Final URL: ${currentUrl}\n` +
        `Cookies updated: ${updatedCookies.length}\n` +
        (shared
          ? "Note: Instagram may take a moment to process and display the reel."
          : "⚠️ Share button click uncertain. Check screenshot and IG profile manually.")
      );
    } catch (err: any) {
      return `❌ Instagram browser upload failed: ${err.message}`;
    } finally {
      if (tmpPath && existsSync(tmpPath)) {
        try { unlinkSync(tmpPath); } catch {}
      }
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instagram Login Flow — One-time setup endpoint
// Called via POST /api/browser/instagram-login
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function instagramLoginFlow(): Promise<string> {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await setupMobilePage(page);

    await page.goto(IG_LOGIN_URL, { waitUntil: "networkidle2", timeout: 30_000 });

    // Screenshot for Ace
    const loginSS = await page.screenshot({ type: "png" }) as Buffer;
    writeFileSync("/tmp/ig_login_page.png", loginSS);

    // Wait up to 120 seconds for login
    let loggedIn = false;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const currentUrl = page.url();
      if (!currentUrl.includes("/accounts/login") && !currentUrl.includes("/challenge")) {
        loggedIn = true;
        break;
      }
    }

    const cookies = await page.cookies();
    saveCookies(COOKIE_DOMAIN, cookies);

    const finalSS = await page.screenshot({ type: "png" }) as Buffer;
    writeFileSync("/tmp/ig_login_final.png", finalSS);

    await page.close();

    if (loggedIn) {
      return JSON.stringify({
        status: "ok",
        message: `Instagram login successful. ${cookies.length} cookies saved.`,
        cookies_saved: cookies.length,
        screenshots: ["/tmp/ig_login_page.png", "/tmp/ig_login_final.png"],
      });
    } else {
      return JSON.stringify({
        status: "timeout",
        message: "Login window timed out after 120s. Cookies saved in current state.",
        cookies_saved: cookies.length,
        screenshots: ["/tmp/ig_login_page.png", "/tmp/ig_login_final.png"],
      });
    }
  } catch (err: any) {
    return JSON.stringify({ status: "error", message: err.message });
  }
}
