// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Instagram Browser Reply (S128, 2026-05-02)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Sister worker to yuki-instagram-replier.ts (Graph API path). That one
// requires `instagram_basic` + `instagram_manage_comments` scopes on the
// Meta token, which the "Sovereign synthesis publisher" Meta App doesn't
// have configured (see master ref §15). Until that's fixed in the Meta
// dev console, the Graph API replier silently no-ops every poll.
//
// THIS worker bypasses Meta entirely — uses the same browser+cookies
// pattern as yuki-tiktok-replier.ts. Architect imports IG cookies via
// /api/browser/import-cookies (or directly into browser_cookies_persistent
// per S128's persistence layer) and the bot scrapes comments off recent
// posts and replies via DOM. No Meta App configuration needed.
//
// FLOW (per brand, per run):
//   1. Load cookies for the brand's IG account from /app/data/browser-cookies.
//   2. Navigate to https://www.instagram.com/<handle>/.
//   3. Pull recent post permalinks from the profile grid.
//   4. For each post, open + scrape comments via DOM.
//   5. Dedupe against instagram_browser_replies_seen by synthetic id
//      (sha1(post_id + author + text), 32 hex). IG Web doesn't expose
//      stable comment IDs reliably so we hash same as TikTok does.
//   6. For each new comment: ask Gemini Flash Lite (plain-Ace voice) to
//      decide+draft reply. Type into the reply box and click Post.
//   7. PATCH instagram_browser_replies_seen with reply outcome.
//
// FAIL-CLOSED: refuses to run from datacenter IP without a residential
// YTDLP_PROXY (same anti-flag policy as TikTok). IG flags datacenter IPs
// for sketchy-bot detection just as aggressively as TT does.
//
// FAIL-OPEN otherwise: missing cookies / handle / DOM mismatches log and
// exit without throwing.
//
// ENV REQUIRED:
//   BROWSER_ENABLED=true
//   YTDLP_PROXY=<residential proxy URL>
//   INSTAGRAM_HANDLE_SS=sovereign_synthesis  (no @)
//   INSTAGRAM_HANDLE_CF=the_containment_field
//   Cookies pre-saved (S128 persistence layer or /api/browser/import-cookies).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";
import { loadCookies, saveCookies, EXEC_PATH } from "../tools/browser";
import { generateShortText } from "../llm/gemini-flash";
import type { Browser, Page } from "puppeteer-core";
import { createHash } from "crypto";

// ── Residential-proxy launch path (mirror of TT) ──
interface ParsedProxy {
  argValue: string;
  username?: string;
  password?: string;
}

function parseProxyUrl(raw: string): ParsedProxy | null {
  try {
    const url = new URL(raw);
    const proto = url.protocol.replace(":", "").toLowerCase();
    if (!["socks5", "socks4", "http", "https"].includes(proto)) return null;
    const argValue = `${proto}://${url.host}`;
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;
    return { argValue, username, password };
  } catch {
    return null;
  }
}

async function launchIGBrowser(): Promise<{ browser: Browser; usedProxy: boolean }> {
  const puppeteer = await import("puppeteer-core");
  const proxyRaw = process.env.YTDLP_PROXY || "";
  const proxy = proxyRaw ? parseProxyUrl(proxyRaw) : null;

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--single-process",
  ];
  if (proxy) {
    args.push(`--proxy-server=${proxy.argValue}`);
    console.log(`[YukiIGBrowserReplier] launching dedicated browser via proxy ${proxy.argValue}`);
  } else if (proxyRaw) {
    console.warn(`[YukiIGBrowserReplier] YTDLP_PROXY set but unparseable — falling back to direct (datacenter IP, FLAG RISK)`);
  } else {
    console.warn(`[YukiIGBrowserReplier] no YTDLP_PROXY set — direct datacenter IP (FLAG RISK on Instagram)`);
  }

  const browser = await puppeteer.default.launch({
    executablePath: EXEC_PATH,
    headless: true,
    args,
  });
  return { browser, usedProxy: !!proxy };
}

async function applyProxyAuth(page: Page): Promise<void> {
  const proxyRaw = process.env.YTDLP_PROXY || "";
  if (!proxyRaw) return;
  const proxy = parseProxyUrl(proxyRaw);
  if (proxy?.username && proxy?.password) {
    await page.authenticate({ username: proxy.username, password: proxy.password });
  }
}

