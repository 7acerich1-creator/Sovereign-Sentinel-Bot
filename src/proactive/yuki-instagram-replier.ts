// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Instagram Auto-Reply
// Session 126 (2026-04-30) — community engagement on Instagram comments
// for both brand accounts. Mirrors the YT comment replier pattern (S115).
//
// FLOW (per brand, per run):
//   1. Fetch the Business Account's most recent N media via Graph API.
//   2. For each media, fetch comments published in the last 24h.
//   3. Skip if (brand, comment_id) is already in instagram_replies_seen.
//   4. Generate plain-Ace voice reply via Gemini Flash Lite (or skip on
//      should_reply=false).
//   5. POST the reply to /comment_id/replies via Graph API.
//   6. PATCH instagram_replies_seen with reply_id, reply_text, replied_at,
//      or reply_error.
//
// ENV REQUIRED (per brand):
//   sovereign_synthesis: INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ID
//   containment_field:   INSTAGRAM_ACCESS_TOKEN_CF + INSTAGRAM_BUSINESS_ID_CF
//
// FAIL-OPEN: Missing tokens → log + skip. Never throws.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { generateShortText } from "../llm/gemini-flash";

type Brand = "sovereign_synthesis" | "containment_field";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const MAX_MEDIA_PER_RUN = 6;       // Look at last 6 posts
const MAX_REPLIES_PER_RUN = 8;     // Hard cap to avoid burst-reply spam-flag
const COMMENT_LOOKBACK_HOURS = 36; // Only reply to recent comments
const FIRST_RUN_SEED = true;       // Don't reply to historical comments on first poll

// First-run-per-brand seed flag — same pattern as YouTube watcher.
const firstRunPerBrand: Partial<Record<Brand, boolean>> = {
  sovereign_synthesis: true,
  containment_field: true,
};

// In-memory dedup fallback when Supabase is unreachable
const inMemorySeen: Partial<Record<Brand, Set<string>>> = {
  sovereign_synthesis: new Set(),
  containment_field: new Set(),
};

// Plain-Ace voice — same as YT replier and Bluesky replier.
// NO sovereign/synthesis/containment lexicon. Just Ace as a normal creator.
const PLAIN_ACE_SYSTEM_PROMPT = `You are writing an Instagram comment reply on behalf of Ace, the account owner. You are NOT the AI agent Yuki here — you are Ace replying personally to a viewer.

VOICE RULES (these override anything else):
- Plain conversational English. No jargon, no buzzwords.
- Do NOT use the words: "sovereign", "synthesis", "containment", "frequency", "transmission", "architect", "mindset", "consciousness", "matrix", "simulation", "firmware", "protocol", "initiate", "resonance", "vibration".
- Do NOT use: "great question", "love this", "amazing", "absolutely", "100%". No sycophancy.
- Do NOT push links or URLs. The bio link does that.
- 1 to 2 sentences MAX. Often 1 is right. Instagram comments are skimmed, not read.
- Sound like a real person who skimmed the comment and replied in 30 seconds. Casual but warm. Direct.
- If the commenter said something specific, acknowledge that specific thing.

WHEN NOT TO REPLY (return should_reply=false):
- Spam, promotional comments, links to other accounts.
- Languages you can't reliably reply in (English-only for now).
- Hostile, abusive, or trolling comments — engaging only feeds them.
- Pure emoji or single-word comments where there's nothing to actually respond to.
- Bot-looking comments.

OUTPUT FORMAT (JSON ONLY, no markdown, no fenced blocks):
{"should_reply": true, "reply": "your reply text here"}
OR
{"should_reply": false, "reason": "short reason"}

Hard cap reply length at 220 characters.`;

interface IGCredentials {
  token: string;
  businessId: string;
}

function getCredentials(brand: Brand): IGCredentials | null {
  if (brand === "containment_field") {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN_CF;
    const businessId = process.env.INSTAGRAM_BUSINESS_ID_CF;
    if (!token || !businessId) return null;
    return { token, businessId };
  }
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const businessId = process.env.INSTAGRAM_BUSINESS_ID;
  if (!token || !businessId) return null;
  return { token, businessId };
}

interface IGMedia {
  id: string;
  caption?: string;
  media_type: string;
  permalink?: string;
  timestamp: string;
}

interface IGComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
}

async function fetchRecentMedia(creds: IGCredentials): Promise<IGMedia[]> {
  try {
    const url = `https://graph.facebook.com/v21.0/${creds.businessId}/media?fields=id,caption,media_type,permalink,timestamp&limit=${MAX_MEDIA_PER_RUN}&access_token=${creds.token}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[YukiIGReplier] media fetch ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return [];
    }
    const data = (await resp.json()) as { data?: IGMedia[] };
    return data.data || [];
  } catch (err: any) {
    console.error(`[YukiIGReplier] media fetch threw: ${err.message}`);
    return [];
  }
}

async function fetchComments(creds: IGCredentials, mediaId: string): Promise<IGComment[]> {
  try {
    const url = `https://graph.facebook.com/v21.0/${mediaId}/comments?fields=id,text,username,timestamp&limit=50&access_token=${creds.token}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: IGComment[] };
    return data.data || [];
  } catch {
    return [];
  }
}

