// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki TikTok Comment Watcher (Browser Path)
// Session 126 (2026-04-30) — community engagement on TikTok comments.
//
// TikTok's public API does NOT expose a comment-reply endpoint. Browser
// automation is the only path. This worker:
//
//   1. Loads existing TikTok cookies (saved via /api/browser/tiktok-login).
//   2. Navigates to https://www.tiktok.com/@<handle> for each brand.
//   3. Pulls the latest N video item links from the profile DOM.
//   4. For each video, opens its page and scrapes visible comments via DOM.
//   5. Dedupes against tiktok_replies_seen by comment text + author + video.
//      (TikTok's web DOM doesn't expose stable comment IDs reliably, so we
//      hash author+text+video as a synthetic id.)
//   6. For each new comment: generate plain-Ace voice reply via Gemini Flash
//      Lite. Type it in the reply input + click Post.
//   7. PATCH tiktok_replies_seen with replied_at + reply_text or reply_error.
//
// FAIL-OPEN: If the cookies aren't loaded, the page is logged out, or the
// DOM selectors miss, this worker logs and exits without throwing.
// Phase 2 will add a fallback that alerts Yuki Telegram bot on detection
// failures so Ace can manually engage.
//
// ENV REQUIRED:
//   BROWSER_ENABLED=true
//   TIKTOK_HANDLE_SS  (e.g. acerichie, no @)         — sovereign_synthesis
//   TIKTOK_HANDLE_CF  (e.g. tcf-handle, no @)        — containment_field
//   Cookies pre-saved via POST /api/browser/tiktok-login (or import-cookies).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";
import { getBrowser, loadCookies, saveCookies } from "../tools/browser";
import { generateShortText } from "../llm/gemini-flash";
import type { Page } from "puppeteer-core";
import { createHash } from "crypto";

type Brand = "sovereign_synthesis" | "containment_field";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const COOKIE_DOMAIN = "tiktok";
const MAX_VIDEOS_PER_RUN = 4;     // Last 4 videos per brand
const MAX_REPLIES_PER_RUN = 5;    // Cap to avoid TT spam-flagging
const FIRST_RUN_SEED = true;

const firstRunPerBrand: Partial<Record<Brand, boolean>> = {
  sovereign_synthesis: true,
  containment_field: true,
};

const inMemorySeen: Partial<Record<Brand, Set<string>>> = {
  sovereign_synthesis: new Set(),
  containment_field: new Set(),
};

const PLAIN_ACE_SYSTEM_PROMPT = `You are writing a TikTok comment reply on behalf of Ace, the account owner. You are NOT the AI agent Yuki — you are Ace replying personally to a viewer.

VOICE RULES (override anything else):
- Plain conversational English. No jargon, no buzzwords.
- Do NOT use the words: "sovereign", "synthesis", "containment", "frequency", "transmission", "architect", "mindset", "consciousness", "matrix", "simulation", "firmware", "protocol", "initiate", "resonance", "vibration".
- Do NOT use: "great question", "love this", "amazing", "absolutely", "100%". No sycophancy.
- Do NOT push links or URLs. The bio link does that.
- 1 sentence MAX (TikTok comments are skimmed in <2 seconds, brevity wins).
- Sound like a real person who skimmed the comment and replied in 30 seconds. Casual but warm. Direct.
- If the commenter said something specific, acknowledge that specific thing.

WHEN NOT TO REPLY (return should_reply=false):
- Spam, promotional, links, "follow me back".
- Languages you can't reliably reply in (English-only).
- Hostile, abusive, or trolling.
- Pure emoji or single-word with nothing to respond to.
- Bot-looking comments.

OUTPUT FORMAT (JSON ONLY, no markdown, no fenced blocks):
{"should_reply": true, "reply": "your reply text here"}
OR
{"should_reply": false, "reason": "short reason"}

Hard cap reply length at 140 characters.`;

function brandToAccount(brand: Brand): string {
  return brand === "containment_field" ? "tcf" : "acerichie";
}

function brandHandle(brand: Brand): string | null {
  const h = brand === "containment_field" ? process.env.TIKTOK_HANDLE_CF : process.env.TIKTOK_HANDLE_SS;
  if (!h) return null;
  return h.replace(/^@/, "").trim();
}

