-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- agent_spend — per-turn cost tracking for every agent in the swarm.
-- Created S125+ (2026-04-30) as part of the Agentic Refactor Phase 1.
-- Powers the Mission Control "Agent Spend" tile (next-session build,
-- documented in NORTH_STAR.md).
--
-- The bot side: src/tools/spend-logger.ts writes one row per LLM call,
-- hooked into AgentLoop.processMessage. Captures every agent uniformly
-- (Sapphire, Anita, Yuki, Vector, Veritas, Alfred).
--
-- Cost model (S125+ pricing):
--   - Per-token: charged by Anthropic/Gemini directly, mirrored here for
--     visibility (input_tokens, output_tokens).
--   - Per-server-tool: web_search_20250305 = $0.01/call. Other server
--     tools added as Anthropic ships them.
--   - total_cost_usd = (input_tokens × input_rate) + (output_tokens × output_rate)
--                    + server_tool_cost_usd. The logger computes this; this
--     table just stores the result.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.agent_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  model text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  server_tool_calls int NOT NULL DEFAULT 0,
  server_tool_cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  total_cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  channel text,
  chat_id text,
  turn_id text,
  iteration_count int NOT NULL DEFAULT 1,
  finish_reason text,
  -- Optional per-server-tool breakdown when Anthropic returns it.
  -- Example: {"web_search_requests": 2, "code_execution_calls": 0}
  server_tool_breakdown jsonb,
  -- Free-form metadata for future fields without migrations
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Hot path: per-agent recent activity (Mission Control tile reads this)
CREATE INDEX IF NOT EXISTS idx_agent_spend_agent_created
  ON public.agent_spend (agent_name, created_at DESC);

-- Hot path: time-window aggregations (today/week/month rollups)
CREATE INDEX IF NOT EXISTS idx_agent_spend_created
  ON public.agent_spend (created_at DESC);

-- Hot path: chat-level cost tracking (debugging a specific runaway turn)
CREATE INDEX IF NOT EXISTS idx_agent_spend_chat
  ON public.agent_spend (chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;

-- ── Row-Level Security ──
-- Service role (bot writes, MC server reads): full access.
-- Anon (browser): read-only — MC dashboard reads this directly via the
-- anon key. No PII in this table; safe for direct anon read.
ALTER TABLE public.agent_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_agent_spend" ON public.agent_spend
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon_read_agent_spend" ON public.agent_spend
  FOR SELECT
  TO anon
  USING (true);

-- ── Convenience views for the MC tile ──
-- These let the dashboard run cheap reads without recomputing aggregates.
-- Mission Control can either query these views or reconstruct the SQL itself
-- per the NORTH_STAR.md "Next Session Build" sketch.

CREATE OR REPLACE VIEW public.agent_spend_today AS
  SELECT
    agent_name,
    COUNT(*) AS turns,
    SUM(input_tokens) AS total_input_tokens,
    SUM(output_tokens) AS total_output_tokens,
    SUM(server_tool_calls) AS total_server_tool_calls,
    SUM(server_tool_cost_usd) AS server_tool_cost,
    SUM(total_cost_usd) AS total_cost,
    AVG(total_cost_usd) AS avg_cost_per_turn,
    MAX(total_cost_usd) AS max_cost_single_turn
  FROM public.agent_spend
  WHERE created_at >= date_trunc('day', now())
  GROUP BY agent_name
  ORDER BY total_cost DESC;

CREATE OR REPLACE VIEW public.agent_spend_this_week AS
  SELECT
    agent_name,
    COUNT(*) AS turns,
    SUM(input_tokens) AS total_input_tokens,
    SUM(output_tokens) AS total_output_tokens,
    SUM(server_tool_calls) AS total_server_tool_calls,
    SUM(server_tool_cost_usd) AS server_tool_cost,
    SUM(total_cost_usd) AS total_cost,
    AVG(total_cost_usd) AS avg_cost_per_turn,
    MAX(total_cost_usd) AS max_cost_single_turn
  FROM public.agent_spend
  WHERE created_at >= date_trunc('week', now())
  GROUP BY agent_name
  ORDER BY total_cost DESC;

CREATE OR REPLACE VIEW public.agent_spend_this_month AS
  SELECT
    agent_name,
    COUNT(*) AS turns,
    SUM(input_tokens) AS total_input_tokens,
    SUM(output_tokens) AS total_output_tokens,
    SUM(server_tool_calls) AS total_server_tool_calls,
    SUM(server_tool_cost_usd) AS server_tool_cost,
    SUM(total_cost_usd) AS total_cost,
    AVG(total_cost_usd) AS avg_cost_per_turn,
    MAX(total_cost_usd) AS max_cost_single_turn
  FROM public.agent_spend
  WHERE created_at >= date_trunc('month', now())
  GROUP BY agent_name
  ORDER BY total_cost DESC;

-- Allow anon to read the views (mirrors the table policy)
GRANT SELECT ON public.agent_spend_today TO anon;
GRANT SELECT ON public.agent_spend_this_week TO anon;
GRANT SELECT ON public.agent_spend_this_month TO anon;

COMMENT ON TABLE public.agent_spend IS
  'Per-turn cost tracking for every Maven Crew agent. Written by src/tools/spend-logger.ts in Sentinel Bot. Read by Mission Control Agent Spend tile. S125+ (2026-04-30).';
