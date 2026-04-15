-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- S66 — Widen niche_cooldown CHECK constraint + retune client window
--
-- Migration 004 enforced the original 5-niche allowlist per brand at the DB
-- layer. S66 widen-pass adds 3 niches per brand (total 8/brand) so daily
-- cadence doesn't starve on the soft-relax window. The client-side constants
-- also move from 30d hard / 14d soft → 14d hard / 7d soft (see
-- `src/tools/niche-cooldown.ts` — COOLDOWN_FRESH_DAYS / COOLDOWN_RELAX_DAYS).
--
-- ACE_RICHIE additions:  exit-velocity, memetic-engineering, signal-discipline
-- CONTAINMENT_FIELD additions:  information-warfare, narrative-capture, frame-control
--
-- The SQL CHECK constraint is the hard DB floor — must match the TS allowlist
-- in `src/data/shared-context.ts` exactly or inserts from the cooldown client
-- will 23514 (check_violation) and the pipeline will silently log a warn via
-- recordNicheRun's non-throwing path.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE public.niche_cooldown
  DROP CONSTRAINT IF EXISTS niche_cooldown_niche_chk;

ALTER TABLE public.niche_cooldown
  ADD CONSTRAINT niche_cooldown_niche_chk
  CHECK (
    (brand = 'ace_richie' AND niche_norm IN (
      'sovereignty',
      'authority',
      'architecture',
      'system-mastery',
      'wealth-frequency',
      'exit-velocity',
      'memetic-engineering',
      'signal-discipline'
    ))
    OR
    (brand = 'containment_field' AND niche_norm IN (
      'burnout',
      'dark-psychology',
      'containment',
      'manipulation-exposed',
      'pattern-interrupt',
      'information-warfare',
      'narrative-capture',
      'frame-control'
    ))
  );

COMMENT ON CONSTRAINT niche_cooldown_niche_chk ON public.niche_cooldown IS
  'S66 widen — 8 niches/brand to support 5-7/week cadence under 14d hard / 7d soft cooldown.';
