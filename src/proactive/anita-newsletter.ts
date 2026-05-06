// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Anita Newsletter System (S131 realignment, 2026-05-06)
//
// Realignment swept four drift points that accumulated from the 5/1 brand
// voice fix:
//   1. Compose function hardcoded the OLD dark email wrapper. Replaced with
//      structured-content + light-canonical email renderer per
//      .claude/skills/brand-identity/resources/email-templates.md.
//   2. Recipient list read from `initiates` only. Now unions
//      `newsletter_subscribers` + `initiates`, deduped, unsubscribed excluded.
//   3. `bot_active_state.active_format` for anita pointed at a key removed
//      from prompt-pieces.json. Realigned to `email_html_light_canonical`
//      via DB migration.
//   4. Idea graph treated mechanisms and foundations as one linear queue.
//      Now `kind` column splits them: 9 mechanism rows (issues 02-10) get
//      pulled in `mechanism_sequence` order; foundations stay pinned and
//      never auto-pick. Compose enters open mode after the queue exhausts.
//
// New: `publishToWebsite()` writes each new issue as
// `/newsletter/{slug}/index.html` and prepends it to `/newsletter/index.html`
// in the sovereign-landing repo via GitHub Contents API. Graceful no-op when
// `GITHUB_TOKEN` is unset.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";
import { voicedDM, type FactPayload } from "../channels/agent-voice";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "Sovereign Synthesis <ace@sovereign-synthesis.com>";
const WEEKLY_CAP = 3;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || "7acerich1-creator";
const GITHUB_REPO = process.env.GITHUB_REPO || "sovereign-landing";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const SITE_BASE_URL = "https://sovereign-synthesis.com";

type SendType = "newsletter" | "inbound_reply" | "nurture_step" | "broadcast";

interface CapStatus {
  sends_last_7d: number;
  budget_remaining: number;
  capped: boolean;
}

export interface NewsletterContent {
  issueNumber: number;
  slug: string;
  ideaSlug: string;
  subject: string;
  preheader: string;
  publishedDate: string;
  headline: string;
  dek: string;
  sections: Array<{
    marker: string;
    paragraphs: string[];
  }>;
  cta: {
    buttonText: string;
    url: string;
  };
  closing: string;
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
export async function sendWithCap(input: {
  sendType: SendType;
  to: string | string[];
  subject: string;
  htmlBody: string;
  plainBody?: string;
  referenceId?: string;
  bypassCap?: boolean;
}): Promise<{ sent: boolean; resendEmailId?: string; error?: string; capStatus?: CapStatus }> {
  if (!RESEND_API_KEY) return { sent: false, error: "RESEND_API_KEY not set" };

  let capStatus: CapStatus | undefined;
  if (!input.bypassCap && input.sendType !== "inbound_reply") {
    capStatus = await getWeeklyCapStatus();
    if (capStatus.capped) {
      return {
        sent: false,
        error: `Weekly send cap reached (${capStatus.sends_last_7d}/${WEEKLY_CAP} sent in last 7 days). This send is blocked.`,
        capStatus,
      };
    }
  }

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

// ── 3. Picker (kind-aware) ─────────────────────────────────────────────────
type PickResult =
  | { mode: "mechanism"; idea: { id: string; slug: string; title: string; summary: string; cta_path: string | null }; reason: string }
  | { mode: "open"; reason: string }
  | { mode: "error"; reason: string };

export async function pickNextIdeaToIntroduce(): Promise<PickResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { mode: "error", reason: "Supabase not configured" };

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/newsletter_ideas?kind=eq.mechanism&introduced_in_issue_number=is.null&select=id,slug,title,summary,cta_path,mechanism_sequence&order=mechanism_sequence.asc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return { mode: "error", reason: `query failed: ${resp.status}` };
    const ideas = (await resp.json()) as Array<{
      id: string; slug: string; title: string; summary: string;
      cta_path: string | null; mechanism_sequence: number;
    }>;

    if (ideas.length > 0) {
      const pick = ideas[0];
      return {
        mode: "mechanism",
        idea: { id: pick.id, slug: pick.slug, title: pick.title, summary: pick.summary, cta_path: pick.cta_path },
        reason: `next mechanism in sequence (${pick.mechanism_sequence})`,
      };
    }

    return { mode: "open", reason: "mechanism queue exhausted — open mode" };
  } catch (err: any) {
    return { mode: "error", reason: err.message };
  }
}