function syntheticCommentId(videoId: string, author: string, text: string): string {
  return createHash("sha1").update(`${videoId}|${author}|${text}`).digest("hex").slice(0, 32);
}

interface ScrapedComment {
  syntheticId: string;
  videoId: string;
  videoUrl: string;
  author: string;
  text: string;
}

async function fetchSeenIds(brand: Brand, ids: string[]): Promise<Set<string>> {
  const memSet = inMemorySeen[brand] ?? new Set();
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return memSet;
  try {
    const inList = ids.map((i) => `"${i}"`).join(",");
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tiktok_replies_seen?select=synthetic_id&brand=eq.${brand}&synthetic_id=in.(${encodeURIComponent(inList)})`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return memSet;
    const rows = (await resp.json()) as Array<{ synthetic_id: string }>;
    const set = new Set(rows.map((r) => r.synthetic_id));
    for (const id of memSet) set.add(id);
    return set;
  } catch {
    return memSet;
  }
}

async function recordSeen(row: Record<string, unknown>): Promise<void> {
  const brand = row.brand as Brand;
  const sid = row.synthetic_id as string;
  if (brand && sid) (inMemorySeen[brand] ?? new Set()).add(sid);
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/tiktok_replies_seen`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch (err: any) {
    console.error(`[YukiTTReplier] recordSeen failed: ${err.message}`);
  }
}

async function patchSeenRow(brand: Brand, syntheticId: string, patch: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/tiktok_replies_seen?brand=eq.${brand}&synthetic_id=eq.${encodeURIComponent(syntheticId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(patch),
      }
    );
  } catch {}
}

async function applyCookies(page: Page, brand: Brand): Promise<boolean> {
  const account = brandToAccount(brand);
  const cookies = loadCookies(COOKIE_DOMAIN, account);
  if (!cookies || cookies.length === 0) {
    console.log(`[YukiTTReplier] ${brand}: no cookies for account=${account}`);
    return false;
  }
  await page.setCookie(...cookies);
  return true;
}

async function getRecentVideoLinks(page: Page, handle: string): Promise<Array<{ videoId: string; videoUrl: string }>> {
  await page.goto(`https://www.tiktok.com/@${handle}`, { waitUntil: "networkidle2", timeout: 45_000 });
  await new Promise((r) => setTimeout(r, 4000));

  const links = (await page.evaluate(`
    (() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
      const seen = new Set();
      const out = [];
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\\/video\\/(\\d+)/);
        if (!m) continue;
        const videoId = m[1];
        if (seen.has(videoId)) continue;
        seen.add(videoId);
        out.push({ videoId, videoUrl: href.startsWith("http") ? href : "https://www.tiktok.com" + href });
        if (out.length >= ${MAX_VIDEOS_PER_RUN}) break;
      }
      return out;
    })()
  `)) as Array<{ videoId: string; videoUrl: string }>;

  return links;
}

async function scrapeCommentsOnVideo(page: Page, video: { videoId: string; videoUrl: string }): Promise<ScrapedComment[]> {
  try {
    await page.goto(video.videoUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 5000));

    // Scroll the comment panel a bit to load comments
    try {
      await page.evaluate(`(() => {
        const panel = document.querySelector('[data-e2e="comment-list"], .css-13wx63w-DivCommentListContainer, [class*="DivCommentListContainer"]');
        if (panel) panel.scrollTop = 400;
      })()`);
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));

    const raw = (await page.evaluate(`
      (() => {
        // TikTok web DOM is class-mangled; we look for stable data-e2e attributes.
        const items = Array.from(document.querySelectorAll('[data-e2e="comment-level-1"], [data-e2e^="comment-username"]'));
        const out = [];
        // Strategy: walk all comment-level-1 nodes; inside each, find author + text.
        const wrappers = Array.from(document.querySelectorAll('[data-e2e="comment-level-1"]'));
        for (const w of wrappers) {
          const userEl = w.querySelector('[data-e2e="comment-username-1"], a[href^="/@"]');
          const textEl = w.querySelector('[data-e2e="comment-level-1"] p, [data-e2e^="comment-text"], span');
          const author = userEl ? (userEl.textContent || "").trim().replace(/^@/, "") : "";
          const text = textEl ? (textEl.textContent || "").trim() : "";
          if (author && text && text.length > 1 && text.length < 800) out.push({ author, text });
        }
        return out;
      })()
    `)) as Array<{ author: string; text: string }>;

    return raw.map((c) => ({
      syntheticId: syntheticCommentId(video.videoId, c.author, c.text),
      videoId: video.videoId,
      videoUrl: video.videoUrl,
      author: c.author,
      text: c.text,
    }));
  } catch (err: any) {
    console.error(`[YukiTTReplier] scrape on ${video.videoId} failed: ${err.message}`);
    return [];
  }
}

