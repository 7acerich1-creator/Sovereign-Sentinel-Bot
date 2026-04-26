// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Proactive Briefings
// Morning check-in, evening recap, smart recommendations
// SESSION 108: Rewired to pull REAL data from Supabase
// (youtube_analytics, landing_analytics, activity_log, crew_dispatch)
// instead of empty memory stores.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider, MemoryProvider, Channel } from "../types";
import { config } from "../config";
import { PERSONA_REGISTRY, getSystemPrompt } from "../agent/personas";
// S121: prefer the full ddxfish-assembled blueprint over the static persona stub.
// Falls back to getSystemPrompt(persona) if assembly returns empty.
import { assembleCrewPrompt } from "../agent/crew-prompt-builder";
import { appendThoughtTag } from "../channels/agent-voice";

async function veritasSystemPrompt(): Promise<string> {
  try {
    const assembled = await assembleCrewPrompt("veritas");
    if (assembled && assembled.length > 100) return assembled;
  } catch {
    /* fall through to static */
  }
  return getSystemPrompt(PERSONA_REGISTRY.veritas);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function supabaseGet(table: string, params: string): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) return [];
    return resp.json() as Promise<any[]>;
  } catch {
    return [];
  }
}

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

LIVE DATA (pulled from production systems just now):
${context}

Rules:
- Reference the ACTUAL numbers above — views, visitors, dispatch counts, top videos
- Do NOT fabricate anything not present in the data
- If a section says "unavailable", skip it — don't mention the gap

Include:
1. Activity Summary: crew dispatch activity, content pipeline output
2. YouTube pulse: total views across channels, any standout videos
3. Landing page pulse: visitors, top pages
4. One tactical sovereign directive for today based on what the data reveals
5. A frequency-lock affirmation

