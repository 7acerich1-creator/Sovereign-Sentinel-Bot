-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SOVEREIGN SYNTHESIS — Full Dashboard + Bot Wiring Migration
-- Creates ALL tables the Mission Control dashboard expects
-- Safe to run multiple times (IF NOT EXISTS everywhere)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ══════════════════════════════════════════════════════
-- COMMAND CENTER (Home Page) — 7 tables
-- ══════════════════════════════════════════════════════

-- 1. mission_metrics — top-level KPIs
CREATE TABLE IF NOT EXISTS public.mission_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    liberation_count INTEGER DEFAULT 0,
    inner_circle_count INTEGER DEFAULT 0,
    fiscal_sum NUMERIC(12,2) DEFAULT 0.00,
    velocity NUMERIC(8,4) DEFAULT 0.0000,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed a single row if empty
INSERT INTO public.mission_metrics (liberation_count, inner_circle_count, fiscal_sum, velocity)
SELECT 0, 0, 0.00, 0.0000
WHERE NOT EXISTS (SELECT 1 FROM public.mission_metrics LIMIT 1);

-- 2. revenue_log — income tracking
CREATE TABLE IF NOT EXISTS public.revenue_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount NUMERIC(12,2) NOT NULL,
    source TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. agent_history — already exists from gate2, ensure it's there
CREATE TABLE IF NOT EXISTS public.agent_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL,
    role TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. command_queue — bot task tracking
CREATE TABLE IF NOT EXISTS public.command_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT,
    command TEXT,
    status TEXT DEFAULT 'pending',
    agent_name TEXT DEFAULT 'veritas',
    chat_id TEXT,
    result TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 5. content_transmissions — content pipeline tracking
CREATE TABLE IF NOT EXISTS public.content_transmissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT,
    source TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    intent_tag TEXT,
    strategy_json JSONB DEFAULT '{}',
    linkedin_post TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. vid_rush_queue — video production pipeline
CREATE TABLE IF NOT EXISTS public.vid_rush_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT,
    topic TEXT,
    script TEXT,
    thumbnail_prompt TEXT,
    title_variants JSONB,
    memetic_hooks JSONB,
    audio_path TEXT,
    status TEXT DEFAULT 'queued',
    niche TEXT,
    video_url TEXT,
    youtube_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. glitch_log — error/incident tracking
CREATE TABLE IF NOT EXISTS public.glitch_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity TEXT DEFAULT 'low',
    description TEXT NOT NULL,
    agent_name TEXT,
    stack_trace TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- TASKS & PROJECTS
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'human' CHECK (type IN ('human', 'ai')),
    status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in-progress', 'done')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    assignee TEXT,
    due_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    details TEXT,
    agent_name TEXT,
    status TEXT DEFAULT 'success',
    timestamp TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- FINANCE / REVENUE GRID
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.payment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount NUMERIC(12,2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    source TEXT,
    payer_name TEXT,
    payer_email TEXT,
    status TEXT DEFAULT 'completed',
    stripe_id TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- CONTENT INTEL
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.youtube_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id TEXT,
    title TEXT,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    ctr NUMERIC(5,2) DEFAULT 0.00,
    retention NUMERIC(5,2) DEFAULT 0.00,
    impressions INTEGER DEFAULT 0,
    niche TEXT,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- PORTALS (Sovereign Metrics — alias/view)
-- ══════════════════════════════════════════════════════

-- sovereign_metrics is an alias pattern for mission_metrics
-- Dashboard reads liberation_count + inner_circle_count from it
CREATE TABLE IF NOT EXISTS public.sovereign_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fiscal_sum NUMERIC(12,2) DEFAULT 0.00,
    mindset_count INTEGER DEFAULT 0,
    elite_count INTEGER DEFAULT 0,
    liberation_count INTEGER DEFAULT 0,
    inner_circle_count INTEGER DEFAULT 0,
    velocity NUMERIC(8,4) DEFAULT 0.0000,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.sovereign_metrics (fiscal_sum, mindset_count, elite_count, liberation_count, inner_circle_count, velocity)
SELECT 0.00, 0, 0, 0, 0, 0.0000
WHERE NOT EXISTS (SELECT 1 FROM public.sovereign_metrics LIMIT 1);


-- ══════════════════════════════════════════════════════
-- SECOND BRAIN
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.knowledge_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT,
    node_type TEXT DEFAULT 'note',
    tags JSONB DEFAULT '[]',
    connections JSONB DEFAULT '[]',
    agent_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- CONNECTIONS
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.system_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    endpoint TEXT,
    config JSONB DEFAULT '{}',
    last_ping TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- SETTINGS
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.system_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- PRODUCTIVITY
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.habit_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    habit_id UUID,
    day_index INTEGER NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    text TEXT NOT NULL,
    done BOOLEAN DEFAULT FALSE,
    priority TEXT DEFAULT 'medium',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.architect_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Legacy habits table (referenced in CLAUDE.md schema)
CREATE TABLE IF NOT EXISTS public.habits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    streak INTEGER DEFAULT 0,
    completed_today BOOLEAN DEFAULT FALSE,
    last_completed_at TIMESTAMPTZ
);


