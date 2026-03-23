// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Browser Automation
// Navigate, click, type, screenshot, extract content (Puppeteer)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { config } from "../config";

// Browser automation requires puppeteer to be installed
// npm install puppeteer (optional dependency)

export class BrowserTool implements Tool {
  definition: ToolDefinition = {
    name: "browser",
    description: "Automate browser actions: navigate to URL, extract page content, take screenshot. Requires puppeteer.",
    parameters: {
      action: { type: "string", description: "Action: navigate, extract, screenshot", enum: ["navigate", "extract", "screenshot"] },
      url: { type: "string", description: "URL to navigate to" },
      selector: { type: "string", description: "CSS selector to extract or interact with" },
    },
    required: ["action", "url"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!config.tools.browserEnabled) {
      return "Browser automation is disabled. Set BROWSER_ENABLED=true and install puppeteer.";
    }

    try {
      // Dynamic import — puppeteer is optional
      const puppeteer = await import("puppeteer");
      const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
      const page = await browser.newPage();

      const action = String(args.action);
      const url = String(args.url);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

      let result = "";

      switch (action) {
        case "navigate":
          result = `Navigated to: ${url}\nTitle: ${await page.title()}`;
          break;

        case "extract": {
          const selector = String(args.selector || "body");
          const content = await page.$eval(selector, (el: any) => el.innerText || el.textContent);
          result = String(content).slice(0, 5000);
          break;
        }

        case "screenshot": {
          const buffer = await page.screenshot({ type: "png", fullPage: false });
          result = `Screenshot taken (${Buffer.from(buffer).length} bytes). Screenshot saved but cannot be displayed in text.`;
          break;
        }

        default:
          result = `Unknown browser action: ${action}`;
      }

      await browser.close();
      return result;
    } catch (err: any) {
      if (err.code === "MODULE_NOT_FOUND") {
        return "Puppeteer not installed. Run: npm install puppeteer";
      }
      return `Browser error: ${err.message}`;
    }
  }
}
