// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Gmail Tools
// Session 114 — 2026-04-24
//
// Inbox + Search + Draft + Send. Uses both Google accounts via the
// account_label parameter on every call.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { getValidGoogleAccessToken, type SapphireAccountLabel } from "../../proactive/sapphire-oauth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

function parseAccountLabel(input: unknown): SapphireAccountLabel | null {
  const s = String(input || "").toLowerCase().trim();
  if (s.includes("empower") || s === "primary" || s === "personal") return "empoweredservices2013";
  if (s.includes("7ace") || s.includes("ace") || s === "secondary" || s === "sovereign") return "7ace.rich1";
  if (s === "empoweredservices2013") return "empoweredservices2013";
  if (s === "7ace.rich1") return "7ace.rich1";
  return null;
}

async function gmailFetch(
  account: SapphireAccountLabel,
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const tokenRes = await getValidGoogleAccessToken(account);
  if (!tokenRes.ok) return { ok: false, error: tokenRes.error };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenRes.token}`,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };

  const opts: RequestInit = { ...init, headers };
  if (init.jsonBody !== undefined) opts.body = JSON.stringify(init.jsonBody);

  let resp: Response;
  try {
    resp = await fetch(`${GMAIL_API}${path}`, opts);
  } catch (e: any) {
    return { ok: false, error: `Gmail network error: ${e.message}` };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unreadable>");
    return { ok: false, error: `Gmail ${resp.status}: ${body.slice(0, 300)}` };
  }
  const data = await resp.json();
  return { ok: true, data };
}

function decodeBase64Url(s: string): string {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractSnippet(payload: any, maxLen = 200): string {
  // Try snippet field first, fall back to body decode
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data).slice(0, maxLen);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data).slice(0, maxLen);
      }
    }
  }
  return "";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIST INBOX
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class GmailInboxTool implements Tool {
  definition: ToolDefinition = {
    name: "gmail_inbox",
    description:
      "List recent emails from Ace's Gmail inbox. ONLY call when he explicitly asks 'any new emails', 'check my email', 'anything important come in', or similar — OR when needed to answer a specific email-related question. Do NOT call by default on greetings or unrelated chat. Returns sender, subject, snippet, received time. Defaults to unread + last 24h.",
    parameters: {
      account: { type: "string", description: "Which account: 'primary' (empoweredservices2013), 'secondary' (7ace.rich1), or 'both'." },
      max: { type: "number", description: "Max emails to return per account. Default 10, max 25." },
      unread_only: { type: "boolean", description: "Only show unread. Default true." },
      hours_back: { type: "number", description: "Look back this many hours. Default 24." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const accountInput = String(args.account || "both").toLowerCase();
    const max = Math.min(Number(args.max) || 10, 25);
    const unreadOnly = args.unread_only !== false;
    const hoursBack = Number(args.hours_back) || 24;

    const accounts: SapphireAccountLabel[] = accountInput === "both"
      ? ["empoweredservices2013", "7ace.rich1"]
      : (() => {
          const a = parseAccountLabel(accountInput);
          return a ? [a] : ["empoweredservices2013", "7ace.rich1"] as SapphireAccountLabel[];
        })();

    const results: string[] = [];

    for (const account of accounts) {
      const queryParts: string[] = [];
      if (unreadOnly) queryParts.push("is:unread");
      if (hoursBack) queryParts.push(`newer_than:${Math.ceil(hoursBack / 24)}d`);
      queryParts.push("-category:promotions -category:social");
      const q = queryParts.join(" ");

      const list = await gmailFetch(account, `/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
      if (!list.ok) {
        results.push(`[${account}] error: ${list.error}`);
        continue;
      }
      const ids = (list.data.messages as Array<{ id: string }>) || [];
      if (ids.length === 0) {
        results.push(`[${account}] No matching emails.`);
        continue;
      }

      const lines: string[] = [`[${account}] ${ids.length} email${ids.length === 1 ? "" : "s"}:`];
      for (const { id } of ids.slice(0, max)) {
        const msg = await gmailFetch(account, `/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        if (!msg.ok) continue;
        const headers = (msg.data.payload?.headers as Array<{ name: string; value: string }>) || [];
        const from = extractHeader(headers, "From").replace(/<.*>/, "").trim() || "(unknown)";
        const subject = extractHeader(headers, "Subject") || "(no subject)";
        const snippet = (msg.data.snippet || "").slice(0, 100);
        lines.push(`  • ${from}: ${subject}`);
        if (snippet) lines.push(`    ${snippet}`);
      }
      results.push(lines.join("\n"));
    }

    return results.join("\n\n");
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEARCH GMAIL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class GmailSearchTool implements Tool {
  definition: ToolDefinition = {
    name: "gmail_search",
    description:
      "Search Ace's Gmail using Gmail's native search syntax (e.g., 'from:school subject:permission', 'has:attachment newer_than:7d').",
    parameters: {
      account: { type: "string", description: "'primary', 'secondary', or 'both'." },
      query: { type: "string", description: "Gmail search query." },
      max: { type: "number", description: "Max results. Default 10, max 25." },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const accountInput = String(args.account || "both").toLowerCase();
    const query = String(args.query || "").trim();
    const max = Math.min(Number(args.max) || 10, 25);
    if (!query) return "gmail_search: query required.";

    const accounts: SapphireAccountLabel[] = accountInput === "both"
      ? ["empoweredservices2013", "7ace.rich1"]
      : ((): SapphireAccountLabel[] => {
          const a = parseAccountLabel(accountInput);
          return a ? [a] : ["empoweredservices2013", "7ace.rich1"];
        })();

    const out: string[] = [];
    for (const account of accounts) {
      const list = await gmailFetch(account, `/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
      if (!list.ok) { out.push(`[${account}] ${list.error}`); continue; }
      const ids = (list.data.messages as Array<{ id: string }>) || [];
      if (ids.length === 0) { out.push(`[${account}] No matches.`); continue; }
      const lines: string[] = [`[${account}] ${ids.length} match${ids.length === 1 ? "" : "es"}:`];
      for (const { id } of ids) {
        const msg = await gmailFetch(account, `/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        if (!msg.ok) continue;
        const headers = (msg.data.payload?.headers as Array<{ name: string; value: string }>) || [];
        const from = extractHeader(headers, "From").replace(/<.*>/, "").trim() || "(unknown)";
        const subject = extractHeader(headers, "Subject") || "(no subject)";
        const date = extractHeader(headers, "Date");
        lines.push(`  • ${from} — ${subject} ${date ? `(${date})` : ""}`);
      }
      out.push(lines.join("\n"));
    }
    return out.join("\n\n");
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEND / DRAFT EMAIL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildRfc822(from: string, to: string, subject: string, body: string): string {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `MIME-Version: 1.0`,
    ``,
    body,
  ];
  return lines.join("\r\n");
}

function encodeBase64Url(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendOrDraft(
  args: Record<string, unknown>,
  mode: "send" | "draft",
): Promise<string> {
  const accountInput = String(args.account || "primary").toLowerCase();
  const account = parseAccountLabel(accountInput) || "empoweredservices2013";
  const fromAddr = account === "empoweredservices2013" ? "empoweredservices2013@gmail.com" : "7ace.rich1@gmail.com";
  const to = String(args.to || "").trim();
  const subject = String(args.subject || "").trim();
  const body = String(args.body || "");
  if (!to) return `gmail_${mode}: 'to' required.`;
  if (!subject) return `gmail_${mode}: 'subject' required.`;
  if (!body) return `gmail_${mode}: 'body' required.`;

  const rfc822 = buildRfc822(fromAddr, to, subject, body);
  const raw = encodeBase64Url(rfc822);

  if (mode === "send") {
    const r = await gmailFetch(account, `/users/me/messages/send`, {
      method: "POST",
      jsonBody: { raw },
    });
    if (!r.ok) return `gmail_send: ${r.error}`;
    return `Sent from ${fromAddr} to ${to}: "${subject}"`;
  } else {
    const r = await gmailFetch(account, `/users/me/drafts`, {
      method: "POST",
      jsonBody: { message: { raw } },
    });
    if (!r.ok) return `gmail_draft: ${r.error}`;
    return `Draft created in ${fromAddr} to ${to}: "${subject}". Open Gmail to review/send.`;
  }
}

export class GmailSendTool implements Tool {
  definition: ToolDefinition = {
    name: "gmail_send",
    description: "Send an email immediately from one of Ace's Gmail accounts. Use for replies he explicitly asks to send.",
    parameters: {
      account: { type: "string", description: "'primary' or 'secondary'." },
      to: { type: "string", description: "Recipient email address." },
      subject: { type: "string", description: "Subject line." },
      body: { type: "string", description: "Plain-text body." },
    },
    required: ["to", "subject", "body"],
  };
  async execute(args: Record<string, unknown>): Promise<string> {
    return await sendOrDraft(args, "send");
  }
}

export class GmailDraftTool implements Tool {
  definition: ToolDefinition = {
    name: "gmail_draft",
    description: "Create a draft email (saved to Gmail Drafts, NOT sent). Use when Ace asks for a draft or wants to review before sending.",
    parameters: {
      account: { type: "string", description: "'primary' or 'secondary'." },
      to: { type: "string", description: "Recipient email address." },
      subject: { type: "string", description: "Subject line." },
      body: { type: "string", description: "Plain-text body." },
    },
    required: ["to", "subject", "body"],
  };
  async execute(args: Record<string, unknown>): Promise<string> {
    return await sendOrDraft(args, "draft");
  }
}

// ── Internal helper for morning brief ──────────────────────────────────────
// Returns a human-friendly summary of recent emails for both accounts.
export async function getInboxSummaryForBrief(hoursBack = 24): Promise<string> {
  const tool = new GmailInboxTool();
  return await tool.execute({ account: "both", max: 6, unread_only: true, hours_back: hoursBack });
}
