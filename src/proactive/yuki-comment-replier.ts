// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Auto-Reply (Plain-Ace voice)
// Session 115 (2026-04-24) — auto-respond to YouTube comments within ~5 min.
//
// Wired into the 5-min comment watcher (src/proactive/youtube-comment-watcher.ts).
// On every NEW unseen comment that fires the Telegram alert, this module ALSO:
//   1. Generates a 1-3 sentence reply in plain-Ace conversational voice
//      (NO memetic triggers, NO Sovereign / Containment lexicon — just Ace
//      talking like a normal channel owner who replies to viewers).
//      Mirrors the Sapphire PA dual-mode precedent (S114).
//   2. Posts the reply via replyToYouTubeComment (the /comments + parentId
//      threaded-reply endpoint, NOT the top-level /commentThreads endpoint).
//   3. PATCHes youtube_comments_seen with replied_at, reply_comment_id,
//      reply_text, or reply_error.
//
// Defensive: every failure mode logs and returns. The Telegram DM still
// fires regardless — if Yuki's reply fails, Ace still sees the comment in
// his hand within 5 min, same as before this build.
//
// LLM: Anthropic Claude Haiku (cheap — these are 1-3 sentence replies).
// Spam guard: LLM is asked to return {should_reply: false} for visible spam,
// promotional comments, or anything the channel owner shouldn't engage with.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { replyToYouTubeComment } from "../tools/youtube-comment-tool";

type Brand = "sovereign_synthesis" | "containment_field";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Cheap model for 1-3 sentence replies. Sonnet is overkill here.
const REPLY_MODEL = "claude-haiku-4-5-20251001";

// Plain-Ace voice — explicitly NOT the brand voice.
// Mirrors Sapphire PA pattern from S114: plain English, no memetic triggers,
// no `*[inner state: ...]*` stamps, no "frequency" / "transmission" / "sovereign"
// lexicon. Just Ace replying like a normal creator who actually reads comments.
const PLAIN_ACE_SYSTEM_PROMPT = `You are writing a YouTube comment reply on behalf of Ace, the channel owner. You are NOT the AI agent Yuki here — you are Ace replying personally to a viewer.

VOICE RULES (these override anything else):
- Plain conversational English. No jargon, no buzzwords.
- Do NOT use the words: "sovereign", "synthesis", "containment", "frequency", "transmission", "architect", "mindset", "consciousness", "matrix", "simulation", "firmware", "protocol", "initiate", "resonance", "vibration".
- Do NOT use the words: "great question", "love this", "amazing", "absolutely". No sycophancy.
- Do NOT push links, URLs, "free guide", or sales-y language. The video description already has the link.
- 1 to 3 sentences MAX. Often 1 is right.
- Sound like a real person who skimmed the comment and replied in 30 seconds. Casual but warm. Direct.
- If the commenter said something specific, acknowledge that specific thing — don't reply with generic praise.

WHEN NOT TO REPLY (return should_reply=false):
- Spam, promotional comments, links to other channels.
- Comments in a language you can't reliably reply in (English-only for now).
- Hostile, abusive, or trolling comments where engaging would only feed them.
- Pure emoji-only or single-word comments where there's nothing to actually respond to.
- Comments that look like bot/auto-generated.

OUTPUT FORMAT (JSON ONLY, no markdown, no fenced code blocks):
{"should_reply": true, "reply": "your reply text here"}
OR
{"should_reply": false, "reason": "short reason"}

Examples:

Comment: "Outdated code is the realest thing I've heard all week. Saving this."
Output: {"should_reply": true, "reply": "Glad it landed. The 'outdated code' frame was the one I almost cut — kept it because it kept catching me too."}

Comment: "Who are you? Thank you for the message."
Output: {"should_reply": true, "reply": "Just someone who got tired of the script everyone else was running. Thanks for watching — means more than you'd think this early on."}

Comment: "🔥🔥🔥"
Output: {"should_reply": false, "reason": "single emoji, nothing to respond to"}

Comment: "Check out my channel for more like this!!!"
Output: {"should_reply": false, "reason": "self-promotional spam"}

Comment: "What was that intro music called?"
Output: {"should_reply": true, "reply": "Custom track I built for the channel — no name, no release. Glad you noticed."}

Now reply to the actual comment.`;

