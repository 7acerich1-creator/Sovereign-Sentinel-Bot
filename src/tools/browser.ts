// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Browser Automation (Full Arsenal)
// Real Puppeteer-based automation: login, upload, click,
// type, evaluate, screenshot, cookie persistence.
// Session 11 upgrade — from toy to sovereign weapon.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { config } from "../config";
import type { Browser, Page, Cookie } from "puppeteer-core";

const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";
const COOKIE_DIR = "/app/data/browser-cookies";
const DEFAULT_TIMEOUT = 30_000;

// ── Singleton browser instance (reuse across calls) ──
let _browser: Browser | null = null;
let _lastActivity = 0;
const BROWSER_IDLE_MS = 5 * 60 * 1000; // Close after 5 min idle

async function getBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  if (_browser && _browser.connected) {
    _lastActivity = Date.now();
    return _browser;
  }
  _browser = await puppeteer.default.launch({
    executablePath: EXEC_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--single-process",
    ],
  });
  _lastActivity = Date.now();

  // Auto-close after idle
  const idleCheck = setInterval(() => {
    if (Date.now() - _lastActivity > BROWSER_IDLE_MS && _browser) {
      _browser.close().catch(() => {});
      _browser = null;
      clearInterval(idleCheck);
    }
  }, 60_000);

  return _browser;
}

async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

// ── Cookie persistence (filesystem-based) ──
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";

