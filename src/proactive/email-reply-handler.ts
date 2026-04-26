// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Inbound Email Reply Handler
// Session 109 (2026-04-24) — Anita engagement automation.
//
// When a lead replies to a nurture email, this handler:
// 1. Receives the inbound email via webhook (POST /api/inbound-email)
// 2. Dispatches to Anita (crew_dispatch) for a plain-English draft
// 3. Sends the draft to Telegram for Architect approval
// 4. On approval callback, sends the reply via Resend
//
// Inbound trigger: Resend inbound email webhook or manual forwarding.
// Nurture emails are sent from ace@sovereign-synthesis.com — replies land there.
//
// IMPORTANT: Anita must respond in PLAIN ENGLISH. No propagandist syntax,
// no lexical triggering, no sovereign jargon. The reader should feel like
// they're talking to a real person, not a brand.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { dispatchTask } from "../agent/crew-dispatch";
import type { Channel } from "../types";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "Sovereign Synthesis <ace@sovereign-synthesis.com>";

// S119c: Module-level Telegram channel singleton so crew-dispatch.completeDispatch
// can fire the approval prompt without threading the channel through every call site.
let _telegramChannel: Channel | null = null;
let _defaultChatId: string | null = null;

export function setEmailReplyChannel(channel: Channel, chatId: string): void {
  _telegramChannel = channel;
  _defaultChatId = chatId;
  console.log(`[EmailReply] Channel registered for approval prompts (chatId=${chatId})`);
}

// In-memory pending reply drafts awaiting Telegram approval.
// Key = reply_id, Value = { to, subject, draft, original }
interface PendingReply {
  replyId: string;
  to: string;
  subject: string;
  originalText: string;
  draftText: string;
  createdAt: Date;
}

const pendingReplies = new Map<string, PendingReply>();

// Expire pending replies after 24h to prevent memory leaks
function cleanExpiredReplies(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, reply] of pendingReplies) {
    if (reply.createdAt.getTime() < cutoff) {
      pendingReplies.delete(id);
    }
  }
}

/**
 * Handle an inbound email forwarded via webhook.
 * Expected payload shape (Resend inbound or manual):
 * {
 *   from: "lead@example.com",
 *   to: "ace@sovereign-synthesis.com",
 *   subject: "Re: Your Reality Override Manual",
 *   text: "Hey, I took the diagnostic and...",
 *   html?: "<p>Hey, I took the diagnostic...</p>"
 * }
 */
export async function handleInboundEmail(
  payload: {
    from: string;
    to?: string;
    subject: string;
    text: string;
    html?: string;
  },
  telegram: Channel,
  chatId: string
): Promise<{ queued: boolean; replyId?: string; error?: string }> {
  const { from, subject, text } = payload;

  if (!from || !text) {
    return { queued: false, error: "Missing from or text in payload" };
  }

  const replyId = `reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 1. Notify Architect immediately that a reply came in
  const alertMsg =
    `📧 *Inbound Email Reply*\n\n` +
    `*From:* ${from}\n` +
    `*Subject:* ${subject}\n\n` +
    `"${text.slice(0, 500)}${text.length > 500 ? "..." : ""}"\n\n` +
    `_Dispatching to Anita for draft response..._`;

  try {
    await telegram.sendMessage(chatId, alertMsg, { parseMode: "Markdown" });
  } catch (err: any) {
    console.error(`[EmailReply] Telegram alert failed: ${err.message}`);
  }

  // 2. Dispatch to Anita for plain-English draft
  try {
    await dispatchTask({
      from_agent: "system",
      to_agent: "anita",
      task_type: "email_reply_draft",
      priority: 0, // High priority — lead is warm RIGHT NOW
      chat_id: chatId,
      payload: {
        reply_id: replyId,
        from_email: from,
        subject,
        original_text: text.slice(0, 2000),
        directive:
          "DRAFT AN EMAIL REPLY to this lead. They replied to a nurture email from Sovereign Synthesis. " +
          "CRITICAL VOICE RULES: " +
          "1. Write in PLAIN ENGLISH. No sovereign jargon, no dark psychology terms, no lexical triggers. " +
          "2. Sound like a real human — warm, direct, conversational. Like texting a friend who happens to be knowledgeable. " +
          "3. Keep it SHORT — 3-5 sentences max. Answer their question or acknowledge their message. " +
          "4. If they asked about the diagnostic result, explain the pattern briefly and what it means practically. " +
          "5. End with ONE clear next step (not a sales pitch). " +
          "6. Do NOT mention Protocol 77, firmware updates, the simulation, escape velocity, or any brand lexicon. " +
          "7. Sign off as 'Ace' (not 'Sovereign Synthesis', not 'The Architect'). " +
          "After drafting, report the draft text to the Architect via Telegram. " +
          "Include the reply_id in your response so the approval system can match it.",
      },
    });
  } catch (err: any) {
    console.error(`[EmailReply] Dispatch to Anita failed: ${err.message}`);
    return { queued: false, error: `Dispatch failed: ${err.message}` };
  }

  // 3. Store pending reply metadata
  pendingReplies.set(replyId, {
    replyId,
    to: from,
    subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    originalText: text.slice(0, 2000),
    draftText: "", // Will be filled when Anita responds
    createdAt: new Date(),
  });

  cleanExpiredReplies();

  console.log(`[EmailReply] Queued reply ${replyId} for ${from} — awaiting Anita's draft`);
  return { queued: true, replyId };
}

