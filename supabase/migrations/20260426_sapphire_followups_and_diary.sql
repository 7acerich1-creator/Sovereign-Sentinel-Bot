-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- S121 BUILD D — Sapphire PA UX scaffolding
-- Two tables enabling anticipatory follow-ups and diary/significance reads.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS public.sapphire_followups (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  topic       text          NOT NULL,
  detail      text,
  due_at      timestamptz   NOT NULL,
  status      text          NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','done','cancelled','snoozed')),
  source_excerpt  text,
  surfaced_at timestamptz,
  created_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sapphire_followups_due_status
  ON public.sapphire_followups (status, due_at);
ALTER TABLE public.sapphire_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_full" ON public.sapphire_followups;
CREATE POLICY "service_role_full" ON public.sapphire_followups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.sapphire_diary (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  entry       text          NOT NULL,
  mood        text,
  scenario    text,
  tags        text[],
  created_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sapphire_diary_created_at
  ON public.sapphire_diary (created_at DESC);
ALTER TABLE public.sapphire_diary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_full" ON public.sapphire_diary;
CREATE POLICY "service_role_full" ON public.sapphire_diary
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.sapphire_followups IS 'S121: Promises Ace makes - Sapphire surfaces these when due_at hits.';
COMMENT ON TABLE public.sapphire_diary IS 'S121: Sapphire writes her own daily observations here.';
