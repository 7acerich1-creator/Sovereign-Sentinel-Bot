-- SESSION 94: Track which R2 long-form videos have been rechopped.
-- Used by rechop-pipeline.ts to avoid re-processing videos.

CREATE TABLE IF NOT EXISTS rechop_completed (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  video_job_id text NOT NULL UNIQUE,
  shorts_count integer NOT NULL DEFAULT 0,
  clip_keys text[] DEFAULT '{}',
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rechop_completed_job_id ON rechop_completed(video_job_id);

-- RLS: service_role full access, anon read-only
ALTER TABLE rechop_completed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON rechop_completed
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "anon_read" ON rechop_completed
  FOR SELECT USING (true);
