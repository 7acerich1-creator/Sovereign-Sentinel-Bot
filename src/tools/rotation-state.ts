// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sequential Rotation Cursor — single source of truth for "what ships next."
//
// Replaces Alfred's runtime LLM thesis (1-2 sentences, unbounded by content
// pool) with a deterministic march through THESIS_ANGLES (curated, ~250
// unique 2-4 sentence seeds per brand).
//
// Math:
//   total_ships ─┐
//                ├─→ niche_index = total_ships % niche_count       (0..14)
//                └─→ pass_index  = total_ships ÷ niche_count       (0, 1, 2, ...)
//                                  angle_index = pass_index % len(angles_for_niche)
//
// One row per brand in `pipeline_rotation_state`. Brands advance independently —
// SS and TCF each have their own cursor and never block each other. Drift
// across brands is expected (different angle pool sizes per niche).
//
// Survives Railway redeploys (state in Supabase, not memory). The new pipeline
// queue serializes runs per-brand, so atomic increment is unnecessary; a
// read-modify-write under a serialized caller is safe.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";
import type { Brand } from "../pod/types";
import { getAllowedNiches, normalizeNiche } from "../data/shared-context";
import { THESIS_ANGLES, type ThesisAngle } from "../data/thesis-angles";

interface SupabaseCfg {
  url: string;
  key: string;
}

function getSupabaseConfig(): SupabaseCfg | null {
  const url = process.env.SUPABASE_URL || config.memory.supabaseUrl || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    config.memory.supabaseKey ||
    "";
  if (!url || !key) return null;
  return { url, key };
}

export interface RotationState {
  brand: Brand;
  totalShips: number;
  lastAdvancedAt: Date | null;
  lastNiche: string | null;
  lastAngleId: string | null;
}

export interface RotationSeed {
  brand: Brand;
  niche: string;
  angle: ThesisAngle;
  /** The slot this seed belongs to (0-indexed). Equals total_ships at peek time. */
  slotIndex: number;
  /** 0-indexed pass through the niche array (first pass = 0, second pass = 1). */
  passIndex: number;
  /** 0-indexed niche position within the brand's allowlist. */
  nicheIndex: number;
  /** 0-indexed angle position within the niche's angle pool. */
  angleIndex: number;
}

/**
 * Pure function: given a brand and a slot index, deterministically compute
 * the (niche, angle) pair the rotator will return for that slot. No I/O.
 * Used by both the live rotator and the offline simulator.
 */
export function computeSeedAtSlot(brand: Brand, slot: number): RotationSeed {
  if (slot < 0 || !Number.isInteger(slot)) {
    throw new Error(`computeSeedAtSlot: slot must be a non-negative integer, got ${slot}`);
  }
  const niches = getAllowedNiches(brand).map((n) => normalizeNiche(n));
  if (niches.length === 0) {
    throw new Error(`computeSeedAtSlot: brand ${brand} has no allowed niches`);
  }
  const nicheIndex = slot % niches.length;
  const passIndex = Math.floor(slot / niches.length);
  const niche = niches[nicheIndex];
  const angles = THESIS_ANGLES[brand]?.[niche] ?? [];
  if (angles.length === 0) {
    throw new Error(
      `computeSeedAtSlot: brand=${brand} niche="${niche}" has zero angles in THESIS_ANGLES — ` +
      `every allowed niche must have at least one angle.`,
    );
  }
  const angleIndex = passIndex % angles.length;
  const angle = angles[angleIndex];
  return {
    brand,
    niche,
    angle,
    slotIndex: slot,
    passIndex,
    nicheIndex,
    angleIndex,
  };
}

/**
 * Read the current rotation state for `brand`. Returns null on Supabase outage —
 * caller should treat null as "halt this run, resolve infra first." We do NOT
 * fall back to an in-memory counter because that would break determinism across
 * Railway redeploys (the whole point of this table).
 */