interface CommentReplyContext {
  commentId: string;        // The YouTube comment thread id (used as parentId for the reply)
  brand: Brand;
  videoId: string;
  videoTitle: string;
  authorName: string;
  authorHandle: string;
  textOriginal: string;
}

interface LlmDecision {
  should_reply: boolean;
  reply?: string;
  reason?: string;
}

async function generateReplyText(ctx: CommentReplyContext): Promise<LlmDecision> {
  if (!ANTHROPIC_API_KEY) {
    return { should_reply: false, reason: "ANTHROPIC_API_KEY not set" };
  }

  const userMessage = `Video title: ${ctx.videoTitle}\nCommenter: ${ctx.authorName}\nComment: ${ctx.textOriginal.slice(0, 1500)}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: REPLY_MODEL,
        max_tokens: 400,
        system: PLAIN_ACE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      return { should_reply: false, reason: `LLM ${resp.status}: ${body.slice(0, 200)}` };
    }

    const data = (await resp.json()) as any;
    const text = data?.content?.[0]?.text || "";
    if (!text) return { should_reply: false, reason: "empty LLM response" };

    // Strip code fences if the model wrapped it anyway
    const cleaned = text.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();

    let parsed: LlmDecision;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: if the model returned plain text, assume it's the reply
      const trimmed = cleaned.replace(/^["']|["']$/g, "");
      if (trimmed && trimmed.length < 500) {
        return { should_reply: true, reply: trimmed };
      }
      return { should_reply: false, reason: `LLM returned non-JSON: ${cleaned.slice(0, 100)}` };
    }

    if (parsed.should_reply && parsed.reply) {
      // Final safety: hard-reject if any banned word slipped through
      const banned = /\b(sovereign|synthesis|containment|frequency|transmission|architect|firmware|protocol|initiate|resonance)\b/i;
      if (banned.test(parsed.reply)) {
        return { should_reply: false, reason: `banned-word leak: ${parsed.reply.slice(0, 80)}` };
      }
      // Cap length defensively
      if (parsed.reply.length > 500) {
        parsed.reply = parsed.reply.slice(0, 497) + "...";
      }
    }

    return parsed;
  } catch (err: any) {
    return { should_reply: false, reason: `LLM exception: ${err.message}` };
  }
}

async function patchSeenRow(commentId: string, brand: Brand, patch: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/youtube_comments_seen?comment_id=eq.${encodeURIComponent(commentId)}&brand=eq.${brand}`,
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
    console.error(`[YukiReplier] patchSeenRow failed: ${err.message}`);
  }
}

/**
 * Main entry point. Called fire-and-forget from the comment watcher.
 * Generates a plain-Ace reply, posts it, and patches the seen row.
 * NEVER throws — every error is logged and recorded to youtube_comments_seen.reply_error.
 */
export async function replyToCommentAsAce(ctx: CommentReplyContext): Promise<void> {
  try {
    const decision = await generateReplyText(ctx);

    if (!decision.should_reply || !decision.reply) {
      const reason = decision.reason || "no-reply decision";
      console.log(`[YukiReplier] ${ctx.brand}/${ctx.commentId}: skipped — ${reason}`);
      await patchSeenRow(ctx.commentId, ctx.brand, {
        reply_error: `skipped: ${reason}`.slice(0, 500),
      });
      return;
    }

    const replyResult = await replyToYouTubeComment(ctx.commentId, decision.reply, ctx.brand);

    if (!replyResult.success) {
      console.error(`[YukiReplier] ${ctx.brand}/${ctx.commentId}: post failed — ${replyResult.error}`);
      await patchSeenRow(ctx.commentId, ctx.brand, {
        reply_error: (replyResult.error || "unknown post failure").slice(0, 500),
        reply_text: decision.reply,
      });
      return;
    }

    console.log(`[YukiReplier] ${ctx.brand}/${ctx.commentId}: replied as ${replyResult.commentId}`);
    await patchSeenRow(ctx.commentId, ctx.brand, {
      replied_at: new Date().toISOString(),
      reply_comment_id: replyResult.commentId,
      reply_text: decision.reply,
      reply_error: null,
    });
  } catch (err: any) {
    console.error(`[YukiReplier] unhandled exception on ${ctx.brand}/${ctx.commentId}: ${err.message}`);
    await patchSeenRow(ctx.commentId, ctx.brand, {
      reply_error: `exception: ${err.message}`.slice(0, 500),
    });
  }
}