/**
 * Store Anita's draft and send it to Telegram for approval.
 * Called from the dispatch completion handler when Anita finishes.
 */
export async function storeDraftAndRequestApproval(
  replyId: string,
  draftText: string,
  telegram: Channel,
  chatId: string
): Promise<void> {
  const pending = pendingReplies.get(replyId);
  if (!pending) {
    console.warn(`[EmailReply] No pending reply found for ${replyId}`);
    return;
  }

  pending.draftText = draftText;

  const approvalMsg =
    `✉️ *Anita's Draft Reply*\n\n` +
    `*To:* ${pending.to}\n` +
    `*Subject:* ${pending.subject}\n\n` +
    `---\n${draftText}\n---\n\n` +
    `Reply \`/approve\` to send, or \`/edit <your rewrite>\` to send a custom version.\n` +
    `_(ID: \`${replyId}\` — use it if you have multiple pending drafts.)_`;

  try {
    await telegram.sendMessage(chatId, approvalMsg, { parseMode: "Markdown" });
  } catch (err: any) {
    console.error(`[EmailReply] Approval request failed: ${err.message}`);
  }
}

// S119h: deduplication so the same replyId can't be approval-carded twice
// (e.g. if completeDispatch fires twice for the same dispatch). 24h TTL.
const _approvalCardSent = new Map<string, number>();
function _cleanApprovalCardSent(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, ts] of _approvalCardSent) {
    if (ts < cutoff) _approvalCardSent.delete(id);
  }
}

/**
 * S119c: Convenience wrapper — uses the module-level registered channel.
 * Called from crew-dispatch.completeDispatch when an email_reply_draft task finishes.
 * If the registered channel is missing, logs and no-ops (don't crash the dispatch loop).
 *
 * S119h: idempotent per replyId — won't fire the approval card more than once
 * for the same draft even if upstream calls duplicate.
 */
export async function notifyDraftReady(replyId: string, draftText: string): Promise<void> {
  if (!_telegramChannel || !_defaultChatId) {
    console.warn(
      `[EmailReply] notifyDraftReady called but channel not registered. ` +
        `replyId=${replyId} — call setEmailReplyChannel() at bot init.`
    );
    return;
  }
  _cleanApprovalCardSent();
  if (_approvalCardSent.has(replyId)) {
    console.log(`[EmailReply] Approval card already sent for ${replyId} — skipping duplicate.`);
    return;
  }
  _approvalCardSent.set(replyId, Date.now());
  await storeDraftAndRequestApproval(replyId, draftText, _telegramChannel, _defaultChatId);
}

/**
 * Send an approved reply via Resend.
 */
export async function sendApprovedReply(
  replyId: string,
  overrideText?: string
): Promise<{ sent: boolean; error?: string }> {
  const pending = pendingReplies.get(replyId);
  if (!pending) {
    return { sent: false, error: `No pending reply found for ${replyId}` };
  }

  const bodyText = overrideText || pending.draftText;
  if (!bodyText) {
    return { sent: false, error: "No draft text available" };
  }

  if (!RESEND_API_KEY) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: pending.to,
        subject: pending.subject,
        text: bodyText,
        headers: {
          "List-Unsubscribe": "<https://sovereign-synthesis.com/unsubscribe>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });

    const data = (await resp.json()) as any;
    if (!resp.ok) {
      return { sent: false, error: `Resend ${resp.status}: ${JSON.stringify(data)}` };
    }

    console.log(`[EmailReply] Sent reply ${replyId} to ${pending.to} — Resend ID: ${data.id}`);
    pendingReplies.delete(replyId);
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

/**
 * Get all pending replies (for status checks).
 */
export function getPendingReplies(): PendingReply[] {
  cleanExpiredReplies();
  return [...pendingReplies.values()];
}

/**
 * S119e: Get the reply_id of the most-recently-created pending reply.
 * Lets the user type bare /approve or /edit without copy-pasting the long ID
 * when there's only one pending draft (the common case).
 * Returns null if no pending replies.
 */
export function getMostRecentPendingReplyId(): string | null {
  cleanExpiredReplies();
  let mostRecent: PendingReply | null = null;
  for (const reply of pendingReplies.values()) {
    if (!mostRecent || reply.createdAt > mostRecent.createdAt) {
      mostRecent = reply;
    }
  }
  return mostRecent?.replyId ?? null;
}
