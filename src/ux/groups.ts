// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Group Chat Management
// Respond only when mentioned, per-group memory, admin commands
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Message } from "../types";

export class GroupManager {
  private botUsername: string;
  private adminUserIds: number[];

  constructor(botUsername: string, adminUserIds: number[]) {
    this.botUsername = botUsername.toLowerCase().replace(/^@/, "");
    this.adminUserIds = adminUserIds;
  }

  /**
   * Update the bot username dynamically (e.g., after getMe() resolves).
   */
  setBotUsername(username: string): void {
    this.botUsername = username.toLowerCase().replace(/^@/, "");
  }

  shouldRespond(message: Message): boolean {
    const meta = message.metadata || {};

    // Always respond in private chats
    if (meta.chatType === "private") return true;

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

  isAdmin(userId: string): boolean {
    return this.adminUserIds.includes(Number(userId));
  }

  getChatId(message: Message): string {
    return message.chatId;
  }

  stripMention(text: string): string {
    return text.replace(new RegExp(`@${this.botUsername}\\b`, "gi"), "").trim();
  }
}
