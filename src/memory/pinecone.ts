// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Pinecone Semantic Memory (Tier 4)
// Long-term institutional intelligence across all agents
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

// ── Types ──
export interface KnowledgeNode {
  id: string;
  content: string;
  agent_name: string;
  niche?: string;
  type: "hook" | "insight" | "protocol" | "research" | "briefing" | "clip" | "content" | "funnel" | "brand";
  namespace: string;
  tags: string[];
  timestamp: string;
}

export interface PineconeMatch {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

// ── Embedding helper ──
// Uses Gemini gemini-embedding-001 (768d via MRL) via the REST API
// so we don't pull in extra SDK dependencies for a single call.
// NOTE: text-embedding-004 was deprecated Jan 14 2026, replaced by gemini-embedding-001
async function embedText(text: string): Promise<number[]> {
  // GEMINI_API_KEY is set in Railway but getting 403 on embeddings.
  // Likely cause: API key has API restrictions (check Google Cloud Console →
  // Credentials → click the key → "API restrictions" tab. Must include
  // "Generative Language API" or be set to "Don't restrict key").
  // Also check: "Application restrictions" — if restricted to specific IPs,
  // Railway's dynamic IPs will be blocked.
  // Fallback: OPENAI_API_KEY for text-embedding-3-small (768d).
  const geminiKey = config.llm.providers.gemini?.apiKey;
  const openaiKey = config.llm.providers.openai?.apiKey;

  // Early exit: no embedding provider available — return empty (don't throw/spam)
  if (!geminiKey && !openaiKey) {
    return []; // Empty vector = caller skips the upsert
  }

  // Primary: Gemini embedding (1024d)
  if (geminiKey) {
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
      return data.embedding?.values || [];
    }
    const errBody = await res.text().catch(() => "");
    console.warn(`[Pinecone] Gemini embed failed (${res.status}): ${errBody.slice(0, 300)}. Trying OpenAI fallback...`);
  }

