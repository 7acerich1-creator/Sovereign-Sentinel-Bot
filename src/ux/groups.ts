// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Group Chat Management
// Respond only when mentioned, per-group memory, admin commands
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Message } from "../types";

/**
 * Keywords that ALL bots in the group respond to (no @mention required).
 * Each bot fires sequentially with a stagger delay.
 */
const GROUP_BROADCAST_TRIGGERS = [
  "roll call",
  "rollcall",
  "check in",
  "checkin",
  "check-in",
  "maven crew",
];

/**
 * Group role determines how an agent responds in group chats:
 * - "lead"    → Responds to ALL Architect messages (no @mention needed). Veritas only.
 * - "copilot" → Responds to ALL Architect messages with a delay (plain English summary). Sapphire only.
 * - "crew"    → Responds only on @mention, reply, broadcast trigger, or /command. All others.
 */
export type GroupRole = "lead" | "copilot" | "crew";

export class GroupManager {
  private botUsername: string;
  private adminUserIds: number[];
  private groupRole: GroupRole;

  constructor(botUsername: string, adminUserIds: number[], groupRole: GroupRole = "crew") {
    this.botUsername = botUsername.toLowerCase().replace(/^@/, "");
    this.adminUserIds = adminUserIds;
    this.groupRole = groupRole;
  }

  /**
   * Update the bot username dynamically (e.g., after getMe() resolves).
   */
  setBotUsername(username: string): void {
    this.botUsername = username.toLowerCase().replace(/^@/, "");
  }

  /**
   * Check if a message is a broadcast trigger (roll call, check in, etc.)
   * These bypass the normal @mention requirement in groups.
   */
  isBroadcastTrigger(message: Message): boolean {
    const content = message.content.toLowerCase().trim();
    return GROUP_BROADCAST_TRIGGERS.some((trigger) => content.includes(trigger));
  }

  shouldRespond(message: Message): boolean {
    const meta = message.metadata || {};

    // Always respond in private chats
    if (meta.chatType === "private") return true;

    // Broadcast triggers — all bots respond (roll call, check in, etc.)
    if (this.isBroadcastTrigger(message)) return true;

    // Lead (Veritas, Chief Brand Officer) and CoPilot (Sapphire) ALWAYS respond to the Architect in groups.
    // Lead responds immediately, CoPilot responds after a delay with plain English assessment.
    if ((this.groupRole === "lead" || this.groupRole === "copilot") &&
        message.userId && this.isAdmin(message.userId)) return true;

    // Check Telegram entities for @mention (most reliable)
    const mentionedUsernames = meta.mentionedUsernames as string[] | undefined;
    if (mentionedUsernames?.includes(this.botUsername)) return true;

    // Respond to replies to this bot's messages
    if (meta.replyToBotMessage) return true;

    // Fallback: text-based @mention check (handles edge cases)
    const content = message.content.toLowerCase();
    if (content.includes(`@${this.botUsername}`)) return true;

    // Respond to slash commands
    if (content.startsWith("/")) return true;

    return false;
  }

  /**
   * Whether this agent should add a delay before responding in groups.
   * CoPilot (Sapphire) waits so she can see/reference what Veritas said.
   */
  get respondDelay(): number {
    if (this.groupRole === "copilot") return 8000; // 8s — wait for Veritas to finish
    return 0;
  }

  get role(): GroupRole {
    return this.groupRole;
  }

  isAdmin(userId: string): boolean {
    return this.adminUserIds.includes(Number(userId));
  }

  getChatId(message: Message): string {
    return message.chatId;
  }

  stripMention(text: string): string {
    return text.replace(new RegExp(`@${this.botUsername}`, "gi"), "").trim();
  }
}
