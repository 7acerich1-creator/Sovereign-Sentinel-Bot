-- ══════════════════════════════════════════════════════
-- YOUTUBE COMMENTS SEEN — dedup state for the comment alert layer
-- Session 58 (2026-04-14). See src/proactive/youtube-comment-watcher.ts
-- and memory/project_first_audience_signal.md.
--
-- Poll fires every 5 min. Each NEW (not in this table) comment on either
-- Ace Richie or The Containment Field YT channel → Telegram DM to Architect.
-- This table is the persistent "already seen" set so alerts don't double-fire
-- across restarts or redeploys.
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.youtube_comments_seen (
    comment_id TEXT PRIMARY KEY,
    brand TEXT NOT NULL CHECK (brand IN ('ace_richie', 'containment_field')),
    video_id TEXT NOT NULL,
    video_title TEXT,
    author_handle TEXT,
    author_display_name TEXT,
    text_original TEXT,
    published_at TIMESTAMPTZ,
    alerted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand + recency lookup for diagnostics / dashboard queries
CREATE INDEX IF NOT EXISTS idx_ycs_brand_published
  ON public.youtube_comments_seen (brand, published_at DESC);

-- RLS: service role writes (from bot); anon read is fine for future dashboard use
ALTER TABLE public.youtube_comments_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_ycs"
  ON public.youtube_comments_seen
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "anon_read_ycs"
  ON public.youtube_comments_seen
  FOR SELECT USING (auth.role() = 'anon');