  // Fallback: OpenAI text-embedding-3-small
  if (openaiKey) {
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
      return data.data?.[0]?.embedding || [];
    }
  }

  return []; // Graceful degradation — no spam, no throw
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PineconeMemory — REST-based client (no SDK dependency)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class PineconeMemory {
  private apiKey: string;
  private host: string;
  private indexName: string;
  private ready = false;

  constructor() {
    this.apiKey = process.env.PINECONE_API_KEY || config.memory.pineconeApiKey || "";
    this.host = process.env.PINECONE_HOST || "";
    this.indexName = process.env.PINECONE_INDEX || config.memory.pineconeIndex || "";
  }

  async initialize(): Promise<boolean> {
    if (!this.apiKey || !this.host || !this.indexName) {
      console.log("ℹ️ Pinecone not configured — semantic memory disabled");
      console.log(`   PINECONE_API_KEY: ${this.apiKey ? "✅" : "❌"}`);
      console.log(`   PINECONE_HOST: ${this.host ? "✅" : "❌"}`);
      console.log(`   PINECONE_INDEX: ${this.indexName ? "✅" : "❌"}`);
      return false;
    }

    try {
      // Verify connection by hitting the describe_index_stats endpoint
      const res = await fetch(`${this.host}/describe_index_stats`, {
        method: "POST",
        headers: {
          "Api-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      if (!res.ok) {
        console.error(`[Pinecone] Connection failed: ${res.status} ${res.statusText}`);
        return false;
      }

      const stats = (await res.json()) as any;
      this.ready = true;
      console.log(`✅ Pinecone connected: ${this.indexName} at ${this.host}`);
      console.log(`   Vectors: ${stats.totalVectorCount || 0} | Namespaces: ${Object.keys(stats.namespaces || {}).length}`);
      return true;
    } catch (err: any) {
      console.error(`[Pinecone] Init error: ${err.message}`);
      return false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  // ── Write: embed content and upsert to Pinecone + Supabase ──
  async writeKnowledge(node: KnowledgeNode): Promise<boolean> {
    if (!this.ready) return false;

    try {
      // 1. Generate embedding
      const vector = await embedText(node.content);
      if (vector.length === 0) {
        console.error("[Pinecone] Empty embedding returned");
        return false;
      }

      // 2. Upsert to Pinecone
      const upsertRes = await fetch(`${this.host}/vectors/upsert`, {
        method: "POST",
        headers: {
          "Api-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vectors: [
            {
              id: node.id,
              values: vector,
              metadata: {
                content: node.content.slice(0, 1000), // Pinecone metadata limit
                agent_name: node.agent_name,
                niche: node.niche || "general",
                type: node.type,
                tags: node.tags.join(","),
                timestamp: node.timestamp,
              },
            },
          ],
          namespace: node.namespace,
        }),
      });

      if (!upsertRes.ok) {
        const err = await upsertRes.text();
        console.error(`[Pinecone] Upsert failed: ${err}`);
        return false;
      }

      // 3. Mirror to Supabase knowledge_nodes table
      await this.writeToSupabase(node);

      // 4. Log to sync_log
      await this.writeSyncLog(node.id, node.agent_name, node.namespace, "success");

      console.log(`🧠 [Pinecone] Knowledge stored: [${node.namespace}/${node.type}] by ${node.agent_name} — "${node.content.slice(0, 60)}..."`);
      return true;
    } catch (err: any) {
      console.error(`[Pinecone] writeKnowledge error: ${err.message}`);
      await this.writeSyncLog(node.id, node.agent_name, node.namespace, "error", err.message);
      return false;
    }
  }

  // ── Read: query semantically similar past knowledge ──
  async queryRelevant(
    queryText: string,
    topK = 3,
    namespace = "",
    minScore = 0.7
  ): Promise<Array<{ content: string; score: number; agent: string; type: string; niche: string }>> {
    if (!this.ready) return [];

    try {
      const vector = await embedText(queryText);
      if (vector.length === 0) return [];

      const body: any = {
        vector,
        topK,
        includeMetadata: true,
      };
      if (namespace) body.namespace = namespace;

      const res = await fetch(`${this.host}/query`, {
        method: "POST",
        headers: {
          "Api-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`[Pinecone] Query failed: ${res.status}`);
        return [];
      }

      const data = (await res.json()) as any;
      const matches = (data.matches || []) as PineconeMatch[];

      return matches
        .filter((m) => m.score >= minScore)
        .map((m) => ({
          content: String(m.metadata.content || ""),
          score: m.score,
          agent: String(m.metadata.agent_name || "unknown"),
          type: String(m.metadata.type || "insight"),
          niche: String(m.metadata.niche || "general"),
        }));
    } catch (err: any) {
      console.error(`[Pinecone] queryRelevant error: ${err.message}`);
      return [];
    }
  }

  // ── Supabase mirror ──
  // must use SERVICE ROLE key — anon key fails RLS on insert.
  // Both knowledge_nodes and sync_log have RLS enabled with service-role-only
  // write policies. Prior code used config.memory.supabaseKey (which resolves
  // to SUPABASE_ANON_KEY) and silently swallowed the JS-client error →
  // mirror has been empty for the bot's lifetime. Now uses SERVICE_ROLE key
  // explicitly with anon fallback (so local dev without service-role key
  // doesn't crash, just no-ops).
  private getMirrorKey(): string | undefined {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey;
  }

  private async writeToSupabase(node: KnowledgeNode): Promise<void> {
    if (!config.memory.supabaseUrl) return;
    const key = this.getMirrorKey();
    if (!key) return;

    // Skip Supabase mirror for non-UUID IDs (e.g., blueprint seed IDs like "blueprint-sapphire-chunk-0")
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(node.id)) {
      return; // Pinecone-only entry (blueprints, etc.)
    }

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(config.memory.supabaseUrl, key);

      const { error } = await supabase.from("knowledge_nodes").insert({
        id: node.id,
        content: node.content,
        agent_name: node.agent_name,
        niche: node.niche || "general",
        type: node.type,
        namespace: node.namespace,
        tags: node.tags,
        created_at: node.timestamp,
      });
      if (error) {
        console.error(`[Pinecone→Supabase] knowledge_nodes insert error: ${error.message} (code=${error.code})`);
      }
    } catch (err: any) {
      console.error(`[Pinecone→Supabase] knowledge_nodes write threw: ${err.message}`);
    }
  }

  private async writeSyncLog(
    vectorId: string,
    agentName: string,
    namespace: string,
    status: string,
    errorMsg?: string
  ): Promise<void> {
    if (!config.memory.supabaseUrl) return;
    const key = this.getMirrorKey();
    if (!key) return;

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(config.memory.supabaseUrl, key);

      const { error } = await supabase.from("sync_log").upsert({
        vector_id: vectorId,
        agent_name: agentName,
        namespace,
        status,
        error_message: errorMsg || null,
        synced_at: new Date().toISOString(),
      }, { onConflict: "vector_id" });
      if (error) {
        console.error(`[Pinecone→Supabase] sync_log upsert error: ${error.message} (code=${error.code})`);
      }
    } catch (err: any) {
      console.error(`[Pinecone→Supabase] sync_log write threw: ${err.message}`);
    }
  }

  // ── Boot-time blueprint seeder ──
  // Reads all personality_config blueprints from Supabase and seeds them into
  // Pinecone so every agent starts with foundational crew knowledge on day one.
  async seedBlueprints(): Promise<number> {
    if (!this.ready) return 0;
    if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return 0;

    const AGENT_NAMESPACES: Record<string, string> = {
      alfred: "hooks", yuki: "clips", anita: "content",
      vector: "funnels", sapphire: "brand", veritas: "brand",
    };

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(config.memory.supabaseUrl, config.memory.supabaseKey);

      // Pre-check: skip entirely if blueprints are already seeded
      const { data: existingSeeds } = await supabase
        .from("sync_log")
        .select("vector_id")
        .like("vector_id", "blueprint-%")
        .limit(1);

      if (existingSeeds && existingSeeds.length > 0) {
        console.log("✅ [Pinecone Seeder] Blueprints already seeded — skipping (found existing sync_log entries)");
        return 0;
      }

      const { data: blueprints, error } = await supabase
        .from("personality_config")
        .select("agent_name, prompt_blueprint");

      if (error || !blueprints || blueprints.length === 0) {
        // Supabase personality_config was retired in Session 28 (bloated prompts caused
        // Groq 413 → Gemini failover on every dispatch, ~$12/day burn). Personalities now
        // load from bundled JSON (src/data/personalities.json). This branch is the expected
        // steady-state — log quietly, do not warn. If Supabase blueprint seeding is ever
        // re-enabled, repopulate personality_config and remove this comment.
        console.log("ℹ️ [Pinecone Seeder] Supabase blueprints retired — personalities load from bundled JSON (expected)");
        return 0;
      }

      let seeded = 0;
      for (const bp of blueprints) {
        if (!bp.prompt_blueprint || bp.prompt_blueprint.length < 100) continue;

        const agentName = bp.agent_name.toLowerCase().replace(/\s+/g, "_");
        const namespace = AGENT_NAMESPACES[agentName] || "general";

        // Deterministic ID so re-runs don't create duplicates
        const seedId = `blueprint-${agentName}`;

        // Chunk large blueprints: Pinecone metadata limit is ~40KB,
        // and embeddings work best on focused chunks.
        // Split into ~1000 char chunks with overlap
        const chunks = this.chunkText(bp.prompt_blueprint, 1000, 100);

        for (let i = 0; i < chunks.length; i++) {
          const chunkId = chunks.length === 1 ? seedId : `${seedId}-chunk-${i}`;
          const node: KnowledgeNode = {
            id: chunkId,
            content: chunks[i],
            agent_name: agentName,
            niche: "identity",
            type: "brand",
            namespace,
            tags: ["blueprint", "identity", agentName, "foundational"],
            timestamp: new Date().toISOString(),
          };

          await this.writeKnowledge(node);
          seeded++;
        }

        console.log(`🌱 [Seeder] ${bp.agent_name}: ${chunks.length} chunk(s) seeded to Pinecone/${namespace}`);
      }

      console.log(`✅ [Pinecone Seeder] ${seeded} blueprint chunks seeded across ${blueprints.length} agents`);
      return seeded;
    } catch (err: any) {
      console.error(`[Pinecone Seeder] Error: ${err.message}`);
      return 0;
    }
  }

  // ── Bulk memory ingestion ──
  // Ingests an array of raw knowledge entries (from memory files, transcripts, etc.)
  // directly into Pinecone + Supabase. Used for transferring existing memory banks.
  async ingestBulk(entries: Array<{
    content: string;
    agent_name: string;
    niche?: string;
    type?: KnowledgeNode["type"];
    namespace?: string;
    tags?: string[];
  }>): Promise<{ success: number; failed: number }> {
    if (!this.ready) return { success: 0, failed: entries.length };

    let success = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        // Chunk large entries
        const chunks = this.chunkText(entry.content, 1000, 100);

        for (let i = 0; i < chunks.length; i++) {
          const node: KnowledgeNode = {
            id: `bulk-${entry.agent_name}-${Date.now()}-${i}`,
            content: chunks[i],
            agent_name: entry.agent_name,
            niche: entry.niche || "general",
            type: entry.type || "insight",
            namespace: entry.namespace || "general",
            tags: entry.tags || [entry.agent_name],
            timestamp: new Date().toISOString(),
          };

          const ok = await this.writeKnowledge(node);
          if (ok) success++;
          else failed++;

          // Rate limit: small delay between writes to avoid overwhelming APIs
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch (err: any) {
        console.error(`[Bulk ingest] Failed for ${entry.agent_name}: ${err.message}`);
        failed++;
      }
    }

    console.log(`📦 [Bulk Ingest] Complete: ${success} succeeded, ${failed} failed`);
    return { success, failed };
  }

  // ── Sync unembedded knowledge_nodes to Pinecone ──
  // Reads knowledge_nodes that exist in Supabase but haven't been embedded in Pinecone
  // (i.e. bulk imports via SQL). Checks sync_log to avoid re-embedding.
  async syncUnembeddedToVector(): Promise<number> {
    if (!this.ready) return 0;
    if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return 0;

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(config.memory.supabaseUrl, config.memory.supabaseKey);

      // Find knowledge_nodes whose IDs don't appear in sync_log
      const { data: unsynced, error } = await supabase
        .from("knowledge_nodes")
        .select("id, content, agent_name, niche, type, namespace, tags")
        .order("created_at", { ascending: true });

      if (error || !unsynced || unsynced.length === 0) {
        console.log("[Vector Sync] No knowledge_nodes to process");
        return 0;
      }

      // Get already-synced IDs from sync_log
      const { data: synced } = await supabase
        .from("sync_log")
        .select("vector_id");

      const syncedIds = new Set((synced || []).map((s: any) => s.vector_id));

      const toSync = unsynced.filter((n: any) => !syncedIds.has(n.id));
      if (toSync.length === 0) {
        console.log("[Vector Sync] All knowledge_nodes already embedded");
        return 0;
      }

      // Cap boot sync to 25 nodes per deploy to prevent API rate-limit storms.
      // 1000 nodes × embedText() at boot was hammering Gemini embedding API with 1000 calls
      // in ~10 seconds, causing 403s and saturating the network egress.
      // Remaining nodes will be picked up on subsequent deploys (25/deploy).
      const BOOT_SYNC_CAP = 25;
      const cappedSync = toSync.slice(0, BOOT_SYNC_CAP);
      console.log(`🔄 [Vector Sync] ${toSync.length} unembedded nodes found — syncing ${cappedSync.length} this boot (cap: ${BOOT_SYNC_CAP})...`);

      let synced_count = 0;
      for (const node of cappedSync) {
        try {
          const vector = await embedText(node.content);
          if (vector.length === 0) continue;

          // Determine namespace from node data
          const ns = node.namespace || "general";

          const upsertRes = await fetch(`${this.host}/vectors/upsert`, {
            method: "POST",
            headers: {
              "Api-Key": this.apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              vectors: [{
                id: node.id,
                values: vector,
                metadata: {
                  content: (node.content || "").slice(0, 1000),
                  agent_name: node.agent_name || "unknown",
                  niche: node.niche || "general",
                  type: node.type || "insight",
                  tags: Array.isArray(node.tags) ? node.tags.join(",") : String(node.tags || ""),
                  timestamp: new Date().toISOString(),
                },
              }],
              namespace: ns,
            }),
          });

          if (upsertRes.ok) {
            await this.writeSyncLog(node.id, node.agent_name, ns, "success");
            synced_count++;
          } else {
            const errText = await upsertRes.text();
            console.error(`[Vector Sync] Failed for ${node.id}: ${errText}`);
            await this.writeSyncLog(node.id, node.agent_name, ns, "error", errText);
          }

          // Rate limit
          await new Promise((r) => setTimeout(r, 250));
        } catch (err: any) {
          console.error(`[Vector Sync] Error for ${node.id}: ${err.message}`);
        }
      }

      console.log(`✅ [Vector Sync] ${synced_count}/${toSync.length} nodes embedded into Pinecone`);
      return synced_count;
    } catch (err: any) {
      console.error(`[Vector Sync] Error: ${err.message}`);
      return 0;
    }
  }

  // ── Text chunking utility ──
  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    if (text.length <= chunkSize) return [text];

    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start += chunkSize - overlap;
      if (end === text.length) break;
    }
    return chunks;
  }
}
