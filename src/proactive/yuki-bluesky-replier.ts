// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Bluesky Reply Watcher
// Session 115 (2026-04-25) — 5-min poll, plain-Ace voice replies on
// Bluesky notifications.
//
// Mirrors the YouTube comment watcher pattern but on Bluesky's AT
// Protocol. Polls app.bsky.notification.listNotifications, dedupes
// against bluesky_replies_seen, drafts a plain-Ace reply via the
// shared Gemini Flash helper, posts via createRecord with reply
// field referencing root + parent.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { bskyFetch, getOwnDid, type BskyBrand } from "./bluesky-client";
import { generateShortText } from "../llm/gemini-flash";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Same plain-Ace voice as the YouTube replier — ZERO brand jargon, normal
// conversational English. Mirrors Sapphire S114 PA mode.
const PLAIN_ACE_SYSTEM_PROMPT = `You are writing a Bluesky reply on behalf of Ace, the account owner. You are NOT the AI agent Yuki here — you are Ace replying personally.

VOICE RULES (override anything else):
- Plain conversational English. No jargon, no buzzwords.
- Do NOT use the words: "sovereign", "synthesis", "containment", "frequency", "transmission", "architect", "mindset", "consciousness", "matrix", "simulation", "firmware", "protocol", "initiate", "resonance", "vibration".
- Do NOT use: "great point", "love this", "amazing", "absolutely", "100%". No sycophancy.
- Do NOT push links or URLs.
- 1 to 2 sentences MAX. Bluesky's 300-char post limit makes long replies look bad anyway.
- Sound like a real person who skimmed the reply and answered in 30 seconds. Casual, warm, direct.
- If the commenter said something specific, acknowledge that specific thing.

WHEN NOT TO REPLY (return should_reply=false):
- Spam, promotional content, links to other accounts.
- Languages you can't reliably reply in (English-only).
- Hostile, abusive, or trolling — engaging only feeds them.
- Pure emoji or single-word replies where there's nothing to respond to.
- Bot-looking replies.

OUTPUT FORMAT (JSON only, no markdown, no fenced blocks):
{"should_reply": true, "reply": "your reply text here"}
OR
{"should_reply": false, "reason": "short reason"}

Hard cap reply length at 250 characters (Bluesky cap is 300, leave headroom).`;

// First-run-per-brand seed flag — same pattern as YouTube watcher.
// On first poll after boot, dump notifications into the seen-table without
// replying, so we don't spam Ace's followers with replies to historical
// notifications. Subsequent ticks only reply to fresh ones.
const firstRunPerBrand: Partial<Record<BskyBrand, boolean>> = {
  sovereign_synthesis: true,
  containment_field: true,
};

// Process-local dedup fallback when Supabase is unreachable
const inMemorySeen: Partial<Record<BskyBrand, Set<string>>> = {
  sovereign_synthesis: new Set(),
  containment_field: new Set(),
};

interface BskyNotification {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string };
  reason: string; // 'reply' | 'mention' | 'like' | 'repost' | 'follow' | 'quote'
  reasonSubject?: string;
  record: any;
  isRead: boolean;
  indexedAt: string;
}

