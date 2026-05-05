// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Anita Newsletter System
// Session 117 (2026-04-25) — Anita autonomous send + compounding-ideas
// newsletter program. Per Ace S117: Anita gets autonomy (no per-email
// approval) capped at 3 emails/week. Newsletter is separate from the
// existing nurture sequence: each issue compounds on prior ideas, tracked
// in semantic memory (Pinecone `content` namespace).
//
// Tables (created in migration anita_newsletter_s117):
//   - newsletter_ideas    (compounding-concept graph)
//   - newsletter_issues   (sequential issues)
//   - anita_send_log      (cap enforcement source of truth)
//   - anita_weekly_send_count (helper view)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";
import { voicedDM, type FactPayload } from "../channels/agent-voice";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "Sovereign Synthesis <ace@sovereign-synthesis.com>";
const WEEKLY_CAP = 3;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

type SendType = "newsletter" | "inbound_reply" | "nurture_step" | "broadcast";

interface CapStatus {
  sends_last_7d: number;
  budget_remaining: number;
  capped: boolean;
}

// ── 1. Cap status query ────────────────────────────────────────────────────
export async function getWeeklyCapStatus(): Promise<CapStatus> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { sends_last_7d: 0, budget_remaining: WEEKLY_CAP, capped: false };
  }
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/anita_weekly_send_count?select=sends_last_7d,budget_remaining`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return { sends_last_7d: 0, budget_remaining: WEEKLY_CAP, capped: false };
    const rows = (await resp.json()) as Array<{ sends_last_7d: number; budget_remaining: number }>;
    const row = rows[0] || { sends_last_7d: 0, budget_remaining: WEEKLY_CAP };
    const remaining = Math.max(0, row.budget_remaining);
    return {
      sends_last_7d: row.sends_last_7d,
      budget_remaining: remaining,
      capped: remaining <= 0,
    };
  } catch {
    return { sends_last_7d: 0, budget_remaining: WEEKLY_CAP, capped: false };
  }
}

// ── 2. Cap-enforced send primitive ─────────────────────────────────────────
// Every Anita-initiated send goes through here. Checks weekly cap, sends via
// Resend, logs to anita_send_log on success.
export async function sendWithCap(input: {
  sendType: SendType;
  to: string | string[];
  subject: string;
  htmlBody: string;
  plainBody?: string;
  referenceId?: string;
  bypassCap?: boolean;  // ONLY for inbound_reply (those are 1:1, not broadcast)
}): Promise<{ sent: boolean; resendEmailId?: string; error?: string; capStatus?: CapStatus }> {
  if (!RESEND_API_KEY) return { sent: false, error: "RESEND_API_KEY not set" };

  // Cap check (skip for inbound_reply since those are direct 1:1 responses)
  let capStatus: CapStatus | undefined;
  if (!input.bypassCap && input.sendType !== "inbound_reply") {
    capStatus = await getWeeklyCapStatus();
    if (capStatus.capped) {
      return {
        sent: false,
        error: `Weekly send cap reached (${capStatus.sends_last_7d}/${WEEKLY_CAP} sent in last 7 days). This send is blocked. Try again next week or surface to Ace as a 'meeting requested' if urgent.`,
        capStatus,
      };
    }
  }

  // Send via Resend
  let resendId: string | undefined;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: input.to,
        subject: input.subject,
        html: input.htmlBody,
        text: input.plainBody,
        headers: {
          "List-Unsubscribe": "<https://sovereign-synthesis.com/unsubscribe>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    const data = (await resp.json()) as any;
    if (!resp.ok) {
      return { sent: false, error: `Resend ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`, capStatus };
    }
    resendId = data.id;
  } catch (err: any) {
    return { sent: false, error: err.message, capStatus };
  }

  // Log to anita_send_log (best-effort — failure here doesn't block the actual send)
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const recipientCount = Array.isArray(input.to) ? input.to.length : 1;
      await fetch(`${SUPABASE_URL}/rest/v1/anita_send_log`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          send_type: input.sendType,
          reference_id: input.referenceId || null,
          recipient_count: recipientCount,
          subject: input.subject,
          resend_email_id: resendId,
        }),
      });
    } catch (err: any) {
      console.error(`[AnitaSend] Failed to log send (send itself succeeded): ${err.message}`);
    }
  }

  console.log(`[AnitaSend] ✅ Sent ${input.sendType}: "${input.subject.slice(0, 60)}" — Resend ID: ${resendId}`);
  return { sent: true, resendEmailId: resendId, capStatus };
}

// ── 3. Idea graph traversal: pick the next idea to introduce ──────────────
// Returns the idea whose parents are ALL already introduced (status: ready
// to be expounded), preferring ones never used yet. Falls back to suggesting
// expansion of an existing idea if no new ones are ready.
export async function pickNextIdeaToIntroduce(): Promise<{
  next?: { id: string; slug: string; title: string; summary: string };
  suggestExpand?: { id: string; slug: string; title: string };
  reason: string;
}> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { reason: "Supabase not configured" };

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/newsletter_ideas?select=id,slug,title,summary,parent_ids,introduced_in_issue_number&order=created_at.asc`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return { reason: `query failed: ${resp.status}` };
    const ideas = (await resp.json()) as Array<{
      id: string; slug: string; title: string; summary: string;
      parent_ids: string[]; introduced_in_issue_number: number | null;
    }>;

    if (ideas.length === 0) {
      return { reason: "No ideas in graph yet. Anita should propose foundational ideas before composing first issue." };
    }

    const introducedIds = new Set(
      ideas.filter((i) => i.introduced_in_issue_number != null).map((i) => i.id)
    );
    const readyToIntroduce = ideas.filter(
      (i) => i.introduced_in_issue_number == null &&
             (i.parent_ids || []).every((pid) => introducedIds.has(pid))
    );

    if (readyToIntroduce.length > 0) {
      const pick = readyToIntroduce[0];
      return { next: { id: pick.id, slug: pick.slug, title: pick.title, summary: pick.summary }, reason: "ready_to_introduce" };
    }

    // No new ideas ready — suggest expanding an introduced one (oldest unexpanded first)
    const introducedSorted = ideas
      .filter((i) => i.introduced_in_issue_number != null)
      .sort((a, b) => (a.introduced_in_issue_number || 0) - (b.introduced_in_issue_number || 0));
    if (introducedSorted.length > 0) {
      const pick = introducedSorted[0];
      return {
        suggestExpand: { id: pick.id, slug: pick.slug, title: pick.title },
        reason: "no_ready_new_ideas_expand_oldest",
      };
    }

    return { reason: "no actionable ideas" };
  } catch (err: any) {
    return { reason: `error: ${err.message}` };
  }
}

