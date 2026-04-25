// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Bluesky Hook Dropper
// Session 115 (2026-04-25) — twice-daily outbound consciousness hooks on
// Bluesky. Mirrors yuki-hook-dropper.ts but for AT Protocol.
//
// FLOW (per brand, per run):
//   1. List follows via app.bsky.graph.getFollows (max 100/page).
//   2. For each follow, get the latest top-level post via
//      app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=1.
//   3. Skip if (brand, target_uri) already in bluesky_hook_drops, OR
//      if we've replied to anything by this same author in the last 7d
//      (to avoid looking like a stalker).
//   4. Generate ONE single-sentence brand-voice reframe via the shared
//      Gemini Flash helper.
//   5. Post as a reply on Bluesky via createRecord with reply field
//      pointing at the target post as both root and parent.
//   6. Insert into bluesky_hook_drops.
//
// THROTTLE: Hard cap 3 drops per brand per run (stricter than YouTube's 5
// because Bluesky's spam detection is tighter on a smaller network).
// Twice/day = 12 drops/day max across both brands when CF added.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { bskyFetch, getOwnDid, type BskyBrand } from "./bluesky-client";
import { generateShortText } from "../llm/gemini-flash";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const MAX_DROPS_PER_RUN = 3;
const MAX_FOLLOWS_TO_SCAN = 100;
const SAME_AUTHOR_COOLDOWN_DAYS = 7;

// Brand voice prompts — same shape as yuki-hook-dropper.ts but
// adapted for Bluesky's text-first culture (no thumbnails to react to,
// users skim posts not videos).
const BRAND_HOOK_PROMPTS: Record<BskyBrand, string> = {
  sovereign_synthesis: `You are writing ONE single-sentence reply on someone else's Bluesky post, posted from the Sovereign Synthesis account.

The goal: drop a "consciousness hook" — a sharp systemic observation that reframes whatever they posted into a deeper pattern. Like a smart friend leaving the most precise reply in the thread.

VOICE RULES:
- ONE sentence. Hard cap. No exceptions.
- Must reference something specific from the actual post text. Generic = fail.
- Bluesky 250-char hard cap (300 is the limit, leave headroom).
- No links. No URLs. No "follow me", "DM me", emojis.
- No sycophancy ("great post", "loved this"). No villain-coded snark.
- No buzzwords like "consciousness", "frequency", "vibration", "matrix" — those signal guru-content. Use plain words to point at the systemic thing.
- Tone: observant, slightly sharper than the average reply, like you're seeing the pattern under the topic. Not spiritual. Not academic. Just a clearer angle.

GOOD EXAMPLES:
Post about productivity: "The interesting part isn't the system — it's that the same person who can't stick to one for a week will run someone else's for ten years if they're paid to."
Post about confidence: "Most 'confidence' content teaches people to perform certainty about decisions they were never allowed to actually make for themselves."
Post about money mindset: "The mindset isn't the bottleneck — it's that the people teaching it had a financial floor under them when they ran the experiment."

OUTPUT: Plain text, ONE sentence, no quotes, no markdown. Under 250 characters.`,

  containment_field: `You are writing ONE single-sentence reply on someone else's Bluesky post, posted from The Containment Field account — anonymous, points at psychological capture mechanisms.

The goal: drop a darker, more clinical reframe. Forensic, not preachy.

VOICE RULES:
- ONE sentence. Hard cap.
- Must reference something specific from the post text.
- 250-char hard cap.
- No links, URLs, emojis, follow-asks.
- No spiritual language ("consciousness", "vibration", "frequency", "matrix").
- Tone: cold, observational, slightly unsettling. Forensic note in the margin.
- Don't moralize. State the mechanism.

GOOD EXAMPLES:
Post on burnout: "Burnout reads like a workload problem; functionally it's the body refusing a contract the mind already signed twice."
Post on toxic relationships: "Most 'gaslighting' framing handles the symptom — the architecture underneath is that the person was rewarded for self-doubt long before the relationship started."
Post on social anxiety: "The anxiety isn't the malfunction — it's the only honest signal in a system that's been rewarding performed comfort for years."

OUTPUT: Plain text, ONE sentence, no quotes, no markdown. Under 250 characters.`,
};

interface FollowRecord {
  did: string;
  handle: string;
  displayName?: string;
}

interface FeedPost {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string };
  record: any;
  indexedAt: string;
}

async function listFollows(brand: BskyBrand, ownDid: string): Promise<FollowRecord[]> {
  const all: FollowRecord[] = [];
  let cursor: string | undefined;
  while (all.length < MAX_FOLLOWS_TO_SCAN) {
    const resp = await bskyFetch<{ follows: FollowRecord[]; cursor?: string }>(brand, "app.bsky.graph.getFollows", {
      query: { actor: ownDid, limit: 100, cursor },
    });
    if (!resp) break;
    all.push(...(resp.follows || []));
    if (!resp.cursor) break;
    cursor = resp.cursor;
  }
  return all.slice(0, MAX_FOLLOWS_TO_SCAN);
}

async function getLatestTopLevelPost(brand: BskyBrand, actorDid: string): Promise<FeedPost | null> {
  const resp = await bskyFetch<{ feed: Array<{ post: FeedPost; reply?: any; reason?: any }> }>(brand, "app.bsky.feed.getAuthorFeed", {
    query: { actor: actorDid, limit: 5, filter: "posts_no_replies" },
  });
  if (!resp) return null;
  const items = resp.feed || [];
  // First item is most recent; filter again to ensure we get a top-level post (no reply, no repost)
  for (const item of items) {
    if (!item.reply && !item.reason && item.post) return item.post;
  }
  return null;
}