function cookiePath(domain: string): string {
  return `${COOKIE_DIR}/${domain.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
}

function saveCookies(domain: string, cookies: Cookie[]): void {
  try {
    if (!existsSync(COOKIE_DIR)) mkdirSync(COOKIE_DIR, { recursive: true });
    writeFileSync(cookiePath(domain), JSON.stringify(cookies, null, 2));
  } catch (err: any) {
    console.error(`[Browser] Cookie save failed for ${domain}: ${err.message}`);
  }
}

function loadCookies(domain: string): Cookie[] | null {
  try {
    const path = cookiePath(domain);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class BrowserTool implements Tool {
  definition: ToolDefinition = {
    name: "browser",
    description:
      "Full-featured browser automation. Actions: navigate, click, type, wait, " +
      "screenshot, extract, evaluate, login, upload_video, cookies_save, cookies_load, close. " +
      "Used for web scraping, research, social media uploads (TikTok/IG via browser when APIs are blocked), " +
      "and any task requiring a real browser. Cookies persist across sessions for login reuse.",
    parameters: {
      action: {
        type: "string",
        description:
          "Action to perform: navigate, click, type, wait, screenshot, extract, " +
          "evaluate, login, upload_video, cookies_save, cookies_load, close",
        enum: [
          "navigate", "click", "type", "wait", "screenshot", "extract",
          "evaluate", "login", "upload_video", "cookies_save", "cookies_load", "close",
        ],
      },
      url: { type: "string", description: "URL to navigate to (for navigate/login actions)" },
      selector: { type: "string", description: "CSS selector for click/type/wait/extract actions" },
      text: { type: "string", description: "Text to type (for type action) or JS code (for evaluate action)" },
      domain: { type: "string", description: "Domain key for cookie save/load (e.g. 'tiktok', 'instagram')" },
      file_path: { type: "string", description: "Local file path for upload_video file input" },
      timeout: { type: "number", description: "Timeout in ms (default 30000)" },
      mobile: { type: "boolean", description: "Emulate mobile viewport (for Instagram upload)" },
      wait_after: { type: "number", description: "Wait N ms after action completes" },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!config.tools.browserEnabled) {
      return "⬚ Browser automation disabled. Set BROWSER_ENABLED=true in Railway env.";
    }

    const action = String(args.action);
    const timeout = Number(args.timeout) || DEFAULT_TIMEOUT;

    try {
      // Close doesn't need a browser
      if (action === "close") {
        await closeBrowser();
        return "✅ Browser closed.";
      }

      // Cookie load doesn't need a page
      if (action === "cookies_load") {
        const domain = String(args.domain || "unknown");
        const cookies = loadCookies(domain);
        if (!cookies) return `⬚ No saved cookies for domain: ${domain}`;
        return `✅ Loaded ${cookies.length} cookies for ${domain}. Use navigate to apply them.`;
      }

      const browser = await getBrowser();
      const pages = await browser.pages();
      let page = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();

      // Mobile emulation if requested
      if (args.mobile) {
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        );
      }

      // If domain cookies exist and we're navigating, restore them
      if ((action === "navigate" || action === "login") && args.domain) {
        const saved = loadCookies(String(args.domain));
        if (saved && saved.length > 0) {
          await page.setCookie(...saved);
        }
      }

      let result = "";

      switch (action) {
        // ── NAVIGATE ──
        case "navigate": {
          const url = String(args.url);
          await page.goto(url, { waitUntil: "domcontentloaded", timeout });
          const title = await page.title();
          result = `✅ Navigated to: ${url}\nTitle: ${title}\nURL: ${page.url()}`;
          break;
        }

        // ── CLICK ──
        case "click": {
          const sel = String(args.selector);
          await page.waitForSelector(sel, { timeout });
          await page.click(sel);
          result = `✅ Clicked: ${sel}`;
          break;
        }

        // ── TYPE ──
        case "type": {
          const sel = String(args.selector);
          const text = String(args.text || "");
          await page.waitForSelector(sel, { timeout });
          await page.click(sel, { clickCount: 3 }); // Select all existing text
          await page.type(sel, text, { delay: 30 });
          result = `✅ Typed ${text.length} chars into: ${sel}`;
          break;
        }

        // ── WAIT ──
        case "wait": {
          if (args.selector) {
            await page.waitForSelector(String(args.selector), { timeout });
            result = `✅ Element found: ${args.selector}`;
          } else {
            const waitMs = Number(args.timeout) || 2000;
            await new Promise((r) => setTimeout(r, waitMs));
            result = `✅ Waited ${waitMs}ms`;
          }
          break;
        }

        // ── SCREENSHOT ──
        case "screenshot": {
          const buffer = await page.screenshot({ type: "png", fullPage: false }) as Buffer;
          const size = buffer.length;
          // Save to /tmp for retrieval
          const filename = `/tmp/screenshot_${Date.now()}.png`;
          writeFileSync(filename, buffer);
          result = `✅ Screenshot saved: ${filename} (${Math.round(size / 1024)}KB)\nPage: ${page.url()}`;
          break;
        }

        // ── EXTRACT ──
        case "extract": {
          const sel = String(args.selector || "body");
          await page.waitForSelector(sel, { timeout }).catch(() => {});
          const content = await page.$eval(sel, (el: any) => el.innerText || el.textContent).catch(() => "");
          result = String(content).slice(0, 8000) || "(empty)";
          break;
        }

        // ── EVALUATE ──
        case "evaluate": {
          const code = String(args.text || "document.title");
          const evalResult = await page.evaluate(code);
          result = `✅ Eval result: ${JSON.stringify(evalResult).slice(0, 5000)}`;
          break;
        }

        // ── LOGIN ──
        // Navigate to URL, restore cookies if available, take screenshot for verification
        case "login": {
          const url = String(args.url);
          const domain = String(args.domain || new URL(url).hostname);

          // Try restoring cookies first
          const saved = loadCookies(domain);
          if (saved && saved.length > 0) {
            await page.setCookie(...saved);
          }

          await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
          const title = await page.title();

          // Save current cookies
          const currentCookies = await page.cookies();
          saveCookies(domain, currentCookies);

          const screenshotBuf = await page.screenshot({ type: "png", fullPage: false }) as Buffer;
          const ssFile = `/tmp/login_${domain}_${Date.now()}.png`;
          writeFileSync(ssFile, screenshotBuf);

          result =
            `✅ Login page loaded: ${url}\n` +
            `Title: ${title}\n` +
            `Cookies saved: ${currentCookies.length} for ${domain}\n` +
            `Screenshot: ${ssFile}\n` +
            `If already logged in via cookies, you're good. Otherwise, use type/click actions to fill credentials.`;
          break;
        }

        // ── UPLOAD_VIDEO ──
        // Attach a local file to a file input on the page
        case "upload_video": {
          const filePath = String(args.file_path);
          const sel = String(args.selector || 'input[type="file"]');

          // Find file input (may be hidden)
          const fileInput = await page.$(sel);
          if (!fileInput) {
            // Try to find any file input on the page
            const anyInput = await page.$('input[type="file"]');
            if (!anyInput) {
              result = `❌ No file input found on page. Selector: ${sel}`;
              break;
            }
            await anyInput.uploadFile(filePath);
          } else {
            await fileInput.uploadFile(filePath);
          }

          result = `✅ File attached: ${filePath} via ${sel}\nWaiting for upload processing...`;
          break;
        }

        // ── COOKIES_SAVE ──
        case "cookies_save": {
          const domain = String(args.domain || "unknown");
          const cookies = await page.cookies();
          saveCookies(domain, cookies);
          result = `✅ Saved ${cookies.length} cookies for domain: ${domain}`;
          break;
        }

        default:
          result = `❌ Unknown browser action: ${action}`;
      }

      // Optional post-action wait
      if (args.wait_after) {
        await new Promise((r) => setTimeout(r, Number(args.wait_after)));
      }

      _lastActivity = Date.now();
      return result;
    } catch (err: any) {
      if (err.code === "MODULE_NOT_FOUND") {
        return "❌ puppeteer-core not installed. Run: npm install puppeteer-core";
      }
      return `❌ Browser error: ${err.message}`;
    }
  }
}

// ── Export helpers for use by TikTok/Instagram upload tools ──
export { getBrowser, closeBrowser, saveCookies, loadCookies, EXEC_PATH, COOKIE_DIR };