// ── 4. Get next issue number (for sequential numbering) ───────────────────
export async function getNextIssueNumber(): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 1;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/newsletter_issues?select=issue_number&order=issue_number.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return 1;
    const rows = (await resp.json()) as Array<{ issue_number: number }>;
    return (rows[0]?.issue_number ?? 0) + 1;
  } catch {
    return 1;
  }
}

// ── 5. Save a draft issue ─────────────────────────────────────────────────
export async function saveDraftIssue(input: {
  issueNumber: number;
  subject: string;
  preheader?: string;
  bodyHtml: string;
  bodyPlain?: string;
  ideasIntroduced?: string[];
  ideasExpounded?: string[];
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, error: "Supabase not configured" };
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_issues`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        issue_number: input.issueNumber,
        subject: input.subject,
        preheader: input.preheader || null,
        body_html: input.bodyHtml,
        body_plain: input.bodyPlain || null,
        ideas_introduced: input.ideasIntroduced || [],
        ideas_expounded: input.ideasExpounded || [],
        status: "draft",
      }),
    });
    if (!resp.ok) {
      return { ok: false, error: `${resp.status}: ${(await resp.text()).slice(0, 300)}` };
    }
    const rows = (await resp.json()) as Array<{ id: string }>;
    return { ok: true, id: rows[0]?.id };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── 6. Mark issue as sent + patch idea graph ──────────────────────────────
// S130e (2026-05-04): The function name was always "markIssueSent + patch idea
// graph" but the idea-graph patch was never wired. Result: every newsletter
// cycle re-picked `the_simulation` because no idea ever got
// `introduced_in_issue_number` set, so `pickNextIdeaToIntroduce` saw all
// ideas as never-introduced and returned the same root each time. This
// extension adds the write-back so the graph compounds as designed.
export async function markIssueSent(
  issueId: string,
  resendEmailId: string,
  recipientCount: number,
  issueNumber?: number,
  ideasIntroduced?: string[],
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/newsletter_issues?id=eq.${issueId}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status: "sent",
        sent_at: new Date().toISOString(),
        recipient_count: recipientCount,
      }),
    });
  } catch (err: any) {
    console.error(`[AnitaSend] markIssueSent (issues PATCH) failed: ${err.message}`);
  }

  // S130e: Patch each newly-introduced idea with the issue number so future
  // cycles know it's been introduced. Best-effort — failures here don't
  // unship the issue. If issueNumber is undefined, skip silently (caller
  // didn't pass enough info to do this safely).
  if (typeof issueNumber === "number" && ideasIntroduced && ideasIntroduced.length > 0) {
    for (const ideaId of ideasIntroduced) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/newsletter_ideas?id=eq.${ideaId}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            introduced_in_issue_number: issueNumber,
          }),
        });
        console.log(`[AnitaSend] idea-graph: marked ${ideaId.slice(0, 8)}… as introduced in issue #${issueNumber}`);
      } catch (err: any) {
        console.error(`[AnitaSend] markIssueSent (ideas PATCH ${ideaId}) failed: ${err.message}`);
      }
    }
  }
}

