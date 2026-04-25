// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Tool-call indicators for DM transparency
// Session 114 (S114q) — 2026-04-25
//
// Maps each PA tool name to a brief friendly Telegram message that fires
// BEFORE the tool runs. Lets Ace see what she's doing in real-time, the way
// "Sapphire processing..." shows the message-level activity.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";

const TOOL_LABELS: Record<string, string> = {
  // Reminders
  set_reminder: "⏰ Setting reminder…",
  list_reminders: "📋 Checking reminders…",
  cancel_reminder: "🗑️ Cancelling reminder…",
  // Gmail
  gmail_inbox: "📧 Checking inbox…",
  gmail_search: "🔍 Searching email…",
  gmail_send: "✉️ Sending email…",
  gmail_draft: "📝 Drafting email…",
  // Calendar
  calendar_list: "📅 Checking calendar…",
  calendar_create_event: "📅 Adding to calendar…",
  calendar_reschedule: "📅 Moving event…",
  // Notion
  notion_create_page: "📓 Creating Notion page…",
  notion_append_to_page: "📓 Adding to Notion…",
  notion_search: "🔍 Searching Notion…",
  notion_set_parent_page: "📓 Linking parent page…",
  // Memory
  remember_fact: "💾 Saving that…",
  recall_facts: "🧠 Looking up what I know…",
  // Documents
  analyze_pdf: "📄 Reading the PDF…",
  // Research
  research_brief: "🔎 Researching…",
  // Family
  save_family_member: "👨‍👩‍👧 Updating family profile…",
  get_family: "👨‍👩‍👧 Looking up family…",
  // Planner
  create_plan: "🗒️ Drafting plan…",
  approve_plan: "✅ Approving plan…",
  advance_plan: "▶️ Next step…",
  record_step_result: "✓ Marking step done…",
  cancel_plan: "🗑️ Cancelling plan…",
  // News
  add_news_source: "📰 Adding news source…",
  remove_news_source: "📰 Removing news source…",
  list_news_sources: "📰 Listing news sources…",
  // Cross-mode utilities
  web_search: "🔍 Searching the web…",
  browser: "🌐 Browsing…",
  read_protocols: "📜 Reading protocols…",
  // Self-mod meta-tools (S114u)
  set_piece: "🎚️ Adjusting myself…",
  remove_piece: "🎚️ Dropping a mode…",
  create_piece: "✨ Adding to my library…",
  list_pieces: "📚 Checking my library…",
  view_self_prompt: "🪞 Looking at myself…",
};

/**
 * Build a tool-call observer for a Sapphire DM. Fires a brief Telegram
 * message before each tool execution so Ace sees what she's doing.
 */
export function makeSapphireToolObserver(channel: Channel, chatId: string) {
  // Throttle — don't fire same tool indicator more than once per 8s (was 1.5s).
  // Tighter cap prevents retry-loop indicator spam (S114v: Sapphire was firing
  // 5+ "Setting reminder…" indicators when set_reminder rejected past dates).
  // Also hard cap: max 3 indicators per message regardless of tool name.
  const lastFired: Record<string, number> = {};
  let totalThisMessage = 0;
  const MAX_PER_MESSAGE = 3;
  return async (name: string, _args: Record<string, unknown>) => {
    const label = TOOL_LABELS[name];
    if (!label) return;
    if (totalThisMessage >= MAX_PER_MESSAGE) return;
    const now = Date.now();
    if (lastFired[name] && now - lastFired[name] < 8000) return;
    lastFired[name] = now;
    totalThisMessage++;
    try {
      await channel.sendMessage(chatId, label);
    } catch {
      // Silent — never block tool exec on indicator failure
    }
  };
}
