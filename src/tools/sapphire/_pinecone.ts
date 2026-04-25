// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Pinecone helper (PERSONAL namespace ONLY)
// Session 114 (S114l) — 2026-04-25
//
// Strict separation: personal memories live in `sapphire-personal` namespace.
// Brand/business insights stay in the `brand` namespace (untouched by PA).
// Never cross-pollinate.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PINECONE_HOST = process.env.PINECONE_HOST;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const NAMESPACE = "sapphire-personal";

// Same embed function as src/memory/pinecone.ts — Gemini primary, OpenAI fallback.
async function embedText(text: string): Promise<number[] | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!geminiKey && !openaiKey) return null;

  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: text.slice(0, 2000) }] },
          outputDimensionality: 1024,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const vec = data.embedding?.values;
        if (vec && vec.length > 0) return vec;
      }
    } catch (e) { /* fall through */ }
  }

  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000), dimensions: 1024 }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const vec = data.data?.[0]?.embedding;
        if (vec && vec.length > 0) return vec;
      }
    } catch (e) { /* fall through */ }
  }

  return null;
}

// ── UPSERT a personal fact ───────────────────────────────────────────────────
export async function upsertSapphireFact(
  key: string,
  value: string,
  category: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!PINECONE_HOST || !PINECONE_API_KEY) {
    return { ok: false, error: "Pinecone env not configured." };
  }

  const text = `${key}: ${value} (category: ${category})`;
  const vec = await embedText(text);
  if (!vec) return { ok: false, error: "Embedding failed (no API key worked)." };

  try {
    const res = await fetch(`${PINECONE_HOST}/vectors/upsert`, {
      method: "POST",
      headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace: NAMESPACE,
        vectors: [{
          id: `fact:${key}`,
          values: vec,
          metadata: {
            key,
            value: value.slice(0, 1000),
            category,
            type: "personal_fact",
            timestamp: new Date().toISOString(),
          },
        }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinecone ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ── QUERY similar personal facts ACROSS multiple namespaces ────────────────
//
// Sapphire reads from FOUR namespaces because seed memory may live anywhere:
//   - sapphire-personal: NEW. PA-mode personal facts (post-S114l).
//   - sapphire: LEGACY. Original Sapphire COO memory before namespace split.
//   - shared: Cross-cutting insights from any agent (insight-extractor flagged shared:true).
//   - brand: Business intel (lower weight — usually not personal but may contain Ace context).
//
// Results are merged + deduped + sorted by score. Sapphire-personal gets a
// small score boost to prefer her own personal memory when scores are close.
const PA_RECALL_NAMESPACES: Array<{ ns: string; weight: number }> = [
  { ns: "sapphire-personal", weight: 1.0 },
  { ns: "sapphire", weight: 0.95 },              // legacy (empty in current state but kept for future)
  { ns: "sovereign-synthesis", weight: 0.95 },   // SEED MEMORY — 80 vectors of Ace's deep context
  { ns: "conversations", weight: 0.9 },          // past chat history — 32 vectors
  { ns: "shared", weight: 0.9 },                 // cross-cutting insights
  { ns: "brand", weight: 0.85 },                 // last priority — mostly business but contains some Ace context
];

interface RecallMatch {
  key: string;
  value: string;
  category: string;
  score: number;
  namespace: string;
}

async function queryNamespace(
  vec: number[],
  namespace: string,
  topK: number,
): Promise<RecallMatch[]> {
  try {
    const res = await fetch(`${PINECONE_HOST}/query`, {
      method: "POST",
      headers: { "Api-Key": PINECONE_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ namespace, vector: vec, topK, includeMetadata: true }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const matches = (data.matches as any[]) || [];
    return matches.map((m) => ({
      key: String(m.metadata?.key || m.metadata?.id || m.id || ""),
      // Different writers use different metadata schemas — try both
      value: String(m.metadata?.value || m.metadata?.content || ""),
      category: String(m.metadata?.category || m.metadata?.type || ""),
      score: Number(m.score || 0),
      namespace,
    }));
  } catch {
    return [];
  }
}

export async function recallSapphireFacts(
  query: string,
  topK = 5,
  minScore = 0.6,
): Promise<Array<{ key: string; value: string; category: string; score: number; namespace: string }>> {
  if (!PINECONE_HOST || !PINECONE_API_KEY) return [];
  if (!query || query.length < 4) return [];

  const vec = await embedText(query);
  if (!vec) return [];

  // Query all namespaces in parallel
  const perNamespaceK = Math.max(2, Math.ceil(topK / 2));
  const allResults = await Promise.all(
    PA_RECALL_NAMESPACES.map(({ ns, weight }) =>
      queryNamespace(vec, ns, perNamespaceK).then((matches) =>
        matches.map((m) => ({ ...m, score: m.score * weight })),
      ),
    ),
  );

  // Merge, dedupe by (namespace, key), apply minScore, sort desc, slice topK
  const merged: RecallMatch[] = [];
  const seen = new Set<string>();
  for (const ns of allResults) {
    for (const m of ns) {
      const id = `${m.namespace}::${m.key}`;
      if (seen.has(id)) continue;
      if (m.score < minScore) continue;
      if (!m.value) continue;
      seen.add(id);
      merged.push(m);
    }
  }
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topK);
}

// ── AUDIT: stats + sample per namespace ─────────────────────────────────────
//
// Used by the /api/sapphire/memory-audit endpoint to inspect what's actually
// in Pinecone for each namespace Sapphire reads from.
export async function auditSapphireMemory(
  sampleQuery = "Ace background life mission family",
): Promise<{
  available: boolean;
  stats: Record<string, number>;
  samples: Record<string, RecallMatch[]>;
  error?: string;
}> {
  if (!PINECONE_HOST || !PINECONE_API_KEY) {
    return { available: false, stats: {}, samples: {}, error: "Pinecone env not configured" };
  }

  const stats: Record<string, number> = {};
  const samples: Record<string, RecallMatch[]> = {};

  // 1. describe_index_stats — total vector counts per namespace
  try {
    const statsRes = await fetch(`${PINECONE_HOST}/describe_index_stats`, {
      method: "POST",
      headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    if (statsRes.ok) {
      const data = (await statsRes.json()) as any;
      for (const [ns, info] of Object.entries(data.namespaces || {})) {
        stats[ns] = (info as any).vectorCount || 0;
      }
      stats.__total = data.totalVectorCount || 0;
    }
  } catch (e: any) {
    return { available: false, stats: {}, samples: {}, error: `describe_index_stats failed: ${e.message}` };
  }

  // 2. Sample query against each namespace Sapphire would read
  const vec = await embedText(sampleQuery);
  if (vec) {
    for (const { ns } of PA_RECALL_NAMESPACES) {
      samples[ns] = await queryNamespace(vec, ns, 5);
    }
  }

  return { available: true, stats, samples };
}