// ── 7. List recipients for newsletter (initiates with email + opted in) ──
export async function listNewsletterRecipients(): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/initiates?select=email&payment_status=neq.unsubscribed`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return [];
    const rows = (await resp.json()) as Array<{ email: string }>;
    return rows.map((r) => r.email).filter(Boolean);
  } catch {
    return [];
  }
}

// ── 8. Compose a draft issue via Gemini (Anita's voice) ───────────────────
async function geminiComposeIssue(input: {
  issueNumber: number;
  isFirstIssue: boolean;
  introduceIdea?: { id: string; title: string; summary: string };
  expandIdea?: { id: string; title: string };
  priorIssues: Array<{ issue_number: number; subject: string; ideas_introduced: string[] }>;
}): Promise<{ ok: boolean; subject?: string; preheader?: string; bodyHtml?: string; bodyPlain?: string; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY not set" };

  const priorContext = input.priorIssues.length === 0
    ? "This is the FIRST issue. Establish the foundation."
    : `Prior issues established: ${input.priorIssues.slice(-5).map((i) => `#${i.issue_number} "${i.subject}"`).join(" | ")}`;

  const focusInstruction = input.introduceIdea
    ? `INTRODUCE this concept: "${input.introduceIdea.title}" — ${input.introduceIdea.summary}. Build on what prior issues established.`
    : input.expandIdea
    ? `EXPAND on this prior concept: "${input.expandIdea.title}". Add a new angle or implication that compounds on what readers already know.`
    : "Introduce ONE foundational concept of the Sovereign Synthesis frame (e.g., the Simulation, the Glitch, Sovereign Synthesis as architecture). This sets up future issues.";

  const prompt = `You are Anita, copy specialist for Sovereign Synthesis. You write a compounding-ideas newsletter — every issue builds on prior ones. Voice: cynical, sharp, dark humor, anti-circle. NEVER marketing jargon. Always one concrete glitch in the reader's reality logic.

Context: Issue #${input.issueNumber}. ${priorContext}

This issue: ${focusInstruction}

