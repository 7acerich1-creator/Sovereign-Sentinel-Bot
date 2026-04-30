// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire — Conditional Reminders Tool (S125+ Phase 2, 2026-04-30)
//
// Threshold-triggered reminders. Sapphire calls this tool with one of three
// actions: set / list / cancel. The conditional-reminders-checker scheduler
// (src/proactive/conditional-reminders-checker.ts) reads from the same table
// every 15 min and fires alerts when conditions cross.
//
// Architect's bank-account use case (2026-04-30): "Remind me to open a new
// bank account when revenue hits $1,000." Sapphire calls:
//   conditional_reminders({
//     action: "set",
//     metric: "stripe_revenue_total",
//     op: ">=",
//     threshold: 1000,
//     message: "Time to open the new bank account."
//   })
//
// Months later, Stripe revenue crosses $1k. Within 15 min, Telegram pings
// Architect with that exact message. No clock-based reminder, no manual
// checking. The system watches for him.
//
// Fat composable tool per Phase 4 architecture — one tool, three actions.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition, ToolContext } from "../../types";
import { config } from "../../config";

// ── Metric source enum ──────────────────────────────────────────────────────
// The full list of metrics Sapphire is allowed to set thresholds on. Adding a
// new source is two changes: add the key here AND add a fetcher in
// src/proactive/conditional-reminders-checker.ts METRIC_FETCHERS map. The DB
// itself doesn't enforce this enum so additions don't need a schema migration.
export const METRIC_SOURCES = [
  // Stripe — the financial coordinate-tracking sources
  "stripe_revenue_total",      // lifetime gross revenue, USD
  "stripe_revenue_30d",        // trailing 30 days
  "stripe_revenue_today",      // current day
  // YouTube — top-of-funnel attention sources (per NORTH_STAR's 5 input metrics)
  "youtube_subs_total",        // SS + TCF combined
  "youtube_views_28d",         // trailing 28 days, both channels combined
  // Funnel — conversion sources
  "initiates_count",           // rows in public.initiates (lead capture endpoint)
  // Self-monitoring — agent_spend visibility (Phase 1's spend_logger feeds this)
  "agent_spend_today",         // total USD across all agents, today
  "agent_spend_this_month",    // total USD across all agents, this month
  // Sovereign metrics — the core mission counters
  "sovereign_metrics_fiscal_sum",  // current liquid (target $1.2M)
  "sovereign_metrics_mindset_count", // liberated minds (target 100k)
  "sovereign_metrics_elite_count",   // initiates (target 100)
  "sovereign_metrics_velocity",      // calculated percentage
] as const;

export type MetricSource = (typeof METRIC_SOURCES)[number];

const COMPARISON_OPS = [">=", ">", "=", "<", "<="] as const;
type ComparisonOp = (typeof COMPARISON_OPS)[number];

// ── Supabase helpers ────────────────────────────────────────────────────────

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// ── The Tool ────────────────────────────────────────────────────────────────

