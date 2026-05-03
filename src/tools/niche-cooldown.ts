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

// re-tune: original 30/14 starved daily cadence with 5-niche allowlist.
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
  /**
   * Session 113+ — permitted niches ordered by lastRanAt ASC (oldest first,
   * never-run ones first). Use this for LRU round-robin selection instead of
   * `permitted` + random shuffle, which is how we burned Session 113 on
   * identity-hijacking duplicates.
   */
  permittedLRU: string[];
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
  const permittedEntries = entries.filter((e) => {
    if (e.status === "fresh") return true;
    if (e.status === "relax") return !hasAnyFresh; // soft relax only when stalled
    return false;
  });

  const permitted = permittedEntries.map((e) => e.niche);

  // Session 113+ — LRU ordering. Null lastRanAt (never run) comes FIRST so
  // brand-new niches get tried before any previously-used ones. Then oldest
  // lastRanAt. Then niche name for deterministic tiebreak. This replaces the
  // `Math.random()` shuffle that was landing on the same depleted niche back
  // to back.
  const permittedLRU = [...permittedEntries]
    .sort((a, b) => {
      if (a.lastRanAt === null && b.lastRanAt === null) return a.niche.localeCompare(b.niche);
      if (a.lastRanAt === null) return -1;
      if (b.lastRanAt === null) return 1;
      const delta = a.lastRanAt.getTime() - b.lastRanAt.getTime();
      if (delta !== 0) return delta;
      return a.niche.localeCompare(b.niche);
    })
    .map((e) => e.niche);

  return { brand, queriedAt, entries, permitted, permittedLRU };
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
  /** Session 113+ — A/B/C aesthetic used on this run (for performance test). */
  aestheticStyle?: "A" | "B" | "C";
  /** S125+ — YouTube watch URL persisted after long-form upload. */
  youtubeUrl?: string | null;
  /** S125+ — Short YouTube URLs (or R2 URLs as fallback) for the standalone shorts produced from this run. */
  shortUrls?: string[] | null;
  /** S125+ — R2 long-form URL (always present after pod upload). */
  r2VideoUrl?: string | null;
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
        aesthetic_style: params.aestheticStyle ?? null,
        // S125+ — URL persistence for Mission Control + audit grepping
        youtube_url: params.youtubeUrl ?? null,
        short_urls: params.shortUrls ?? null,
        r2_video_url: params.r2VideoUrl ?? null,
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

// ─────────────────────────────────────────────────────────────────────────────
// Session 113+ — Aesthetic rotation helpers
// ─────────────────────────────────────────────────────────────────────────────
// Three aesthetic styles (A/B/C) are assigned to each shipped video and
// rotated LRU per brand. `getRecentAestheticRuns` pulls the last N rows from
// niche_cooldown ordered by created_at DESC so the caller can pick whichever
// style was used longest ago. See NORTH_STAR "30-video A/B/C performance
// test" section for the full plan.

export type AestheticStyle = "A" | "B" | "C";

export interface AestheticRun {
  aestheticStyle: AestheticStyle | null;
  createdAt: Date;
}

export async function getRecentAestheticRuns(
  brand: Brand,
  limit: number = 10,
): Promise<AestheticRun[]> {
  const cfg = getSupabaseConfig();
  if (!cfg) return [];
  try {
    const resp = await fetch(
      `${cfg.url}/rest/v1/niche_cooldown?brand=eq.${encodeURIComponent(brand)}` +
        `&select=aesthetic_style,created_at&order=created_at.desc&limit=${Math.max(1, limit)}`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      },
    );
    if (!resp.ok) {
      console.warn(`[NicheCooldown] aesthetic fetch status=${resp.status}`);
      return [];
    }
    const rows = (await resp.json()) as Array<{
      aesthetic_style: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      aestheticStyle: (r.aesthetic_style as AestheticStyle | null) ?? null,
      createdAt: new Date(r.created_at),
    }));
  } catch (err: any) {
    console.warn(`[NicheCooldown] getRecentAestheticRuns error: ${err?.message}`);
    return [];
  }
}

/**
 * Pick the next aesthetic for `brand` via LRU. Looks at the last 3 runs:
 * if any of A/B/C is missing from that window, pick that one. If all three
 * appear in the window, pick the one that appeared LONGEST ago. If Supabase
 * is unreachable, falls back to deterministic hash of the current minute so
 * consecutive renders don't collide.
 */
