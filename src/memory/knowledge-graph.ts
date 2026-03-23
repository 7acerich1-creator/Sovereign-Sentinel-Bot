// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Knowledge Graph Memory
// Interconnected entities with relationships + graph traversal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import Database from "better-sqlite3";
import type { Tool, ToolDefinition } from "../types";
import { config } from "../config";

interface Entity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  createdAt: string;
}

interface Relationship {
  fromId: string;
  toId: string;
  type: string;
  weight: number;
}

export class KnowledgeGraph {
  private db!: Database.Database;

  async initialize(): Promise<void> {
    this.db = new Database(config.memory.sqlitePath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kg_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        properties TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        access_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS kg_relationships (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (from_id, to_id, type),
        FOREIGN KEY (from_id) REFERENCES kg_entities(id),
        FOREIGN KEY (to_id) REFERENCES kg_entities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_kg_entity_name ON kg_entities(name);
      CREATE INDEX IF NOT EXISTS idx_kg_entity_type ON kg_entities(type);
      CREATE INDEX IF NOT EXISTS idx_kg_rel_from ON kg_relationships(from_id);
      CREATE INDEX IF NOT EXISTS idx_kg_rel_to ON kg_relationships(to_id);
    `);

    console.log("✅ Knowledge Graph initialized");
  }

  addEntity(id: string, name: string, type: string, properties: Record<string, unknown> = {}): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO kg_entities (id, name, type, properties)
      VALUES (?, ?, ?, ?)
    `).run(id, name, type, JSON.stringify(properties));
  }

  addRelationship(fromId: string, toId: string, type: string, weight = 1.0): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO kg_relationships (from_id, to_id, type, weight)
      VALUES (?, ?, ?, ?)
    `).run(fromId, toId, type, weight);
  }

  getEntity(id: string): Entity | null {
    const row = this.db.prepare("SELECT * FROM kg_entities WHERE id = ?").get(id) as any;
    if (!row) return null;
    this.db.prepare("UPDATE kg_entities SET access_count = access_count + 1 WHERE id = ?").run(id);
    return { ...row, properties: JSON.parse(row.properties) };
  }

  findEntities(query: string, type?: string): Entity[] {
    let sql = "SELECT * FROM kg_entities WHERE name LIKE ?";
    const params: unknown[] = [`%${query}%`];
    if (type) { sql += " AND type = ?"; params.push(type); }
    sql += " ORDER BY access_count DESC LIMIT 20";

    return (this.db.prepare(sql).all(...params) as any[]).map((r) => ({
      ...r, properties: JSON.parse(r.properties),
    }));
  }

  getRelationships(entityId: string): Array<Relationship & { targetName: string; targetType: string }> {
    const rows = this.db.prepare(`
      SELECT r.*, e.name as target_name, e.type as target_type
      FROM kg_relationships r
      JOIN kg_entities e ON r.to_id = e.id
      WHERE r.from_id = ?
      ORDER BY r.weight DESC
    `).all(entityId) as any[];

    return rows.map((r) => ({
      fromId: r.from_id,
      toId: r.to_id,
      type: r.type,
      weight: r.weight,
      targetName: r.target_name,
      targetType: r.target_type,
    }));
  }

  traverse(startId: string, maxDepth = 2): string {
    const visited = new Set<string>();
    const lines: string[] = [];

    const walk = (id: string, depth: number, prefix: string): void => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);

      const entity = this.getEntity(id);
      if (!entity) return;
      lines.push(`${prefix}[${entity.type}] ${entity.name}`);

      const rels = this.getRelationships(id);
      for (const rel of rels) {
        lines.push(`${prefix}  --${rel.type}--> [${rel.targetType}] ${rel.targetName}`);
        walk(rel.toId, depth + 1, prefix + "    ");
      }
    };

    walk(startId, 0, "");
    return lines.join("\n") || "No graph data found.";
  }

  close(): void {
    this.db.close();
  }
}

// ── Knowledge Graph Tool ──
export class KnowledgeGraphTool implements Tool {
  private graph: KnowledgeGraph;

  constructor(graph: KnowledgeGraph) {
    this.graph = graph;
  }

  definition: ToolDefinition = {
    name: "knowledge_graph",
    description: "Query or update the knowledge graph. Add entities, relationships, search, or traverse the graph.",
    parameters: {
      action: { type: "string", description: "Action: add_entity, add_relationship, search, traverse", enum: ["add_entity", "add_relationship", "search", "traverse"] },
      id: { type: "string", description: "Entity ID" },
      name: { type: "string", description: "Entity name" },
      type: { type: "string", description: "Entity or relationship type" },
      targetId: { type: "string", description: "Target entity ID for relationships" },
      query: { type: "string", description: "Search query" },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action);

    switch (action) {
      case "add_entity": {
        const id = String(args.id || Date.now());
        this.graph.addEntity(id, String(args.name), String(args.type || "concept"));
        return `Entity added: ${args.name} (${id})`;
      }
      case "add_relationship": {
        this.graph.addRelationship(String(args.id), String(args.targetId), String(args.type || "related_to"));
        return `Relationship added: ${args.id} --${args.type}--> ${args.targetId}`;
      }
      case "search": {
        const results = this.graph.findEntities(String(args.query || ""), args.type as string | undefined);
        if (results.length === 0) return "No entities found.";
        return results.map((e) => `[${e.type}] ${e.name} (${e.id})`).join("\n");
      }
      case "traverse": {
        return this.graph.traverse(String(args.id));
      }
      default:
        return `Unknown action: ${action}`;
    }
  }
}
