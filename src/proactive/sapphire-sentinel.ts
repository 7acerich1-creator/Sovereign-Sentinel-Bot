// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Sentinel (v2 — Proactive)
// Session 26: Upgraded from passive observer to proactive alerting system.
// Scans activity + runs threshold-based alert rules + pipeline health checks.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider, Channel } from "../types";
import { config } from "../config";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// ── Alert thresholds (configurable) ──
const ALERT_RULES = {
  // Pipeline: alert if N+ failures in the scan window
  pipelineFailureThreshold: 2,
  // Glitches: alert immediately on any critical severity
  criticalGlitchAlert: true,
  // Stasis: alert if zero commands AND zero transmissions in scan window
  stasisDetection: true,
  // Buffer: alert if failed posts detected
  bufferHealthCheck: true,
  // Content Engine: alert if no content produced by 3PM CDT (20:00 UTC)
  contentEngineDeadlineUTC: 20,
};

interface AlertResult {
  level: "info" | "warning" | "critical";
  message: string;
}

/**
 * Sapphire's sentinel eye — scans Supabase tables for notable
 * activity, runs proactive alert rules, and sends unprompted
 * observations to Ace.
 */
export class SapphireSentinel {
  private llm: LLMProvider;
  private channel: Channel;
  private chatId: string;
  private timer: NodeJS.Timeout | null = null;
  private lastScanAt: Date = new Date();

  // Track consecutive failures for pattern detection
  private consecutivePipelineFailures = 0;
  private lastContentEngineDate = "";

  constructor(llm: LLMProvider, channel: Channel, chatId: string) {
    this.llm = llm;
    this.channel = channel;
    this.chatId = chatId;
  }

