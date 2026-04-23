// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION Phase 3 Task 3.5 — Niche cooldown client
//
// Read side: `getNicheCooldownSnapshot(brand)` returns a Map of
//   niche → { lastRanAt, ageDays, status }
// where status is one of:
//   • "fresh"   — never run OR >= 30 days ago. Free to use.
//   • "relax"   — 14-30 days ago. Permitted only when every allowed niche is
//                 also within the 30d window (soft relax to prevent stall).
//   • "blocked" — < 14 days ago. Hard no unless explicit override.
//
// Write side: `recordNicheRun({brand, niche, thesis, jobId?})` inserts the
//  ledger row. Called by the pipeline AFTER the seed actually enters the
//  factory (not when Alfred merely proposes it) so aborted seeds don't
//  burn a cooldown.
//
// Both operations use Supabase REST directly (matching the bot's existing
// pattern — no Supabase JS client dependency added).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import {
  getAllowedNiches,
  normalizeNiche,
} from "../data/shared-context";
import type { Brand } from "../pod/types";

// S66 re-tune: original 30/14 starved daily cadence with 5-niche allowlist.
// Math: each niche can recycle via soft-relax every RELAX_DAYS → theoretical max
// throughput = (allowlist_size ÷ RELAX_DAYS) per brand. At 14/7 with the widened
// 8-niche allowlist, that's ~8/week/brand — comfortably above the 5-7/week target.
// Content-level dedupe still belongs to the Pinecone 0.85 cosine guard; this cooldown
// is just the COARSE brand-integrity signal so the channel doesn't read as single-topic.
const COOLDOWN_FRESH_DAYS = 14;
const COOLDOWN_RELAX_DAYS = 7;

export type CooldownStatus = "fresh" | "relax" | "blocked";

export interface CooldownEntry {
  niche: string;
  lastRanAt: Date | null;
  ageDays: number | null; // null = never run
  status: CooldownStatus;
}

export interface NicheCooldownSnapshot {
  brand: Brand;
  queriedAt: Date;
  entries: CooldownEntry[];
  /** Convenience: the niches permitted right now (fresh + relax-if-stalled). */
  permitted: string[];
}

interface LastRunRow {
  brand: string;
  niche_norm: string;
  last_ran_at: string;
}

function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * Pulls the collapsed `niche_last_run` view and classifies every allowed niche
 * for the brand. Missing rows → status "fresh". Stale rows → "fresh" again.
 *
 * If Supabase is unreachable, returns a permissive snapshot (everything fresh)
 * and logs a warning — we would rather ship with weak cooldown than halt Alfred
 * on an infra blip.
 */
export async function getNicheCooldownSnapshot(brand: Brand): Promise<NicheCooldownSnapshot> {
  const allowed = getAllowedNiches(brand);
  const queriedAt = new Date();
  const cfg = getSupabaseConfig();

  let rows: LastRunRow[] = [];
  if (cfg) {
    try {
      const resp = await fetch(
        `${cfg.url}/rest/v1/niche_last_run?brand=eq.${encodeURIComponent(brand)}&select=brand,niche_norm,last_ran_at`,
        {
          headers: {
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
          },
        },
      );
      if (resp.ok) {
        rows = (await resp.json()) as LastRunRow[];
      } else {
        console.warn(`[NicheCooldown] ${brand} fetch status=${resp.status}; assuming fresh.`);
      }
    } catch (err: any) {
      console.warn(`[NicheCooldown] ${brand} fetch error: ${err?.message}; assuming fresh.`);
    }
  } else {
    console.warn(`[NicheCooldown] Supabase not configured; assuming all niches fresh.`);
  }

  const byNiche = new Map<string, Date>();
  for (const r of rows) {
    byNiche.set(r.niche_norm, new Date(r.last_ran_at));
  }

  const entries: CooldownEntry[] = allowed.map((niche) => {
    const normalized = normalizeNiche(niche);
    const lastRanAt = byNiche.get(normalized) ?? null;
    if (!lastRanAt) {
      return { niche: normalized, lastRanAt: null, ageDays: null, status: "fresh" };
    }
    const ageMs = queriedAt.getTime() - lastRanAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    let status: CooldownStatus;
    if (ageDays >= COOLDOWN_FRESH_DAYS) status = "fresh";
    else if (ageDays >= COOLDOWN_RELAX_DAYS) status = "relax";
    else status = "blocked";
    return { niche: normalized, lastRanAt, ageDays, status };
  });

  const hasAnyFresh = entries.some((e) => e.status === "fresh");
  const permitted = entries
    .filter((e) => {
      if (e.status === "fresh") return true;
      if (e.status === "relax") return !hasAnyFresh; // soft relax only when stalled
      return false;
    })
    .map((e) => e.niche);

  return { brand, queriedAt, entries, permitted };
}

