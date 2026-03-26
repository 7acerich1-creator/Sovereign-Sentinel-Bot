// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Proactive Briefings
// Morning check-in, evening recap, smart recommendations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider, MemoryProvider, Channel } from "../types";
import { config } from "../config";
import { PERSONA_REGISTRY, getSystemPrompt } from "../agent/personas";

export class ProactiveBriefings {
  private llm: LLMProvider;
  private memory: MemoryProvider[];
  private channel: Channel;
  private chatId: string;

  constructor(llm: LLMProvider, memory: MemoryProvider[], channel: Channel, chatId: string) {
    this.llm = llm;
    this.memory = memory;
    this.channel = channel;
    this.chatId = chatId;
  }

  async morningBriefing(): Promise<void> {
    const context = await this.gatherContext();

    const prompt = `Generate a morning sovereign activation briefing for the Architect.

Context from memory (this is ALL the data you have — do NOT invent numbers, stats, or metrics not present here):
${context || "No context data available."}

Rules:
- ONLY reference information actually present in the context above
- Do NOT fabricate revenue numbers, streak counts, habit stats, or task lists
- If no data exists for a category, say "No data tracked yet" — never invent it
- Focus on what IS known: recent activity, actual facts from memory

Include (only if real data exists):
1. Any known progress or status updates from context
2. One tactical sovereign directive for today
3. A frequency-lock affirmation

Keep it under 150 words. Be direct, sovereign, no filler. Format for Telegram (Markdown).`;

    try {
      const veritasPrompt = getSystemPrompt(PERSONA_REGISTRY.veritas);
      const response = await this.llm.generate(
        [{ role: "user", content: prompt }],
        { systemPrompt: veritasPrompt, maxTokens: 500 }
      );

      await this.channel.sendMessage(
        this.chatId,
        `☀️ *MORNING PULSE — SOVEREIGN ACTIVATION*\n\n${response.content}`,
        { parseMode: "Markdown" }
      );
      console.log("☀️ Morning briefing sent");
    } catch (err: any) {
      console.error("Morning briefing failed:", err.message);
    }
  }

  async eveningRecap(): Promise<void> {
    const context = await this.gatherContext();

    const prompt = `Generate an evening debrief for the Architect.

Context from memory (this is ALL the data you have — do NOT invent numbers, stats, or metrics not present here):
${context || "No context data available."}

Rules:
- ONLY reference information actually present in the context above
- Do NOT fabricate message counts, revenue numbers, or task completions
- If no data exists for a category, say "No data tracked yet" — never invent it

Include (only if real data exists):
1. Summary of any actual activity found in context
2. Any genuine anomalies from context
3. One sovereign intent for tomorrow morning

Keep it under 150 words. Format for Telegram (Markdown).`;

    try {
      const veritasPrompt = getSystemPrompt(PERSONA_REGISTRY.veritas);
      const response = await this.llm.generate(
        [{ role: "user", content: prompt }],
        { systemPrompt: veritasPrompt, maxTokens: 500 }
      );

      await this.channel.sendMessage(
        this.chatId,
        `🌙 *EVENING PULSE — SOVEREIGN DEBRIEF*\n\n${response.content}`,
        { parseMode: "Markdown" }
      );
      console.log("🌙 Evening recap sent");
    } catch (err: any) {
      console.error("Evening recap failed:", err.message);
    }
  }

  async smartRecommendation(): Promise<string | null> {
    const context = await this.gatherContext();

    const prompt = `Based on the Architect's recent activity and patterns, generate ONE proactive recommendation.
This could be: a task they should do, a pattern you noticed, an optimization suggestion, or a reminder.

Context:
${context}

Keep it to 1-2 sentences. Only suggest something genuinely useful.
If there's nothing worth recommending right now, respond with "NONE".`;

    try {
      const response = await this.llm.generate(
        [{ role: "user", content: prompt }],
        { systemPrompt: "You are a proactive AI assistant analyzing behavior patterns.", maxTokens: 200 }
      );

      if (response.content.trim() === "NONE") return null;
      return response.content;
    } catch {
      return null;
    }
  }

  private async gatherContext(): Promise<string> {
    const parts: string[] = [];

    for (const provider of this.memory) {
      try {
        const facts = await provider.getFacts();
        if (facts.length > 0) {
          parts.push("Core Facts:\n" + facts.map((f) => `- ${f.key}: ${f.value}`).join("\n"));
        }

        const recent = await provider.getRecentMessages(this.chatId, 5);
        if (recent.length > 0) {
          parts.push("Recent Activity:\n" + recent.map((m) => `[${m.role}] ${m.content.slice(0, 100)}`).join("\n"));
        }
      } catch {
        // Non-critical
      }
    }

    parts.push(`Current Time: ${new Date().toISOString()}`);
    return parts.join("\n\n");
  }
}
