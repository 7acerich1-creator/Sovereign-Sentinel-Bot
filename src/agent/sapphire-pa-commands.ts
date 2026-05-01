// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Personal Assistant Commands
// Session 114 — 2026-04-24
//
// Deterministic command intercept layer for Sapphire's PA features.
// Runs BEFORE the agent loop — keeps auth flows, reminders, and voice toggles
// out of LLM interpretation.
//
// ALL commands restricted to TELEGRAM_AUTHORIZED_USER_ID (Ace).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel, Message } from "../types";
import { config } from "../config";
import {
  generateGoogleConsentUrl,
  exchangeCodeForRefreshToken,
  storeNotionToken,
  getSapphireAuthStatus,
  type SapphireAccountLabel,
} from "../proactive/sapphire-oauth";

// ── Pending input state ─────────────────────────────────────────────────────
// When Ace runs /auth_google_primary, the next message from him is treated as
// the auth code. State is in-memory because auth codes expire in 10 min anyway.
type PendingInput =
  | { kind: "google_auth_code"; account: SapphireAccountLabel; expiresAt: number }
  | { kind: "notion_token"; expiresAt: number }
  | { kind: "voice_preference_pending"; expiresAt: number };

const pendingState = new Map<string, PendingInput>();

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 min

function setPending(chatId: string, input: PendingInput): void {
  pendingState.set(chatId, input);
  // Auto-clear after TTL
  setTimeout(() => {
    const cur = pendingState.get(chatId);
    if (cur && cur === input) pendingState.delete(chatId);
  }, PENDING_TTL_MS).unref?.();
}

function getPending(chatId: string): PendingInput | undefined {
  const p = pendingState.get(chatId);
  if (!p) return undefined;
  if (p.expiresAt < Date.now()) {
    pendingState.delete(chatId);
    return undefined;
  }
  return p;
}

function clearPending(chatId: string): void {
  pendingState.delete(chatId);
}

// ── Voice preference (in-memory; persisted to sapphire_known_facts on change) ──
let voicePreference: "voice" | "text" | "voice_brief_only" = "text";

export function getVoicePreference(): typeof voicePreference {
  return voicePreference;
}

async function loadVoicePreference(): Promise<void> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(config.memory.supabaseUrl!, (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!);
    const { data } = await supabase
      .from("sapphire_known_facts")
      .select("value")
      .eq("key", "voice_preference")
      .maybeSingle();
    if (data?.value && ["voice", "text", "voice_brief_only"].includes(data.value)) {
      voicePreference = data.value as typeof voicePreference;
    }
  } catch {
    // Silent — defaults to "text"
  }
}

async function saveVoicePreference(pref: typeof voicePreference): Promise<void> {
  voicePreference = pref;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(config.memory.supabaseUrl!, (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!);
    await supabase
      .from("sapphire_known_facts")
      .upsert(
        { key: "voice_preference", value: pref, category: "preferences" },
        { onConflict: "key" },
      );
  } catch {
    // Silent — in-memory still updated
  }
}

// Init on module load
loadVoicePreference().catch(() => {});

// ── Authorization gate ──────────────────────────────────────────────────────
// Uses the SAME source as the rest of the bot (config.telegram.authorizedUserIds).
// Direct process.env reads silently fail when the env var name varies — config.ts
// has a fallback chain (TELEGRAM_AUTHORIZED_USER_IDS → TELEGRAM_AUTHORIZED_USER_ID
// → AUTHORIZED_USER_ID → hardcoded fallback) so this is the canonical source.
function isAce(message: Message): boolean {
  const ids = config.telegram.authorizedUserIds.map(String);
  if (ids.length === 0) {
    console.warn(`[SapphirePA] No authorized user IDs configured — intercept disabled`);
    return false;
  }
  const userId = String(message.userId || "");
  const chatId = String(message.chatId || "");
  const ok = ids.includes(userId) || ids.includes(chatId);
  if (!ok) {
    console.log(`[SapphirePA] Auth check FAIL — userId=${userId} chatId=${chatId} authorized=[${ids.join(",")}]`);
  }
  return ok;
}