interface ReplyDecision {
  shouldReply: boolean;
  reply?: string;
  reason?: string;
}

async function decideReply(comment: ScrapedComment): Promise<ReplyDecision> {
  const userMessage = `Commenter: @${comment.author}\nComment: ${comment.text.slice(0, 600)}\n\nReturn JSON only.`;

  const { text, error } = await generateShortText(PLAIN_ACE_SYSTEM_PROMPT, userMessage, {
    maxOutputTokens: 200,
    temperature: 0.75,
  });

  if (error || !text) return { shouldReply: false, reason: error || "empty LLM" };

  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.should_reply === true && typeof parsed.reply === "string" && parsed.reply.length > 0) {
      let reply = parsed.reply.trim();
      if (reply.length > 140) reply = reply.slice(0, 137) + "...";
      const banned = /sovereign|synthesis|containment|frequency|firmware|protocol|matrix|simulation/i;
      if (banned.test(reply)) return { shouldReply: false, reason: "banned lexicon leaked" };
      return { shouldReply: true, reply };
    }
    return { shouldReply: false, reason: parsed.reason || "LLM voted no" };
  } catch {
    return { shouldReply: false, reason: "JSON parse failed" };
  }
}

async function postReplyDOM(page: Page, comment: ScrapedComment, replyText: string): Promise<boolean> {
  // TikTok web reply flow: hover over the comment's "Reply" button, click,
  // then a contenteditable div appears at the bottom with the reply context
  // already prefixed with @author. Type the reply text and click Post.
  try {
    // Find the matching comment wrapper by author + text and click its Reply button
    const clicked = (await page.evaluate(
      `((author, text) => {
        const wrappers = Array.from(document.querySelectorAll('[data-e2e="comment-level-1"]'));
        for (const w of wrappers) {
          const t = (w.textContent || "");
          if (t.includes(author) && t.includes(text.slice(0, 40))) {
            const replyBtns = w.querySelectorAll('[data-e2e="comment-reply"], button, span');
            for (const b of replyBtns) {
              const label = (b.textContent || "").trim().toLowerCase();
              if (label === "reply" || label === "respond") {
                (b).click();
                return true;
              }
            }
          }
        }
        return false;
      })(${JSON.stringify(comment.author)}, ${JSON.stringify(comment.text)})`
    )) as boolean;

    if (!clicked) return false;
    await new Promise((r) => setTimeout(r, 1500));

    // The composer: contenteditable div near the bottom
    const composerSelectors = [
      'div[contenteditable="true"][data-e2e="comment-input"]',
      'div[contenteditable="true"]',
      'div[role="textbox"]',
    ];

    let typed = false;
    for (const sel of composerSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.keyboard.type(replyText, { delay: 8 });
        typed = true;
        break;
      }
    }
    if (!typed) return false;

    await new Promise((r) => setTimeout(r, 1000));

    // Click Post button
    const posted = (await page.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('[data-e2e="comment-post"], button, div[role="button"]'));
        const post = btns.find((b) => {
          const t = (b.textContent || "").trim().toLowerCase();
          return t === "post" || t === "send" || t === "reply";
        });
        if (post && !post.disabled) { (post).click(); return true; }
        return false;
      })()
    `)) as boolean;

    await new Promise((r) => setTimeout(r, 3500));
    return posted;
  } catch (err: any) {
    console.error(`[YukiTTReplier] postReplyDOM threw: ${err.message}`);
    return false;
  }
}

export async function runTikTokReplyPoll(brand: Brand): Promise<{ scanned: number; replied: number; skipped: number; errors: number }> {
  const stats = { scanned: 0, replied: 0, skipped: 0, errors: 0 };

  if (!config.tools.browserEnabled) {
    console.log(`[YukiTTReplier] BROWSER_ENABLED=false, skipping`);
    return stats;
  }

  const handle = brandHandle(brand);
  if (!handle) {
    console.log(`[YukiTTReplier] ${brand}: no TIKTOK_HANDLE${brand === "containment_field" ? "_CF" : "_SS"} set, skipping`);
    return stats;
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    );

    const cookieOK = await applyCookies(page, brand);
    if (!cookieOK) {
      stats.errors++;
      return stats;
    }

    const videos = await getRecentVideoLinks(page, handle);
    if (videos.length === 0) {
      console.log(`[YukiTTReplier] ${brand}: no videos found on @${handle}`);
      return stats;
    }

    const allComments: ScrapedComment[] = [];
    for (const v of videos) {
      const comments = await scrapeCommentsOnVideo(page, v);
      allComments.push(...comments);
      // Polite delay between video pages
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (allComments.length === 0) {
      console.log(`[YukiTTReplier] ${brand}: no comments scraped across ${videos.length} videos`);
      return stats;
    }

    if (FIRST_RUN_SEED && firstRunPerBrand[brand]) {
      firstRunPerBrand[brand] = false;
      console.log(`[YukiTTReplier] ${brand}: first-run seed of ${allComments.length} historical comments`);
      for (const c of allComments) {
        await recordSeen({
          brand,
          synthetic_id: c.syntheticId,
          video_id: c.videoId,
          video_url: c.videoUrl,
          commenter_handle: c.author,
          comment_text: c.text.slice(0, 500),
          seeded: true,
        });
      }
      // Save cookies on the way out (TT rotates them)
      saveCookies(COOKIE_DOMAIN, await page.cookies(), brandToAccount(brand));
      return stats;
    }

    const ids = allComments.map((c) => c.syntheticId);
    const seen = await fetchSeenIds(brand, ids);
    const fresh = allComments.filter((c) => !seen.has(c.syntheticId));

    for (const c of fresh) {
      if (stats.replied >= MAX_REPLIES_PER_RUN) break;
      stats.scanned++;

      await recordSeen({
        brand,
        synthetic_id: c.syntheticId,
        video_id: c.videoId,
        video_url: c.videoUrl,
        commenter_handle: c.author,
        comment_text: c.text.slice(0, 500),
      });

      const decision = await decideReply(c);
      if (!decision.shouldReply) {
        stats.skipped++;
        await patchSeenRow(brand, c.syntheticId, {
          skipped_reason: decision.reason || "LLM voted no",
          decided_at: new Date().toISOString(),
        });
        continue;
      }

      // Navigate to the video page (we may already be there from scrape pass)
      if (!page.url().includes(c.videoId)) {
        await page.goto(c.videoUrl, { waitUntil: "networkidle2", timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 3500));
      }

      const posted = await postReplyDOM(page, c, decision.reply!);
      if (posted) {
        stats.replied++;
        console.log(`[YukiTTReplier] ${brand}: replied to @${c.author} on ${c.videoId.slice(-10)}`);
        await patchSeenRow(brand, c.syntheticId, {
          reply_text: decision.reply,
          replied_at: new Date().toISOString(),
        });
      } else {
        stats.errors++;
        await patchSeenRow(brand, c.syntheticId, {
          reply_error: "dom_post_failed",
          reply_text: decision.reply,
          decided_at: new Date().toISOString(),
        });
      }
    }

    // Persist potentially-rotated cookies
    saveCookies(COOKIE_DOMAIN, await page.cookies(), brandToAccount(brand));

    console.log(`[YukiTTReplier] ${brand}: scanned=${stats.scanned} replied=${stats.replied} skipped=${stats.skipped} errors=${stats.errors}`);
    return stats;
  } finally {
    try { await page.close(); } catch {}
  }
}
