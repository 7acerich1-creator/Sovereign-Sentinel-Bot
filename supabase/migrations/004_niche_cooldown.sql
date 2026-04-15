-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PROJECT_POD_MIGRATION Phase 3 Task 3.5 — Niche cooldown ledger
--
-- Alfred's dual-seed generator (Task 3.3) emits one niche per brand per run.
-- Without a cooldown, the same niche can repeat day after day until the
-- audience stops believing the channel has range. The cooldown is:
--
--   • 30-day hard floor — same brand cannot run the same niche within 30d
--   • 14-day soft relax — if all niches in a brand's allowlist are within
--     the 30d window, the 14d-aged niche is permitted (prevents a total stall)
--
-- The Sentinel bot queries this table when Alfred scores candidate niches.
-- Mission Control reads it to surface "what ran when" per brand.
--
-- READ: src/data/shared-context.ts BRAND_NICHE_ALLOWLIST for niche universe.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.niche_cooldown (
  id           bigserial PRIMARY KEY,
  brand        text      NOT NULL,
  niche        text      NOT NULL,
  -- The downstream artifact this niche-run produced (for traceability). NULL
  -- while the seed is in flight; filled by the ship/upload step in Task 3.7.
  job_id       text,
  -- Canonical kebab-case form (matches normalizeNiche output). Required so the
  -- query path doesn't have to re-normalize on every scan.
  niche_norm   text      NOT NULL,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  -- Optional breadcrumbs — useful when Mission Control shows the ledger.
  thesis       text,
  source       text DEFAULT 'alfred_daily',
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Brand integrity: enforce the two-brand universe at the DB layer so a stray
  -- Supabase insert can't pollute the ledger. Matches pod/types.ts Brand.
  CONSTRAINT niche_cooldown_brand_chk
    CHECK (brand IN ('ace_richie', 'containment_field')),

  -- Niche integrity: enforce the allowlist at the DB layer. This is the hard
  -- floor. Application-layer (isAllowedNiche) is the ergonomic layer.
  CONSTRAINT niche_cooldown_niche_chk
    CHECK (
      (brand = 'ace_richie' AND niche_norm IN (
        'sovereignty','authority','architecture','system-mastery','wealth-frequency'
      ))
      OR
      (brand = 'containment_field' AND niche_norm IN (
        'burnout','dark-psychology','containment','manipulation-exposed','pattern-interrupt'
      ))
    )
);

-- Hot-path index for "most recent run of <brand,niche>" — the shape of the
-- cooldown query. DESC on ran_at lets Postgres stop at the first match.
CREATE INDEX IF NOT EXISTS niche_cooldown_brand_niche_ran_at_idx
  ON public.niche_cooldown (brand, niche_norm, ran_at DESC);

-- Secondary index for per-brand timelines (Mission Control read path).
CREATE INDEX IF NOT EXISTS niche_cooldown_brand_ran_at_idx
  ON public.niche_cooldown (brand, ran_at DESC);

-- RLS — service_role full, anon read-only (so Mission Control can display
-- the timeline without a service key). No anon writes.
ALTER TABLE public.niche_cooldown ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS niche_cooldown_service_role_all ON public.niche_cooldown;
CREATE POLICY niche_cooldown_service_role_all ON public.niche_cooldown
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS niche_cooldown_anon_read ON public.niche_cooldown;
CREATE POLICY niche_cooldown_anon_read ON public.niche_cooldown
  FOR SELECT TO anon USING (true);

-- ──────────────────────────────────────────────────────────────
-- View: last_run_per_niche — collapses the ledger to (brand, niche_norm,
-- last_ran_at). Alfred reads this in the pre-seed cooldown check.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.niche_last_run AS
SELECT
  brand,
  niche_norm,
  max(ran_at) AS last_ran_at
FROM public.niche_cooldown
GROUP BY brand, niche_norm;

COMMENT ON TABLE public.niche_cooldown IS
  'Phase 3 Task 3.5 — per-brand niche run ledger. 30d hard / 14d soft cooldown gate for Alfred.';
COMMENT ON VIEW public.niche_last_run IS
  'Phase 3 Task 3.5 — collapsed view of niche_cooldown for Alfred''s pre-seed cooldown query.';
