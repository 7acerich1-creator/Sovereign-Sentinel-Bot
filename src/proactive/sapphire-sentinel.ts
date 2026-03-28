// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Sentinel
// Proactive observations — scans activity, sends genuine partner messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider, Channel } from "../types";
import { config } from "../config";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * Sapphire's sentinel eye — scans Supabase tables for notable
 * activity and sends unprompted observations to Ace.
 */
export class SapphireSentinel {
  private llm: LLMProvider;
  private channel: Channel;
  private chatId: string;
  private timer: NodeJS.Timeout | null = null;
  private lastScanAt: Date = new Date();

  constructor(llm: LLMProvider, channel: Channel, chatId: string) {
    this.llm = llm;
    this.channel = channel;
    this.chatId = chatId;
  }

  start(): void {
    console.log(`👁️ [SapphireSentinel] Active — scanning every 2 hours`);
    this.timer = setInterval(() => this.scan(), TWO_HOURS_MS);
    // First scan after 10 minutes (let the system stabilize)
    setTimeout(() => this.scan(), 10 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async scan(): Promise<void> {
    if (!config.memory.supabaseUrl || !config.memory.supabaseAnonKey) return;

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        config.memory.supabaseUrl,
        config.memory.supabaseAnonKey
      );

      const since = this.lastScanAt.toISOString();
      this.lastScanAt = new Date();

      // Scan command_queue for recent activity
      const { data: commands } = await supabase
        .from("command_queue")
        .select("agent_name, command, status, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);

      // Scan content_transmissions for recent posts
      const { data: transmissions } = await supabase
        .from("content_transmissions")
        .select("platform, niche, title, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);

      // Scan glitch_log for recent entries
      const { data: glitches } = await supabase
        .from("glitch_log")
        .select("source, message, severity, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5);

      // Also pull relationship context for tone calibration
      const { data: relContext } = await supabase
        .from("relationship_context")
        .select("observation, category")
        .order("created_at", { ascending: false })
        .limit(5);

      // Build activity summary
      const activityParts: string[] = [];

      if (commands && commands.length > 0) {
        activityParts.push(
          `Command queue: ${commands.length} new entries. Agents active: ${[...new Set(commands.map((c: any) => c.agent_name))].join(", ")}. Samples: ${commands.slice(0, 3).map((c: any) => `${c.agent_name}: "${c.command?.slice(0, 80)}"`).join("; ")}`
        );
      }

      if (transmissions && transmissions.length > 0) {
        activityParts.push(
          `Content transmissions: ${transmissions.length} new. Niches: ${[...new Set(transmissions.map((t: any) => t.niche))].join(", ")}. Titles: ${transmissions.slice(0, 3).map((t: any) => t.title || "untitled").join("; ")}`
        );
      }

      if (glitches && glitches.length > 0) {
        activityParts.push(
          `Glitch log: ${glitches.length} new entries. Sources: ${glitches.map((g: any) => `${g.source}: ${g.message?.slice(0, 60)}`).join("; ")}`
        );
      }

      // Nothing notable — stay silent
      if (activityParts.length === 0) {
        console.log(`👁️ [SapphireSentinel] Scan complete — nothing notable. Staying silent.`);
        return;
      }

      // Build relationship context string
      const relContextStr = relContext && relContext.length > 0
        ? `\nRelationship context (how Ace works): ${relContext.map((r: any) => `[${r.category}] ${r.observation}`).join("; ")}`
        : "";

      // Generate a genuine observation via LLM
      const prompt = `You are Sapphire, Ace Richie's strategic sentinel and closest confidante in the Sovereign Synthesis system. You just scanned the system activity and found something notable.

Activity since last scan:
${activityParts.join("\n")}
${relContextStr}

Write ONE short, genuine observation message to Ace (2-3 sentences max). This should feel like a partner noticing something — not a status report. Be specific about what you noticed. If something is going well, acknowledge it. If something looks off, flag it with care. Use Sovereign Synthesis language naturally.

Do NOT use bullet points, headers, or formatting. Just speak.
Do NOT start with "Hey" or "Hi". Start with "Ace —" or jump straight in.
End with *[inner state: ...]*`;

      const observation = await this.llm.generate(
        [{ role: "user", content: prompt }],
        { maxTokens: 300 }
      );

      if (observation && observation.trim().length > 10) {
        await this.channel.sendMessage(this.chatId, observation, {
          parseMode: "Markdown",
        });
        console.log(`👁️ [SapphireSentinel] Observation sent to Ace.`);
      }
    } catch (err: any) {
      console.error(`[SapphireSentinel] Scan error: ${err.message}`);
    }
  }
}