export class ConditionalRemindersTool implements Tool {
  definition: ToolDefinition = {
    name: "conditional_reminders",
    description:
      "Set, list, or cancel threshold-triggered reminders. Use this when Architect wants to be notified WHEN something hits a value (e.g. 'remind me when revenue hits $1k', 'alert me if my agent spend exceeds $20/day') — NOT for time-based reminders (use set_reminder for those). " +
      "The scheduler checks every 15 min and fires the message via Telegram when the condition crosses. After firing once, the reminder marks itself 'fired' and won't re-fire — set a new one if you want re-trigger.\n\n" +
      "ACTIONS:\n" +
      "• action='set' — required: metric, op, threshold, message. Optional: expires_at (ISO8601), chat_id.\n" +
      "• action='list' — list active reminders for the current chat (or all if status='all').\n" +
      "• action='cancel' — required: id. Marks the reminder cancelled.\n\n" +
      "AVAILABLE METRICS:\n" +
      "• Financial: stripe_revenue_total / stripe_revenue_30d / stripe_revenue_today\n" +
      "• Audience: youtube_subs_total / youtube_views_28d\n" +
      "• Funnel: initiates_count\n" +
      "• Self-monitoring: agent_spend_today / agent_spend_this_month\n" +
      "• Mission counters: sovereign_metrics_fiscal_sum / sovereign_metrics_mindset_count / sovereign_metrics_elite_count / sovereign_metrics_velocity\n\n" +
      "EXAMPLES:\n" +
      "• Architect says 'remind me when revenue hits $1000 to open a new bank account' → conditional_reminders({action:'set', metric:'stripe_revenue_total', op:'>=', threshold:1000, message:'Time to open the new bank account.'})\n" +
      "• Architect says 'alert me if my agent costs blow past $20 today' → conditional_reminders({action:'set', metric:'agent_spend_today', op:'>=', threshold:20, message:'Agent spend exceeded $20 today — check Mission Control for the breakdown.'})\n" +
      "• Architect says 'what conditional alerts do I have set?' → conditional_reminders({action:'list'})\n" +
      "• Architect says 'cancel the bank account one' → conditional_reminders({action:'cancel', id:'<uuid from list>'})",
    parameters: {
      action: {
        type: "string",
        description: "One of: 'set', 'list', 'cancel'.",
        enum: ["set", "list", "cancel"],
      },
      metric: {
        type: "string",
        description: "For 'set' only. The metric to watch. See AVAILABLE METRICS in the tool description.",
        enum: [...METRIC_SOURCES],
      },
      op: {
        type: "string",
        description: "For 'set' only. Comparison operator: '>=', '>', '=', '<', '<='.",
        enum: [...COMPARISON_OPS],
      },
      threshold: {
        type: "number",
        description: "For 'set' only. The numeric threshold to compare against.",
      },
      message: {
        type: "string",
        description: "For 'set' only. The message to send when the threshold is crossed.",
      },
      expires_at: {
        type: "string",
        description: "For 'set' only. Optional ISO8601 timestamp after which the reminder auto-expires without firing.",
      },
      id: {
        type: "string",
        description: "For 'cancel' only. The reminder UUID returned by 'set' or shown by 'list'.",
      },
      status: {
        type: "string",
        description: "For 'list' only. Filter by status. Default 'active'. Use 'all' to include fired/cancelled/expired.",
        enum: ["active", "all", "fired", "cancelled", "expired"],
      },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, context?: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    const chatId = String(args.chat_id || context?.chatId || "");

    try {
      if (action === "set") return await this.handleSet(args, chatId);
      if (action === "list") return await this.handleList(args, chatId);
      if (action === "cancel") return await this.handleCancel(args);
      return `conditional_reminders: unknown action '${action}'. Use 'set', 'list', or 'cancel'.`;
    } catch (e: any) {
      return `conditional_reminders: error — ${e.message || String(e)}`;
    }
  }

  private async handleSet(args: Record<string, unknown>, chatId: string): Promise<string> {
    if (!chatId) return "conditional_reminders set: no chat_id available (tool called outside a chat context).";

    const metric = String(args.metric || "");
    const op = String(args.op || "");
    const thresholdRaw = Number(args.threshold);
    const message = String(args.message || "").trim();
    const expiresAt = args.expires_at ? String(args.expires_at) : null;

    if (!METRIC_SOURCES.includes(metric as MetricSource)) {
      return `conditional_reminders set: invalid metric '${metric}'. Allowed: ${METRIC_SOURCES.join(", ")}`;
    }
    if (!COMPARISON_OPS.includes(op as ComparisonOp)) {
      return `conditional_reminders set: invalid op '${op}'. Allowed: ${COMPARISON_OPS.join(", ")}`;
    }
    if (!Number.isFinite(thresholdRaw)) {
      return `conditional_reminders set: threshold must be a finite number, got ${args.threshold}`;
    }
    if (!message) {
      return "conditional_reminders set: message required.";
    }
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      return `conditional_reminders set: expires_at not a valid ISO8601 timestamp: ${expiresAt}`;
    }

    const supabase = await getSupabase();
    const insert = {
      created_by: "sapphire",
      chat_id: chatId,
      metric_source: metric,
      comparison_op: op,
      threshold: thresholdRaw,
      message,
      status: "active",
      expires_at: expiresAt,
    };

    const { data, error } = await supabase
      .from("conditional_reminders")
      .insert(insert)
      .select("id")
      .single();

    if (error) return `conditional_reminders set: Supabase error — ${error.message}`;
    if (!data?.id) return "conditional_reminders set: insert succeeded but no id returned.";

    return (
      `Conditional reminder set. ID: ${data.id}\n` +
      `Watching: ${metric} ${op} ${thresholdRaw}\n` +
      `Will fire: "${message}"\n` +
      `Checker runs every 15 min. ${expiresAt ? `Auto-expires ${expiresAt}.` : "No expiry."}`
    );
  }

  private async handleList(args: Record<string, unknown>, chatId: string): Promise<string> {
    const filter = String(args.status || "active");
    const supabase = await getSupabase();

    let query = supabase
      .from("conditional_reminders")
      .select("id, metric_source, comparison_op, threshold, message, status, last_observed_value, expires_at, fired_at, created_at")
      .order("created_at", { ascending: false });

    if (chatId) query = query.eq("chat_id", chatId);
    if (filter !== "all") query = query.eq("status", filter);

    const { data, error } = await query.limit(50);
    if (error) return `conditional_reminders list: Supabase error — ${error.message}`;

    const rows = (data || []) as any[];
    if (rows.length === 0) {
      return `No conditional reminders matching status='${filter}'${chatId ? " for this chat" : ""}.`;
    }

    const lines = rows.map((r: any) => {
      const expiry = r.expires_at ? ` | expires ${String(r.expires_at).slice(0, 10)}` : "";
      const lastObs = r.last_observed_value !== null && r.last_observed_value !== undefined
        ? ` | last observed: ${r.last_observed_value}`
        : "";
      const fired = r.fired_at ? ` | fired ${String(r.fired_at).slice(0, 16).replace("T", " ")}` : "";
      return `[${String(r.id).slice(0, 8)}] (${r.status}) ${r.metric_source} ${r.comparison_op} ${r.threshold}${lastObs}${expiry}${fired}\n   "${r.message}"`;
    });

    return `Conditional reminders (status=${filter}, ${rows.length} shown):\n${lines.join("\n")}`;
  }

  private async handleCancel(args: Record<string, unknown>): Promise<string> {
    const id = String(args.id || "").trim();
    if (!id) return "conditional_reminders cancel: id required.";

    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("conditional_reminders")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "active")
      .select("id, metric_source, threshold")
      .maybeSingle();

    if (error) return `conditional_reminders cancel: Supabase error — ${error.message}`;
    if (!data) return `conditional_reminders cancel: no active reminder with id starting '${id.slice(0, 8)}'. (May already be fired or cancelled.)`;
    return `Cancelled conditional reminder ${data.id}: ${data.metric_source} threshold ${data.threshold}.`;
  }
}
