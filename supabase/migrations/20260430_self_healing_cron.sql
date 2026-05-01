-- ============================================================
-- S126 — Self-healing Layer 4 cron job
-- 2026-04-30
--
-- Schedules the bot-health-canary Edge Function every 10 minutes
-- via pg_cron + pg_net. The canary returns 200 even on failure
-- (it logs to bot_health_pulses and sends its own Telegram alerts),
-- so cron success is independent of bot health.
--
-- IMPORTANT: this requires:
--   1. pg_cron extension enabled in the Supabase project (it is by
--      default for projects ≥ 2023).
--   2. pg_net extension enabled (also default).
--   3. The CANARY_SECRET env var set on the Edge Function AND the
--      same value referenced in the cron call below. Set it via:
--        supabase secrets set CANARY_SECRET=<random_value>
--      then UPDATE the cron entry below with the same value.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior canary schedule so re-running this migration is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('bot-health-canary-10min');
EXCEPTION WHEN OTHERS THEN
  -- not scheduled yet; ignore
  NULL;
END $$;

-- Schedule the canary every 10 minutes.
-- The function URL pattern Supabase Edge Functions use is:
--   https://<project_ref>.supabase.co/functions/v1/<function_name>
-- pg_net.http_post is async — we don't need the response, just the trigger.
SELECT cron.schedule(
  'bot-health-canary-10min',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url := concat(
        current_setting('app.settings.supabase_url', true),
        '/functions/v1/bot-health-canary?secret=',
        current_setting('app.settings.canary_secret', true)
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', concat('Bearer ', current_setting('app.settings.service_role_key', true))
      ),
      body := jsonb_build_object('source', 'pg_cron')
    );
  $$
);

-- ── Configuration helpers ──
-- The cron command above reads from custom GUCs so the secret is not
-- hardcoded in pg_cron. Set them ONCE via Supabase SQL editor (these
-- ALTER DATABASE statements persist across connections):
--
--   ALTER DATABASE postgres SET app.settings.supabase_url      = 'https://wzthxohtgojenukmdubz.supabase.co';
--   ALTER DATABASE postgres SET app.settings.canary_secret     = '<copy from supabase secrets>';
--   ALTER DATABASE postgres SET app.settings.service_role_key  = '<copy from project settings>';
--
-- After setting, restart no longer required — pg_net reads them per call.

-- Sanity query to view the schedule (run manually after migration):
--   SELECT * FROM cron.job WHERE jobname = 'bot-health-canary-10min';