// ── Main entry point ────────────────────────────────────────────────────────
//
// Returns true if this message was handled as a PA command and the agent loop
// should be skipped. Returns false if Sapphire's normal AgentLoop should run.
export async function handleSapphirePACommand(
  message: Message,
  channel: Channel,
): Promise<boolean> {
  // Authorization gate — only Ace can run any of these
  if (!isAce(message)) return false;

  const text = (message.content || "").trim();

  // ── Pending input handling (priority over commands) ─────────────────────
  const pending = getPending(message.chatId);
  if (pending && !text.startsWith("/")) {
    if (pending.kind === "google_auth_code") {
      clearPending(message.chatId);
      await channel.sendTyping?.(message.chatId);
      const result = await exchangeCodeForRefreshToken(pending.account, text);
      if (result.ok) {
        await channel.sendMessage(
          message.chatId,
          `Got it. ${pending.account} is connected. I can read your Gmail and Calendar for that account now.\n\n` +
          `Try: "what's on my calendar tomorrow?" or "any new emails today?"`,
        );
      } else {
        await channel.sendMessage(
          message.chatId,
          `That didn't work. Error: ${result.error}\n\nRun /auth_google_${pending.account === "empoweredservices2013" ? "primary" : "secondary"} again to retry.`,
        );
      }
      return true;
    }
    if (pending.kind === "notion_token") {
      clearPending(message.chatId);
      await channel.sendTyping?.(message.chatId);
      const result = await storeNotionToken(text);
      if (result.ok) {
        await channel.sendMessage(
          message.chatId,
          `Notion is connected. Next, share a parent page with me from Notion (any page works) — once you do, I'll create your operations log inside it.`,
        );
      } else {
        await channel.sendMessage(message.chatId, `That didn't work: ${result.error}\n\nRun /auth_notion to retry.`);
      }
      return true;
    }
  }

  // ── Commands ────────────────────────────────────────────────────────────
  if (!text.startsWith("/")) return false;

  const [cmd] = text.split(/\s+/);
  const lower = cmd.toLowerCase();

  switch (lower) {
    case "/auth_google_primary":
    case "/auth_google":
      return await handleAuthGoogle(message, channel, "empoweredservices2013");

    case "/auth_google_secondary":
      return await handleAuthGoogle(message, channel, "7ace.rich1");

    case "/auth_notion":
      return await handleAuthNotion(message, channel);

    case "/auth_status":
      return await handleAuthStatus(message, channel);

    case "/voice_on":
      await saveVoicePreference("voice");
      await channel.sendMessage(message.chatId, `Voice replies on. I'll send voice notes for everything from now on.\n\nUse /voice_off to switch back to text, or /voice_brief to only voice the morning brief and evening wrap.`);
      return true;

    case "/voice_off":
      await saveVoicePreference("text");
      await channel.sendMessage(message.chatId, `Voice replies off. I'll send text only.`);
      return true;

    case "/voice_brief":
      await saveVoicePreference("voice_brief_only");
      await channel.sendMessage(message.chatId, `Voice mode set to brief-only. I'll voice the morning brief and evening wrap, everything else stays as text.`);
      return true;

    case "/sapphire_help":
    case "/help_sapphire":
      return await handleHelp(message, channel);

    case "/diagnose":
      // Self-Healing Layer 5 — pulls the most recent failed deploy event
      // from Supabase, injects it into message.content prefixed with
      // [DIAGNOSE_DEPLOY], and returns false so the AGENT LOOP runs with
      // the new context. The diagnose_deploy_failure doctrine piece in
      // Sapphire's prompt drives the actual investigation.
      return await handleDiagnose(message, channel);

    default:
      return false;
  }
}

// ── /diagnose — Layer 5 entry point ─────────────────────────────────────────
async function handleDiagnose(message: Message, channel: Channel): Promise<boolean> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    await channel.sendMessage(
      message.chatId,
      "Can't pull deploy events — SUPABASE_URL/SERVICE_KEY not set on this container.",
    );
    return true;
  }

  // Pull the most recent FAILED/CRASHED deploy event
  const url =
    `${supabaseUrl}/rest/v1/deploy_events` +
    `?select=deployment_id,project_id,service_id,status,classification,action_taken,retry_count,error_excerpt,created_at` +
    `&status=in.(FAILED,CRASHED)` +
    `&order=created_at.desc` +
    `&limit=1`;

  let row: any = null;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    if (res.ok) {
      const arr = await res.json().catch(() => []);
      row = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    }
  } catch (e) {
    console.error("[/diagnose] supabase fetch failed:", e);
  }

  if (!row) {
    await channel.sendMessage(
      message.chatId,
      "No FAILED/CRASHED deploy events on record. The pipeline is green or the table is empty.",
    );
    return true;
  }

  // Mutate message.content with the diagnose context. The agent loop will
  // pick up the [DIAGNOSE_DEPLOY] prefix; the diagnose_deploy_failure doctrine
  // piece in Sapphire's prompt drives the rest of the investigation.
  const errExcerpt = (row.error_excerpt || "").slice(0, 1500);
  message.content =
    `[DIAGNOSE_DEPLOY]\n` +
    `Architect ran /diagnose. Walk the most recent failure per the diagnose_deploy_failure doctrine.\n\n` +
    `Most recent failure:\n` +
    `  deployment_id: ${row.deployment_id}\n` +
    `  status: ${row.status}\n` +
    `  classification: ${row.classification ?? "unknown"}\n` +
    `  action_taken: ${row.action_taken ?? "alert_only"}\n` +
    `  retry_count: ${row.retry_count ?? 0}\n` +
    `  occurred_at: ${row.created_at}\n` +
    `  project_id: ${row.project_id ?? "(unset)"}\n` +
    `  service_id: ${row.service_id ?? "(unset)"}\n\n` +
    `Error log excerpt:\n` +
    "```\n" +
    (errExcerpt || "(no log captured — Layer 1 may have failed to fetch from Railway GraphQL)") +
    "\n```\n\n" +
    `Step 2: archival_search sapphire-personal for similar incidents using the key error terms above. ` +
    `Step 3: classify confidently and decide whether to file a request_code_change. ` +
    `Step 4: respond with the 4-6 sentence diagnosis Architect is expecting. ` +
    `Step 5: archival_insert your diagnosis with topic='deploy_failure_diagnosis' before signing off.`;

  // Return false so the agent loop runs with the mutated content
  return false;
}

