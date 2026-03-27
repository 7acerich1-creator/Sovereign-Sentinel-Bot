// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Self-Evolving Memory
// Track access patterns, merge duplicates, memory decay
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import Database from "better-sqlite3";
import { config } from "../config";

const DECAY_THRESHOLD_DAYS = 30;
const MERGE_SIMILARITY_THRESHOLD = 0.8;

export class SelfEvolvingMemory {
  private db!: Database.Database;

  async initialize(): Promise<void> {
    this.db = new Database(config.memory.sqlitePath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_access_log (
        memory_key TEXT NOT NULL,
        accessed_at TEXT DEFAULT (datetime('now')),
        context TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_access_key ON memory_access_log(memory_key);
    `);

    console.log("✅ Self-Evolving Memory initialized");
  }

  trackAccess(key: string, context = ""): void {
    this.db.prepare(
      "INSERT INTO memory_access_log (memory_key, context) VALUES (?, ?)"
    ).run(key, context);

    // Bump access count in core_memory
    this.db.prepare(
      "UPDATE core_memory SET access_count = access_count + 1 WHERE key = ?"
    ).run(key);
  }

  getAccessPatterns(): Array<{ key: string; count: number; lastAccess: string }> {
    return this.db.prepare(`
      SELECT memory_key as key, COUNT(*) as count, MAX(accessed_at) as lastAccess
      FROM memory_access_log
      GROUP BY memory_key
      ORDER BY count DESC
      LIMIT 50
    `).all() as any[];
  }

  findDuplicates(): Array<{ key1: string; key2: string; value1: string; value2: string }> {
    // Simple duplicate detection based on similar values
    const facts = this.db.prepare("SELECT key, value FROM core_memory").all() as any[];
    const duplicates: Array<{ key1: string; key2: string; value1: string; value2: string }> = [];

    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const similarity = this.stringSimilarity(facts[i].value, facts[j].value);
        if (similarity > MERGE_SIMILARITY_THRESHOLD) {
          duplicates.push({
            key1: facts[i].key,
            key2: facts[j].key,
            value1: facts[i].value,
            value2: facts[j].value,
          });
        }
      }
    }
    return duplicates;
  }

  mergeDuplicates(keepKey: string, removeKey: string): void {
    this.db.prepare("DELETE FROM core_memory WHERE key = ?").run(removeKey);
    console.log(`🔀 Merged memory: kept "${keepKey}", removed "${removeKey}"`);
  }

  applyDecay(): number {
    // Remove memories that haven't been accessed in DECAY_THRESHOLD_DAYS
    const cutoff = new Date(Date.now() - DECAY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const stale = this.db.prepare(`
      SELECT key FROM core_memory
      WHERE updated_at < ? AND access_count < 3
    `).all(cutoff) as any[];

    if (stale.length > 0) {
      const keys = stale.map((s: any) => s.key);
      const placeholders = keys.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM core_memory WHERE key IN (${placeholders})`).run(...keys);
      console.log(`🧹 Memory decay: removed ${stale.length} stale memories`);
    }

    return stale.length;
  }

  reorganize(): string {
    const patterns = this.getAccessPatterns();
    const duplicates = this.findDuplicates();
    const decayed = this.applyDecay();

    return `Memory Reorganization:\n` +
      `- Top accessed: ${patterns.slice(0, 5).map((p) => `${p.key}(${p.count})`).join(", ")}\n` +
      `- Duplicates found: ${duplicates.length}\n` +
      `- Stale memories decayed: ${decayed}`;
  }

  private stringSimilarity(a: string, b: string): number {
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1.0;

    // Simple Jaccard similarity on words
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  close(): void {
    this.db.close();
  }
}