async function alreadyDropped(brand: BskyBrand, targetUri: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/bluesky_hook_drops?select=id&brand=eq.${brand}&target_uri=eq.${encodeURIComponent(targetUri)}&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return false;
    const rows = (await resp.json()) as any[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function authorRecentlyHit(brand: BskyBrand, authorDid: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const since = new Date(Date.now() - SAME_AUTHOR_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/bluesky_hook_drops?select=id&brand=eq.${brand}&target_author_did=eq.${authorDid}&posted_at=gte.${since}&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return false;
    const rows = (await resp.json()) as any[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function recordDrop(row: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/bluesky_hook_drops`, {
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
    console.error(`[YukiBskyHookDropper] recordDrop failed: ${err.message}`);
  }
}

async function generateHook(brand: BskyBrand, post: FeedPost): Promise<string | null> {
  const text = post.record?.text || "";
  if (!text || text.length < 20) return null; // not enough signal to reframe

  const userMessage = `Author: @${post.author.handle}${post.author.displayName ? ` (${post.author.displayName})` : ""}\nPost text: ${text.slice(0, 1500)}\n\nWrite ONE single-sentence reply per the rules above.`;

  const { text: raw, error } = await generateShortText(
    BRAND_HOOK_PROMPTS[brand],
    userMessage,
    { maxOutputTokens: 250, temperature: 0.85 }
  );

  if (error || !raw) {
    console.warn(`[YukiBskyHookDropper] LLM failed: ${error}`);
    return null;
  }

  let clean = raw.trim().replace(/^["']|["']$/g, "");
  // Single sentence only
  const m = clean.match(/^.+?[.!?](?=\s+[A-Z]|$)/s);
  if (m) clean = m[0];
  if (!clean || clean.length > 290) return null;
  if (/https?:\/\//i.test(clean)) return null;
  if (/follow (me|us)|DM (me|us)|check out|my channel/i.test(clean)) return null;
  return clean;
}

async function postHookReply(
  brand: BskyBrand,
  text: string,
  target: FeedPost
): Promise<{ uri: string; cid: string } | null> {
  const did = await getOwnDid(brand);
  if (!did) return null;

  // For a top-level post we're replying to, root === parent
  const ref = { uri: target.uri, cid: target.cid };
  return bskyFetch<{ uri: string; cid: string }>(brand, "com.atproto.repo.createRecord", {
    method: "POST",
    body: {
      repo: did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        reply: { root: ref, parent: ref },
      },
    },
  });
}

export async function runBlueskyHookDrops(brand: BskyBrand): Promise<{ attempted: number; posted: number; errors: number; skipped: number }> {
  const stats = { attempted: 0, posted: 0, errors: 0, skipped: 0 };

  const ownDid = await getOwnDid(brand);
  if (!ownDid) {
    console.log(`[YukiBskyHookDropper] ${brand}: no credentials, skipping`);
    return stats;
  }

  const follows = await listFollows(brand, ownDid);
  if (follows.length === 0) {
    console.log(`[YukiBskyHookDropper] ${brand}: zero follows`);
    return stats;
  }

  for (const follow of follows) {
    if (stats.posted >= MAX_DROPS_PER_RUN) break;

    // Same-author cooldown — skip if we hit this author in the last 7d
    if (await authorRecentlyHit(brand, follow.did)) {
      stats.skipped++;
      continue;
    }

    const latest = await getLatestTopLevelPost(brand, follow.did);
    if (!latest) continue;

    if (await alreadyDropped(brand, latest.uri)) {
      stats.skipped++;
      continue;
    }

    stats.attempted++;
    const hook = await generateHook(brand, latest);
    if (!hook) {
      stats.errors++;
      await recordDrop({
        brand,
        target_uri: latest.uri,
        target_cid: latest.cid,
        target_author_handle: follow.handle,
        target_author_did: follow.did,
        target_text_preview: (latest.record?.text || "").slice(0, 200),
        comment_text: "(LLM returned no usable hook)",
        error: "llm_no_hook",
      });
      continue;
    }

    const posted = await postHookReply(brand, hook, latest);
    if (posted) {
      stats.posted++;
      console.log(`[YukiBskyHookDropper] ${brand}: dropped on @${follow.handle} (${latest.uri.slice(-12)})`);
      await recordDrop({
        brand,
        target_uri: latest.uri,
        target_cid: latest.cid,
        target_author_handle: follow.handle,
        target_author_did: follow.did,
        target_text_preview: (latest.record?.text || "").slice(0, 200),
        comment_uri: posted.uri,
        comment_text: hook,
      });
    } else {
      stats.errors++;
      console.error(`[YukiBskyHookDropper] ${brand}: post failed on @${follow.handle}`);
      await recordDrop({
        brand,
        target_uri: latest.uri,
        target_cid: latest.cid,
        target_author_handle: follow.handle,
        target_author_did: follow.did,
        target_text_preview: (latest.record?.text || "").slice(0, 200),
        comment_text: hook,
        error: "post_failed",
      });
    }
  }

  console.log(`[YukiBskyHookDropper] ${brand}: attempted=${stats.attempted} posted=${stats.posted} skipped=${stats.skipped} errors=${stats.errors}`);
  return stats;
}
