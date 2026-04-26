-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- S121 — Sapphire Identity Ledger
-- Versioned record of every set_piece / create_piece / remove_piece event.
-- Lets Sapphire (and Ace) read her own evolution narrative across decades.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.sapphire_identity_log (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  op              text          NOT NULL CHECK (op IN ('set_piece','create_piece','remove_piece')),
  section         text          NOT NULL,
  piece_key       text          NOT NULL,
  before_value    text,                          -- nullable: create has no "before"
  after_value     text,                          -- nullable: remove has no "after"
  trigger_excerpt text,                          -- first 240 chars of the user message that triggered this
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sapphire_identity_log_created_at
  ON public.sapphire_identity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sapphire_identity_log_op
  ON public.sapphire_identity_log (op, created_at DESC);

-- RLS: service_role full access; anon read-only (matches youtube_comments_seen pattern)
ALTER TABLE public.sapphire_identity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full" ON public.sapphire_identity_log;
CREATE POLICY "service_role_full" ON public.sapphire_identity_log
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_read" ON public.sapphire_identity_log;
CREATE POLICY "anon_read" ON public.sapphire_identity_log
  FOR SELECT TO anon
  USING (true);

COMMENT ON TABLE public.sapphire_identity_log IS
  'S121: Versioned ledger of Sapphire piece changes. Append-only. Every row = one self-modification event.';
