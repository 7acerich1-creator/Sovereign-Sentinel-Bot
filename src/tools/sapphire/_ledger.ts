// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Identity Ledger
//
// S121: Append-only record of every self-modification Sapphire performs.
// Persists to public.sapphire_identity_log — survives Railway redeploys,
// readable by /history command + the dashboard.
//
// Trigger excerpt is captured via a module-level "current trigger" set by
// the Sapphire DM block in index.ts at the start of each turn and cleared
// in finally. Single Sapphire DM lane = no concurrency hazard.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../../config";

let _currentTriggerExcerpt: string | undefined;

/**
 * Called by index.ts at the start of every Sapphire DM turn so the ledger
 * can attribute piece changes to the message that prompted them.
 */
export function setIdentityLogTrigger(rawText: string | undefined): void {
  _currentTriggerExcerpt = rawText
    ? rawText.slice(0, 240).replace(/\s+/g, " ").trim()
    : undefined;
}

export function clearIdentityLogTrigger(): void {
  _currentTriggerExcerpt = undefined;
}

export type IdentityOp = "set_piece" | "create_piece" | "remove_piece";

export interface IdentityLogEntry {
  op: IdentityOp;
  section: string;
  piece_key: string;
  before_value?: string | null;
  after_value?: string | null;
}

/**
 * Append a row to public.sapphire_identity_log. Best-effort — never throws,
 * never blocks. Logs failures to console for ops visibility.
 */
export async function logIdentityChange(entry: IdentityLogEntry): Promise<void> {
  if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return;
  try {
    // S121b: service-role key (anon can't write through RLS).
    const { getSapphireSupabase } = await import("./_supabase");
    const supabase = await getSapphireSupabase();

    const { error } = await supabase.from("sapphire_identity_log").insert({
      op: entry.op,
      section: entry.section,
      piece_key: entry.piece_key,
      before_value: entry.before_value ?? null,
      after_value: entry.after_value ?? null,
      trigger_excerpt: _currentTriggerExcerpt ?? null,
    });

    if (error) {
      console.warn(`[Sapphire Ledger] insert failed: ${error.message}`);
    } else {
      console.log(`💎 [Sapphire Ledger] ${entry.op} ${entry.section}/${entry.piece_key}`);
    }
  } catch (err: any) {
    console.warn(`[Sapphire Ledger] threw: ${err.message}`);
  }
}

export interface IdentityHistoryRow {
  op: IdentityOp;
  section: string;
  piece_key: string;
  before_value?: string | null;
  after_value?: string | null;
  trigger_excerpt?: string | null;
  created_at: string;
}

/**
 * Read the most recent N ledger entries, optionally filtered by section.
 */
export async function readIdentityHistory(
  limit = 25,
  section?: string
): Promise<IdentityHistoryRow[]> {
  if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return [];
  try {
    // S121b: service-role key.
    const { getSapphireSupabase } = await import("./_supabase");
    const supabase = await getSapphireSupabase();

    let q = supabase
      .from("sapphire_identity_log")
      .select("op, section, piece_key, before_value, after_value, trigger_excerpt, created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 200));
    if (section) q = q.eq("section", section);

    const { data, error } = await q;
    if (error) {
      console.warn(`[Sapphire Ledger] read failed: ${error.message}`);
      return [];
    }
    return (data || []) as IdentityHistoryRow[];
  } catch (err: any) {
    console.warn(`[Sapphire Ledger] read threw: ${err.message}`);
    return [];
  }
}