async function fetchSeenUris(brand: BskyBrand, uris: string[]): Promise<Set<string>> {
  if (!SUPABASE_URL || !SUPABASE_KEY || uris.length === 0) return new Set();
  try {
    const inList = uris.map((u) => `"${u}"`).join(",");
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/bluesky_replies_seen?select=uri&brand=eq.${brand}&uri=in.(${encodeURIComponent(inList)})`,
      {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      }
    );
    if (!resp.ok) return new Set();
    const rows = (await resp.json()) as Array<{ uri: string }>;
    return new Set(rows.map((r) => r.uri));
  } catch {
    return new Set();
  }
}

async function recordSeen(row: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/bluesky_replies_seen`, {
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
    console.error(`[YukiBskyReplier] recordSeen failed: ${err.message}`);
  }
}

async function patchSeenRow(uri: string, brand: BskyBrand, patch: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/bluesky_replies_seen?uri=eq.${encodeURIComponent(uri)}&brand=eq.${brand}`,
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
  } catch (err: any) {
    console.error(`[YukiBskyReplier] patchSeenRow failed: ${err.message}`);
  }
}

interface ReplyDecision {
  should_reply: boolean;
  reply?: string;
  reason?: string;
}

async function generateReply(notif: BskyNotification): Promise<ReplyDecision> {
  const text = notif.record?.text || "";
  const userMessage = `Author: @${notif.author.handle}${notif.author.displayName ? ` (${notif.author.displayName})` : ""}\nReply text: ${text.slice(0, 800)}`;

  const { text: rawText, error } = await generateShortText(
    PLAIN_ACE_SYSTEM_PROMPT,
    userMessage,
    { maxOutputTokens: 350, temperature: 0.8 }
  );

  if (error || !rawText) {
    return { should_reply: false, reason: error || "empty LLM response" };
  }

  const cleaned = rawText.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  let parsed: ReplyDecision;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const trimmed = cleaned.replace(/^["']|["']$/g, "");
    if (trimmed && trimmed.length < 280) {
      return { should_reply: true, reply: trimmed };
    }
    return { should_reply: false, reason: `LLM non-JSON: ${cleaned.slice(0, 100)}` };
  }

  if (parsed.should_reply && parsed.reply) {
    const banned = /\b(sovereign|synthesis|containment|frequency|transmission|architect|firmware|protocol|initiate|resonance)\b/i;
    if (banned.test(parsed.reply)) {
      return { should_reply: false, reason: `banned-word leak: ${parsed.reply.slice(0, 80)}` };
    }
    // Bluesky 300-char hard cap
    if (parsed.reply.length > 290) {
      parsed.reply = parsed.reply.slice(0, 287) + "...";
    }
  }
  return parsed;
}

/**
 * Post a reply on Bluesky via createRecord.
 * Reply field needs root + parent {uri, cid}. Bluesky requires both —
 * if root is the same as parent (replying to a top-level post), pass
 * the same {uri, cid} for both.
 */
async function postReply(
  brand: BskyBrand,
  text: string,
  parent: { uri: string; cid: string },
  root: { uri: string; cid: string }
): Promise<{ uri: string; cid: string } | null> {
  // Need our own DID for the createRecord repo field
  const did = await getOwnDid(brand);
  if (!did) return null;

  const data = await bskyFetch<{ uri: string; cid: string }>(brand, "com.atproto.repo.createRecord", {
    method: "POST",
    body: {
      repo: did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        reply: { root, parent },
      },
    },
  });
  return data;
}

/**
 * Main poll function. Called once per scheduler tick (every 5 min).
 * Iterates configured brands; for each, fetches notifications, dedupes
 * against bluesky_replies_seen, generates plain-Ace reply, posts.
 */
export async function pollBlueskyReplies(): Promise<void> {
  const brands: BskyBrand[] = ["sovereign_synthesis", "containment_field"];

  for (const brand of brands) {
    // Skip brands that don't have credentials configured (e.g., CF until added)
    const did = await getOwnDid(brand);
    if (!did) continue;

    // Fetch notifications — limit to 30 most recent
    const data = await bskyFetch<{ notifications: BskyNotification[] }>(brand, "app.bsky.notification.listNotifications", {
      query: { limit: 30 },
    });
    if (!data) continue;

    // Filter to replies only (skip likes/follows/reposts/etc.)
    const replies = (data.notifications || []).filter((n) => n.reason === "reply" || n.reason === "mention");
    if (replies.length === 0) continue;

    const uris = replies.map((r) => r.uri);
    const seenInDb = await fetchSeenUris(brand, uris);
    const isFirstRun = firstRunPerBrand[brand];
    firstRunPerBrand[brand] = false;

    for (const notif of replies) {
      const memSeen = inMemorySeen[brand]!;
      if (seenInDb.has(notif.uri) || memSeen.has(notif.uri)) continue;

      // Skip our own replies (in case our own posts surface in notifications)
      if (notif.author.did === did) {
        memSeen.add(notif.uri);
        continue;
      }

      const text: string = notif.record?.text || "";
      const replyRef = notif.record?.reply;
      const parentUri: string = replyRef?.parent?.uri || "";
      const parentCid: string = replyRef?.parent?.cid || "";
      const rootUri: string = replyRef?.root?.uri || parentUri;
      const rootCid: string = replyRef?.root?.cid || parentCid;

      // Record as seen FIRST (idempotent — prevents re-reply on next tick if reply post fails)
      await recordSeen({
        uri: notif.uri,
        brand,
        parent_uri: parentUri,
        root_uri: rootUri,
        parent_cid: parentCid,
        root_cid: rootCid,
        author_handle: notif.author.handle,
        author_did: notif.author.did,
        text: text.slice(0, 2000),
        indexed_at: notif.indexedAt,
      });
      memSeen.add(notif.uri);

      // First-run seed pass — don't reply on the first tick after boot
      if (isFirstRun && seenInDb.size === 0) continue;

      const decision = await generateReply(notif);
      if (!decision.should_reply || !decision.reply) {
        await patchSeenRow(notif.uri, brand, {
          reply_error: `skipped: ${(decision.reason || "no-reply decision").slice(0, 500)}`,
        });
        console.log(`[YukiBskyReplier] ${brand}/${notif.uri.slice(-12)}: skipped — ${decision.reason}`);
        continue;
      }

      const posted = await postReply(
        brand,
        decision.reply,
        { uri: notif.uri, cid: notif.cid },
        { uri: rootUri || notif.uri, cid: rootCid || notif.cid }
      );

      if (!posted) {
        await patchSeenRow(notif.uri, brand, {
          reply_error: "post failed (see Railway logs)",
          reply_text: decision.reply,
        });
        console.error(`[YukiBskyReplier] ${brand}/${notif.uri.slice(-12)}: postReply failed`);
        continue;
      }

      await patchSeenRow(notif.uri, brand, {
        replied_at: new Date().toISOString(),
        reply_uri: posted.uri,
        reply_text: decision.reply,
        reply_error: null,
      });
      console.log(`[YukiBskyReplier] ${brand}/${notif.uri.slice(-12)}: replied (${posted.uri.slice(-12)})`);
    }
  }
}