Keep it under 200 words. Be direct, sovereign, data-driven. Format for Telegram (Markdown).`;

    try {
      const veritasPrompt = await veritasSystemPrompt();
      const response = await this.llm.generate(
        [{ role: "user", content: prompt }],
        { systemPrompt: veritasPrompt, maxTokens: 600 }
      );

      // S121: append thought-tag tying the morning read to the macro pattern
      const withTag = await appendThoughtTag(
        "veritas",
        response.content,
        { action: "Morning intelligence briefing emitted from live Supabase data", metric: "MRR" },
      );

      await this.channel.sendMessage(
        this.chatId,
        `☀️ *MORNING PULSE — SOVEREIGN ACTIVATION*\n\n${withTag}`,
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

LIVE DATA (pulled from production systems just now):
${context}

Rules:
- Reference the ACTUAL numbers above
- Do NOT fabricate anything not present in the data
- If a section says "unavailable", skip it

Include:
1. Activity Summary: what the crew accomplished today (dispatches completed)
2. YouTube pulse: views, any anomalies or standout performers
3. Landing page pulse: visitor trends
4. One sovereign intent for tomorrow morning based on what the data reveals

Keep it under 200 words. Format for Telegram (Markdown).`;

    try {
      const veritasPrompt = await veritasSystemPrompt();
      const response = await this.llm.generate(
        [{ role: "user", content: prompt }],
        { systemPrompt: veritasPrompt, maxTokens: 600 }
      );

      // S121: append thought-tag tying the evening read to tomorrow's leverage
      const withTag = await appendThoughtTag(
        "veritas",
        response.content,
        { action: "Evening debrief emitted; tomorrow's macro intent surfaced", metric: "MRR" },
      );

      await this.channel.sendMessage(
        this.chatId,
        `🌙 *EVENING PULSE — SOVEREIGN DEBRIEF*\n\n${withTag}`,
        { parseMode: "Markdown" }
      );
      console.log("🌙 Evening recap sent");
    } catch (err: any) {
      console.error("Evening recap failed:", err.message);
    }
  }

  async smartRecommendation(): Promise<string | null> {
    const context = await this.gatherContext();

    const prompt = `Based on the Architect's live data, generate ONE proactive recommendation.
This could be: a content strategy pivot, a metric that needs attention, or an optimization.

Data:
${context}

Keep it to 1-2 sentences. Only suggest something genuinely useful.
If there's nothing worth recommending right now, respond with "NONE".`;

    try {
      const response = await this.llm.generate(
        [{ role: "user", content: prompt }],
        { systemPrompt: "You are a proactive AI CRO analyst for a sovereign content empire.", maxTokens: 200 }
      );

      if (response.content.trim() === "NONE") return null;
      return response.content;
    } catch {
      return null;
    }
  }

  private async gatherContext(): Promise<string> {
    const parts: string[] = [];
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 86400000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    // ── 1. YouTube Analytics (from Supabase) ──
    try {
      const ytRows = await supabaseGet(
        "youtube_analytics",
        "select=channel_name,title,views,likes,comments,outlier_score&order=views.desc&limit=200"
      );
      if (ytRows.length > 0) {
        const channels: Record<string, { videos: number; views: number; likes: number; comments: number }> = {};
        for (const r of ytRows) {
          const ch = r.channel_name || "Unknown";
          if (!channels[ch]) channels[ch] = { videos: 0, views: 0, likes: 0, comments: 0 };
          channels[ch].videos++;
          channels[ch].views += r.views || 0;
          channels[ch].likes += r.likes || 0;
          channels[ch].comments += r.comments || 0;
        }

        const lines = ["── YOUTUBE ANALYTICS ──"];
        for (const [name, c] of Object.entries(channels)) {
          lines.push(`${name}: ${c.videos} videos, ${c.views.toLocaleString()} total views, ${c.likes} likes, ${c.comments} comments`);
        }

        // Top 3 by views
        const top3 = ytRows.slice(0, 3);
        if (top3.length > 0) {
          lines.push("Top performers:");
          for (const v of top3) {
            lines.push(`  • "${v.title}" — ${(v.views || 0).toLocaleString()} views${v.outlier_score ? `, outlier: ${Number(v.outlier_score).toFixed(1)}` : ""}`);
          }
        }
        parts.push(lines.join("\n"));
      } else {
        parts.push("── YOUTUBE ANALYTICS ──\nNo data available.");
      }
    } catch {
      parts.push("── YOUTUBE ANALYTICS ──\nQuery failed.");
    }

    // ── 2. Landing Analytics (from Supabase) ──
    try {
      const landingRows = await supabaseGet(
        "landing_analytics",
        `select=page_path,visitors,page_views,bounce_rate&fetched_at=gte.${sevenDaysAgo}&order=page_views.desc&limit=20`
      );
      if (landingRows.length > 0) {
        let totalVisitors = 0, totalViews = 0;
        for (const r of landingRows) {
          totalVisitors += r.visitors || 0;
          totalViews += r.page_views || 0;
        }
        const topPages = landingRows.slice(0, 5).map(
          (r: any) => `  • ${r.page_path}: ${r.page_views} views, ${r.visitors} visitors`
        );
        parts.push([
          "── LANDING PAGE (7-day) ──",
          `Total: ${totalVisitors} visitors, ${totalViews} page views`,
          "Top pages:",
          ...topPages,
        ].join("\n"));
      } else {
        parts.push("── LANDING PAGE ──\nNo data in last 7 days.");
      }
    } catch {
      parts.push("── LANDING PAGE ──\nQuery failed.");
    }

    // ── 3. Crew Activity (from crew_dispatch table) ──
    try {
      const dispatchRows = await supabaseGet(
        "crew_dispatch",
        `select=to_agent,task_type,status,created_at&created_at=gte.${oneDayAgo}&order=created_at.desc&limit=30`
      );
      if (dispatchRows.length > 0) {
        const agentCounts: Record<string, { total: number; completed: number }> = {};
        for (const r of dispatchRows) {
          const agent = r.to_agent || "unknown";
          if (!agentCounts[agent]) agentCounts[agent] = { total: 0, completed: 0 };
          agentCounts[agent].total++;
          if (r.status === "completed") agentCounts[agent].completed++;
        }
        const lines = ["── CREW ACTIVITY (24h) ──"];
        for (const [agent, c] of Object.entries(agentCounts)) {
          lines.push(`${agent}: ${c.completed}/${c.total} tasks completed`);
        }
        parts.push(lines.join("\n"));
      } else {
        parts.push("── CREW ACTIVITY (24h) ──\nNo dispatches in last 24 hours.");
      }
    } catch {
      parts.push("── CREW ACTIVITY ──\nQuery failed.");
    }

    // ── 4. YouTube Comments (from youtube_comments_seen) ──
    try {
      const commentRows = await supabaseGet(
        "youtube_comments_seen",
        `select=author_name,comment_text,video_title&seen_at=gte.${oneDayAgo}&order=seen_at.desc&limit=5`
      );
      if (commentRows.length > 0) {
        const lines = ["── NEW YOUTUBE COMMENTS (24h) ──"];
        for (const r of commentRows) {
          lines.push(`• @${r.author_name} on "${(r.video_title || "").slice(0, 40)}": "${(r.comment_text || "").slice(0, 80)}"`);
        }
        parts.push(lines.join("\n"));
      }
      // Don't show "no comments" — absence is silent
    } catch {
      // Silent fail for non-critical
    }

    parts.push(`\nTimestamp: ${now.toISOString()}`);
    return parts.join("\n\n");
  }
}