// ── /auth_google ────────────────────────────────────────────────────────────
async function handleAuthGoogle(
  message: Message,
  channel: Channel,
  account: SapphireAccountLabel,
): Promise<boolean> {
  const url = generateGoogleConsentUrl(account);
  if (!url) {
    await channel.sendMessage(message.chatId, `YOUTUBE_CLIENT_ID is not set in Railway env. Tell Claude to fix that first.`);
    return true;
  }

  setPending(message.chatId, { kind: "google_auth_code", account, expiresAt: Date.now() + PENDING_TTL_MS });

  const accountFriendly = account === "empoweredservices2013" ? "empoweredservices2013@gmail.com" : "7ace.rich1@gmail.com";

  await channel.sendMessage(
    message.chatId,
    `Connect ${accountFriendly} for Gmail + Calendar:\n\n` +
    `1. Tap this link: ${url}\n\n` +
    `2. Pick ${accountFriendly} when Google asks.\n\n` +
    `3. Click Continue / Allow on the permissions screen.\n\n` +
    `4. You'll land on a page that says "✓ Connected". Close that tab.\n\n` +
    `5. Come back here and run /auth_status to confirm.\n\n` +
    `That's it — no codes to paste.`,
  );
  return true;
}

// ── /auth_notion ────────────────────────────────────────────────────────────
async function handleAuthNotion(message: Message, channel: Channel): Promise<boolean> {
  setPending(message.chatId, { kind: "notion_token", expiresAt: Date.now() + PENDING_TTL_MS });

  await channel.sendMessage(
    message.chatId,
    `Connect Notion (one-time, 60 seconds):\n\n` +
    `1. Open https://www.notion.so/my-integrations\n\n` +
    `2. Click "+ New integration".\n\n` +
    `3. Name it "Sapphire". Workspace: pick your main one. Submit.\n\n` +
    `4. On the integration page, find "Internal Integration Secret" — click "Show", then "Copy".\n\n` +
    `5. Paste the token here as your next message.\n\n` +
    `After that, I'll ask you to share a parent page with the Sapphire integration so I can create your operations log inside it.`,
  );
  return true;
}

// ── /auth_status ────────────────────────────────────────────────────────────
async function handleAuthStatus(message: Message, channel: Channel): Promise<boolean> {
  const status = await getSapphireAuthStatus();
  const lines = [
    `Sapphire connection status:`,
    ``,
    `• Gmail/Calendar (empoweredservices2013): ${status.google.empoweredservices2013 ? "✅ connected" : "❌ not connected — run /auth_google_primary"}`,
    `• Gmail/Calendar (7ace.rich1):              ${status.google["7ace.rich1"] ? "✅ connected" : "❌ not connected — run /auth_google_secondary"}`,
    `• Notion:                                   ${status.notion ? "✅ connected" : "❌ not connected — run /auth_notion"}`,
    ``,
    `Voice mode: ${voicePreference}`,
  ];
  await channel.sendMessage(message.chatId, lines.join("\n"));
  return true;
}

// ── /sapphire_help ──────────────────────────────────────────────────────────
async function handleHelp(message: Message, channel: Channel): Promise<boolean> {
  await channel.sendMessage(
    message.chatId,
    `Sapphire — your personal assistant. Here's what I can do:\n\n` +
    `Setup commands:\n` +
    `• /auth_google_primary — connect empoweredservices2013 Gmail + Calendar\n` +
    `• /auth_google_secondary — connect 7ace.rich1 Gmail + Calendar\n` +
    `• /auth_notion — connect Notion\n` +
    `• /auth_status — see what's connected\n\n` +
    `Voice:\n` +
    `• /voice_on — I reply as voice notes\n` +
    `• /voice_off — text only\n` +
    `• /voice_brief — voice only for morning brief and evening wrap\n\n` +
    `In normal conversation:\n` +
    `• "Remind me Friday at 1pm to take the girls to a birthday party"\n` +
    `• "What's on my calendar tomorrow?"\n` +
    `• "Any important emails I should see?"\n` +
    `• "Reschedule my 2pm tomorrow to 4pm"\n` +
    `• "Add to my agenda for tomorrow: call mechanic"\n\n` +
    `I'll send you a brief at 11am and a wrap-up at 1am every day.`,
  );
  return true;
}