-- ══════════════════════════════════════════════════════
-- API ROUTES — agent_payloads (/api/release)
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agent_payloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL,
    payload_type TEXT DEFAULT 'release',
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'received',
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- CREW DISPATCH (inter-agent routing)
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.crew_dispatch (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    task_type TEXT NOT NULL,
    payload JSONB DEFAULT '{}',
    priority INTEGER DEFAULT 5,
    parent_id UUID,
    chat_id TEXT,
    status TEXT DEFAULT 'pending',
    result TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);


-- ══════════════════════════════════════════════════════
-- BOT MEMORY TABLES (used by supabase-vector.ts)
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.messages_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id TEXT,
    user_id TEXT,
    role TEXT,
    content TEXT,
    channel TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.core_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    category TEXT DEFAULT 'general',
    access_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id TEXT UNIQUE NOT NULL,
    summary TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.data_store (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    data_type TEXT DEFAULT 'json',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Personality config (used for bot initialization)
CREATE TABLE IF NOT EXISTS public.personality_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT UNIQUE NOT NULL,
    prompt_blueprint TEXT NOT NULL,
    tone TEXT,
    role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Identity milestones (from CLAUDE.md)
CREATE TABLE IF NOT EXISTS public.identity_milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_name TEXT NOT NULL,
    velocity_trigger NUMERIC(8,4),
    brand_evolution TEXT,
    achieved BOOLEAN DEFAULT FALSE,
    achieved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ══════════════════════════════════════════════════════
-- INDEXES — Performance for dashboard realtime queries
-- ══════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_revenue_log_created ON public.revenue_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_history_name ON public.agent_history(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_history_created ON public.agent_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_queue_status ON public.command_queue(status);
CREATE INDEX IF NOT EXISTS idx_command_queue_agent ON public.command_queue(agent_name);
CREATE INDEX IF NOT EXISTS idx_command_queue_created ON public.command_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_tx_status ON public.content_transmissions(status);
CREATE INDEX IF NOT EXISTS idx_content_tx_created ON public.content_transmissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vid_rush_status ON public.vid_rush_queue(status);
CREATE INDEX IF NOT EXISTS idx_vid_rush_created ON public.vid_rush_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_glitch_severity ON public.glitch_log(severity);
CREATE INDEX IF NOT EXISTS idx_glitch_created ON public.glitch_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON public.tasks(priority);
CREATE INDEX IF NOT EXISTS idx_activity_log_ts ON public.activity_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_payment_created ON public.payment_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_fetched ON public.youtube_analytics(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON public.knowledge_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_created ON public.knowledge_nodes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crew_dispatch_to ON public.crew_dispatch(to_agent, status);
CREATE INDEX IF NOT EXISTS idx_crew_dispatch_parent ON public.crew_dispatch(parent_id);
CREATE INDEX IF NOT EXISTS idx_crew_dispatch_created ON public.crew_dispatch(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_log_chat ON public.messages_log(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_log_ts ON public.messages_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_payloads_agent ON public.agent_payloads(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_payloads_created ON public.agent_payloads(created_at DESC);


-- ══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — Allow anon key reads for dashboard
-- ══════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'mission_metrics', 'revenue_log', 'agent_history', 'command_queue',
            'content_transmissions', 'vid_rush_queue', 'glitch_log', 'tasks',
            'activity_log', 'payment_history', 'youtube_analytics', 'sovereign_metrics',
            'knowledge_nodes', 'system_connections', 'system_config', 'habit_days',
            'todos', 'architect_notes', 'habits', 'agent_payloads', 'crew_dispatch',
            'messages_log', 'core_memory', 'summaries', 'data_store',
            'personality_config', 'identity_milestones'
        ])
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

        -- Allow anon reads (dashboard)
        EXECUTE format(
            'CREATE POLICY IF NOT EXISTS "anon_read_%s" ON public.%I FOR SELECT TO anon USING (true)',
            tbl, tbl
        );

        -- Allow anon inserts (bot writes via anon key)
        EXECUTE format(
            'CREATE POLICY IF NOT EXISTS "anon_insert_%s" ON public.%I FOR INSERT TO anon WITH CHECK (true)',
            tbl, tbl
        );

        -- Allow anon updates (bot updates via anon key)
        EXECUTE format(
            'CREATE POLICY IF NOT EXISTS "anon_update_%s" ON public.%I FOR UPDATE TO anon USING (true)',
            tbl, tbl
        );

        -- Allow anon deletes for productivity tables
        IF tbl IN ('todos', 'habit_days', 'architect_notes') THEN
            EXECUTE format(
                'CREATE POLICY IF NOT EXISTS "anon_delete_%s" ON public.%I FOR DELETE TO anon USING (true)',
                tbl, tbl
            );
        END IF;

        -- Service role full access
        EXECUTE format(
            'CREATE POLICY IF NOT EXISTS "service_full_%s" ON public.%I FOR ALL TO service_role USING (true)',
            tbl, tbl
        );
    END LOOP;
END
$$;


-- ══════════════════════════════════════════════════════
-- REALTIME — Enable for dashboard live subscriptions
-- ══════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'mission_metrics', 'revenue_log', 'agent_history', 'command_queue',
            'content_transmissions', 'vid_rush_queue', 'glitch_log', 'tasks',
            'payment_history', 'sovereign_metrics', 'knowledge_nodes',
            'habit_days', 'todos', 'architect_notes', 'crew_dispatch',
            'agent_payloads'
        ])
    LOOP
        -- Add table to supabase_realtime publication if not already there
        BEGIN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
        EXCEPTION WHEN duplicate_object THEN
            -- Already in publication, skip
        END;
    END LOOP;
END
$$;


-- ══════════════════════════════════════════════════════
-- SEED: System connections for Connections page
-- ══════════════════════════════════════════════════════

INSERT INTO public.system_connections (name, type, status, endpoint) VALUES
    ('Supabase', 'database', 'active', 'https://wzthxohtgojenukmdubz.supabase.co'),
    ('Railway', 'hosting', 'active', 'https://railway.app'),
    ('Telegram (Veritas)', 'channel', 'active', 'telegram://veritas'),
    ('Telegram (Sapphire)', 'channel', 'pending', 'telegram://sapphire'),
    ('Telegram (Alfred)', 'channel', 'pending', 'telegram://alfred'),
    ('Telegram (Yuki)', 'channel', 'pending', 'telegram://yuki'),
    ('Telegram (Anita)', 'channel', 'pending', 'telegram://anita'),
    ('Telegram (Vector)', 'channel', 'pending', 'telegram://vector'),
    ('Make.com (Scenario E)', 'automation', 'pending', 'make://scenario-e'),
    ('Make.com (Scenario F)', 'automation', 'pending', 'make://scenario-f'),
    ('Buffer (Social)', 'social', 'pending', 'https://api.bufferapp.com'),
    ('Sovereign Clip Pipeline', 'video', 'active', 'in-house://yt-dlp+ffmpeg+whisper'),
    ('ElevenLabs', 'voice', 'pending', 'https://api.elevenlabs.io'),
    ('Gemini', 'llm', 'active', 'https://generativelanguage.googleapis.com')
ON CONFLICT DO NOTHING;
