// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Facebook Auto-Reply
// Session 126 (2026-04-30) — community engagement on Facebook Page comments
// for both brand pages. Mirrors the IG replier (also Graph API).
//
// FLOW (per brand, per run):
//   1. Resolve Page Access Token via /PAGE_ID?fields=access_token (S115b
//      pattern from facebook-publisher.ts).
//   2. Fetch the Page's recent N posts via /PAGE_ID/posts.
//   3. For each post, fetch comments via /POST_ID/comments.
//   4. Skip if (brand, comment_id) is in facebook_replies_seen.
//   5. Generate plain-Ace voice reply via Gemini Flash Lite.
//   6. POST the reply to /COMMENT_ID/comments.
//   7. PATCH facebook_replies_seen with reply_id, reply_text, replied_at,
//      or reply_error.
//
// ENV REQUIRED (per brand, mirrors facebook-publisher.ts conventions):
//   sovereign_synthesis: FACEBOOK_PAGE_ACCESS_TOKEN + FACEBOOK_PAGE_ID
//   containment_field:   FACEBOOK_CF_PAGE_ACCESS_TOKEN + FACEBOOK_CF_PAGE_ID
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { generateShortText } from "../llm/gemini-flash";

type Brand = "sovereign_synthesis" | "containment_field";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const FB_API = "https://graph.facebook.com/v25.0";

const MAX_POSTS_PER_RUN = 8;
const MAX_REPLIES_PER_RUN = 8;
const COMMENT_LOOKBACK_HOURS = 36;
const FIRST_RUN_SEED = true;

const firstRunPerBrand: Partial<Record<Brand, boolean>> = {
  sovereign_synthesis: true,
  containment_field: true,
};

const inMemorySeen: Partial<Record<Brand, Set<string>>> = {
  sovereign_synthesis: new Set(),
  containment_field: new Set(),
};

const PLAIN_ACE_SYSTEM_PROMPT = `You are writing a Facebook comment reply on behalf of Ace, the Page owner. You are NOT the AI agent Yuki — you are Ace replying personally.

VOICE RULES (override anything else):
- Plain conversational English. No jargon, no buzzwords.
- Do NOT use the words: "sovereign", "synthesis", "containment", "frequency", "transmission", "architect", "mindset", "consciousness", "matrix", "simulation", "firmware", "protocol", "initiate", "resonance", "vibration".
- Do NOT use: "great question", "love this", "amazing", "absolutely", "100%". No sycophancy.
- Do NOT push links or URLs.
- 1 to 3 sentences MAX. Facebook tolerates slightly longer than IG, but keep it tight.
- Sound like a real person who skimmed the comment and replied in 30 seconds. Casual but warm. Direct.
- If the commenter said something specific, acknowledge that specific thing.

WHEN NOT TO REPLY (return should_reply=false):
- Spam, promotional comments, links to other accounts, marketplace pitches.
- Languages you can't reliably reply in (English-only).
- Hostile, abusive, or trolling comments.
- Pure emoji or single-word with nothing to respond to.
- Bot-looking comments.

OUTPUT FORMAT (JSON ONLY, no markdown, no fenced blocks):
{"should_reply": true, "reply": "your reply text here"}
OR
{"should_reply": false, "reason": "short reason"}

Hard cap reply length at 320 characters.`;

interface FBPageCreds {
  seedToken: string;
  pageId: string;
}

function getCredentials(brand: Brand): FBPageCreds | null {
  if (brand === "containment_field") {
    const token = process.env.FACEBOOK_CF_PAGE_ACCESS_TOKEN;
    const pageId = process.env.FACEBOOK_CF_PAGE_ID;
    if (!token || !pageId) return null;
    return { seedToken: token, pageId };
  }
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!token || !pageId) return null;
  return { seedToken: token, pageId };
}

// Page Access Token cache (mirrors facebook-publisher.ts S115b pattern).
const pageTokenCache = new Map<string, { token: string; fetchedAt: number }>();
const PAGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

async function resolvePageAccessToken(seedToken: string, pageId: string): Promise<string> {
  const cached = pageTokenCache.get(pageId);
  if (cached && Date.now() - cached.fetchedAt < PAGE_TOKEN_TTL_MS) {
    return cached.token;
  }
  try {
    const url = `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(seedToken)}`;
    const resp = await fetch(url);
    const data = (await resp.json()) as any;
    if (data && typeof data.access_token === "string" && data.access_token.length > 0) {
      pageTokenCache.set(pageId, { token: data.access_token, fetchedAt: Date.now() });
      return data.access_token;
    }
  } catch {}
  return seedToken;
}

