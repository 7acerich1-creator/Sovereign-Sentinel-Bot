-- ============================================================
-- S126 — Self-healing infrastructure
-- 2026-04-30
--
-- Tables:
--   deploy_events       — Layer 1+2 audit trail of every Railway
--                         webhook event (FAILED/CRASHED/SUCCESS).
--                         Drives the auto-retry idempotency check.
--   bot_health_pulses   — Layer 4 canary log. One row per canary
--                         run. Used to detect "bot dead" patterns
--                         (no recent agent_spend writes despite
--                         green canary => deeper investigation).
--   smoke_test_runs     — Layer 3 boot-smoke-test outcomes. One
--                         row per boot. Useful for tracking which
--                         dependencies are flaky over time.
--
-- All tables: RLS enabled, service_role full access, anon read-only
-- so Mission Control can surface them on the dashboard later.
-- ============================================================

-- ── Layer 1+2: deploy_events ──
CREATE TABLE IF NOT EXISTS public.deploy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id text NOT NULL,
  project_id text,
  service_id text,
  environment_id text,
  status text NOT NULL,
  classification text,        -- transient | code_bug | unknown | n/a
  action_taken text,          -- alert_only | auto_redeploy | escalated | redeploy_failed | no_op
  retry_count int NOT NULL DEFAULT 0,
  error_excerpt text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deploy_events_deployment_id
  ON public.deploy_events (deployment_id);
CREATE INDEX IF NOT EXISTS idx_deploy_events_created_at
  ON public.deploy_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_events_status_created
  ON public.deploy_events (status, created_at DESC);

ALTER TABLE public.deploy_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role full access" ON public.deploy_events;
CREATE POLICY "service_role full access"
  ON public.deploy_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon read-only" ON public.deploy_events;
CREATE POLICY "anon read-only"
  ON public.deploy_events FOR SELECT
  TO anon
  USING (true);

-- ── Layer 4: bot_health_pulses ──
CREATE TABLE IF NOT EXISTS public.bot_health_pulses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_name text NOT NULL,           -- 'sapphire' | 'veritas' | etc.
  pulse_kind text NOT NULL,         -- 'getMe' | 'spend_freshness' | 'composite'
  status text NOT NULL,             -- 'ok' | 'degraded' | 'dead'
  latency_ms int,
  details jsonb,
  alerted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_health_pulses_bot_created
  ON public.bot_health_pulses (bot_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_health_pulses_status_created
  ON public.bot_health_pulses (status, created_at DESC);

ALTER TABLE public.bot_health_pulses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role full access" ON public.bot_health_pulses;
CREATE POLICY "service_role full access"
  ON public.bot_health_pulses FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon read-only" ON public.bot_health_pulses;
CREATE POLICY "anon read-only"
  ON public.bot_health_pulses FOR SELECT
  TO anon
  USING (true);

-- ── Layer 3: smoke_test_runs ──
CREATE TABLE IF NOT EXISTS public.smoke_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boot_id uuid NOT NULL,            -- one boot can have many checks; this groups them
  check_name text NOT NULL,         -- 'supabase_table:agent_spend' | 'env:ANTHROPIC_API_KEY' | etc.
  severity text NOT NULL,           -- 'critical' | 'warning' | 'info'
  passed boolean NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smoke_test_runs_boot_id
  ON public.smoke_test_runs (boot_id);
CREATE INDEX IF NOT EXISTS idx_smoke_test_runs_created_at
  ON public.smoke_test_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smoke_test_runs_passed_severity
  ON public.smoke_test_runs (passed, severity, created_at DESC);

ALTER TABLE public.smoke_test_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role full access" ON public.smoke_test_runs;
CREATE POLICY "service_role full access"
  ON public.smoke_test_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon read-only" ON public.smoke_test_runs;
CREATE POLICY "anon read-only"
  ON public.smoke_test_runs FOR SELECT
  TO anon
  USING (true);