// ── 4. Get next issue number ──────────────────────────────────────────────
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

// ── 5. Foundations (pinned reference library) ─────────────────────────────
async function loadFoundations(): Promise<Array<{ slug: string; title: string; summary: string }>> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/newsletter_ideas?kind=eq.foundation&select=slug,title,summary&order=created_at.asc`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return [];
    return (await resp.json()) as Array<{ slug: string; title: string; summary: string }>;
  } catch {
    return [];
  }
}

// ── 6. Recipient union ────────────────────────────────────────────────────
export async function listNewsletterRecipients(): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const seen = new Set<string>();

  try {
    const r1 = await fetch(
      `${SUPABASE_URL}/rest/v1/newsletter_subscribers?select=email&status=eq.active&unsubscribed_at=is.null`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (r1.ok) {
      const rows = (await r1.json()) as Array<{ email: string }>;
      for (const row of rows) {
        const e = (row.email || "").trim().toLowerCase();
        if (e) seen.add(e);
      }
    }
  } catch (err: any) {
    console.error(`[AnitaRecipients] newsletter_subscribers fetch failed: ${err.message}`);
  }

  try {
    const r2 = await fetch(
      `${SUPABASE_URL}/rest/v1/initiates?select=email&payment_status=neq.unsubscribed`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (r2.ok) {
      const rows = (await r2.json()) as Array<{ email: string | null }>;
      for (const row of rows) {
        const e = (row.email || "").trim().toLowerCase();
        if (e) seen.add(e);
      }
    }
  } catch (err: any) {
    console.error(`[AnitaRecipients] initiates fetch failed: ${err.message}`);
  }

  return Array.from(seen);
}

// ── 7. Slug derivation ────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatPublishDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

// ── 8. Compose via Gemini → structured content ────────────────────────────
async function composeIssueContent(input: {
  issueNumber: number;
  mode: "mechanism" | "open";
  mechanism?: { slug: string; title: string; summary: string; cta_path: string | null };
  priorIssues: Array<{ issue_number: number; subject: string; ideas_introduced: string[] }>;
  foundations: Array<{ slug: string; title: string; summary: string }>;
}): Promise<{ ok: boolean; content?: NewsletterContent; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY not set" };

  const priorContext = input.priorIssues.length === 0
    ? "This is the foundational issue. Establish the frame."
    : `Prior issues established (most recent first): ${input.priorIssues.slice(-5).map((i) => `#${i.issue_number} "${i.subject}"`).join(" | ")}`;

  const foundationContext = input.foundations.length === 0
    ? ""
    : `Foundational concepts (pinned, all-season, you may reference but do NOT introduce these as if new):\n${input.foundations.map((f) => `  - ${f.title} (${f.slug}): ${f.summary}`).join("\n")}\n`;

  const focusInstruction = input.mode === "mechanism" && input.mechanism
    ? `THIS ISSUE INTRODUCES one specific mechanism: "${input.mechanism.title}".

Mechanism summary (from the editorial graph):
${input.mechanism.summary}

CTA destination: ${input.mechanism.cta_path || "/diagnostic"}

Editorial structure (per the Anita newsletter spec):
  - Section 1: open with a question or scene the reader recognizes — the body-level signal of this mechanism. They feel it before they have words for it.
  - Section 2: name the mechanism explicitly. Plain English. Mom Test enforced — a smart adult outside the sovereignty subculture must understand every sentence on first read.
  - Section 3: the first move out — what naming it changes. Not a fix-it-all promise. Just the door.
  - Close with a single line that activates.
  - Total length under 400 words across all three sections. Short, dense, repeatable.
  - Section markers (you choose): something like "Welcome · Scarcity", "Defense · Blueprint", "Activation" — three short kicker labels separated by ·`
    : `THE MECHANISM QUEUE IS EXHAUSTED — open mode.

Compose freely in character. You may:
  - Observe a new mechanism you have noticed in the field that has not been named in prior issues.
  - Deepen a prior mechanism by threading it to a foundation or to another mechanism.
  - Surface a contradiction the framework has not yet addressed.

