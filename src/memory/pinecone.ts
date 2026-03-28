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
// Uses Gemini text-embedding-004 (768 dimensions) via the REST API
// so we don't pull in extra SDK dependencies for a single call.
async function embedText(text: string): Promise<number[]> {
  const geminiKey = config.llm.providers.gemini?.apiKey;
  const openaiKey = config.llm.providers.openai?.apiKey;

  // Primary: Gemini embedding (768d)
  if (geminiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: text.slice(0, 2000) }] },
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      return data.embedding?.values || [];
    }
    console.warn(`[Pinecone] Gemini embed failed (${res.status}), trying OpenAI fallback...`);
  }

  // Fallback: OpenAI text-embedding-3-small (1536d) — only if Pinecone index matches
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
        dimensions: 768, // Match Gemini dimension for index compatibility
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      return data.data?.[0]?.embedding || [];
    }
  }

  throw new Error("No embedding provider available (need GEMINI_API_KEY or OPENAI_API_KEY)");
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
  private async writeToSupabase(node: KnowledgeNode): Promise<void> {
    if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return;

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(config.memory.supabaseUrl, config.memory.supabaseKey);

      await supabase.from("knowledge_nodes").insert({
        id: node.id,
        content: node.content,
        agent_name: node.agent_name,
        niche: node.niche || "general",
        type: node.type,
        namespace: node.namespace,
        tags: node.tags,
        created_at: node.timestamp,
      });
    } catch (err: any) {
      console.error(`[Pinecone→Supabase] knowledge_nodes write error: ${err.message}`);
    }
  }

  private async writeSyncLog(
    vectorId: string,
    agentName: string,
    namespace: string,
    status: string,
    errorMsg?: string
  ): Promise<void> {
    if (!config.memory.supabaseUrl || !config.memory.supabaseKey) return;

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(config.memory.supabaseUrl, config.memory.supabaseKey);

      await supabase.from("sync_log").insert({
        vector_id: vectorId,
        agent_name: agentName,
        namespace,
        status,
        error_message: errorMsg || null,
        synced_at: new Date().toISOString(),
      });
    } catch (err: any) {
      // Non-critical
      console.error(`[Pinecone→Supabase] sync_log write error: ${err.message}`);
    }
  }
}
