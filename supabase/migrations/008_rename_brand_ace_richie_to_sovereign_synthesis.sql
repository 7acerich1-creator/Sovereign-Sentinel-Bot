-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- S107: Rename brand 'ace_richie' → 'sovereign_synthesis' across all tables.
-- Ace Richie 77 channel rebranded to Sovereign Synthesis.
-- ALREADY APPLIED to production Supabase on 2026-04-23.
-- Correct order: DROP constraints → UPDATE data → ADD new constraints.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Step 1: DROP all CHECK constraints that reference ace_richie
ALTER TABLE content_engine_queue DROP CONSTRAINT IF EXISTS content_engine_queue_brand_check;
ALTER TABLE youtube_comments_seen DROP CONSTRAINT IF EXISTS youtube_comments_seen_brand_check;
ALTER TABLE niche_cooldown DROP CONSTRAINT IF EXISTS niche_cooldown_brand_chk;
ALTER TABLE niche_cooldown DROP CONSTRAINT IF EXISTS niche_cooldown_niche_chk;

-- Step 2: UPDATE all existing data
UPDATE content_engine_queue SET brand = 'sovereign_synthesis' WHERE brand = 'ace_richie';
UPDATE youtube_comments_seen SET brand = 'sovereign_synthesis' WHERE brand = 'ace_richie';
UPDATE niche_cooldown SET brand = 'sovereign_synthesis' WHERE brand = 'ace_richie';
UPDATE cta_audit_proposals SET brand = 'sovereign_synthesis' WHERE brand = 'ace_richie';

-- Step 3: ADD new CHECK constraints with sovereign_synthesis
ALTER TABLE content_engine_queue ADD CONSTRAINT content_engine_queue_brand_check
  CHECK (brand IN ('sovereign_synthesis', 'containment_field'));

ALTER TABLE niche_cooldown ADD CONSTRAINT niche_cooldown_brand_chk
  CHECK (brand IN ('sovereign_synthesis', 'containment_field'));

ALTER TABLE niche_cooldown ADD CONSTRAINT niche_cooldown_niche_chk
  CHECK (
    (brand = 'sovereign_synthesis' AND niche_norm IN (
      'sovereignty', 'authority', 'architecture', 'system-mastery',
      'wealth-frequency', 'exit-velocity', 'memetic-engineering', 'signal-discipline'
    ))
    OR
    (brand = 'containment_field' AND niche_norm IN (
      'burnout', 'dark-psychology', 'containment', 'manipulation-exposed',
      'pattern-interrupt', 'information-warfare', 'narrative-capture', 'frame-control'
    ))
  );

-- niche_last_run is a VIEW on niche_cooldown — auto-reflects the update.

COMMIT;
