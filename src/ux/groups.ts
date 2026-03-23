// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Group Chat Management
// Respond only when mentioned, per-group memory, admin commands
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Message } from "../types";

export class GroupManager {
  private botUsername: string;
  private adminUserIds: number[];

  constructor(botUsername: string, adminUserIds: number[]) {
    this.botUsername = botUsername.toLowerCase();
    this.adminUserIds = adminUserIds;
  }

  shouldRespond(message: Message): boolean {
    const meta = message.metadata || {};

    // Always respond in private chats
    if (meta.chatType === "private") return true;

    // In groups, only respond when mentioned
    const content = message.content.toLowerCase();
    if (content.includes(`@${this.botUsername}`)) return true;
    if (content.startsWith("/")) return true; // Respond to commands

    // Check for reply to bot (would need channelMessageId tracking)
    return false;
  }

  isAdmin(userId: string): boolean {
    return this.adminUserIds.includes(Number(userId));
  }

  getChatId(message: Message): string {
    // Use unique chat ID for per-group memory isolation
    return message.chatId;
  }

  stripMention(text: string): string {
    return text.replace(new RegExp(`@${this.botUsername}\\b`, "gi"), "").trim();
  }
}