export async function getRotationState(brand: Brand): Promise<RotationState | null> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    console.warn(`[RotationState] Supabase not configured — cannot read state for ${brand}`);
    return null;
  }
  try {
    const resp = await fetch(
      `${cfg.url}/rest/v1/pipeline_rotation_state?brand=eq.${encodeURIComponent(brand)}&select=*`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      },
    );
    if (!resp.ok) {
      console.warn(`[RotationState] read failed ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    const rows = (await resp.json()) as Array<{
      brand: Brand;
      total_ships: number;
      last_advanced_at: string;
      last_niche: string | null;
      last_angle_id: string | null;
    }>;
    if (rows.length === 0) {
      // Row missing — seed it lazily. Migration creates rows for both brands but
      // protect against manual deletion or schema drift.
      console.warn(`[RotationState] no row for ${brand} — seeding at total_ships=0`);
      const seedResp = await fetch(`${cfg.url}/rest/v1/pipeline_rotation_state`, {
        method: "POST",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ brand, total_ships: 0 }),
      });
      if (!seedResp.ok) {
        console.warn(`[RotationState] seed failed ${seedResp.status}: ${(await seedResp.text()).slice(0, 200)}`);
        return null;
      }
      return {
        brand,
        totalShips: 0,
        lastAdvancedAt: null,
        lastNiche: null,
        lastAngleId: null,
      };
    }
    const r = rows[0];
    return {
      brand: r.brand,
      totalShips: r.total_ships,
      lastAdvancedAt: r.last_advanced_at ? new Date(r.last_advanced_at) : null,
      lastNiche: r.last_niche,
      lastAngleId: r.last_angle_id,
    };
  } catch (err: any) {
    console.warn(`[RotationState] read error: ${err?.message}`);
    return null;
  }
}

/**
 * Atomically advance the cursor and return the seed for the slot that was just
 * consumed. Supabase is the source of truth; we read total_ships, compute the
 * seed at that slot, then PATCH total_ships+1 with last_niche/last_angle_id.
 *
 * Why advance-then-return (not peek-then-commit): retries should see fresh
 * seeds. With this model, the uniqueness retry loop calls advanceAndPickSeed
 * again and gets the next slot in the rotation — no special peek/rollback
 * machinery needed. Burned slots are fine; with 200+ unique slots per brand,
 * losing one to a failed render is irrelevant.
 *
 * Throws on Supabase failure rather than silently returning a fallback. The
 * whole point of this rotator is determinism — silent fallbacks are exactly
 * the failure mode this commit is built to kill (see extractNarrativeBlueprint
 * gravity-well bug, S125+).
 */
export async function advanceAndPickSeed(brand: Brand): Promise<RotationSeed> {
  const state = await getRotationState(brand);
  if (state === null) {
    throw new Error(
      `advanceAndPickSeed: cannot read pipeline_rotation_state for ${brand} — ` +
      `refusing to advance with stale/missing cursor. Resolve Supabase connectivity first.`,
    );
  }
  const slot = state.totalShips;
  const seed = computeSeedAtSlot(brand, slot);

  const cfg = getSupabaseConfig();
  if (!cfg) {
    throw new Error("advanceAndPickSeed: Supabase not configured");
  }
  const patchResp = await fetch(
    `${cfg.url}/rest/v1/pipeline_rotation_state?brand=eq.${encodeURIComponent(brand)}`,
    {
      method: "PATCH",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        total_ships: slot + 1,
        last_advanced_at: new Date().toISOString(),
        last_niche: seed.niche,
        last_angle_id: seed.angle.id,
      }),
    },
  );
  if (!patchResp.ok) {
    const body = await patchResp.text().catch(() => "");
    throw new Error(
      `advanceAndPickSeed: PATCH failed ${patchResp.status}: ${body.slice(0, 200)} — ` +
      `cursor not advanced; next call will return the same seed.`,
    );
  }
  console.log(
    `🔄 [RotationState] ${brand} slot=${slot} → niche="${seed.niche}" angle="${seed.angle.id}" (pass ${seed.passIndex + 1}, niche ${seed.nicheIndex + 1}/${getAllowedNiches(brand).length}, angle ${seed.angleIndex + 1}/${THESIS_ANGLES[brand]?.[seed.niche]?.length ?? 0})`,
  );
  return seed;
}

/**
 * Coverage check — verify every allowed niche has at least one angle in the
 * THESIS_ANGLES pool. Throws on first gap so a missing pool is caught at boot
 * time, not at runtime when the rotator hits the empty niche.
 *
 * Call this once at process start (after config load). Cheap; 30 lookups.
 */
export function assertRotationCoverage(): void {
  const brands: Brand[] = ["sovereign_synthesis", "containment_field"];
  const gaps: string[] = [];
  for (const brand of brands) {
    for (const niche of getAllowedNiches(brand)) {
      const normalized = normalizeNiche(niche);
      const angles = THESIS_ANGLES[brand]?.[normalized] ?? [];
      if (angles.length === 0) {
        gaps.push(`${brand}/${normalized}`);
      }
    }
  }
  if (gaps.length > 0) {
    throw new Error(
      `assertRotationCoverage: ${gaps.length} niche(s) missing THESIS_ANGLES entries: ${gaps.join(", ")}. ` +
      `Every allowed niche must have at least one angle for the rotator to function.`,
    );
  }
}

/**
 * Diagnostic — pure, no I/O. Returns the next N seeds the rotator WOULD pick
 * for `brand` starting at `startSlot`. Useful for `/rotation peek` Telegram
 * commands and offline planning.
 */
export function previewRotation(brand: Brand, startSlot: number, count: number): RotationSeed[] {
  const out: RotationSeed[] = [];
  for (let i = 0; i < count; i++) {
    out.push(computeSeedAtSlot(brand, startSlot + i));
  }
  return out;
}
