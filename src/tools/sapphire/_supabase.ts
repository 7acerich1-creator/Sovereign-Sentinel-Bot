// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — single Supabase client factory
// Always uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
// config.memory.supabaseKey resolves to ANON which CANNOT write to
// sapphire_* tables (RLS-enabled, no anon policies).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../../config";

export async function getSapphireSupabase() {
  const m = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || config.memory.supabaseUrl!;
  // Service role first — anon as last-resort fallback for read-only diagnostics
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey!;
  return m.createClient(url, key);
}
