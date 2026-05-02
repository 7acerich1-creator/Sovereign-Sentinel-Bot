// Verify Sapphire's recall path returns the newly-ingested vectors.
// Embeds a test query, queries both sapphire-personal and brand namespaces,
// prints top hits.

const PINECONE_HOST = process.env.PINECONE_HOST;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!PINECONE_HOST || !PINECONE_API_KEY || !GEMINI_API_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

async function embed(t: string): Promise<number[]> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: t }] },
        outputDimensionality: 1024,
      }),
    },
  );
  const d: any = await r.json();
  return d.embedding?.values || [];
}

async function query(ns: string, vec: number[], topK = 3): Promise<any[]> {
  const r = await fetch(`${PINECONE_HOST}/query`, {
    method: "POST",
    headers: { "Api-Key": PINECONE_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ namespace: ns, vector: vec, topK, includeMetadata: true }),
  });
  const d: any = await r.json();
  return d.matches || [];
}

async function describe(): Promise<any> {
  const r = await fetch(`${PINECONE_HOST}/describe_index_stats`, {
    method: "POST",
    headers: { "Api-Key": PINECONE_API_KEY!, "Content-Type": "application/json" },
    body: "{}",
  });
  return r.json();
}

async function main() {
  console.log("=== Index stats ===");
  const stats: any = await describe();
  for (const [ns, info] of Object.entries(stats.namespaces || {}) as Array<[string, any]>) {
    console.log(`  ${ns.padEnd(35)} ${info.vectorCount} vectors`);
  }
  console.log("");

  const queries = [
    "What is Ace's mission and target?",
    "Tell me about Sovereign Synthesis Egregore",
    "What does Toilet Mechanics mean — Gravity Siphon Release?",
    "Who are Ace's daughters?",
  ];

  for (const q of queries) {
    console.log(`🔍 Query: "${q}"`);
    const v = await embed(q);
    const personalHits = await query("sapphire-personal", v);
    const brandHits = await query("brand", v);
    const all = [
      ...personalHits.map((m: any) => ({ ...m, ns: "sapphire-personal" })),
      ...brandHits.map((m: any) => ({ ...m, ns: "brand" })),
    ].sort((a, b) => b.score - a.score).slice(0, 4);
    for (const m of all) {
      const value = String(m.metadata?.value || m.metadata?.title || "(no value)").slice(0, 90);
      const title = String(m.metadata?.chat_title || m.metadata?.title || "").slice(0, 50);
      console.log(`  [${m.ns}] ${m.score.toFixed(3)}  ${title.padEnd(50)} — ${value}`);
    }
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
