// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION Phase 3 Tasks 3.6 + 3.7 — Script uniqueness guard
//
// Closes the "every long-form sounds the same" failure mode. Before a script
// enters the render pipeline we embed it and query Pinecone in the brand's
// namespace:
//   • scripts-ace_richie
//   • scripts-containment_field
// If ANY existing shipped script has cosine similarity >= UNIQUENESS_THRESHOLD,
// reject with `ScriptTooSimilarError`. The writer has 2 retries before halt —
// enforced by the caller (faceless-factory), not this module.
//
// Task 3.7: after a script SHIPS (upload succeeded), call `persistShippedScript`
// to upsert the vector into the brand namespace. Same embedding model as the
// guard so similarity math stays symmetric.
//
// Design notes:
//   • No SDK dependency — raw Pinecone REST + raw embedding REST to match the
//     rest of the codebase (src/memory/pinecone.ts convention).
//   • Graceful degradation: if Pinecone OR the embedding provider is missing,
//     the guard short-circuits to "permitted" and logs a warning. Shipping a
//     possible duplicate is better than halting on an infra blip.
//   • We query topK=5 and filter in-code so one slow-to-drift niche can't
//     starve the guard when the real duplicate is in rank 3.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";
import type { Brand } from "../pod/types";

/**
 * Cosine-similarity threshold above which two scripts are "too similar".
 * 0.85 is tight enough that paraphrases register, loose enough that same-niche
 * scripts on different theses pass. Tuned for 1024d gemini-embedding-001.
 */
export const UNIQUENESS_THRESHOLD = 0.85;

/** Pinecone namespace convention for shipped scripts, keyed by brand. */
export function scriptNamespace(brand: Brand): string {
  return `scripts-${brand}`;
}

export class ScriptTooSimilarError extends Error {
  constructor(
    public readonly brand: Brand,
    public readonly score: number,
    public readonly matchId: string,
    public readonly matchPreview: string,
  ) {
    super(
      `ScriptTooSimilarError: brand="${brand}" candidate matches shipped script ` +
      `"${matchId}" at cosine=${score.toFixed(4)} (>= ${UNIQUENESS_THRESHOLD}). ` +
      `Preview: ${matchPreview.slice(0, 140)}...`,
    );
    this.name = "ScriptTooSimilarError";
  }
}

interface PineconeCfg {
  apiKey: string;
  host: string;
}

function getPineconeCfg(): PineconeCfg | null {
  const apiKey = process.env.PINECONE_API_KEY || config.memory.pineconeApiKey || "";
  const host = process.env.PINECONE_HOST || "";
  if (!apiKey || !host) return null;
  return { apiKey, host };
}

/**
 * Embed text via Gemini (primary) or OpenAI (fallback). Mirrors the embedder
 * in src/memory/pinecone.ts so guard vectors and persistence vectors live in
 * the same metric space. Returns [] on any failure — caller treats empty as
 * "embedding unavailable, skip guard".
 */
async function embedScript(text: string): Promise<number[]> {
  const geminiKey = config.llm.providers.gemini?.apiKey;
  const openaiKey = config.llm.providers.openai?.apiKey;
  if (!geminiKey && !openaiKey) return [];

  // Primary: Gemini gemini-embedding-001, 1024d via outputDimensionality
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          // Scripts can be 3-4k chars; 2000 chars captures the thesis +
          // opening + first act, which is where duplication is detectable.
          content: { parts: [{ text: text.slice(0, 2000) }] },
          outputDimensionality: 1024,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const v = data.embedding?.values || [];
        if (Array.isArray(v) && v.length > 0) return v;
      } else {
        const body = await res.text().catch(() => "");
        console.warn(`[UniquenessGuard] Gemini embed ${res.status}: ${body.slice(0, 200)}. Trying OpenAI...`);
      }
    } catch (err: any) {
      console.warn(`[UniquenessGuard] Gemini embed error: ${err?.message}. Trying OpenAI...`);
    }
  }

  // Fallback: OpenAI text-embedding-3-small @ 768d. NOTE: dimensions mismatch
  // means guard vs persistence MUST agree on provider. If Gemini is down when
  // we guard AND up when we persist, indexes diverge. Safer to keep strict:
  // if primary succeeded ever in this deploy, persistShippedScript should
  // insist on primary. For now — symmetry via same call path.
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: text.slice(0, 2000),
          dimensions: 768,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const v = data.data?.[0]?.embedding || [];
        if (Array.isArray(v) && v.length > 0) return v;
      }
    } catch (err: any) {
      console.warn(`[UniquenessGuard] OpenAI embed error: ${err?.message}`);
    }
  }

  return [];
}

export interface UniquenessResult {
  unique: boolean;
  topScore: number;
  topMatchId: string | null;
  topMatchPreview: string;
  /** "skipped" when Pinecone/embedding unavailable — caller should log + pass. */
  mode: "checked" | "skipped";
}

/**
 * Non-throwing check — returns a result object. Useful when the caller wants
 * to log the match score regardless of whether it passed the threshold.
 */