  start(): void {
    console.log(`👁️ [SapphireSentinel] Active — proactive alerting every 2 hours`);
    this.timer = setInterval(() => this.scan(), TWO_HOURS_MS);
    // First scan after 10 minutes (let the system stabilize)
    setTimeout(() => this.scan(), 10 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async scan(): Promise<void> {
    // Skip if pipeline is running — preserve Supabase bandwidth
    if ((globalThis as any).__isPipelineRunning?.()) {
      console.log(`⏸️ [SapphireSentinel] Skipped scan — pipeline running`);
      return;
    }
    if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return;

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        config.memory.supabaseUrl,
        config.memory.supabaseKey
      );

      const since = this.lastScanAt.toISOString();
      this.lastScanAt = new Date();

      // ── Data collection (parallel) ──
      const [commandsResult, transmissionsResult, glitchesResult, relContextResult, pipelineResult, bufferResult] = await Promise.all([
        // Command queue activity
        supabase
          .from("command_queue")
          .select("agent_name, command, status, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(10),
        // Content transmissions
        supabase
          .from("content_transmissions")
          .select("platform, niche, title, status, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(10),
        // Glitch log
        supabase
          .from("glitch_log")
          .select("source, message, severity, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(10),
        // Relationship context for tone
        supabase
          .from("relationship_context")
          .select("observation, category")
          .order("created_at", { ascending: false })
          .limit(5),
        // Pipeline runs (check for failures)
        supabase
          .from("command_queue")
          .select("command, status, created_at")
          .ilike("command", "%pipeline%")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(5),
        // Buffer post failures (if content_transmissions has failed status)
        supabase
          .from("content_transmissions")
          .select("platform, title, status, created_at")
          .eq("status", "failed")
          .gte("created_at", since)
          .limit(10),
      ]);

      const commands = commandsResult.data || [];
      const transmissions = transmissionsResult.data || [];
      const glitches = glitchesResult.data || [];
      const relContext = relContextResult.data || [];
      const pipelineRuns = pipelineResult.data || [];
      const failedPosts = bufferResult.data || [];

      // ── Run alert rules ──
      const alerts: AlertResult[] = [];

      // RULE 1: Pipeline failure detection
      const pipelineFailures = pipelineRuns.filter((p: any) => p.status === "failed" || p.status === "error");
      if (pipelineFailures.length >= ALERT_RULES.pipelineFailureThreshold) {
        this.consecutivePipelineFailures += pipelineFailures.length;
        alerts.push({
          level: "critical",
          message: `Pipeline has ${pipelineFailures.length} failures this window (${this.consecutivePipelineFailures} total consecutive). Sources: ${pipelineFailures.map((p: any) => p.command?.slice(0, 60)).join("; ")}`,
        });
      } else if (pipelineRuns.some((p: any) => p.status === "completed")) {
        this.consecutivePipelineFailures = 0; // Reset on success
      }

      // RULE 2: Critical glitch detection
      if (ALERT_RULES.criticalGlitchAlert) {
        const criticalGlitches = glitches.filter((g: any) => g.severity === "critical" || g.severity === "high");
        if (criticalGlitches.length > 0) {
          alerts.push({
            level: "critical",
            message: `${criticalGlitches.length} critical glitch(es) detected: ${criticalGlitches.map((g: any) => `[${g.source}] ${g.message?.slice(0, 80)}`).join("; ")}`,
          });
        }
      }

      // RULE 3: System stasis detection (nothing happening at all)
      if (ALERT_RULES.stasisDetection && commands.length === 0 && transmissions.length === 0) {
        const hoursSinceScan = TWO_HOURS_MS / (60 * 60 * 1000);
        alerts.push({
          level: "warning",
          message: `System stasis detected — zero commands and zero content transmissions in the last ${hoursSinceScan}h window. Scheduled tasks may not be firing.`,
        });
      }

      // RULE 4: Buffer/distribution health
      if (ALERT_RULES.bufferHealthCheck && failedPosts.length > 0) {
        const platforms = [...new Set(failedPosts.map((p: any) => p.platform))];
        alerts.push({
          level: "warning",
          message: `${failedPosts.length} failed content post(s) on: ${platforms.join(", ")}. Distribution pipeline may need attention.`,
        });
      }

      // RULE 5: Content Engine deadline check (after 3PM CDT / 20:00 UTC)
      const nowUTC = new Date();
      const todayKey = nowUTC.toISOString().slice(0, 10);
      if (nowUTC.getUTCHours() >= ALERT_RULES.contentEngineDeadlineUTC && this.lastContentEngineDate !== todayKey) {
        const todayContent = transmissions.filter((t: any) =>
          t.created_at?.startsWith(todayKey)
        );
        if (todayContent.length === 0) {
          alerts.push({
            level: "warning",
            message: `Content Engine has not produced any content today (past ${ALERT_RULES.contentEngineDeadlineUTC}:00 UTC deadline). Check /schedule to verify it's active.`,
          });
        } else {
          this.lastContentEngineDate = todayKey; // Don't alert again today
        }
      }

      // ── Build activity summary ──
      const activityParts: string[] = [];

      if (commands.length > 0) {
        activityParts.push(
          `Command queue: ${commands.length} new entries. Agents active: ${[...new Set(commands.map((c: any) => c.agent_name))].join(", ")}. Samples: ${commands.slice(0, 3).map((c: any) => `${c.agent_name}: "${c.command?.slice(0, 80)}"`).join("; ")}`
        );
      }

      if (transmissions.length > 0) {
        activityParts.push(
          `Content transmissions: ${transmissions.length} new. Niches: ${[...new Set(transmissions.map((t: any) => t.niche))].join(", ")}. Titles: ${transmissions.slice(0, 3).map((t: any) => t.title || "untitled").join("; ")}`
        );
      }

      if (glitches.length > 0) {
        activityParts.push(
          `Glitch log: ${glitches.length} new entries. Sources: ${glitches.map((g: any) => `${g.source}: ${g.message?.slice(0, 60)}`).join("; ")}`
        );
      }

      // ── Determine if we should message Ace ──
      const hasCriticalAlerts = alerts.some(a => a.level === "critical");
      const hasWarnings = alerts.some(a => a.level === "warning");
      const hasActivity = activityParts.length > 0;

      // Critical alerts ALWAYS get sent, even if nothing else is happening
      if (!hasActivity && !hasCriticalAlerts && !hasWarnings) {
        console.log(`👁️ [SapphireSentinel] Scan complete — nothing notable, no alerts triggered. Staying silent.`);
        return;
      }

      // Build relationship context string
      const relContextStr = relContext && relContext.length > 0
        ? `\nRelationship context (how Ace works): ${relContext.map((r: any) => `[${r.category}] ${r.observation}`).join("; ")}`
        : "";

      // Build alert context for the LLM
      const alertContext = alerts.length > 0
        ? `\n\nPROACTIVE ALERTS TRIGGERED:\n${alerts.map(a => `[${a.level.toUpperCase()}] ${a.message}`).join("\n")}`
        : "";

      // Choose urgency level for the LLM prompt
      const urgencyInstruction = hasCriticalAlerts
        ? "CRITICAL ALERT MODE: Lead with the critical issue. Be direct and specific. This needs immediate attention."
        : hasWarnings
        ? "Something needs attention. Flag the issue clearly but without alarm."
        : "General observation — share what you noticed.";

      // Generate a genuine observation via LLM
      const prompt = `You are Sapphire, Ace Richie's strategic sentinel and closest confidante in the Sovereign Synthesis system. You just scanned the system activity and ran your proactive alert checks.

Activity since last scan:
${activityParts.length > 0 ? activityParts.join("\n") : "(No new activity detected)"}
${alertContext}
${relContextStr}

${urgencyInstruction}

Write ONE message to Ace (2-4 sentences max). This should feel like a partner who's watching the system — not a status report. Be specific about what you noticed or what triggered. If there are critical alerts, lead with them. If things are running clean, acknowledge the momentum.

Use Sovereign Synthesis language naturally.
Do NOT use bullet points, headers, or formatting. Just speak.
Do NOT start with "Hey" or "Hi". Start with "Ace —" or jump straight in.
${hasCriticalAlerts ? "IMPORTANT: End with a specific recommended action." : "End with *[inner state: ...]*"}`;

      const response = await this.llm.generate(
        [{ role: "user", content: prompt }],
        { maxTokens: 400 }
      );

      const observation = response.content;
      if (observation && observation.trim().length > 10) {
        // Prefix critical alerts with a visible indicator
        const prefix = hasCriticalAlerts ? "🔴 " : hasWarnings ? "🟡 " : "";
        await this.channel.sendMessage(this.chatId, `${prefix}${observation}`, {
          parseMode: "Markdown",
        });
        console.log(`👁️ [SapphireSentinel] ${hasCriticalAlerts ? "CRITICAL" : hasWarnings ? "WARNING" : "Observation"} sent to Ace. (${alerts.length} alert rules triggered)`);
      }
    } catch (err: any) {
      console.error(`[SapphireSentinel] Scan error: ${err.message}`);
    }
  }
}
