-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- sapphire_core_memory — Sapphire-owned in-context state. S125+ Phase 5A (2026-04-30).
--
-- Letta/MemGPT pattern: the agent owns its own memory writes as tool calls,
-- not as framework-auto-plumbed state. A small in-context block (~1,500
-- tokens hard cap) that's always visible to Sapphire as her "current
-- understanding" of Ace's world. She updates it via memory(action='core_*').
--
-- Slot model: instead of one big text blob, slots are themed sections she
-- can update independently (current_projects, current_concerns, current_priorities,
-- recent_themes, etc.). Each slot is upsert-by-key — no append history.
-- For longitudinal history, use the diary or archival memory tools instead.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.sapphire_core_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot text NOT NULL UNIQUE,
  content text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'sapphire',
  metadata jsonb
);

-- Hot path: context-prefix injection reads ALL active rows on every Sapphire turn
CREATE INDEX IF NOT EXISTS idx_sapphire_core_memory_updated
  ON public.sapphire_core_memory (updated_at DESC);

-- ── RLS ──
ALTER TABLE public.sapphire_core_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_sapphire_core_memory" ON public.sapphire_core_memory
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon_read_sapphire_core_memory" ON public.sapphire_core_memory
  FOR SELECT
  TO anon
  USING (true);

-- Seed a few starter slots so the format is obvious from day one. Sapphire
-- can replace/extend these via memory(action='core_replace', ...) once she
-- learns more.
INSERT INTO public.sapphire_core_memory (slot, content)
VALUES
  ('current_priorities', 'S125+ agentic refactor live. Phase 1-5 shipped 2026-04-30. Architect testing live. NORTH_STAR coordinate: $1.2M net liquid by Jan 1, 2027.'),
  ('current_projects', 'Sovereign Synthesis brand. The Containment Field brand. YouTube faceless pipeline. Mission Control dashboard. Crew agents (Anita/Yuki/Vector/Veritas/Alfred).'),
  ('current_concerns', 'Phase 5 just shipped — watch for regression in Sapphire DM lane after fat-tool consolidation. Stripe revenue currently $0; first conversion not yet hit.'),
  ('recent_themes', 'Architect surfaced linear-vs-fluid gap 2026-04-30. Pinecone pollution debugged. Personal Intelligence layer added. Concept mode for exploratory questions.')
ON CONFLICT (slot) DO NOTHING;

COMMENT ON TABLE public.sapphire_core_memory IS
  'Sapphire-owned in-context state (Letta/MemGPT pattern). Always-injected into her context prefix. Updated via memory(action=core_append/core_replace) tool calls. S125+ Phase 5A (2026-04-30).';