export async function checkScriptUniqueness(brand: Brand, script: string): Promise<UniquenessResult> {
  const cfg = getPineconeCfg();
  if (!cfg) {
    console.warn(`[UniquenessGuard] Pinecone not configured — skipping guard for ${brand}`);
    return { unique: true, topScore: 0, topMatchId: null, topMatchPreview: "", mode: "skipped" };
  }

  const vector = await embedScript(script);
  if (vector.length === 0) {
    console.warn(`[UniquenessGuard] Embedding unavailable — skipping guard for ${brand}`);
    return { unique: true, topScore: 0, topMatchId: null, topMatchPreview: "", mode: "skipped" };
  }

  try {
    const res = await fetch(`${cfg.host}/query`, {
      method: "POST",
      headers: {
        "Api-Key": cfg.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vector,
        topK: 5,
        includeMetadata: true,
        namespace: scriptNamespace(brand),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[UniquenessGuard] Pinecone query ${res.status} ${body.slice(0, 200)} — skipping guard`);
      return { unique: true, topScore: 0, topMatchId: null, topMatchPreview: "", mode: "skipped" };
    }

    const data = (await res.json()) as any;
    const matches = (data.matches || []) as Array<{ id: string; score: number; metadata?: any }>;
    if (matches.length === 0) {
      return { unique: true, topScore: 0, topMatchId: null, topMatchPreview: "", mode: "checked" };
    }

    // Pinecone cosine returns [-1, 1]; matches are sorted desc.
    const top = matches[0];
    const preview = String(top.metadata?.content || top.metadata?.thesis || "");
    const unique = top.score < UNIQUENESS_THRESHOLD;
    return {
      unique,
      topScore: top.score,
      topMatchId: top.id,
      topMatchPreview: preview,
      mode: "checked",
    };
  } catch (err: any) {
    console.warn(`[UniquenessGuard] Query error: ${err?.message} — skipping guard`);
    return { unique: true, topScore: 0, topMatchId: null, topMatchPreview: "", mode: "skipped" };
  }
}

/**
 * Hard-gate variant. Throws `ScriptTooSimilarError` if the candidate's top match
 * is >= UNIQUENESS_THRESHOLD in the brand namespace. Callers (faceless-factory)
 * wrap this in a 2-retry loop around the script writer before halting.
 */
export async function assertScriptUnique(brand: Brand, script: string): Promise<void> {
  const result = await checkScriptUniqueness(brand, script);
  if (result.mode === "skipped") return;
  if (!result.unique && result.topMatchId) {
    throw new ScriptTooSimilarError(
      brand,
      result.topScore,
      result.topMatchId,
      result.topMatchPreview,
    );
  }
}

export interface PersistScriptParams {
  brand: Brand;
  script: string;
  niche: string;
  thesis?: string;
  jobId: string;
  youtubeUrl?: string;
  /** Optional extra metadata (thumbnail, title, etc.) — will be stringified. */
  extra?: Record<string, string | number | boolean>;
}

/**
 * Task 3.7 — persist a SHIPPED script's vector into the brand namespace so
 * future uniqueness checks see it. Call this AFTER upload succeeds, not when
 * the script is merely written. Vector id = `script-<brand>-<jobId>` for
 * deterministic re-runs.
 *
 * Graceful: returns false on any failure (embedding down, Pinecone down,
 * missing config) — never throws. A missed persist weakens the future guard
 * by one script; a throw would break the pipeline completion path.
 */
export async function persistShippedScript(params: PersistScriptParams): Promise<boolean> {
  const cfg = getPineconeCfg();
  if (!cfg) {
    console.warn(`[UniquenessGuard] Pinecone not configured — cannot persist ${params.brand}/${params.jobId}`);
    return false;
  }

  const vector = await embedScript(params.script);
  if (vector.length === 0) {
    console.warn(`[UniquenessGuard] Embedding unavailable — cannot persist ${params.brand}/${params.jobId}`);
    return false;
  }

  // Flatten extras into string-valued metadata (Pinecone metadata constraint).
  const extraFlat: Record<string, string> = {};
  if (params.extra) {
    for (const [k, v] of Object.entries(params.extra)) {
      extraFlat[k] = typeof v === "string" ? v : String(v);
    }
  }

  const vectorId = `script-${params.brand}-${params.jobId}`;
  try {
    const res = await fetch(`${cfg.host}/vectors/upsert`, {
      method: "POST",
      headers: {
        "Api-Key": cfg.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vectors: [
          {
            id: vectorId,
            values: vector,
            metadata: {
              brand: params.brand,
              niche: params.niche,
              thesis: (params.thesis ?? "").slice(0, 500),
              content: params.script.slice(0, 1000),
              job_id: params.jobId,
              youtube_url: params.youtubeUrl ?? "",
              timestamp: new Date().toISOString(),
              ...extraFlat,
            },
          },
        ],
        namespace: scriptNamespace(params.brand),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[UniquenessGuard] Persist failed ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }

    console.log(`🧬 [UniquenessGuard] Persisted ${vectorId} → ${scriptNamespace(params.brand)}`);
    return true;
  } catch (err: any) {
    console.warn(`[UniquenessGuard] Persist error: ${err?.message}`);
    return false;
  }
}