export async function pickNextAesthetic(brand: Brand): Promise<AestheticStyle> {
  const recent = await getRecentAestheticRuns(brand, 3);
  const all: AestheticStyle[] = ["A", "B", "C"];
  const seenSet = new Set<AestheticStyle>();
  for (const r of recent) {
    if (r.aestheticStyle === "A" || r.aestheticStyle === "B" || r.aestheticStyle === "C") {
      seenSet.add(r.aestheticStyle);
    }
  }
  const unused = all.filter((s) => !seenSet.has(s));
  if (unused.length > 0) return unused[0];
  // All 3 seen in last 3 — return the oldest-seen of them (last in recent[])
  for (let i = recent.length - 1; i >= 0; i--) {
    const s = recent[i].aestheticStyle;
    if (s === "A" || s === "B" || s === "C") return s;
  }
  // Unreachable if recent is non-empty and seenSet.size === 3, but safety net:
  return "A";
}

// ─────────────────────────────────────────────────────────────────────────────
// Session 122b — Niche rotation on uniqueness retry
// ─────────────────────────────────────────────────────────────────────────────
// NORTH_STAR S113+ planned this but it was never implemented. The faceless
// factory's retry loop was generating against the SAME niche on each retry,
// which kept producing scripts in the same lane and re-colliding with the
// uniqueness gate. `pickNextNiche` swaps the niche to the LRU pick from the
// brand's allowlist, so retry 2 prompts the writer with a structurally
// different niche prefix, not just a soft "be different" directive.

export async function getRecentNicheRuns(
  brand: Brand,
  limit: number = 10,
): Promise<string[]> {
  const cfg = getSupabaseConfig();
  if (!cfg) return [];
  try {
    const resp = await fetch(
      `${cfg.url}/rest/v1/niche_cooldown?brand=eq.${encodeURIComponent(brand)}` +
        `&select=niche_norm,created_at&order=created_at.desc&limit=${Math.max(1, limit)}`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      },
    );
    if (!resp.ok) {
      console.warn(`[NicheCooldown] niche fetch status=${resp.status}`);
      return [];
    }
    const rows = (await resp.json()) as Array<{ niche_norm: string }>;
    return rows.map((r) => r.niche_norm).filter(Boolean);
  } catch (err: any) {
    console.warn(`[NicheCooldown] getRecentNicheRuns error: ${err?.message}`);
    return [];
  }
}

/**
 * Pick a different niche from the brand's allowlist for a uniqueness retry.
 * Strategy: LRU. Query the last N niche_cooldown rows for the brand and pick
 * the allowed niche that was used LONGEST ago (or never appears in the recent
 * window). NEVER returns `currentNiche` — caller is retrying because that one
 * just collided. If Supabase is down, falls back to the first allowed niche
 * that isn't `currentNiche`. If only one niche exists in the allowlist (edge
 * case), returns the same niche (caller's retry loop is then non-rotating).
 */
export async function pickNextNiche(brand: Brand, currentNiche: string): Promise<string> {
  const allowed = getAllowedNiches(brand).map((n) => normalizeNiche(n));
  const current = normalizeNiche(currentNiche);
  const candidates = allowed.filter((n) => n !== current);
  if (candidates.length === 0) {
    // Single-niche allowlist — nothing to rotate to.
    return current;
  }
  const recent = await getRecentNicheRuns(brand, 20);
  if (recent.length === 0) {
    // Supabase unavailable or no history — return first non-current candidate.
    return candidates[0];
  }
  // For each candidate, find its most recent appearance index in `recent`
  // (lower index = more recent). Pick the candidate with the HIGHEST index
  // (used longest ago) or that's missing entirely (treat as -Infinity-recency).
  let bestNiche = candidates[0];
  let bestRecency = -1; // higher = older
  for (const cand of candidates) {
    const recencyIdx = recent.indexOf(cand);
    const recencyScore = recencyIdx === -1 ? Number.MAX_SAFE_INTEGER : recencyIdx;
    if (recencyScore > bestRecency) {
      bestRecency = recencyScore;
      bestNiche = cand;
    }
  }
  return bestNiche;
}
