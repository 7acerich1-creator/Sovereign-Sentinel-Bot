// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Marketing Fat Tool — S125+ Phase 7 (2026-04-30)
//
// Anita's primary capability surface for Marketing Lead work. Starter
// version — will grow significantly as Architect develops his marketing
// strategy and patterns emerge. This is the foundation, not the ceiling.
//
// Architect directive 2026-04-30: NO cross-crew dispatch authority yet.
// Anita reasons + drafts + tracks; Architect coordinates the actual crew
// dispatch (Yuki for distribution, Vector for metrics) until the pattern
// is proven. This tool surface is build-her-thinking-and-tracking, not
// build-her-as-conductor.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { config } from "../config";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// ── Controlled vocabulary ───────────────────────────────────────────────────

const CHANNELS = [
  "youtube", "youtube_shorts", "instagram", "instagram_reels",
  "tiktok", "bluesky", "facebook",
  "email", "newsletter", "landing_page", "stripe_checkout",
  "podcast", "blog", "telegram", "other",
] as const;

const EXPERIMENT_STATUSES = ["planning", "running", "concluded", "abandoned"] as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARKETING FAT TOOL — single tool, multiple actions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class MarketingTool implements Tool {
  definition: ToolDefinition = {
    name: "marketing",
    description:
      "Marketing strategy and tracking operations. Use for: campaign briefs, audience definition, hypothesis testing, channel performance reads. NO cross-crew dispatch — when a campaign needs Yuki to post or Vector to pull metrics, Anita drafts the requirement and surfaces it for Architect to coordinate. (Dispatch authority will be granted in a later phase once the pattern is proven.)\n\n" +
      "ACTIONS:\n" +
      "• draft_campaign — produce a structured campaign brief (positioning, message, channels, audience, success metric, hypothesis). Required: name, audience, message_core, channels, success_metric. Returns the brief; doesn't auto-execute.\n" +
      "• define_audience — define or update an audience segment. Required: name. Optional: description, attributes (jsonb), size_estimate, channels, pain_points, desired_outcomes. Idempotent on name.\n" +
      "• list_audiences — list active audience segments. Optional: limit.\n" +
      "• log_experiment — start tracking a hypothesis test. Required: name, hypothesis, metric. Optional: variant_a, variant_b, channel, audience_segment (name). Status starts 'planning'.\n" +
      "• update_experiment — change status / record result / declare winner. Required: id. Optional: status ('running' | 'concluded' | 'abandoned'), result (text), winner ('A' | 'B' | null).\n" +
      "• list_experiments — list experiments. Optional: status filter, limit.\n" +
      "• analyze_channel — interpret channel performance from current data + Anita's archival memory. Required: channel. Optional: window_days (default 30). Returns natural-language read with anchored numbers.\n\n" +
      "PHILOSOPHY: Anita is a strategic mind, not a deterministic specialist. When in doubt, draft (don't dispatch), define (don't decide), track (don't conclude). Architect remains in the coordination loop.",
    parameters: {
      action: {
        type: "string",
        description: "draft_campaign | define_audience | list_audiences | log_experiment | update_experiment | list_experiments | analyze_channel",
        enum: ["draft_campaign", "define_audience", "list_audiences", "log_experiment", "update_experiment", "list_experiments", "analyze_channel"],
      },
      // draft_campaign
      name: { type: "string", description: "[draft_campaign, define_audience, log_experiment] Name." },
      audience: { type: "string", description: "[draft_campaign] Audience segment name (existing or new)." },
      message_core: { type: "string", description: "[draft_campaign] Core message — single sentence the campaign is built around." },
      channels: { type: "array", description: "[draft_campaign, define_audience] Channels (controlled vocab).", items: { type: "string", description: "channel" } },
      success_metric: { type: "string", description: "[draft_campaign] How success is measured (e.g. 'email signups', 'paid conversions')." },
      campaign_hypothesis: { type: "string", description: "[draft_campaign] Hypothesis the campaign tests." },
      // define_audience
      description: { type: "string", description: "[define_audience] Plain-English description." },
      attributes: { type: "object", description: "[define_audience] Structured attributes (jsonb)." },
      size_estimate: { type: "number", description: "[define_audience] Rough audience size." },
      pain_points: { type: "string", description: "[define_audience] What this audience struggles with." },
      desired_outcomes: { type: "string", description: "[define_audience] What this audience wants." },
      // list_audiences / list_experiments
      limit: { type: "number", description: "[list_*] Max results, default 20." },
      // log_experiment
      hypothesis: { type: "string", description: "[log_experiment] What you predict will happen and why." },
      variant_a: { type: "string", description: "[log_experiment] Variant A description." },
      variant_b: { type: "string", description: "[log_experiment] Variant B description." },
      metric: { type: "string", description: "[log_experiment] How the experiment will be measured." },
      channel: { type: "string", description: "[log_experiment, analyze_channel] Channel.", enum: [...CHANNELS] },
      audience_segment: { type: "string", description: "[log_experiment] Audience segment name." },
      // update_experiment
      id: { type: "string", description: "[update_experiment] Experiment UUID." },
      status: { type: "string", description: "[update_experiment, list_experiments] Status.", enum: [...EXPERIMENT_STATUSES, "all"] },
      result: { type: "string", description: "[update_experiment] Free-form result writeup." },
      winner: { type: "string", description: "[update_experiment] 'A' | 'B' | null." },
      // analyze_channel
      window_days: { type: "number", description: "[analyze_channel] Analysis window. Default 30." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    try {
      switch (action) {
        case "draft_campaign": return await this.draftCampaign(args);
        case "define_audience": return await this.defineAudience(args);
        case "list_audiences": return await this.listAudiences(args);
        case "log_experiment": return await this.logExperiment(args);
        case "update_experiment": return await this.updateExperiment(args);
        case "list_experiments": return await this.listExperiments(args);
        case "analyze_channel": return await this.analyzeChannel(args);
        default: return `marketing: unknown action '${action}'. Valid: draft_campaign | define_audience | list_audiences | log_experiment | update_experiment | list_experiments | analyze_channel`;
      }
    } catch (e: any) {
      return `marketing: error in ${action} — ${e.message || String(e)}`;
    }
  }

  // ── Action: draft_campaign — structured brief returned, NOT auto-executed ──
  private async draftCampaign(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || "").trim();
    const audience = String(args.audience || "").trim();
    const messageCore = String(args.message_core || "").trim();
    const channelsArr = Array.isArray(args.channels) ? (args.channels as string[]).map((c) => String(c)) : [];
    const successMetric = String(args.success_metric || "").trim();
    const hypothesis = args.campaign_hypothesis ? String(args.campaign_hypothesis) : "(none stated)";

    if (!name) return "marketing.draft_campaign: name required.";
    if (!audience) return "marketing.draft_campaign: audience required (segment name — define_audience first if it doesn't exist).";
    if (!messageCore) return "marketing.draft_campaign: message_core required (single sentence the campaign is built around).";
    if (channelsArr.length === 0) return "marketing.draft_campaign: at least one channel required.";
    if (!successMetric) return "marketing.draft_campaign: success_metric required.";

    const invalidChannels = channelsArr.filter((c) => !CHANNELS.includes(c as any));
    if (invalidChannels.length > 0) {
      return `marketing.draft_campaign: invalid channels: ${invalidChannels.join(", ")}. Allowed: ${CHANNELS.join(", ")}`;
    }

    return [
      `📋 CAMPAIGN BRIEF — ${name}`,
      ``,
      `Audience: ${audience}`,
      `Core message: ${messageCore}`,
      `Channels: ${channelsArr.join(", ")}`,
      `Success metric: ${successMetric}`,
      `Hypothesis: ${hypothesis}`,
      ``,
      `Status: DRAFTED. Architect coordinates execution.`,
      `Anita's next moves: log_experiment with this hypothesis to start tracking.`,
    ].join("\n");
  }

  // ── Action: define_audience ────────────────────────────────────────────────
  private async defineAudience(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || "").trim();
    if (!name) return "marketing.define_audience: name required.";
    const description = args.description ? String(args.description) : null;
    const attributes = (args.attributes as Record<string, any>) || null;
    const sizeEstimate = args.size_estimate !== undefined && args.size_estimate !== null
      ? Number(args.size_estimate)
      : null;
    const channels = Array.isArray(args.channels) ? args.channels : null;
    const painPoints = args.pain_points ? String(args.pain_points) : null;
    const desiredOutcomes = args.desired_outcomes ? String(args.desired_outcomes) : null;

    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("anita_audience_segments")
      .upsert(
        {
          name,
          description,
          attributes,
          size_estimate: sizeEstimate,
          channels,
          pain_points: painPoints,
          desired_outcomes: desiredOutcomes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "name" },
      )
      .select("id")
      .single();

    if (error) return `marketing.define_audience: Supabase error — ${error.message}`;
    return `Audience segment '${name}' upserted. ID: ${data.id}`;
  }

  // ── Action: list_audiences ─────────────────────────────────────────────────
  private async listAudiences(args: Record<string, unknown>): Promise<string> {
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("anita_audience_segments")
      .select("id, name, description, size_estimate, pain_points, channels")
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) return `marketing.list_audiences: Supabase error — ${error.message}`;
    const rows = (data || []) as any[];
    if (rows.length === 0) return "No active audience segments yet. Use define_audience to create one.";

    const lines = rows.map((r: any) => {
      const sizeStr = r.size_estimate ? ` ~${r.size_estimate.toLocaleString()}` : "";
      const channelsStr = r.channels && r.channels.length ? ` [${r.channels.join(",")}]` : "";
      const painStr = r.pain_points ? `\n  pain: ${r.pain_points.slice(0, 100)}` : "";
      return `• ${r.name}${sizeStr}${channelsStr}\n  ${r.description || "(no description)"}${painStr}`;
    });
    return `Audience segments (${rows.length}):\n${lines.join("\n\n")}`;
  }

  // ── Action: log_experiment ─────────────────────────────────────────────────
  private async logExperiment(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || "").trim();
    const hypothesis = String(args.hypothesis || "").trim();
    const metric = String(args.metric || "").trim();
    if (!name) return "marketing.log_experiment: name required.";
    if (!hypothesis) return "marketing.log_experiment: hypothesis required.";
    if (!metric) return "marketing.log_experiment: metric required.";

    const variantA = args.variant_a ? String(args.variant_a) : null;
    const variantB = args.variant_b ? String(args.variant_b) : null;
    const channel = args.channel ? String(args.channel) : null;
    const audienceName = args.audience_segment ? String(args.audience_segment).trim() : null;

    const supabase = await getSupabase();

    // Resolve audience_segment if given
    let audienceId: string | null = null;
    if (audienceName) {
      const { data: audRow } = await supabase
        .from("anita_audience_segments")
        .select("id")
        .eq("name", audienceName)
        .maybeSingle();
      if (!audRow) return `marketing.log_experiment: audience_segment '${audienceName}' not found. Run define_audience first.`;
      audienceId = audRow.id;
    }

    const { data, error } = await supabase
      .from("anita_experiments")
      .insert({
        name,
        hypothesis,
        variant_a: variantA,
        variant_b: variantB,
        metric,
        channel,
        audience_segment_id: audienceId,
        status: "planning",
      })
      .select("id")
      .single();

    if (error) return `marketing.log_experiment: Supabase error — ${error.message}`;
    return `Experiment '${name}' logged (status: planning). ID: ${data.id}\n  Hypothesis: ${hypothesis}\n  Metric: ${metric}\n  Use update_experiment when you flip status to 'running' or record results.`;
  }

  // ── Action: update_experiment ──────────────────────────────────────────────
  private async updateExperiment(args: Record<string, unknown>): Promise<string> {
    const id = String(args.id || "").trim();
    if (!id) return "marketing.update_experiment: id required.";

    const updates: Record<string, any> = {};
    if (args.status) {
      const s = String(args.status);
      if (!EXPERIMENT_STATUSES.includes(s as any)) return `marketing.update_experiment: status '${s}' invalid.`;
      updates.status = s;
      if (s === "running" && !updates.started_at) updates.started_at = new Date().toISOString();
      if (s === "concluded" || s === "abandoned") updates.concluded_at = new Date().toISOString();
    }
    if (args.result !== undefined) updates.result = String(args.result);
    if (args.winner !== undefined) updates.winner = args.winner ? String(args.winner) : null;

    if (Object.keys(updates).length === 0) {
      return "marketing.update_experiment: no updates provided (status / result / winner).";
    }

    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("anita_experiments")
      .update(updates)
      .eq("id", id)
      .select("id, name, status")
      .maybeSingle();

    if (error) return `marketing.update_experiment: Supabase error — ${error.message}`;
    if (!data) return `marketing.update_experiment: no experiment with id ${id}.`;
    return `Experiment '${data.name}' updated. Status: ${data.status}.`;
  }

  // ── Action: list_experiments ───────────────────────────────────────────────
  private async listExperiments(args: Record<string, unknown>): Promise<string> {
    const filter = String(args.status || "running");
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));

    const supabase = await getSupabase();
    let query = supabase
      .from("anita_experiments")
      .select("id, name, hypothesis, metric, channel, status, result, winner, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (filter !== "all") query = query.eq("status", filter);

    const { data, error } = await query;
    if (error) return `marketing.list_experiments: Supabase error — ${error.message}`;
    const rows = (data || []) as any[];
    if (rows.length === 0) return `No experiments matching status='${filter}'.`;

    const lines = rows.map((r: any) => {
      const winnerStr = r.winner ? ` winner=${r.winner}` : "";
      const channelStr = r.channel ? ` [${r.channel}]` : "";
      const resultStr = r.result ? `\n  result: ${r.result.slice(0, 150)}` : "";
      return `• ${r.name} (${r.status}${winnerStr})${channelStr}\n  hyp: ${r.hypothesis.slice(0, 150)}${resultStr}\n  metric: ${r.metric}`;
    });
    return `Experiments (status=${filter}, ${rows.length}):\n${lines.join("\n\n")}`;
  }

  // ── Action: analyze_channel — natural-language read with anchored numbers ──
  // Starter: pulls recent experiments + audience associations for the channel.
  // Future: integrates with Buffer/YouTube/Stripe metrics for actual perf data.
  private async analyzeChannel(args: Record<string, unknown>): Promise<string> {
    const channel = String(args.channel || "").trim();
    if (!CHANNELS.includes(channel as any)) {
      return `marketing.analyze_channel: channel '${channel}' invalid. Allowed: ${CHANNELS.join(", ")}`;
    }
    const windowDays = Math.max(1, Math.min(365, Number(args.window_days) || 30));

    const supabase = await getSupabase();
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: experiments } = await supabase
      .from("anita_experiments")
      .select("id, name, status, result, winner, hypothesis, created_at")
      .eq("channel", channel)
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    const expCount = (experiments || []).length;
    const concluded = (experiments || []).filter((e: any) => e.status === "concluded");
    const winners = concluded.filter((e: any) => e.winner);

    const lines: string[] = [];
    lines.push(`📊 CHANNEL READ — ${channel} (${windowDays}d window)`);
    lines.push(``);
    lines.push(`Experiments tracked: ${expCount} (${concluded.length} concluded, ${winners.length} with declared winners)`);
    if (concluded.length > 0) {
      lines.push(``);
      lines.push(`Recent conclusions:`);
      for (const e of concluded.slice(0, 5)) {
        lines.push(`  • ${e.name}${e.winner ? ` (winner=${e.winner})` : ""}: ${(e.result || "(no writeup)").slice(0, 200)}`);
      }
    }
    lines.push(``);
    lines.push(`Note: this is the starter analyze_channel. Future versions will integrate Buffer/YouTube/Stripe metrics for actual performance numbers. For now, surfaces what Anita has tracked herself.`);

    return lines.join("\n");
  }
}
