-- ══════════════════════════════════════════════════════
-- CTA AUDIT PROPOSALS — Agent-proposed YouTube optimizations
-- Flow: youtube_cta_audit writes here → Architect reviews in MC →
--       Approves → agent executes via youtube_update_metadata
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cta_audit_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id TEXT NOT NULL,
    video_title TEXT,
    brand TEXT DEFAULT 'ace_richie',
    channel TEXT,
    views INTEGER DEFAULT 0,
    ctr NUMERIC(5,2) DEFAULT 0.00,
    issues_found JSONB DEFAULT '[]',
    current_description TEXT,
    proposed_description TEXT,
    proposed_comment TEXT,
    status TEXT DEFAULT 'pending_review'
      CHECK (status IN ('pending_review', 'approved', 'executed', 'rejected', 'skipped')),
    reviewed_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for dashboard queries (pending first, then by views)
CREATE INDEX IF NOT EXISTS idx_cta_proposals_status
  ON public.cta_audit_proposals (status, views DESC);


-- ══════════════════════════════════════════════════════
-- LANDING ANALYTICS — Vercel Analytics data pulled on schedule
-- Feeds Content Intel alongside youtube_analytics
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.landing_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_path TEXT DEFAULT '/',
    visitors INTEGER DEFAULT 0,
    page_views INTEGER DEFAULT 0,
    bounce_rate NUMERIC(5,2),
    avg_duration_seconds NUMERIC(8,2),
    referrer TEXT,
    country TEXT,
    device TEXT,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for dashboard time-range queries
CREATE INDEX IF NOT EXISTS idx_landing_analytics_period
  ON public.landing_analytics (period_start DESC);

-- RLS: Allow service role full access (bot writes), anon read for dashboard
ALTER TABLE public.cta_audit_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_cta" ON public.cta_audit_proposals
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "anon_read_cta" ON public.cta_audit_proposals
  FOR SELECT USING (true);

CREATE POLICY "service_role_full_landing" ON public.landing_analytics
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "anon_read_landing" ON public.landing_analytics
  FOR SELECT USING (true);