interface FBPost {
  id: string;
  message?: string;
  created_time: string;
}

interface FBComment {
  id: string;
  message: string;
  from?: { name?: string; id?: string };
  created_time: string;
}

async function fetchRecentPosts(token: string, pageId: string): Promise<{ posts: FBPost[]; authFailure?: string }> {
  try {
    const url = `${FB_API}/${pageId}/posts?fields=id,message,created_time&limit=${MAX_POSTS_PER_RUN}&access_token=${token}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[YukiFBReplier] posts fetch ${resp.status}: ${body.slice(0, 200)}`);
      const isAuth =
        resp.status === 401 ||
        resp.status === 403 ||
        /"code"\s*:\s*(190|102|10|459|464|467)/.test(body) ||
        /OAuthException|invalid.*token|session.*expired|access token/i.test(body);
      if (isAuth) {
        return { posts: [], authFailure: `Graph API ${resp.status}: ${body.slice(0, 150)}` };
      }
      return { posts: [] };
    }
    const data = (await resp.json()) as { data?: FBPost[] };
    return { posts: data.data || [] };
  } catch (err: any) {
    console.error(`[YukiFBReplier] posts fetch threw: ${err.message}`);
    return { posts: [] };
  }
}

async function fetchComments(token: string, postId: string): Promise<FBComment[]> {
  try {
    const url = `${FB_API}/${postId}/comments?fields=id,message,from,created_time&limit=50&filter=stream&access_token=${token}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: FBComment[] };
    return data.data || [];
  } catch {
    return [];
  }
}

async function postReply(token: string, commentId: string, text: string): Promise<{ id: string } | null> {
  try {
    const url = `${FB_API}/${commentId}/comments`;
    const params = new URLSearchParams({ message: text, access_token: token });
    const resp = await fetch(`${url}?${params.toString()}`, { method: "POST" });
    if (!resp.ok) {
      console.error(`[YukiFBReplier] reply post ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    return (await resp.json()) as { id: string };
  } catch (err: any) {
    console.error(`[YukiFBReplier] reply post threw: ${err.message}`);
    return null;
  }
}