type Brand = "sovereign_synthesis" | "containment_field";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const COOKIE_DOMAIN = "instagram";
const MAX_POSTS_PER_RUN = 4;       // scan a few posts per run
const MAX_REPLIES_PER_RUN = 2;     // ~6-12/day across two brands max
const FIRST_RUN_SEED = true;

const firstRunPerBrand: Partial<Record<Brand, boolean>> = {
  sovereign_synthesis: true,
  containment_field: true,
};

const inMemorySeen: Partial<Record<Brand, Set<string>>> = {
  sovereign_synthesis: new Set(),
  containment_field: new Set(),
};

const PLAIN_ACE_SYSTEM_PROMPT = `You are writing an Instagram comment reply on behalf of Ace, the account owner. You are NOT the AI agent Yuki — you are Ace replying personally to a viewer.

VOICE RULES (override anything else):
- Plain conversational English. No jargon, no buzzwords.
- Do NOT use the words: "sovereign", "synthesis", "containment", "frequency", "transmission", "architect", "mindset", "consciousness", "matrix", "simulation", "firmware", "protocol", "initiate", "resonance", "vibration".
- Do NOT use: "great question", "love this", "amazing", "absolutely", "100%". No sycophancy.
- Do NOT push links or URLs. The bio link does that.
- 1 to 2 sentences MAX. Often 1 is right. IG comments are skimmed, not read.
- Sound like a real person who skimmed the comment and replied in 30 seconds. Casual but warm. Direct.
- If the commenter said something specific, acknowledge that specific thing.

WHEN NOT TO REPLY (return should_reply=false):
- Spam, promotional, links to other accounts, follow-for-follow.
- Languages you can't reliably reply in (English-only).
- Hostile, abusive, or trolling.
- Pure emoji or single-word with nothing to respond to.
- Bot-looking comments.

OUTPUT FORMAT (JSON ONLY, no markdown, no fenced blocks):
{"should_reply": true, "reply": "your reply text here"}
OR
{"should_reply": false, "reason": "short reason"}

Hard cap reply length at 220 characters.`;

function brandToAccount(brand: Brand): string {
  return brand === "containment_field" ? "tcf" : "acerichie";
}

function brandHandle(brand: Brand): string | null {
  const h = brand === "containment_field" ? process.env.INSTAGRAM_HANDLE_CF : process.env.INSTAGRAM_HANDLE_SS;
  if (!h) return null;
  return h.replace(/^@/, "").trim();
}

function syntheticCommentId(postId: string, author: string, text: string): string {
  return createHash("sha1").update(`${postId}|${author}|${text}`).digest("hex").slice(0, 32);
}

interface ScrapedComment {
  syntheticId: string;
  postId: string;
  postUrl: string;
  author: string;
  text: string;
}