Brand email standard (NON-NEGOTIABLE):
- Dark HTML wrapper, table-based 600px card, #121212 bg, #252525 border, 8px radius
- Header: "SOVEREIGN SYNTHESIS" left, "Transmission #${input.issueNumber}" right
- Gradient accent line: linear-gradient(#E5850F → #5A9CF5 → #2ECC8F)
- Section label color coding: Gold=welcome/scarcity, Blue=defense/blueprint, Green=activation
- CTA button: #E5850F bg, #000000 text, uppercase, 1.5px letter-spacing
- Footer with unsubscribe link to https://sovereign-synthesis.com/unsubscribe
- Signature: "— Ace" + "Sovereign Synthesis"

Output STRICT JSON, no other text:
{"subject":"<subject line, max 60 chars, no emoji>","preheader":"<15-90 chars preview>","body_html":"<full HTML conforming to brand standard>","body_plain":"<plain-text version for email clients that block HTML>"}`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4000, responseMimeType: "application/json" },
        }),
      }
    );
    if (!resp.ok) return { ok: false, error: `Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}` };
    const data = (await resp.json()) as any;
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    const parsed = JSON.parse(text);
    if (!parsed.subject || !parsed.body_html) return { ok: false, error: "Missing subject or body_html in Gemini output" };
    return {
      ok: true,
      subject: String(parsed.subject),
      preheader: String(parsed.preheader || ""),
      bodyHtml: String(parsed.body_html),
      bodyPlain: String(parsed.body_plain || ""),
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── 9. The weekly cron orchestrator ───────────────────────────────────────
// Invoked by the scheduler in index.ts. Produces a draft, sends if cap allows.
export async function runWeeklyNewsletterCycle(opts: {
  alertChannel?: Channel;
  alertChatId?: string;
  dryRun?: boolean;
}): Promise<{ status: string; details: string }> {
  // every alert routes through Anita's voice (ddxfish blueprint + content-namespace
  // recall). Falls back to the raw `text` on any failure — alert delivery never breaks.
  const alert = async (text: string, fact?: FactPayload) => {
    if (opts.alertChannel && opts.alertChatId) {
      const body = fact ? await voicedDM("anita", fact, text) : text;
      try { await opts.alertChannel.sendMessage(opts.alertChatId, body, { parseMode: "Markdown" }); } catch {}
    }
    console.log(`[AnitaNewsletterCron] ${text.replace(/\n/g, " | ").slice(0, 200)}`);
  };

  // 1. Cap check
  const cap = await getWeeklyCapStatus();
  if (cap.capped) {
    await alert(
      `📭 *Anita newsletter — skipped (cap reached)*\nSent ${cap.sends_last_7d}/3 in last 7 days. Next opportunity opens as old sends roll out.`,
      {
        action: "Newsletter cycle skipped — weekly send cap reached",
        detail: `${cap.sends_last_7d}/3 sends in last 7 days. No new issue this cycle.`,
        metric: "leads",
      },
    );
    return { status: "skipped_cap", details: `${cap.sends_last_7d}/3` };
  }

  // 2. Pick the next idea
  const pick = await pickNextIdeaToIntroduce();
  // 3. Get prior context for compose
  let priorIssues: Array<{ issue_number: number; subject: string; ideas_introduced: string[] }> = [];
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/newsletter_issues?select=issue_number,subject,ideas_introduced&status=eq.sent&order=issue_number.desc&limit=10`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (r.ok) priorIssues = (await r.json()) as any[];
    } catch {}
  }
  const issueNumber = await getNextIssueNumber();

  // 4. Compose
  const composed = await geminiComposeIssue({
    issueNumber,
    isFirstIssue: priorIssues.length === 0,
    introduceIdea: pick.next ? { id: pick.next.id, title: pick.next.title, summary: pick.next.summary } : undefined,
    expandIdea: pick.suggestExpand ? { id: pick.suggestExpand.id, title: pick.suggestExpand.title } : undefined,
    priorIssues,
  });
  if (!composed.ok) {
    await alert(
      `⚠️ *Anita newsletter — compose failed*\n${composed.error}`,
      {
        action: "Newsletter compose step failed — Gemini call did not produce a usable issue",
        detail: `Error: ${composed.error}`,
        metric: "leads",
      },
    );
    return { status: "compose_failed", details: composed.error || "unknown" };
  }

  // 5. Save draft
  const ideasIntroducedArr = pick.next ? [pick.next.id] : [];
  const ideasExpoundedArr = pick.suggestExpand ? [pick.suggestExpand.id] : [];
  const draft = await saveDraftIssue({
    issueNumber,
    subject: composed.subject!,
    preheader: composed.preheader,
    bodyHtml: composed.bodyHtml!,
    bodyPlain: composed.bodyPlain,
    ideasIntroduced: ideasIntroducedArr,
    ideasExpounded: ideasExpoundedArr,
  });
  if (!draft.ok || !draft.id) {
    await alert(
      `⚠️ *Anita newsletter — draft save failed*\n${draft.error}`,
      {
        action: "Newsletter draft save failed at the newsletter_issues insert step",
        detail: `Error: ${draft.error}`,
        metric: "leads",
      },
    );
    return { status: "draft_save_failed", details: draft.error || "unknown" };
  }

  // 6. Dry-run exit
  if (opts.dryRun) {
    await alert(
      `📝 *Anita newsletter draft saved (dry-run)*\nIssue #${issueNumber}: "${composed.subject}"\n\nNot sent — dry-run mode. Inspect newsletter_issues table.`,
      {
        action: `Newsletter issue #${issueNumber} drafted in dry-run mode (not sent)`,
        detail: `Subject: "${composed.subject}". Available in newsletter_issues for review.`,
        metric: "leads",
      },
    );
    return { status: "draft_only_dryrun", details: `issue ${issueNumber} draft id ${draft.id}` };
  }

  // 7. Get recipients
  const recipients = await listNewsletterRecipients();
  if (recipients.length === 0) {
    await alert(
      `📭 *Anita newsletter — no recipients*\nIssue #${issueNumber} drafted but \`initiates\` table has 0 valid emails. Draft saved; will not send until audience exists.`,
      {
        action: `Newsletter issue #${issueNumber} drafted but cannot ship — zero recipients in initiates table`,
        detail: `Issue is saved to newsletter_issues; will hold until at least one valid email exists.`,
        metric: "leads",
      },
    );
    return { status: "no_recipients", details: `issue ${issueNumber} drafted, 0 recipients` };
  }

  // 8. Send
  const send = await sendWithCap({
    sendType: "newsletter",
    to: recipients,
    subject: composed.subject!,
    htmlBody: composed.bodyHtml!,
    plainBody: composed.bodyPlain,
    referenceId: draft.id,
  });
  if (!send.sent) {
    await alert(
      `⚠️ *Anita newsletter — send failed*\nIssue #${issueNumber}: ${send.error}`,
      {
        action: `Newsletter issue #${issueNumber} failed to ship via Resend`,
        detail: `Error: ${send.error}`,
        metric: "leads",
      },
    );
    return { status: "send_failed", details: send.error || "unknown" };
  }

  // 9. Mark sent — also patches newsletter_ideas.introduced_in_issue_number
  // for each idea introduced in this issue (S130e). Without this, the graph
  // never compounds and pickNextIdeaToIntroduce keeps returning the same root.
  await markIssueSent(draft.id, send.resendEmailId!, recipients.length, issueNumber, ideasIntroducedArr);
  await alert(
    `📧 *Anita newsletter shipped*\n` +
    `Issue #${issueNumber}: "${composed.subject}"\n` +
    `Recipients: ${recipients.length}\n` +
    `Cap: ${(cap.sends_last_7d ?? 0) + 1}/3 in last 7 days\n` +
    `Resend ID: \`${send.resendEmailId}\``,
    {
      action: `Newsletter issue #${issueNumber} shipped to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`,
      detail: `Subject: "${composed.subject}". Cap usage: ${(cap.sends_last_7d ?? 0) + 1}/3 in last 7 days. Resend ID: ${send.resendEmailId}`,
      metric: "leads",
    },
  );
  return { status: "sent", details: `issue ${issueNumber} → ${recipients.length} recipients` };
}
