// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Supabase + pgvector Memory (Tier 3)
// Semantic similarity search, cross-device persistence
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { MemoryProvider, MemoryFact, MemorySearchResult, Message } from "../types";
import { config } from "../config";

export class SupabaseVectorMemory implements MemoryProvider {
  name = "supabase-vector";
  private client: SupabaseClient | null = null;

  async initialize(): Promise<void> {
    if (!config.memory.supabaseUrl || !config.memory.supabaseKey) {
      console.log("ℹ️ Supabase not configured — vector memory disabled");
      return;
    }

    this.client = createClient(config.memory.supabaseUrl, config.memory.supabaseKey);
    console.log("✅ Supabase Vector Memory initialized");
  }

  private ensureClient(): SupabaseClient {
    if (!this.client) throw new Error("Supabase client not initialized");
    return this.client;
  }

  async saveMessage(message: Message): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.from("messages_log").insert({
        chat_id: message.chatId,
        user_id: message.userId,
        role: message.role,
        content: message.content,
        channel: message.channel,
        timestamp: message.timestamp.toISOString(),
        metadata: message.metadata || {},
      });
    } catch (err: any) {
      console.error("Supabase saveMessage error:", err.message);
    }
  }

  async getRecentMessages(chatId: string, limit = 20): Promise<Message[]> {
    try {
      const client = this.ensureClient();
      const { data } = await client
        .from("messages_log")
        .select("*")
        .eq("chat_id", chatId)
        .order("timestamp", { ascending: false })
        .limit(limit);

      return (data || []).reverse().map((r: any) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        timestamp: new Date(r.timestamp),
        channel: r.channel,
        chatId: r.chat_id,
        userId: r.user_id,
        metadata: r.metadata,
      }));
    } catch {
      return [];
    }
  }

  async saveFact(key: string, value: string, category = "general"): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.from("core_memory").upsert(
        { key, value, category, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    } catch (err: any) {
      console.error("Supabase saveFact error:", err.message);
    }
  }

  async getFacts(): Promise<MemoryFact[]> {
    try {
      const client = this.ensureClient();
      const { data } = await client.from("core_memory").select("*").order("updated_at", { ascending: false }).limit(50);

      return (data || []).map((r: any) => ({
        key: r.key,
        value: r.value,
        category: r.category || "general",
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
        accessCount: r.access_count || 0,
      }));
    } catch {
      return [];
    }
  }

  async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    try {
      const client = this.ensureClient();

      // Try pgvector semantic search if available
      const { data, error } = await client.rpc("match_memories", {
        query_text: query,
        match_count: limit,
      });

      if (!error && data) {
        return data.map((r: any) => ({
          content: r.content,
          score: r.similarity || 0.5,
          source: "supabase-vector",
          metadata: r.metadata,
        }));
      }

      // Fallback: text search
      const { data: textData } = await client
        .from("messages_log")
        .select("content")
        .ilike("content", `%${query}%`)
        .limit(limit);

      return (textData || []).map((r: any) => ({
        content: r.content,
        score: 0.5,
        source: "supabase-text",
      }));
    } catch {
      return [];
    }
  }

  async getSummary(chatId: string): Promise<string | null> {
    try {
      const client = this.ensureClient();
      const { data } = await client
        .from("summaries")
        .select("summary")
        .eq("chat_id", chatId)
        .single();
      return data?.summary || null;
    } catch {
      return null;
    }
  }

  async saveSummary(chatId: string, summary: string): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.from("summaries").upsert(
        { chat_id: chatId, summary, updated_at: new Date().toISOString() },
        { onConflict: "chat_id" }
      );
    } catch (err: any) {
      console.error("Supabase saveSummary error:", err.message);
    }
  }

  async compact(): Promise<void> {
    // Supabase doesn't need local compaction
  }

  async logActivity(action: string, details: string, status = "success"): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.from("activity_log").insert({
        action,
        details,
        status,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Non-critical
    }
  }

  async saveData(key: string, value: unknown, dataType = "json"): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.from("data_store").upsert(
        { key, value: JSON.stringify(value), data_type: dataType },
        { onConflict: "key" }
      );
    } catch (err: any) {
      console.error("Supabase saveData error:", err.message);
    }
  }

  async queryData(key: string): Promise<unknown> {
    try {
      const client = this.ensureClient();
      const { data } = await client.from("data_store").select("value, data_type").eq("key", key).single();
      if (!data) return null;
      return data.data_type === "json" ? JSON.parse(data.value) : data.value;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    this.client = null;
  }
}
