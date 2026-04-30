// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Spend Logger — per-LLM-call cost tracking for every agent in the swarm.
// Created S125+ (2026-04-30) as part of the Agentic Refactor Phase 1.
//
// Hooked into AgentLoop.processMessage right after each activeLLM.generate
// call. Writes one row to public.agent_spend in Supabase per LLM call.
// Mission Control reads from agent_spend (and the agent_spend_today /
// _this_week / _this_month views) to render the "Agent Spend" tile.
//
// Design notes:
//   - Pure module, no class. Fire-and-forget. Never blocks the agent loop.
//   - Pricing table below MUST be kept current. When Anthropic or Gemini ships
//     new models or changes prices, update PRICING_PER_MILLION_TOKENS.
//   - Unknown models log $0 cost rather than guessing — that's the signal to
//     add them to the table.
//   - Per-iteration logging (not per-turn aggregate) for full granularity.
//     Multiple rows can share the same turn_id.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMResponse } from "../types";

export interface SpendLogEntry {
  agentName: string;
  channel?: string;
  chatId?: string;
  turnId?: string;
  iterationCount?: number;
}

// USD per 1,000,000 tokens. Updated S125+ (2026-04-30).
// SOURCE: Anthropic + Google pricing pages. If a model isn't here, find it
// during the next pricing review and add it. Until then it logs $0.
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  // ── Anthropic ──
  "claude-sonnet-4-5": { input: 3.00, output: 15.00 },
  "claude-sonnet-4": { input: 3.00, output: 15.00 },
  "claude-opus-4-5": { input: 15.00, output: 75.00 },
  "claude-opus-4": { input: 15.00, output: 75.00 },
  "claude-haiku-4-5": { input: 0.80, output: 4.00 },
  "claude-3-7-sonnet": { input: 3.00, output: 15.00 },
  "claude-3-5-sonnet": { input: 3.00, output: 15.00 },
  "claude-3-5-haiku": { input: 0.80, output: 4.00 },
  // ── Gemini (Google) ──
  "gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
  "gemini-2.5-flash": { input: 0.30, output: 2.50 },
  "gemini-2.5-pro": { input: 1.25, output: 5.00 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.0-pro": { input: 1.25, output: 5.00 },
  "gemini-1.5-pro": { input: 1.25, output: 5.00 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  // ── Groq (Llama) ──
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-70b": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  // ── DeepSeek ──
  "deepseek-chat": { input: 0.27, output: 1.10 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

// USD per server-tool invocation. Updated S125+ (2026-04-30).
// Anthropic returns these counts in usage.server_tool_use.{key}.
const SERVER_TOOL_PRICING: Record<string, number> = {
  web_search_requests: 0.01,
  web_fetch_requests: 0.01,
  // code_execution / computer_use have different pricing models (per-second
  // or per-action). Add when we start using them.
};

function findPricing(model: string): { input: number; output: number } {
  // Exact match first
  if (PRICING_PER_MILLION_TOKENS[model]) return PRICING_PER_MILLION_TOKENS[model];
  // Prefix match — e.g. "claude-sonnet-4-5-20251015" → "claude-sonnet-4-5"
  // Sort keys longest-first so "claude-sonnet-4-5" beats "claude-sonnet-4"
  // when both could prefix-match.
  const sortedKeys = Object.keys(PRICING_PER_MILLION_TOKENS).sort(
    (a, b) => b.length - a.length,
  );
  for (const key of sortedKeys) {
    if (model.startsWith(key)) return PRICING_PER_MILLION_TOKENS[key];
  }
  return { input: 0, output: 0 };
}

function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  serverToolBreakdown?: Record<string, number>,
): { tokenCost: number; serverToolCost: number; total: number } {
  const pricing = findPricing(model);
  const tokenCost =
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  let serverToolCost = 0;
  if (serverToolBreakdown) {
    for (const [key, count] of Object.entries(serverToolBreakdown)) {
      const perCall = SERVER_TOOL_PRICING[key] || 0;
      serverToolCost += perCall * count;
    }
  }
  return { tokenCost, serverToolCost, total: tokenCost + serverToolCost };
}

export async function logSpend(
  response: LLMResponse,
  entry: SpendLogEntry,
): Promise<void> {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return; // silent skip — env not configured

    const usage = response.usage;
    if (!usage) return;
    // Skip rows where the response was an outright provider error to avoid
    // polluting the cost data with $0 rows that aren't real conversations.
    if (response.finishReason === "error" && usage.inputTokens === 0) return;

    const cost = computeCost(
      response.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.serverToolBreakdown,
    );

    const row = {
      agent_name: entry.agentName,
      model: response.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      server_tool_calls: usage.serverToolCalls || 0,
      server_tool_cost_usd: Number(cost.serverToolCost.toFixed(4)),
      total_cost_usd: Number(cost.total.toFixed(4)),
      channel: entry.channel || null,
      chat_id: entry.chatId || null,
      turn_id: entry.turnId || null,
      iteration_count: entry.iterationCount || 1,
      finish_reason: response.finishReason,
      server_tool_breakdown: usage.serverToolBreakdown || null,
    };

    await fetch(`${supabaseUrl}/rest/v1/agent_spend`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    }).catch((err) => {
      console.warn(`[spend-logger] write failed: ${err?.message || err}`);
    });
  } catch (err: any) {
    // Never block the agent on spend logging
    console.warn(`[spend-logger] unexpected error: ${err.message}`);
  }
}
