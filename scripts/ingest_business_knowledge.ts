// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// scripts/ingest_business_knowledge.ts (S125j, 2026-04-29)
//
// Ingests business-knowledge.json into Pinecone `brand` namespace so
// Sapphire (and any other agent that recalls from the brand namespace)
// has structured knowledge of Ace's actual business infrastructure.
//
// Source: scripts/business-knowledge.json — array of {id, category, title,
// content, tags}. Built from canonical repo .md files (NORTH_STAR, master
// reference, PURPOSE, DEFERRED-BUILDS, AUDIT, MAVEN-CREW-DIRECTIVES) plus
// the current session's worth of context.
//
// Namespace: `brand` (per master reference architecture: "Brand/business
// insights stay in the brand namespace"). Sapphire's PA recall reads from
// brand alongside sapphire-personal so she finds these naturally.
//
// Usage:
//   railway run npx ts-node --transpile-only scripts/ingest_business_knowledge.ts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync } from "fs";
import { resolve } from "path";

interface Entry {
  id: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
}

const PINECONE_HOST = process.env.PINECONE_HOST;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NAMESPACE = "brand";
const RATE_LIMIT_MS = 250;

if (!PINECONE_HOST || !PINECONE_API_KEY) {
  console.error("❌ PINECONE_HOST or PINECONE_API_KEY not set in env.");
  process.exit(1);
}
if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
  console.error("❌ Need GEMINI_API_KEY or OPENAI_API_KEY for embeddings.");
  process.exit(1);
}



const inputPath = resolve(__dirname, "business-knowledge.json");
const entries: Entry[] = JSON.parse(readFileSync(inputPath, "utf-8"));
console.log(`📂 Loaded ${entries.length} business knowledge entries from ${inputPath}`);
console.log(`🎯 Namespace: ${NAMESPACE} (Sapphire's PA tool reads from brand alongside sapphire-personal)`);
console.log("");

async function embedText(text: string): Promise<number[] | null> {
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: text.slice(0, 2000) }] },
            outputDimensionality: 1024,
          }),
        },
      );
      if (res.ok) {
        const data: any = await res.json();
        const vec = data.embedding?.values;
        if (vec && vec.length > 0) return vec;
      }
    } catch {}
  }
  if (OPENAI_API_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000), dimensions: 1024 }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const vec = data.data?.[0]?.embedding;
        if (vec && vec.length > 0) return vec;
      }
    } catch {}
  }
  return null;
}

async function upsert(id: string, vec: number[], metadata: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(`${PINECONE_HOST}/vectors/upsert`, {
      method: "POST",
      headers: { "Api-Key": PINECONE_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: NAMESPACE, vectors: [{ id, values: vec, metadata }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  let ok = 0, fail = 0;
  for (const entry of entries) {
    // Embed: prepend title for stronger semantic anchor
    const embedText_ = `${entry.title}\n\n${entry.content}`;
    const vec = await embedText(embedText_);
    if (!vec) {
      console.log(`❌ ${entry.id} — embedding failed`);
      fail++;
      continue;
    }
    const success = await upsert(`brand-${entry.id}`, vec, {
      source: "business_knowledge_canon",
      category: entry.category,
      title: entry.title,
      value: entry.content.slice(0, 1500),
      tags: entry.tags.join(","),
      type: "business_infrastructure",
      timestamp: new Date().toISOString(),
    });
    if (success) {
      ok++;
      console.log(`✅ ${entry.id.padEnd(28)} [${entry.category.padEnd(20)}] "${entry.title.slice(0, 60)}"`);
    } else {
      console.log(`❌ ${entry.id} — upsert failed`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }
  console.log("");
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Business knowledge ingestion complete.`);
  console.log(`   Ingested: ${ok}`);
  console.log(`   Failed: ${fail}`);
  console.log(`   Namespace: ${NAMESPACE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
