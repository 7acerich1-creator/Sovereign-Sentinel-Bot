-- Gate 2: Agent-Specific Persistent History
-- Target: Supabase (Project: Sovereign_Ascent_Intake)

CREATE TABLE IF NOT EXISTS public.agent_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL,
    role TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for context retrieval performance
CREATE INDEX IF NOT EXISTS idx_agent_history_name ON public.agent_history(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_history_created_at ON public.agent_history(created_at DESC);

-- Index for metadata searches (e.g. topic-specific history)
CREATE INDEX IF NOT EXISTS idx_agent_history_metadata ON public.agent_history USING GIN (metadata);

-- Enable RLS
ALTER TABLE public.agent_history ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON public.agent_history FOR ALL TO service_role USING (true);
