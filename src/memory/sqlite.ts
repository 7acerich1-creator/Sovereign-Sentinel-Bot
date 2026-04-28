// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — SQLite Memory (Tier 1)
// Local · Instant · Always Available
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { MemoryProvider, MemoryFact, MemorySearchResult, Message } from "../types";
import { config } from "../config";

const COMPACT_THRESHOLD = 30;

export class SqliteMemory implements MemoryProvider {
  name = "sqlite";
  private db!: Database.Database;

  async initialize(): Promise<void> {
    this.db = new Database(config.memory.sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS core_memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        access_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT DEFAULT '',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        channel TEXT DEFAULT 'telegram',
        timestamp TEXT DEFAULT (datetime('now')),
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS summaries (
        chat_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_core_memory_cat ON core_memory(category);
    `);

    // FTS5 for full-text search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content, chat_id, tokenize='porter unicode61'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          key, value, category, tokenize='porter unicode61'
        );
      `);
    } catch {
      // FTS5 may already exist
    }

    console.log("✅ SQLite Memory initialized");
  }

  async saveMessage(message: Message): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, chat_id, user_id, role, content, channel, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      message.id || randomUUID(),
      message.chatId,
      message.userId || "",
      message.role,
      message.content,
      message.channel,
      message.timestamp.toISOString(),
      JSON.stringify(message.metadata || {})
    );

    // Index in FTS
    try {
      this.db.prepare("INSERT INTO messages_fts (content, chat_id) VALUES (?, ?)").run(
        message.content,
        message.chatId
      );
    } catch {
      // Non-critical
    }
  }

  async getRecentMessages(chatId: string, limit = 20): Promise<Message[]> {
    const rows = this.db.prepare(`
      SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?
    `).all(chatId, limit) as any[];

    if (rows.length === 0) {
      // S122: Log if we find nothing, as this triggers the Hydration Protocol in AgentLoop.
      console.log(`🧠 [SqliteMemory] No history found for chat ${chatId}`);
    } else {
      console.log(`🧠 [SqliteMemory] Found ${rows.length} messages for chat ${chatId}`);
    }

    return rows.reverse().map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      timestamp: new Date(r.timestamp),
      channel: r.channel,
      chatId: r.chat_id,
      userId: r.user_id,
      metadata: JSON.parse(r.metadata || "{}"),
    }));
  }

  async saveFact(key: string, value: string, category = "general"): Promise<void> {
    this.db.prepare(`
      INSERT INTO core_memory (key, value, category, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        updated_at = datetime('now'),
        access_count = access_count + 1
    `).run(key, value, category);

    try {
      this.db.prepare("INSERT INTO memory_fts (key, value, category) VALUES (?, ?, ?)").run(
        key, value, category
      );
    } catch {
      // Non-critical
    }
  }

  async getFacts(chatId?: string): Promise<MemoryFact[]> {
    const rows = this.db.prepare(
      "SELECT * FROM core_memory ORDER BY updated_at DESC LIMIT 50"
    ).all() as any[];

    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      category: r.category,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
      accessCount: r.access_count,
    }));
  }

  async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];

    // Search messages FTS
    try {
      const msgRows = this.db.prepare(`
        SELECT content, rank FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?
      `).all(query, limit) as any[];

      for (const row of msgRows) {
        results.push({
          content: row.content,
          score: Math.abs(row.rank || 0),
          source: "messages",
        });
      }
    } catch {
      // FTS query may fail on special characters
    }

    // Search memory FTS
    try {
      const memRows = this.db.prepare(`
        SELECT key, value, category, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?
      `).all(query, limit) as any[];

      for (const row of memRows) {
        results.push({
          content: `${row.key}: ${row.value}`,
          score: Math.abs(row.rank || 0),
          source: "core_memory",
        });
      }
    } catch {
      // Non-critical
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async getSummary(chatId: string): Promise<string | null> {
    const row = this.db.prepare("SELECT summary FROM summaries WHERE chat_id = ?").get(chatId) as any;
    return row?.summary || null;
  }

  async saveSummary(chatId: string, summary: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO summaries (chat_id, summary, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(chat_id) DO UPDATE SET summary = excluded.summary, updated_at = datetime('now')
    `).run(chatId, summary);
  }

  async compact(chatId: string): Promise<void> {
    const count = (this.db.prepare(
      "SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?"
    ).get(chatId) as any)?.cnt || 0;

    if (count <= COMPACT_THRESHOLD) return;

    // Get older messages to summarize (keep last 10)
    const keepCount = 10;
    const olderMessages = this.db.prepare(`
      SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC LIMIT ?
    `).all(chatId, count - keepCount) as any[];

    if (olderMessages.length === 0) return;

    // Build summary text from older messages
    const text = olderMessages.map((m: any) => `${m.role}: ${m.content}`).join("\n");
    const existing = await this.getSummary(chatId);
    const newSummary = existing
      ? `${existing}\n\n[Compacted ${olderMessages.length} messages]\n${text.slice(0, 2000)}`
      : `[Compacted ${olderMessages.length} messages]\n${text.slice(0, 2000)}`;

    await this.saveSummary(chatId, newSummary.slice(0, 8000));

    // Delete compacted messages
    const ids = olderMessages.map((m: any) => m.id);
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids);

    console.log(`🗜️ Compacted ${olderMessages.length} messages for chat ${chatId}`);
  }

  // ── Fact Extraction (call after each exchange) ──
  extractFactsFromText(text: string): Array<{ key: string; value: string; category: string }> {
    const facts: Array<{ key: string; value: string; category: string }> = [];
    const patterns: Array<{ regex: RegExp; key: string; category: string }> = [
      { regex: /my name is (\w+)/i, key: "user_name", category: "identity" },
      { regex: /i(?:'m| am) (?:a |an )?(\w[\w\s]{2,30})/i, key: "user_role", category: "identity" },
      { regex: /i live in ([\w\s,]+)/i, key: "user_location", category: "identity" },
      { regex: /my timezone is ([\w/+-]+)/i, key: "user_timezone", category: "preferences" },
      { regex: /i prefer (\w[\w\s]{2,50})/i, key: "user_preference", category: "preferences" },
    ];

    for (const p of patterns) {
      const match = text.match(p.regex);
      if (match) {
        facts.push({ key: p.key, value: match[1].trim(), category: p.category });
      }
    }
    return facts;
  }

  getMessageCount(chatId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?"
    ).get(chatId) as any;
    return row?.cnt || 0;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
