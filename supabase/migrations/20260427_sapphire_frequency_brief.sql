-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Sapphire PA — Daily Frequency Alignment Brief
-- 2026-04-27
--
-- 1. Ensure sapphire_daily_pages exists (created directly in Supabase
--    during S114 — not yet in migrations).
-- 2. Add frequency_brief_at column for idempotency tracking.
--    The job checks this before sending so it never fires twice on the same day.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Ensure the table exists (no-op if already present from earlier manual creation)
CREATE TABLE IF NOT EXISTS public.sapphire_daily_pages (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date          NOT NULL UNIQUE,
  notion_page_id      text,
  status              text          NOT NULL DEFAULT 'pending',
  morning_brief_at    timestamptz,
  morning_brief_text  text,
  evening_wrap_at     timestamptz,
  evening_wrap_text   text,
  frequency_brief_at  timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- Add frequency_brief_at column if the table already existed without it
ALTER TABLE public.sapphire_daily_pages
  ADD COLUMN IF NOT EXISTS frequency_brief_at timestamptz;

-- Index for date-based lookups (covers morning brief, evening wrap, frequency brief checks)
CREATE INDEX IF NOT EXISTS idx_sapphire_daily_pages_date
  ON public.sapphire_daily_pages (date DESC);

-- Row-level security — service role has full access
ALTER TABLE public.sapphire_daily_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_full" ON public.sapphire_daily_pages;
CREATE POLICY "service_role_full" ON public.sapphire_daily_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON COLUMN public.sapphire_daily_pages.frequency_brief_at
  IS 'Set when Sapphire sends the daily Frequency Alignment Brief — prevents duplicate sends.';