/**
 * One-line summary injectable into Alfred's seed prompt: shows which niches
 * are fresh, which are relaxed, which are blocked. Tokens-per-character is
 * kept tight — this goes into a prompt that already has a niche allowlist.
 *
 * Example:
 *   SOVEREIGN_SYNTHESIS cooldown: fresh=[authority|architecture] relax=[sovereignty] blocked=[system-mastery(3d)|wealth-frequency(7d)]
 */
export function cooldownSummaryLine(snapshot: NicheCooldownSnapshot): string {
  const groups: Record<CooldownStatus, string[]> = { fresh: [], relax: [], blocked: [] };
  for (const e of snapshot.entries) {
    if (e.status === "blocked" && e.ageDays !== null) {
      groups.blocked.push(`${e.niche}(${Math.round(e.ageDays)}d)`);
    } else {
      groups[e.status].push(e.niche);
    }
  }
  const parts = [
    `fresh=[${groups.fresh.join("|") || "-"}]`,
    `relax=[${groups.relax.join("|") || "-"}]`,
    `blocked=[${groups.blocked.join("|") || "-"}]`,
  ];
  return `${snapshot.brand.toUpperCase()} cooldown: ${parts.join(" ")}`;
}

/** Throws if the requested niche is currently blocked for the brand. */
export async function assertNichePermitted(brand: Brand, niche: string): Promise<void> {
  const normalized = normalizeNiche(niche);
  const snapshot = await getNicheCooldownSnapshot(brand);
  const entry = snapshot.entries.find((e) => e.niche === normalized);
  if (!entry) {
    throw new Error(
      `assertNichePermitted: niche "${niche}" not in ${brand} allowlist. ` +
      `Permitted: [${snapshot.permitted.join(" | ")}]`,
    );
  }
  if (entry.status === "blocked") {
    throw new Error(
      `assertNichePermitted: ${brand}/${normalized} is on cooldown ` +
      `(last ran ${entry.ageDays?.toFixed(1)}d ago; requires ${COOLDOWN_RELAX_DAYS}d relax / ${COOLDOWN_FRESH_DAYS}d fresh).`,
    );
  }
  if (entry.status === "relax" && !snapshot.permitted.includes(normalized)) {
    // Relax path but some niche is fresh — so this one is not permitted today.
    throw new Error(
      `assertNichePermitted: ${brand}/${normalized} is in relax window ` +
      `(${entry.ageDays?.toFixed(1)}d) and at least one fresher niche is available. Prefer one of [${snapshot.permitted.join(" | ")}].`,
    );
  }
}

/** Insert a ledger row after a seed successfully enters the factory. */
export async function recordNicheRun(params: {
  brand: Brand;
  niche: string;
  thesis?: string;
  jobId?: string;
  source?: string;
}): Promise<void> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    console.warn(`[NicheCooldown] Supabase not configured; cannot record ${params.brand}/${params.niche}`);
    return;
  }
  const niche_norm = normalizeNiche(params.niche);
  try {
    const resp = await fetch(`${cfg.url}/rest/v1/niche_cooldown`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        brand: params.brand,
        niche: params.niche,
        niche_norm,
        thesis: params.thesis ?? null,
        job_id: params.jobId ?? null,
        source: params.source ?? "alfred_daily",
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[NicheCooldown] record failed ${resp.status}: ${body.slice(0, 200)}`);
    }
  } catch (err: any) {
    console.warn(`[NicheCooldown] record error: ${err?.message}`);
  }
}