async function fetchSeenIds(brand: Brand, ids: string[]): Promise<Set<string>> {
  const memSet = inMemorySeen[brand] ?? new Set();
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return memSet;
  try {
    const inList = ids.map((i) => `"${i}"`).join(",");
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/facebook_replies_seen?select=comment_id&brand=eq.${brand}&comment_id=in.(${encodeURIComponent(inList)})`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return memSet;
    const rows = (await resp.json()) as Array<{ comment_id: string }>;
    const set = new Set(rows.map((r) => r.comment_id));
    for (const id of memSet) set.add(id);
    return set;
  } catch {
    return memSet;
  }
}

async function recordSeen(row: Record<string, unknown>): Promise<void> {
  const brand = row.brand as Brand;
  const cid = row.comment_id as string;
  if (brand && cid) (inMemorySeen[brand] ?? new Set()).add(cid);

  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/facebook_replies_seen`, {
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
    console.error(`[YukiFBReplier] recordSeen failed: ${err.message}`);
  }
}

async function patchSeenRow(brand: Brand, commentId: string, patch: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/facebook_replies_seen?brand=eq.${brand}&comment_id=eq.${encodeURIComponent(commentId)}`,
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

interface ReplyDecision {
  shouldReply: boolean;
  reply?: string;
  reason?: string;
}

async function decideReply(comment: FBComment, postMessage: string): Promise<ReplyDecision> {
  const userMessage = `Post: ${postMessage.slice(0, 400)}\nCommenter: ${comment.from?.name || "(unknown)"}\nComment: ${comment.message.slice(0, 800)}\n\nReturn JSON only.`;

  const { text, error } = await generateShortText(PLAIN_ACE_SYSTEM_PROMPT, userMessage, {
    maxOutputTokens: 320,
    temperature: 0.75,
  });

  if (error || !text) return { shouldReply: false, reason: error || "empty LLM" };

  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.should_reply === true && typeof parsed.reply === "string" && parsed.reply.length > 0) {
      let reply = parsed.reply.trim();
      if (reply.length > 320) reply = reply.slice(0, 317) + "...";
      const banned = /sovereign|synthesis|containment|frequency|firmware|protocol|matrix|simulation/i;
      if (banned.test(reply)) return { shouldReply: false, reason: "banned lexicon leaked" };
      return { shouldReply: true, reply };
    }
    return { shouldReply: false, reason: parsed.reason || "LLM voted no" };
  } catch {
    return { shouldReply: false, reason: "JSON parse failed" };
  }
}

export async function runFacebookReplyPoll(brand: Brand): Promise<{ scanned: number; replied: number; skipped: number; errors: number; authFailure?: string }> {
  const stats: { scanned: number; replied: number; skipped: number; errors: number; authFailure?: string } = {
    scanned: 0, replied: 0, skipped: 0, errors: 0,
  };

  const creds = getCredentials(brand);
  if (!creds) {
    console.log(`[YukiFBReplier] ${brand}: no FACEBOOK${brand === "containment_field" ? "_CF" : ""}_PAGE_ACCESS_TOKEN configured, skipping`);
    return stats;
  }

  const pageToken = await resolvePageAccessToken(creds.seedToken, creds.pageId);

  const postsResult = await fetchRecentPosts(pageToken, creds.pageId);
  if (postsResult.authFailure) {
    stats.authFailure = postsResult.authFailure;
    return stats;
  }
  const posts = postsResult.posts;
  if (posts.length === 0) {
    console.log(`[YukiFBReplier] ${brand}: no recent posts`);
    return stats;
  }

  const allComments: Array<{ comment: FBComment; postMessage: string }> = [];
  for (const p of posts) {
    const comments = await fetchComments(pageToken, p.id);
    for (const c of comments) allComments.push({ comment: c, postMessage: p.message || "" });
  }

  if (allComments.length === 0) {
    console.log(`[YukiFBReplier] ${brand}: no comments across ${posts.length} posts`);
    return stats;
  }

  if (FIRST_RUN_SEED && firstRunPerBrand[brand]) {
    firstRunPerBrand[brand] = false;
    console.log(`[YukiFBReplier] ${brand}: first-run seed of ${allComments.length} historical comments`);
    for (const { comment } of allComments) {
      await recordSeen({
        brand,
        comment_id: comment.id,
        commenter_name: comment.from?.name || null,
        commenter_id: comment.from?.id || null,
        comment_text: comment.message.slice(0, 500),
        comment_timestamp: comment.created_time,
        seeded: true,
      });
    }
    return stats;
  }

  const cutoff = Date.now() - COMMENT_LOOKBACK_HOURS * 60 * 60 * 1000;
  const fresh = allComments.filter(({ comment }) => {
    const ts = new Date(comment.created_time).getTime();
    return !Number.isNaN(ts) && ts >= cutoff;
  });

  if (fresh.length === 0) return stats;

  const ids = fresh.map(({ comment }) => comment.id);
  const seen = await fetchSeenIds(brand, ids);

  for (const { comment, postMessage } of fresh) {
    if (stats.replied >= MAX_REPLIES_PER_RUN) break;
    if (seen.has(comment.id)) continue;
    stats.scanned++;

    await recordSeen({
      brand,
      comment_id: comment.id,
      commenter_name: comment.from?.name || null,
      commenter_id: comment.from?.id || null,
      comment_text: comment.message.slice(0, 500),
      comment_timestamp: comment.created_time,
    });

    const decision = await decideReply(comment, postMessage);
    if (!decision.shouldReply) {
      stats.skipped++;
      await patchSeenRow(brand, comment.id, {
        skipped_reason: decision.reason || "LLM voted no",
        decided_at: new Date().toISOString(),
      });
      continue;
    }

    const posted = await postReply(pageToken, comment.id, decision.reply!);
    if (posted) {
      stats.replied++;
      console.log(`[YukiFBReplier] ${brand}: replied to ${comment.from?.name || "(anon)"} on comment ${comment.id.slice(-10)}`);
      await patchSeenRow(brand, comment.id, {
        reply_id: posted.id,
        reply_text: decision.reply,
        replied_at: new Date().toISOString(),
      });
    } else {
      stats.errors++;
      await patchSeenRow(brand, comment.id, {
        reply_error: "post_failed",
        reply_text: decision.reply,
        decided_at: new Date().toISOString(),
      });
    }
  }

  console.log(`[YukiFBReplier] ${brand}: scanned=${stats.scanned} replied=${stats.replied} skipped=${stats.skipped} errors=${stats.errors}`);
  return stats;
}