Voice rules in force. Mom Test mandatory. 3-section structure (body-signal → name → first-move-out). CTA destination: pick the funnel rung that fits — /diagnostic for pattern-naming issues, /protocol-zero for awareness-installation issues, /p77 for defensive-architecture issues, /manifesto-portal for synthesis or pivot issues.`;

  const prompt = `You are Anita, copy specialist for Sovereign Synthesis. You write a compounding-mechanism newsletter — every issue names ONE thing that was operating invisibly. By the time a reader has consumed twenty issues they have twenty things named that nobody around them can name. That is the function.

Voice: cynical, sharp, dark humor, anti-circle. NEVER marketing jargon ("limited time", "unlock", "transform your life", "last chance" are all banned). Copy that names the loop and shows the move out. The reader is sophisticated; treat them that way.

Issue #${input.issueNumber}. ${priorContext}

${foundationContext}${focusInstruction}

Output STRICT JSON matching this shape, no other text:
{
  "subject": "<email subject line, max 60 chars, no emoji>",
  "preheader": "<inbox preview, 60-110 chars>",
  "headline": "<the issue title, may exceed subject in length>",
  "dek": "<one italic subhead line introducing the mechanism, max 120 chars>",
  "sections": [
    { "marker": "<section 1 kicker, 2-3 words separated by ·>", "paragraphs": ["<para>", "<para>"] },
    { "marker": "<section 2 kicker>", "paragraphs": ["<para>"] },
    { "marker": "<section 3 kicker>", "paragraphs": ["<para>"] }
  ],
  "cta": {
    "buttonText": "<short uppercase-friendly verb phrase, e.g. 'See the code'>",
    "url": "${input.mode === "mechanism" && input.mechanism?.cta_path ? input.mechanism.cta_path : "/diagnostic"}"
  },
  "closing": "<one line that lands the issue, no signature — that is added separately>"
}`;

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

    if (!parsed.subject || !parsed.headline || !Array.isArray(parsed.sections) || parsed.sections.length < 1) {
      return { ok: false, error: "Gemini output missing required fields (subject/headline/sections)" };
    }

    const slug = slugify(parsed.headline);
    if (!slug) return { ok: false, error: `slugify produced empty result for headline: "${parsed.headline}"` };

    const content: NewsletterContent = {
      issueNumber: input.issueNumber,
      slug,
      ideaSlug: input.mode === "mechanism" && input.mechanism ? input.mechanism.slug : "open",
      subject: String(parsed.subject).slice(0, 80),
      preheader: String(parsed.preheader || ""),
      publishedDate: new Date().toISOString().slice(0, 10),
      headline: String(parsed.headline),
      dek: String(parsed.dek || parsed.preheader || ""),
      sections: (parsed.sections as any[]).slice(0, 3).map((s) => ({
        marker: String(s.marker || ""),
        paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs.map(String) : [String(s.paragraphs || "")],
      })),
      cta: {
        buttonText: String(parsed.cta?.buttonText || "See the code"),
        url: String(parsed.cta?.url || "/diagnostic"),
      },
      closing: String(parsed.closing || ""),
    };
    return { ok: true, content };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── 9. Email renderer (light canonical) ───────────────────────────────────
export function renderNewsletterEmail(c: NewsletterContent): string {
  const fullCtaUrl = c.cta.url.startsWith("http") ? c.cta.url : `${SITE_BASE_URL}${c.cta.url}`;
  const headerTag = `Transmission #${c.issueNumber}`;

  const sectionsHtml = c.sections.map((s) => `
              <p style="margin:32px 0 14px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#E5850F;font-weight:700;">${escapeHtml(s.marker)}</p>
              ${s.paragraphs.map((p) => `<p style="margin:0 0 18px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#3A3A3A;">${escapeHtml(p)}</p>`).join("\n              ")}`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f4f0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1a2e;">

  <div style="display:none;font-size:1px;color:#f5f4f0;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${escapeHtml(c.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f4f0;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #ddd8d0;border-radius:8px;overflow:hidden;">

          <tr>
            <td style="background-color:#ffffff;padding:28px 40px;border-bottom:1px solid #ddd8d0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td><span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E5850F;">SOVEREIGN SYNTHESIS</span></td>
                  <td align="right"><span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#8E8C9A;letter-spacing:2px;text-transform:uppercase;">${escapeHtml(headerTag)}</span></td>
                </tr>
              </table>
            </td>
          </tr>

          <tr><td style="height:3px;background-color:#d4a843;font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td style="padding:48px 40px 8px 40px;">
              <h1 style="margin:0 0 14px 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:600;color:#1a1a2e;line-height:1.25;letter-spacing:-0.3px;">${escapeHtml(c.headline)}</h1>
              <p style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:17px;line-height:1.6;color:#555555;">${escapeHtml(c.dek)}</p>
${sectionsHtml}
            </td>
          </tr>

          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#d4a843;border-radius:4px;">
                    <a href="${escapeHtml(fullCtaUrl)}" style="display:inline-block;padding:16px 36px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#1a1a2e;text-decoration:none;">${escapeHtml(c.cta.buttonText)} &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#8E8C9A;line-height:1.6;">
                If the button doesn't work, paste this into your browser:<br/>
                <a href="${escapeHtml(fullCtaUrl)}" style="color:#E5850F;text-decoration:underline;word-break:break-all;">${escapeHtml(fullCtaUrl)}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 40px 40px 40px;">
              ${c.closing ? `<p style="margin:0 0 14px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#3A3A3A;">${escapeHtml(c.closing)}</p>` : ""}
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#1a1a2e;font-weight:600;">— Ace</p>
              <p style="margin:4px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;color:#8E8C9A;letter-spacing:1px;">Sovereign Synthesis</p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#f5f4f0;padding:24px 40px;border-top:1px solid #ddd8d0;">
              <p style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#8E8C9A;line-height:1.6;text-align:center;">
                You're receiving this because you entered your email at sovereign-synthesis.com.<br/>
                <a href="https://sovereign-synthesis.com/unsubscribe" style="color:#8E8C9A;text-decoration:underline;">Unsubscribe</a>
              </p>
              <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#aaaaaa;text-align:center;letter-spacing:2px;text-transform:uppercase;">
                Sovereign Synthesis · sovereign-synthesis.com
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

export function renderNewsletterEmailPlain(c: NewsletterContent): string {
  const fullCtaUrl = c.cta.url.startsWith("http") ? c.cta.url : `${SITE_BASE_URL}${c.cta.url}`;
  const sections = c.sections.map((s) => `${s.marker.toUpperCase()}\n\n${s.paragraphs.join("\n\n")}`).join("\n\n");
  return `${c.headline}\n\n${c.dek}\n\n${sections}\n\n${c.cta.buttonText}: ${fullCtaUrl}\n\n${c.closing}\n\n— Ace\nSovereign Synthesis\n\nUnsubscribe: ${SITE_BASE_URL}/unsubscribe`;
}

// ── 10. Web page renderer ──────────────────────────────────────────────────
export function renderNewsletterWebPage(c: NewsletterContent): string {
  const issueLabel = String(c.issueNumber).padStart(2, "0");
  const dateLabel = formatPublishDate(c.publishedDate);
  const fullCtaUrl = c.cta.url;
  const sectionsHtml = c.sections.map((s) => `    <span class="section-marker">${escapeHtml(s.marker)}</span>

${s.paragraphs.map((p) => `    <p>${escapeHtml(p)}</p>`).join("\n\n")}`).join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(c.headline)} | Newsletter | Sovereign Synthesis</title>
<meta name="description" content="${escapeHtml(c.preheader)}" />
<link rel="canonical" href="${SITE_BASE_URL}/newsletter/${escapeHtml(c.slug)}" />
<link rel="stylesheet" href="/css/sovereign.css" />
<style>
  .article-meta { text-align: center; padding: 80px 0 24px; border-bottom: 1px solid var(--border); margin-bottom: 48px; }
  .article-num { font-family: var(--mono); font-size: 11px; letter-spacing: 3px; color: var(--gold); font-weight: 700; text-transform: uppercase; margin-bottom: 18px; display: block; }
  .article-title { font-family: var(--serif); font-size: clamp(36px, 6vw, 56px); font-weight: 600; line-height: 1.1; letter-spacing: -0.6px; color: var(--text); margin: 0 auto 20px; max-width: 760px; }
  .article-dek { font-family: var(--serif); font-style: italic; font-size: 19px; color: var(--body-dim); line-height: 1.5; max-width: 620px; margin: 0 auto 22px; }
  .article-date { font-family: var(--mono); font-size: 10px; letter-spacing: 2px; color: var(--muted); text-transform: uppercase; }
  .article-body { max-width: 660px; margin: 0 auto; }
  .article-body p { font-family: var(--serif); font-size: 19px; line-height: 1.7; color: var(--body); margin: 0 0 22px; }
  .article-body p:first-of-type::first-letter { font-family: var(--serif); font-weight: 700; font-size: 64px; float: left; line-height: 0.85; margin: 4px 8px -4px 0; color: var(--gold); }
  .section-marker { font-family: var(--mono); font-size: 11px; letter-spacing: 3px; color: var(--gold); font-weight: 700; text-transform: uppercase; text-align: center; margin: 48px 0 24px; display: block; padding: 14px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .article-cta { text-align: center; margin: 48px auto 24px; max-width: 660px; }
  .article-cta a { display: inline-block; font-family: var(--sans); font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text); text-decoration: none; background: var(--gold); padding: 16px 36px; border-radius: var(--radius-sm); }
  .article-cta a:hover { opacity: 0.9; }
  .article-signoff { max-width: 660px; margin: 56px auto 0; padding: 32px 0; border-top: 1px solid var(--border); text-align: left; font-family: var(--serif); font-size: 16px; color: var(--body-dim); line-height: 1.6; }
  .article-signoff strong { color: var(--text); font-weight: 600; }
  .article-nav { max-width: 660px; margin: 24px auto 48px; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 24px 0; border-top: 1px solid var(--border); }
  .article-nav a { font-family: var(--mono); font-size: 11px; letter-spacing: 1.5px; color: var(--muted); text-decoration: none; font-weight: 700; text-transform: uppercase; }
  .article-nav a:hover { color: var(--gold); }
</style>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>

<div class="top">
  <div class="top-inner">
    <a href="/" class="wordmark">Sovereign Synthesis</a>
    <nav class="nav">
      <a href="/about">About</a>
      <a href="/diagnostic">Diagnostic</a>
      <a href="/p77">Protocol 77</a>
      <a href="/newsletter">Newsletter</a>
      <a href="/members">Members</a>
    </nav>
  </div>
</div>
<div class="gold-line"></div>

<article>
  <header class="article-meta">
    <span class="article-num">Edition ${issueLabel} · Newsletter</span>
    <h1 class="article-title">${escapeHtml(c.headline)}</h1>
    <p class="article-dek">${escapeHtml(c.dek)}</p>
    <span class="article-date">${escapeHtml(dateLabel)}</span>
  </header>

  <div class="article-body">

${sectionsHtml}

    <div class="article-cta">
      <a href="${escapeHtml(fullCtaUrl)}">${escapeHtml(c.cta.buttonText)} &rarr;</a>
    </div>

    <div class="article-signoff">
      <p>${escapeHtml(c.closing)}</p>
      <p style="margin-top:24px;"><strong>&mdash; Ace</strong><br/>Sovereign Synthesis</p>
    </div>

  </div>

  <div class="article-nav">
    <a href="/newsletter">&larr; All editions</a>
    <span style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;">Edition ${issueLabel}</span>
    <span style="opacity:0.4;">Next &rarr;</span>
  </div>
</article>

<footer>
  <div class="foot-inner">
    <p>
      <a href="/about">About</a>
      <a href="/diagnostic">Diagnostic</a>
      <a href="/p77">Protocol 77</a>
      <a href="/newsletter">Newsletter</a>
      <a href="/members">Members</a>
      <a href="/unsubscribe">Unsubscribe</a>
    </p>
    <p style="margin-top: 16px; color: #aaaaaa;">© Sovereign Synthesis · sovereign-synthesis.com</p>
  </div>
</footer>

</body>
</html>
`;
}

// ── 11. Save draft issue ──────────────────────────────────────────────────
export async function saveDraftIssue(input: {
  issueNumber: number;
  content: NewsletterContent;
  bodyHtml: string;
  bodyPlain: string;
  ideasIntroduced: string[];
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
        slug: input.content.slug,
        subject: input.content.subject,
        preheader: input.content.preheader,
        body_html: input.bodyHtml,
        body_plain: input.bodyPlain,
        structured_content: input.content,
        ideas_introduced: input.ideasIntroduced,
        ideas_expounded: [],
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

// ── 12. Mark issue sent + idea-graph patch + publish-to-website ───────────
export async function markIssueSent(
  issueId: string,
  resendEmailId: string,
  recipientCount: number,
  issueNumber: number,
  ideasIntroduced: string[],
  content: NewsletterContent,
): Promise<{ webPublishStatus: "ok" | "skipped_no_token" | "failed"; webPublishError?: string }> {
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/newsletter_issues?id=eq.${issueId}`, {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), recipient_count: recipientCount }),
      });
    } catch (err: any) {
      console.error(`[AnitaSend] markIssueSent (issues PATCH) failed: ${err.message}`);
    }

    if (ideasIntroduced.length > 0) {
      for (const ideaId of ideasIntroduced) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/newsletter_ideas?id=eq.${ideaId}`, {
            method: "PATCH",
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ introduced_in_issue_number: issueNumber }),
          });
          console.log(`[AnitaSend] idea-graph: marked ${ideaId.slice(0, 8)}… as introduced in issue #${issueNumber}`);
        } catch (err: any) {
          console.error(`[AnitaSend] markIssueSent (ideas PATCH ${ideaId}) failed: ${err.message}`);
        }
      }
    }
  }

  const pub = await publishToWebsite(content);

  if (pub.status === "ok" && SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/newsletter_issues?id=eq.${issueId}`, {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          published_to_website_at: new Date().toISOString(),
          web_archive_url: `${SITE_BASE_URL}/newsletter/${content.slug}/`,
        }),
      });
    } catch (err: any) {
      console.error(`[AnitaPublish] mark-published PATCH failed: ${err.message}`);
    }
  }

  return { webPublishStatus: pub.status, webPublishError: pub.error };
}

// ── 13. publishToWebsite (GitHub Contents API) ────────────────────────────
async function publishToWebsite(c: NewsletterContent): Promise<{ status: "ok" | "skipped_no_token" | "failed"; error?: string }> {
  if (!GITHUB_TOKEN) {
    console.warn(`[AnitaPublish] GITHUB_TOKEN not set — skipping web publish for issue #${c.issueNumber} ("${c.slug}"). Set GITHUB_TOKEN on Railway to enable.`);
    return { status: "skipped_no_token" };
  }

  const ghBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
  const ghHeaders = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  const articleHtml = renderNewsletterWebPage(c);
  const articlePath = `newsletter/${c.slug}/index.html`;

  try {
    let articleSha: string | undefined;
    try {
      const probe = await fetch(`${ghBase}/${articlePath}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });
      if (probe.ok) {
        const data = (await probe.json()) as any;
        articleSha = data.sha;
      }
    } catch {}

    const articleBody: any = {
      message: `newsletter: publish issue #${c.issueNumber} — ${c.slug}`,
      content: b64(articleHtml),
      branch: GITHUB_BRANCH,
    };
    if (articleSha) articleBody.sha = articleSha;

    const articleResp = await fetch(`${ghBase}/${articlePath}`, {
      method: "PUT",
      headers: ghHeaders,
      body: JSON.stringify(articleBody),
    });
    if (!articleResp.ok) {
      const errText = (await articleResp.text()).slice(0, 300);
      return { status: "failed", error: `article PUT ${articleResp.status}: ${errText}` };
    }
  } catch (err: any) {
    return { status: "failed", error: `article publish: ${err.message}` };
  }

  try {
    const indexPath = `newsletter/index.html`;
    const indexResp = await fetch(`${ghBase}/${indexPath}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });
    if (!indexResp.ok) {
      return { status: "failed", error: `index GET ${indexResp.status}: ${(await indexResp.text()).slice(0, 200)}` };
    }
    const indexData = (await indexResp.json()) as any;
    const currentIndexHtml = Buffer.from(indexData.content, "base64").toString("utf8");
    const indexSha = indexData.sha;

    const newRowHtml = renderArchiveRow(c);
    const updatedIndexHtml = injectRowIntoArchive(currentIndexHtml, newRowHtml, c.slug);
    if (updatedIndexHtml === currentIndexHtml) {
      console.log(`[AnitaPublish] archive index already contains row for ${c.slug} — skipping update`);
    } else {
      const indexPutResp = await fetch(`${ghBase}/${indexPath}`, {
        method: "PUT",
        headers: ghHeaders,
        body: JSON.stringify({
          message: `newsletter: link issue #${c.issueNumber} into archive`,
          content: b64(updatedIndexHtml),
          branch: GITHUB_BRANCH,
          sha: indexSha,
        }),
      });
      if (!indexPutResp.ok) {
        const errText = (await indexPutResp.text()).slice(0, 300);
        return { status: "failed", error: `index PUT ${indexPutResp.status}: ${errText}` };
      }
    }
  } catch (err: any) {
    return { status: "failed", error: `index update: ${err.message}` };
  }

  console.log(`[AnitaPublish] ✅ Published issue #${c.issueNumber} → ${SITE_BASE_URL}/newsletter/${c.slug}/`);
  return { status: "ok" };
}

