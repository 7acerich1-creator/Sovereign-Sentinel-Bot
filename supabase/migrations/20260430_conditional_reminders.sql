-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- conditional_reminders — threshold-triggered alerts that fire when a watched
-- metric crosses a configured value. Phase 2 (S125+, 2026-04-30).
--
-- Architect's bank-account use case: "Remind me to open a new bank account
-- when revenue hits $1,000." Sapphire writes one row, the scheduler checks
-- every 15 min, fires on cross. Makes her ANTICIPATORY instead of reactive.
--
-- Metric source enum is enforced at the tool layer (src/tools/sapphire/
-- conditional_reminders.ts), NOT at the DB layer — so new metrics can be added
-- in code without a schema migration.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.conditional_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'sapphire',
  chat_id text NOT NULL,
  metric_source text NOT NULL,
  comparison_op text NOT NULL CHECK (comparison_op IN ('>=', '>', '=', '<', '<=')),
  threshold numeric NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fired', 'cancelled', 'expired')),
  last_checked_at timestamptz,
  last_observed_value numeric,
  fired_at timestamptz,
  expires_at timestamptz,
  metadata jsonb
);

-- Hot path: scheduler reads only active, non-expired rows
CREATE INDEX IF NOT EXISTS idx_conditional_reminders_active
  ON public.conditional_reminders (status, metric_source)
  WHERE status = 'active';

-- Hot path: per-chat lookups (list/cancel by chat_id)
CREATE INDEX IF NOT EXISTS idx_conditional_reminders_chat
  ON public.conditional_reminders (chat_id, created_at DESC);

-- Hot path: time-window expiry sweep
CREATE INDEX IF NOT EXISTS idx_conditional_reminders_expires
  ON public.conditional_reminders (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';

-- ── Row-Level Security ──
ALTER TABLE public.conditional_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_conditional_reminders" ON public.conditional_reminders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon_read_conditional_reminders" ON public.conditional_reminders
  FOR SELECT
  TO anon
  USING (true);

-- ── Convenience views for Mission Control / debugging ──

CREATE OR REPLACE VIEW public.conditional_reminders_active AS
  SELECT
    id,
    created_by,
    chat_id,
    metric_source,
    comparison_op,
    threshold,
    message,
    last_checked_at,
    last_observed_value,
    expires_at,
    created_at
  FROM public.conditional_reminders
  WHERE status = 'active'
  ORDER BY metric_source, threshold;

CREATE OR REPLACE VIEW public.conditional_reminders_recently_fired AS
  SELECT
    id,
    created_by,
    chat_id,
    metric_source,
    comparison_op,
    threshold,
    message,
    last_observed_value,
    fired_at,
    created_at
  FROM public.conditional_reminders
  WHERE status = 'fired'
    AND fired_at > now() - interval '7 days'
  ORDER BY fired_at DESC;

GRANT SELECT ON public.conditional_reminders_active TO anon;
GRANT SELECT ON public.conditional_reminders_recently_fired TO anon;

COMMENT ON TABLE public.conditional_reminders IS
  'Threshold-triggered reminders. Sapphire writes via conditional_reminders tool. The conditional-reminders-checker scheduler reads every 15 min, fires on crossings. S125+ Phase 2 (2026-04-30).';
