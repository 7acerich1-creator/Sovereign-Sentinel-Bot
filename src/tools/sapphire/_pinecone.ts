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

// ── QUERY similar personal facts ────────────────────────────────────────────
export async function recallSapphireFacts(
  query: string,
  topK = 5,
  minScore = 0.6,
): Promise<Array<{ key: string; value: string; category: string; score: number }>> {
  if (!PINECONE_HOST || !PINECONE_API_KEY) return [];
  if (!query || query.length < 4) return [];

  const vec = await embedText(query);
  if (!vec) return [];

  try {
    const res = await fetch(`${PINECONE_HOST}/query`, {
      method: "POST",
      headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace: NAMESPACE,
        vector: vec,
        topK,
        includeMetadata: true,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const matches = (data.matches as any[]) || [];
    return matches
      .filter((m) => m.score >= minScore)
      .map((m) => ({
        key: String(m.metadata?.key || ""),
        value: String(m.metadata?.value || ""),
        category: String(m.metadata?.category || ""),
        score: Number(m.score || 0),
      }));
  } catch {
    return [];
  }
}