function renderArchiveRow(c: NewsletterContent): string {
  const num = String(c.issueNumber).padStart(2, "0");
  const date = formatPublishDate(c.publishedDate);
  return `    <a href="/newsletter/${escapeHtml(c.slug)}/" class="news-row">
      <span class="news-num">${num}</span>
      <div class="news-meta">
        <span class="news-date">${escapeHtml(date)}</span>
        <p class="news-title">${escapeHtml(c.headline)}</p>
        <p class="news-dek">${escapeHtml(c.dek)}</p>
      </div>
      <span class="news-arrow">Read &rarr;</span>
    </a>

`;
}

function injectRowIntoArchive(currentHtml: string, newRow: string, slug: string): string {
  if (currentHtml.includes(`/newsletter/${slug}/`)) return currentHtml;
  const marker = `<div class="news-list">`;
  const idx = currentHtml.indexOf(marker);
  if (idx === -1) {
    console.error(`[AnitaPublish] archive index missing news-list marker — cannot inject row`);
    return currentHtml;
  }
  const insertPos = idx + marker.length;
  return currentHtml.slice(0, insertPos) + "\n\n" + newRow + currentHtml.slice(insertPos);
}

// ── 14. Weekly cron orchestrator ──────────────────────────────────────────
export async function runWeeklyNewsletterCycle(opts: {
  alertChannel?: Channel;
  alertChatId?: string;
  dryRun?: boolean;
}): Promise<{ status: string; details: string }> {
  const alert = async (text: string, fact?: FactPayload) => {
    if (opts.alertChannel && opts.alertChatId) {
      const body = fact ? await voicedDM("anita", fact, text) : text;
      try { await opts.alertChannel.sendMessage(opts.alertChatId, body, { parseMode: "Markdown" }); } catch {}
    }
    console.log(`[AnitaNewsletterCron] ${text.replace(/\n/g, " | ").slice(0, 200)}`);
  };

  const cap = await getWeeklyCapStatus();
  if (cap.capped) {
    await alert(
      `📭 *Anita newsletter — skipped (cap reached)*\nSent ${cap.sends_last_7d}/3 in last 7 days.`,
      { action: "Newsletter cycle skipped — weekly send cap reached", detail: `${cap.sends_last_7d}/3 in last 7 days`, metric: "leads" },
    );
    return { status: "skipped_cap", details: `${cap.sends_last_7d}/3` };
  }

  const pick = await pickNextIdeaToIntroduce();
  if (pick.mode === "error") {
    await alert(
      `⚠️ *Anita newsletter — picker error*\n${pick.reason}`,
      { action: "Newsletter picker errored", detail: pick.reason, metric: "leads" },
    );
    return { status: "picker_error", details: pick.reason };
  }

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
  const foundations = await loadFoundations();
  const issueNumber = await getNextIssueNumber();

  const composed = await composeIssueContent({
    issueNumber,
    mode: pick.mode === "mechanism" ? "mechanism" : "open",
    mechanism: pick.mode === "mechanism" ? pick.idea : undefined,
    priorIssues,
    foundations,
  });
  if (!composed.ok || !composed.content) {
    await alert(
      `⚠️ *Anita newsletter — compose failed*\n${composed.error}`,
      { action: "Newsletter compose step failed", detail: composed.error || "unknown", metric: "leads" },
    );
    return { status: "compose_failed", details: composed.error || "unknown" };
  }

  const emailHtml = renderNewsletterEmail(composed.content);
  const emailPlain = renderNewsletterEmailPlain(composed.content);
  const ideasIntroducedArr = pick.mode === "mechanism" ? [pick.idea.id] : [];

  const draft = await saveDraftIssue({
    issueNumber,
    content: composed.content,
    bodyHtml: emailHtml,
    bodyPlain: emailPlain,
    ideasIntroduced: ideasIntroducedArr,
  });
  if (!draft.ok || !draft.id) {
    await alert(
      `⚠️ *Anita newsletter — draft save failed*\n${draft.error}`,
      { action: "Newsletter draft save failed", detail: draft.error || "unknown", metric: "leads" },
    );
    return { status: "draft_save_failed", details: draft.error || "unknown" };
  }

  if (opts.dryRun) {
    await alert(
      `📝 *Anita newsletter draft saved (dry-run)*\nIssue #${issueNumber}: "${composed.content.subject}"\n\nNot sent — dry-run.`,
      { action: `Newsletter issue #${issueNumber} drafted in dry-run`, detail: `Subject: "${composed.content.subject}"`, metric: "leads" },
    );
    return { status: "draft_only_dryrun", details: `issue ${issueNumber} draft id ${draft.id}` };
  }

  const recipients = await listNewsletterRecipients();
  if (recipients.length === 0) {
    await alert(
      `📭 *Anita newsletter — no recipients*\nIssue #${issueNumber} drafted but recipient union returned 0. Draft saved.`,
      { action: `Newsletter issue #${issueNumber} drafted but cannot ship — zero recipients`, detail: `Draft saved; will hold until at least one valid email exists.`, metric: "leads" },
    );
    return { status: "no_recipients", details: `issue ${issueNumber} drafted, 0 recipients` };
  }

  const send = await sendWithCap({
    sendType: "newsletter",
    to: recipients,
    subject: composed.content.subject,
    htmlBody: emailHtml,
    plainBody: emailPlain,
    referenceId: draft.id,
  });
  if (!send.sent) {
    await alert(
      `⚠️ *Anita newsletter — send failed*\nIssue #${issueNumber}: ${send.error}`,
      { action: `Newsletter issue #${issueNumber} failed to ship via Resend`, detail: send.error || "unknown", metric: "leads" },
    );
    return { status: "send_failed", details: send.error || "unknown" };
  }

  const post = await markIssueSent(draft.id, send.resendEmailId!, recipients.length, issueNumber, ideasIntroducedArr, composed.content);

  const publishLine = post.webPublishStatus === "ok"
    ? `Web: ${SITE_BASE_URL}/newsletter/${composed.content.slug}/`
    : post.webPublishStatus === "skipped_no_token"
      ? `Web: SKIPPED (GITHUB_TOKEN not set on Railway)`
      : `Web: FAILED — ${post.webPublishError}`;

  await alert(
    `📧 *Anita newsletter shipped*\n` +
    `Issue #${issueNumber}: "${composed.content.subject}"\n` +
    `Mode: ${pick.mode}${pick.mode === "mechanism" ? ` (${pick.idea.slug})` : ""}\n` +
    `Recipients: ${recipients.length}\n` +
    `Cap: ${(cap.sends_last_7d ?? 0) + 1}/3 in last 7 days\n` +
    `Resend ID: \`${send.resendEmailId}\`\n` +
    publishLine,
    {
      action: `Newsletter issue #${issueNumber} shipped to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`,
      detail: `Subject: "${composed.content.subject}". Cap usage: ${(cap.sends_last_7d ?? 0) + 1}/3. ${publishLine}`,
      metric: "leads",
    },
  );
  return { status: "sent", details: `issue ${issueNumber} → ${recipients.length} recipients (${publishLine})` };
}
