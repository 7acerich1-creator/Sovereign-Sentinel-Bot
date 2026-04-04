// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Heartbeat System
// Check for events at intervals, proactively notify
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel } from "../types";
import { config } from "../config";

type HeartbeatCheck = {
  name: string;
  check: () => Promise<string | null>; // Returns message if noteworthy, null if nothing
  silent?: boolean;
};

export class HeartbeatSystem {
  private checks: HeartbeatCheck[] = [];
  private channel: Channel;
  private chatId: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(channel: Channel, chatId: string) {
    this.channel = channel;
    this.chatId = chatId;
  }

  addCheck(check: HeartbeatCheck): void {
    this.checks.push(check);
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const intervalMs = config.scheduler.heartbeatIntervalMs;

    this.timer = setInterval(async () => {
      await this.pulse();
    }, intervalMs);

    console.log(`💓 Heartbeat started — checking every ${intervalMs / 1000}s with ${this.checks.length} checks`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  async pulse(): Promise<void> {
    // Skip if pipeline is running — preserve Supabase bandwidth
    if ((globalThis as any).__isPipelineRunning?.()) {
      console.log(`⏸️ [Heartbeat] Skipped — pipeline running`);
      return;
    }

    for (const check of this.checks) {
      try {
        const message = await check.check();
        if (message) {
          console.log(`💓 Heartbeat: ${check.name} -> ${message.slice(0, 100)}`);
          
          if (!check.silent) {
            await this.channel.sendMessage(
              this.chatId,
              `⚙️ _Background Sync: ${check.name}_\n\`\`\`\n${message}\n\`\`\``,
              { parseMode: "Markdown" }
            );
          }
        }
      } catch (err: any) {
        console.error(`Heartbeat check "${check.name}" failed:`, err.message);
      }
    }
  }
}
