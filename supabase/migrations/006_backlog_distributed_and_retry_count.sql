-- SESSION 92: Create backlog_distributed table for backlog drainer dedup
-- + add retry_count to content_engine_queue for failed draft retry cap.

-- Backlog drainer tracks which R2 clips have been distributed
CREATE TABLE IF NOT EXISTS backlog_distributed (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  clip_key text NOT NULL UNIQUE,
  buffer_post_ids text[] DEFAULT '{}',
  distributed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup during drain
CREATE INDEX IF NOT EXISTS idx_backlog_distributed_clip_key ON backlog_distributed(clip_key);

-- 7-day auto-cleanup: Supabase doesn't have native TTL, so we add a
-- cleanup function that the scheduled sweep can call.
-- For now, the drainer handles this via age check.

-- Add retry_count to content_engine_queue if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_engine_queue' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE content_engine_queue ADD COLUMN retry_count integer DEFAULT 0;
  END IF;
END $$;