async function fetchSeenIds(brand: Brand, ids: string[]): Promise<Set<string>> {
  const memSet = inMemorySeen[brand] ?? new Set();
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return memSet;
  try {
    const inList = ids.map((i) => `"${i}"`).join(",");
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/instagram_browser_replies_seen?select=synthetic_id&brand=eq.${brand}&synthetic_id=in.(${encodeURIComponent(inList)})`,
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
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_browser_replies_seen`, {
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
    console.error(`[YukiIGBrowserReplier] recordSeen failed: ${err.message}`);
  }
}

async function patchSeenRow(brand: Brand, syntheticId: string, patch: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/instagram_browser_replies_seen?brand=eq.${brand}&synthetic_id=eq.${encodeURIComponent(syntheticId)}`,
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
    console.log(`[YukiIGBrowserReplier] ${brand}: no cookies for account=${account}`);
    return false;
  }
  await page.setCookie(...cookies);
  return true;
}

async function getRecentPostLinks(page: Page, handle: string): Promise<{ links: Array<{ postId: string; postUrl: string }>; authFailure?: string }> {
  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "networkidle2", timeout: 45_000 });
  await new Promise((r) => setTimeout(r, 4000));

  const currentUrl = page.url();
  if (/\/accounts\/login(\?|$|\/)/.test(currentUrl)) {
    return { links: [], authFailure: `redirected to login page: ${currentUrl}` };
  }

  // Detect login wall by "Log in" / "Sign up" CTA being visible without profile content
  const loggedOut = (await page.evaluate(`
    (() => {
      const ctas = Array.from(document.querySelectorAll('a, button')).find((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        return t === "log in" || t === "sign up";
      });
      const hasProfile = !!document.querySelector('header section, article a[href*="/p/"]');
      return ctas && !hasProfile;
    })()
  `)) as boolean;
  if (loggedOut) {
    return { links: [], authFailure: "IG login wall detected — cookies stale" };
  }

  const links = (await page.evaluate(`
    (() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
      const seen = new Set();
      const out = [];
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\\/(?:p|reel)\\/([\\w-]+)/);
        if (!m) continue;
        const postId = m[1];
        if (seen.has(postId)) continue;
        seen.add(postId);
        out.push({ postId, postUrl: href.startsWith("http") ? href : "https://www.instagram.com" + href });
        if (out.length >= ${MAX_POSTS_PER_RUN}) break;
      }
      return out;
    })()
  `)) as Array<{ postId: string; postUrl: string }>;

  return { links };
}

async function scrapeCommentsOnPost(page: Page, post: { postId: string; postUrl: string }): Promise<ScrapedComment[]> {
  try {
    await page.goto(post.postUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 4000));

    // Try to scroll the comment list to reveal more comments
    try {
      await page.evaluate(`(() => {
        const dialog = document.querySelector('div[role="dialog"]') || document;
        const scrollers = dialog.querySelectorAll('div[style*="overflow"], ul');
        for (const s of scrollers) { s.scrollTop = 800; }
      })()`);
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));

    // IG comment DOM — author is in a link with /<username>/ href, body is sibling span
    const raw = (await page.evaluate(`
      (() => {
        const out = [];
        // Comment list items typically live in <ul> with role=list inside the post dialog.
        // Each comment row has an anchor to /<username>/ and a span containing the text.
        const rows = Array.from(document.querySelectorAll('ul ul li, ul li[role="menuitem"], div[role="dialog"] ul > div'));
        for (const r of rows) {
          const userA = r.querySelector('a[href^="/"][href$="/"]') || r.querySelector('a[role="link"][href^="/"]');
          if (!userA) continue;
          const href = userA.getAttribute('href') || '';
          // Skip post-permalink anchors
          if (href.includes('/p/') || href.includes('/reel/')) continue;
          const author = (userA.textContent || '').trim().replace(/^@/, '');
          if (!author) continue;
          // Find the comment text — usually a span/h3 inside the same row
          const spans = Array.from(r.querySelectorAll('span, h3'));
          let text = '';
          for (const s of spans) {
            const t = (s.textContent || '').trim();
            if (t && t !== author && t.length > 1 && !/^\\d+[wdhms]$/.test(t) && !/^Reply$/i.test(t) && !/^Like$/i.test(t)) {
              text = t;
              break;
            }
          }
          if (text && text.length < 800) out.push({ author, text });
        }
        return out;
      })()
    `)) as Array<{ author: string; text: string }>;

    // Dedup within the page
    const seen = new Set<string>();
    const dedup: Array<{ author: string; text: string }> = [];
    for (const c of raw) {
      const k = `${c.author}|${c.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(c);
    }

    return dedup.map((c) => ({
      syntheticId: syntheticCommentId(post.postId, c.author, c.text),
      postId: post.postId,
      postUrl: post.postUrl,
      author: c.author,
      text: c.text,
    }));
  } catch (err: any) {
    console.error(`[YukiIGBrowserReplier] scrape on ${post.postId} failed: ${err.message}`);
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
    maxOutputTokens: 250,
    temperature: 0.75,
  });
  if (error || !text) return { shouldReply: false, reason: error || "empty LLM" };
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.should_reply === true && typeof parsed.reply === "string" && parsed.reply.length > 0) {
      let reply = parsed.reply.trim();
      if (reply.length > 220) reply = reply.slice(0, 217) + "...";
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
  try {
    // Find the matching comment row by author+text and click its Reply button
    const clicked = (await page.evaluate(
      `((author, snippet) => {
        const rows = Array.from(document.querySelectorAll('ul ul li, ul li[role="menuitem"], div[role="dialog"] ul > div'));
        for (const r of rows) {
          const t = r.textContent || '';
          if (t.includes(author) && t.includes(snippet)) {
            const replyBtn = Array.from(r.querySelectorAll('button, span')).find((b) => (b.textContent || '').trim().toLowerCase() === 'reply');
            if (replyBtn) { (replyBtn).click(); return true; }
          }
        }
        return false;
      })(${JSON.stringify(comment.author)}, ${JSON.stringify(comment.text.slice(0, 30))})`
    )) as boolean;

    if (!clicked) return false;
    await new Promise((r) => setTimeout(r, 1500));

    // Find the comment textarea (contenteditable)
    const composerSelectors = [
      'textarea[aria-label*="comment" i]',
      'textarea[aria-label*="Add a comment" i]',
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
        const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
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
    console.error(`[YukiIGBrowserReplier] postReplyDOM threw: ${err.message}`);
    return false;
  }
}

export async function runInstagramBrowserReplyPoll(brand: Brand): Promise<{ scanned: number; replied: number; skipped: number; errors: number; authFailure?: string }> {
  const stats: { scanned: number; replied: number; skipped: number; errors: number; authFailure?: string } = {
    scanned: 0, replied: 0, skipped: 0, errors: 0,
  };

  if (!config.tools.browserEnabled) {
    console.log(`[YukiIGBrowserReplier] BROWSER_ENABLED=false, skipping`);
    return stats;
  }

  const handle = brandHandle(brand);
  if (!handle) {
    console.log(`[YukiIGBrowserReplier] ${brand}: no INSTAGRAM_HANDLE${brand === "containment_field" ? "_CF" : "_SS"} set, skipping`);
    return stats;
  }

  // FAIL-CLOSED on missing residential proxy — IG flags datacenter IPs hard.
  const proxyRaw = process.env.YTDLP_PROXY || "";
  const parsedProxy = proxyRaw ? parseProxyUrl(proxyRaw) : null;
  if (!parsedProxy) {
    const reason = proxyRaw
      ? `YTDLP_PROXY set but unparseable: "${proxyRaw.slice(0, 40)}..." (expected socks5:// or http://)`
      : "YTDLP_PROXY env var not set — refusing to run IG polling from datacenter IP";
    console.warn(`[YukiIGBrowserReplier] ${brand}: HALTED — ${reason}`);
    stats.authFailure = reason;
    return stats;
  }

  let browser: Browser;
  let page: Page;
  try {
    const launched = await launchIGBrowser();
    browser = launched.browser;
    page = await browser.newPage();
    await applyProxyAuth(page);
  } catch (err: any) {
    console.log(`[YukiIGBrowserReplier] ${brand}: browser launch failed (${err.message?.slice(0, 120) || "unknown"}), skipping`);
    stats.authFailure = `Browser launch failed: ${err.message?.slice(0, 100) || "unknown"}`;
    return stats;
  }

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    );

    const cookieOK = await applyCookies(page, brand);
    if (!cookieOK) {
      stats.errors++;
      return stats;
    }

    const linksResult = await getRecentPostLinks(page, handle);
    if (linksResult.authFailure) {
      stats.authFailure = linksResult.authFailure;
      return stats;
    }
    const posts = linksResult.links;
    if (posts.length === 0) {
      console.log(`[YukiIGBrowserReplier] ${brand}: no posts found on @${handle}`);
      return stats;
    }

    const allComments: ScrapedComment[] = [];
    for (const p of posts) {
      const comments = await scrapeCommentsOnPost(page, p);
      allComments.push(...comments);
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (allComments.length === 0) {
      console.log(`[YukiIGBrowserReplier] ${brand}: no comments scraped across ${posts.length} posts`);
      return stats;
    }

    if (FIRST_RUN_SEED && firstRunPerBrand[brand]) {
      firstRunPerBrand[brand] = false;
      console.log(`[YukiIGBrowserReplier] ${brand}: first-run seed of ${allComments.length} historical comments`);
      for (const c of allComments) {
        await recordSeen({
          brand,
          synthetic_id: c.syntheticId,
          post_id: c.postId,
          post_url: c.postUrl,
          commenter_handle: c.author,
          comment_text: c.text.slice(0, 500),
          seeded: true,
        });
      }
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
        post_id: c.postId,
        post_url: c.postUrl,
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

      // Make sure we're on the post page
      if (!page.url().includes(c.postId)) {
        await page.goto(c.postUrl, { waitUntil: "networkidle2", timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 3500));
      }

      const posted = await postReplyDOM(page, c, decision.reply!);
      if (posted) {
        stats.replied++;
        console.log(`[YukiIGBrowserReplier] ${brand}: replied to @${c.author} on ${c.postId}`);
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

    saveCookies(COOKIE_DOMAIN, await page.cookies(), brandToAccount(brand));

    console.log(`[YukiIGBrowserReplier] ${brand}: scanned=${stats.scanned} replied=${stats.replied} skipped=${stats.skipped} errors=${stats.errors}`);
    return stats;
  } finally {
    try { await page.close(); } catch {}
    try { await browser.close(); } catch {}
  }
}
