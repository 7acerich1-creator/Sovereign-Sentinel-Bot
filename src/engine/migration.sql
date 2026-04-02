-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- GRAVITY CLAW — Deterministic Content Engine Queue
-- Run this in Supabase SQL Editor to create the table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS content_engine_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL CHECK (brand IN ('ace_richie', 'containment_field')),
  niche TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TIMESTAMPTZ NOT NULL,
  scheduled_hour_utc INTEGER NOT NULL,
  universal_text TEXT NOT NULL,
  platform_variants JSONB DEFAULT '{}',
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'posted', 'failed', 'skipped')),
  is_repost BOOLEAN DEFAULT FALSE,
  original_id UUID REFERENCES content_engine_queue(id),
  buffer_results TEXT,
  channels_hit INTEGER DEFAULT 0,
  channels_total INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  posted_at TIMESTAMPTZ
);

-- Index for the distribution sweep (most common query)
CREATE INDEX IF NOT EXISTS idx_ceq_distribution
  ON content_engine_queue (status, scheduled_time)
  WHERE status = 'ready';

-- Index for dedup check during daily production
CREATE INDEX IF NOT EXISTS idx_ceq_dedup
  ON content_engine_queue (brand, time_slot, scheduled_date);

-- Index for weekend repost query
CREATE INDEX IF NOT EXISTS idx_ceq_top_performers
  ON content_engine_queue (status, scheduled_date, channels_hit DESC)
  WHERE status = 'posted';

-- Enable RLS (match existing table pattern)
ALTER TABLE content_engine_queue ENABLE ROW LEVEL SECURITY;

-- Allow anon key full access (same as other Gravity Claw tables)
CREATE POLICY "anon_full_access" ON content_engine_queue
  FOR ALL USING (true) WITH CHECK (true);

-- Grant access
GRANT ALL ON content_engine_queue TO anon;
GRANT ALL ON content_engine_queue TO authenticated;