async function postReply(creds: IGCredentials, commentId: string, text: string): Promise<{ id: string } | null> {
  try {
    const url = `https://graph.facebook.com/v21.0/${commentId}/replies`;
    const params = new URLSearchParams({ message: text, access_token: creds.token });
    const resp = await fetch(`${url}?${params.toString()}`, { method: "POST" });
    if (!resp.ok) {
      console.error(`[YukiIGReplier] reply post ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    return (await resp.json()) as { id: string };
  } catch (err: any) {
    console.error(`[YukiIGReplier] reply post threw: ${err.message}`);
    return null;
  }
}

async function fetchSeenIds(brand: Brand, ids: string[]): Promise<Set<string>> {
  const memSet = inMemorySeen[brand] ?? new Set();
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return memSet;
  try {
    const inList = ids.map((i) => `"${i}"`).join(",");
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/instagram_replies_seen?select=comment_id&brand=eq.${brand}&comment_id=in.(${encodeURIComponent(inList)})`,
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
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_replies_seen`, {
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
    console.error(`[YukiIGReplier] recordSeen failed: ${err.message}`);
  }
}

async function patchSeenRow(brand: Brand, commentId: string, patch: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/instagram_replies_seen?brand=eq.${brand}&comment_id=eq.${encodeURIComponent(commentId)}`,
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

async function decideReply(comment: IGComment, mediaCaption: string): Promise<ReplyDecision> {
  const userMessage = `Media caption: ${mediaCaption.slice(0, 300)}\nCommenter: @${comment.username}\nComment: ${comment.text.slice(0, 800)}\n\nReturn JSON only.`;

  const { text, error } = await generateShortText(PLAIN_ACE_SYSTEM_PROMPT, userMessage, {
    maxOutputTokens: 250,
    temperature: 0.75,
  });

  if (error || !text) {
    return { shouldReply: false, reason: error || "empty LLM response" };
  }

  // Strip code fences if model returned them despite instructions
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.should_reply === true && typeof parsed.reply === "string" && parsed.reply.length > 0) {
      let reply = parsed.reply.trim();
      if (reply.length > 240) reply = reply.slice(0, 237) + "...";
      // Filter banned lexicon as belt-and-suspenders
      const banned = /sovereign|synthesis|containment|frequency|firmware|protocol|matrix|simulation/i;
      if (banned.test(reply)) {
        return { shouldReply: false, reason: "banned lexicon leaked into reply" };
      }
      return { shouldReply: true, reply };
    }
    return { shouldReply: false, reason: parsed.reason || "LLM voted no" };
  } catch {
    return { shouldReply: false, reason: "JSON parse failed" };
  }
}

export async function runInstagramReplyPoll(brand: Brand): Promise<{ scanned: number; replied: number; skipped: number; errors: number }> {
  const stats = { scanned: 0, replied: 0, skipped: 0, errors: 0 };

  const creds = getCredentials(brand);
  if (!creds) {
    console.log(`[YukiIGReplier] ${brand}: no INSTAGRAM_ACCESS_TOKEN${brand === "containment_field" ? "_CF" : ""} configured, skipping`);
    return stats;
  }

  const media = await fetchRecentMedia(creds);
  if (media.length === 0) {
    console.log(`[YukiIGReplier] ${brand}: no recent media`);
    return stats;
  }

  // Collect all comments across recent media
  const allComments: Array<{ comment: IGComment; mediaCaption: string; mediaPermalink: string }> = [];
  for (const m of media) {
    const comments = await fetchComments(creds, m.id);
    for (const c of comments) {
      allComments.push({ comment: c, mediaCaption: m.caption || "", mediaPermalink: m.permalink || "" });
    }
  }

  if (allComments.length === 0) {
    console.log(`[YukiIGReplier] ${brand}: no comments across ${media.length} media`);
    return stats;
  }

  // First-run seed: dump all comments into seen-table without replying
  if (FIRST_RUN_SEED && firstRunPerBrand[brand]) {
    firstRunPerBrand[brand] = false;
    console.log(`[YukiIGReplier] ${brand}: first-run seed of ${allComments.length} historical comments`);
    for (const { comment } of allComments) {
      await recordSeen({
        brand,
        comment_id: comment.id,
        commenter_handle: comment.username,
        comment_text: comment.text.slice(0, 500),
        comment_timestamp: comment.timestamp,
        seeded: true,
      });
    }
    return stats;
  }

  // Window comments to lookback
  const cutoff = Date.now() - COMMENT_LOOKBACK_HOURS * 60 * 60 * 1000;
  const fresh = allComments.filter(({ comment }) => {
    const ts = new Date(comment.timestamp).getTime();
    return !Number.isNaN(ts) && ts >= cutoff;
  });

  if (fresh.length === 0) return stats;

  const ids = fresh.map(({ comment }) => comment.id);
  const seen = await fetchSeenIds(brand, ids);

  for (const { comment, mediaCaption, mediaPermalink } of fresh) {
    if (stats.replied >= MAX_REPLIES_PER_RUN) break;
    if (seen.has(comment.id)) continue;
    stats.scanned++;

    // Record seen IMMEDIATELY so a crash doesn't cause double-reply on retry
    await recordSeen({
      brand,
      comment_id: comment.id,
      commenter_handle: comment.username,
      comment_text: comment.text.slice(0, 500),
      comment_timestamp: comment.timestamp,
      media_permalink: mediaPermalink,
    });

    const decision = await decideReply(comment, mediaCaption);
    if (!decision.shouldReply) {
      stats.skipped++;
      await patchSeenRow(brand, comment.id, {
        skipped_reason: decision.reason || "LLM voted no",
        decided_at: new Date().toISOString(),
      });
      continue;
    }

    const posted = await postReply(creds, comment.id, decision.reply!);
    if (posted) {
      stats.replied++;
      console.log(`[YukiIGReplier] ${brand}: replied to @${comment.username} on media ${comment.id.slice(-10)}`);
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

  console.log(`[YukiIGReplier] ${brand}: scanned=${stats.scanned} replied=${stats.replied} skipped=${stats.skipped} errors=${stats.errors}`);
  return stats;
}
