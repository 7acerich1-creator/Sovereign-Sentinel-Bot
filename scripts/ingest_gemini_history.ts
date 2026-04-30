// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// scripts/ingest_gemini_history.ts (S125i, 2026-04-29)
//
// Ingests a Gemini history JSON export into Sapphire's Pinecone
// `sapphire-personal` namespace so she can semantically recall every
// conversation Ace has had with Gemini over the past year.
//
// Source: a JSON file produced by the Claude-in-Chrome scraper run.
// Format: array of {id, title, turn_count, char_count, turns: [{role, text}]}
//
// Usage:
//   npx tsx scripts/ingest_gemini_history.ts <path-to-json>
//
// Behavior:
//   - Filters turns with text < 80 chars (no point embedding "ok" or "yes")
//   - Skips IDs already in the resume sidecar (resumable)
//   - Rate-limits: 250ms between embeddings to stay under Gemini quota
//   - Saves progress every 10 successful upserts
//   - Prints chat-level progress (X/93) + turn-level counts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname, basename } from "path";
import "dotenv/config";

interface Turn { role: "user" | "model" | "thoughts"; text: string; }
interface Chat { id: string; title: string; turn_count: number; char_count: number; turns: Turn[]; }

const PINECONE_HOST = process.env.PINECONE_HOST;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NAMESPACE = "sapphire-personal";
const MIN_CHARS = 80;
const RATE_LIMIT_MS = 250;
const SAVE_EVERY = 10;

if (!PINECONE_HOST || !PINECONE_API_KEY) {
  console.error("❌ PINECONE_HOST or PINECONE_API_KEY not set in env. Source .env first.");
  process.exit(1);
}
if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
  console.error("❌ Neither GEMINI_API_KEY nor OPENAI_API_KEY set. One required for embeddings.");
  process.exit(1);
}



const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npx tsx scripts/ingest_gemini_history.ts <path-to-json>");
  process.exit(1);
}
const absPath = resolve(inputPath);
if (!existsSync(absPath)) { console.error(`❌ File not found: ${absPath}`); process.exit(1); }

const sidecarPath = absPath.replace(/\.json$/, "_progress.json");
let progress: { ingestedIds: string[]; failedIds: string[]; startedAt: string } =
  existsSync(sidecarPath)
    ? JSON.parse(readFileSync(sidecarPath, "utf-8"))
    : { ingestedIds: [], failedIds: [], startedAt: new Date().toISOString() };

const ingestedSet = new Set(progress.ingestedIds);

function saveProgress() {
  writeFileSync(sidecarPath, JSON.stringify(progress, null, 2));
}

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
      } else if (res.status !== 429) {
        const errText = await res.text().catch(() => "");
        console.warn(`  [embed] Gemini ${res.status}: ${errText.slice(0, 150)}`);
      }
    } catch (e: any) { console.warn(`  [embed] Gemini error: ${e.message}`); }
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
    } catch (e: any) { console.warn(`  [embed] OpenAI error: ${e.message}`); }
  }
  return null;
}



async function upsertVector(id: string, vec: number[], metadata: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(`${PINECONE_HOST}/vectors/upsert`, {
      method: "POST",
      headers: { "Api-Key": PINECONE_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace: NAMESPACE,
        vectors: [{ id, values: vec, metadata }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`  [upsert] Pinecone ${res.status}: ${errText.slice(0, 150)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`  [upsert] error: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`📂 Reading ${absPath}`);
  const raw = readFileSync(absPath, "utf-8");
  const chats: Chat[] = JSON.parse(raw);
  console.log(`📊 ${chats.length} chats loaded.`);
  console.log(`💾 Resume sidecar: ${sidecarPath} (${ingestedSet.size} already ingested)`);
  console.log(`🎯 Namespace: ${NAMESPACE}`);
  console.log(`⚙️  Min chars per turn: ${MIN_CHARS} | Rate limit: ${RATE_LIMIT_MS}ms`);
  console.log("");

  let totalEligible = 0;
  let totalSkipped = 0;
  let totalIngested = 0;
  let totalFailed = 0;
  const startTime = Date.now();

  for (let chatIdx = 0; chatIdx < chats.length; chatIdx++) {
    const chat = chats[chatIdx];
    const eligible = chat.turns.filter((t) => t.text.length >= MIN_CHARS);
    totalEligible += eligible.length;

    if (eligible.length === 0) {
      console.log(`[${chatIdx + 1}/${chats.length}] SKIP "${chat.title.slice(0, 50)}" — all turns under ${MIN_CHARS} chars`);
      continue;
    }

    let chatIngested = 0;
    let chatSkipped = 0;
    let chatFailed = 0;

    for (let turnIdx = 0; turnIdx < chat.turns.length; turnIdx++) {
      const turn = chat.turns[turnIdx];
      if (turn.text.length < MIN_CHARS) continue;
      const id = `gemini-${chat.id}-${turnIdx}-${turn.role}`;

      if (ingestedSet.has(id)) { chatSkipped++; totalSkipped++; continue; }

      const vec = await embedText(turn.text);
      if (!vec) { chatFailed++; totalFailed++; progress.failedIds.push(id); continue; }

      const ok = await upsertVector(id, vec, {
        source: "gemini_takeout",
        chat_id: chat.id,
        chat_title: chat.title.slice(0, 200),
        turn_index: turnIdx,
        role: turn.role,
        value: turn.text.slice(0, 1500),
        type: "consciousness_journey",
        timestamp: new Date().toISOString(),
      });

      if (ok) {
        chatIngested++; totalIngested++;
        progress.ingestedIds.push(id); ingestedSet.add(id);
        if (totalIngested % SAVE_EVERY === 0) saveProgress();
      } else {
        chatFailed++; totalFailed++;
        progress.failedIds.push(id);
      }

      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(
      `[${String(chatIdx + 1).padStart(2)}/${chats.length}] "${chat.title.slice(0, 50).padEnd(50)}" — ` +
      `ingested ${chatIngested} skipped ${chatSkipped} failed ${chatFailed} | ` +
      `total ingested ${totalIngested} | ${elapsed}s elapsed`,
    );
    saveProgress();
  }

  saveProgress();
  console.log("");
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Ingestion complete.`);
  console.log(`   Eligible turns: ${totalEligible}`);
  console.log(`   Newly ingested: ${totalIngested}`);
  console.log(`   Skipped (already done): ${totalSkipped}`);
  console.log(`   Failed: ${totalFailed}`);
  console.log(`   Total in namespace: ${progress.ingestedIds.length}`);
  console.log(`   Sidecar: ${sidecarPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
