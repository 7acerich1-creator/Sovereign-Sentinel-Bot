// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire — Temporal Knowledge Graph (S125+ Phase 6, 2026-04-30)
//
// Zep-style temporal graph in Postgres (Supabase). Two tables:
//   • sapphire_entities — nodes (person, project, place, etc.)
//   • sapphire_relationships — directed edges with valid_from/valid_until
//
// When a fact changes (Aliza switches schools, project status updates), the
// old edge gets valid_until=now() and a new edge is created. Default queries
// filter to currently-valid edges (valid_until IS NULL).
//
// Why Postgres-as-graph instead of Neo4j: Sapphire's scale is hundreds-to-
// thousands of edges, not millions. Recursive CTEs handle 1-3 hop traversal
// fine. Standard SQL. No new infrastructure. Already-paid Supabase cost.
// 90% of Zep's value at 10% of operational complexity.
//
// Controlled vocabulary: entity_type and relationship_type are CHECK-
// constrained at the DB level. Adding new types requires a schema migration —
// intentional friction to prevent fragmentation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// Controlled vocabulary — must match the CHECK constraints in the migration.
export const ENTITY_TYPES = [
  "person", "project", "task", "place", "organization", "event", "concept", "document",
] as const;

export const RELATIONSHIP_TYPES = [
  // Family/social
  "PARENT_OF", "CHILD_OF", "SIBLING_OF", "PARTNER_OF",
  // Education/medical/work
  "AT_SCHOOL", "HAS_DOCTOR", "HAS_THERAPIST", "WORKS_AT", "WORKS_ON",
  // Project state
  "HAS_STATUS", "BELONGS_TO", "DEPENDS_ON", "BLOCKS", "OWNS",
  // Events/temporal
  "ATTENDED", "SCHEDULED_FOR", "OCCURRED_AT",
  // Memory/conceptual
  "REFERENCES", "CONTRADICTS", "EXTENDS", "INSTANCE_OF",
  // Generic fallback
  "RELATED_TO",
] as const;

type EntityType = (typeof ENTITY_TYPES)[number];
type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENTITY_UPSERT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class EntityUpsertTool implements Tool {
  definition: ToolDefinition = {
    name: "entity_upsert",
    description:
      "Create or update a graph entity (node). Idempotent on (name, entity_type) — calling twice with the same name+type updates attributes, doesn't duplicate.",
    parameters: {
      name: { type: "string", description: "Entity name (e.g. 'Aliza', 'Sovereign Synthesis', 'Pacific Elementary')." },
      entity_type: { type: "string", description: "Type from controlled vocabulary.", enum: [...ENTITY_TYPES] },
      attributes: { type: "object", description: "Optional structured attributes (jsonb)." },
    },
    required: ["name", "entity_type"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || "").trim();
    const entityType = String(args.entity_type || "");
    const attributes = (args.attributes as Record<string, any>) || null;

    if (!name) return "entity_upsert: name required.";
    if (!ENTITY_TYPES.includes(entityType as EntityType)) {
      return `entity_upsert: entity_type '${entityType}' invalid. Allowed: ${ENTITY_TYPES.join(", ")}`;
    }

    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("sapphire_entities")
      .upsert(
        { name, entity_type: entityType, attributes, updated_at: new Date().toISOString() },
        { onConflict: "name,entity_type" },
      )
      .select("id")
      .single();

    if (error) return `entity_upsert: Supabase error — ${error.message}`;
    return `Entity '${name}' (${entityType}) upserted. ID: ${data.id}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENTITY_GET
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class EntityGetTool implements Tool {
  definition: ToolDefinition = {
    name: "entity_get",
    description: "Look up an entity by name+type or by id. Returns the entity row including attributes. Useful before calling relate to confirm both sides exist.",
    parameters: {
      name: { type: "string", description: "Entity name to look up. Required if id not provided." },
      entity_type: { type: "string", description: "Required when looking up by name.", enum: [...ENTITY_TYPES] },
      id: { type: "string", description: "Optional. UUID — overrides name+type lookup." },
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || "").trim();
    const entityType = String(args.entity_type || "");
    const id = String(args.id || "").trim();

    const supabase = await getSupabase();
    let query = supabase.from("sapphire_entities").select("id, name, entity_type, attributes, created_at, updated_at");
    if (id) {
      query = query.eq("id", id);
    } else if (name && entityType) {
      query = query.eq("name", name).eq("entity_type", entityType);
    } else {
      return "entity_get: provide either id OR (name + entity_type).";
    }
    const { data, error } = await query.maybeSingle();
    if (error) return `entity_get: Supabase error — ${error.message}`;
    if (!data) return `entity_get: no entity found.`;

    const attrStr = data.attributes ? JSON.stringify(data.attributes) : "{}";
    return `Entity ${data.id}: ${data.name} (${data.entity_type}). Attributes: ${attrStr}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RELATE — create new relationship; auto-supersedes any prior same-shape edge
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RelateTool implements Tool {
  definition: ToolDefinition = {
    name: "relate",
    description:
      "Create a directed relationship between two entities. AUTO-SUPERSEDES any prior currently-valid edge with the same (source, type, target) — sets valid_until=now on the old edge, creates the new edge with valid_from=now. This is the Zep-style temporal model: when a fact changes, the history is preserved.\n\n" +
      "Examples:\n" +
      "• 'Aliza switched to Pacific Elementary' → relate(source='Aliza', source_type='person', relationship='AT_SCHOOL', target='Pacific Elementary', target_type='place')\n" +
      "• 'Sovereign Synthesis is now in launch phase' → entity_upsert a status entity, then relate(source='Sovereign Synthesis', source_type='project', relationship='HAS_STATUS', target='launch_phase', target_type='concept')\n\n" +
      "Both source and target must already exist (call entity_upsert first if not).",
    parameters: {
      source_name: { type: "string", description: "Source entity name." },
      source_type: { type: "string", description: "Source entity type.", enum: [...ENTITY_TYPES] },
      relationship_type: { type: "string", description: "Relationship type from controlled vocabulary.", enum: [...RELATIONSHIP_TYPES] },
      target_name: { type: "string", description: "Target entity name." },
      target_type: { type: "string", description: "Target entity type.", enum: [...ENTITY_TYPES] },
      attributes: { type: "object", description: "Optional edge attributes (jsonb)." },
      valid_from: { type: "string", description: "Optional ISO8601 timestamp. Default: now()." },
      supersede_reason: { type: "string", description: "Optional. Reason for superseding the prior edge (audit trail)." },
    },
    required: ["source_name", "source_type", "relationship_type", "target_name", "target_type"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const sourceName = String(args.source_name || "").trim();
    const sourceType = String(args.source_type || "");
    const relType = String(args.relationship_type || "");
    const targetName = String(args.target_name || "").trim();
    const targetType = String(args.target_type || "");
    const attributes = (args.attributes as Record<string, any>) || null;
    const validFrom = args.valid_from ? String(args.valid_from) : new Date().toISOString();
    const supersedeReason = args.supersede_reason ? String(args.supersede_reason) : null;

    if (!sourceName || !targetName) return "relate: source_name and target_name required.";
    if (!ENTITY_TYPES.includes(sourceType as EntityType)) return `relate: source_type '${sourceType}' invalid.`;
    if (!ENTITY_TYPES.includes(targetType as EntityType)) return `relate: target_type '${targetType}' invalid.`;
    if (!RELATIONSHIP_TYPES.includes(relType as RelationshipType)) return `relate: relationship_type '${relType}' invalid. Allowed: ${RELATIONSHIP_TYPES.join(", ")}`;

    const supabase = await getSupabase();

    // 1. Resolve source + target entity IDs
    const { data: sourceRow } = await supabase
      .from("sapphire_entities")
      .select("id")
      .eq("name", sourceName)
      .eq("entity_type", sourceType)
      .maybeSingle();
    if (!sourceRow) return `relate: source entity '${sourceName}' (${sourceType}) not found. Call entity_upsert first.`;

    const { data: targetRow } = await supabase
      .from("sapphire_entities")
      .select("id")
      .eq("name", targetName)
      .eq("entity_type", targetType)
      .maybeSingle();
    if (!targetRow) return `relate: target entity '${targetName}' (${targetType}) not found. Call entity_upsert first.`;

    // 2. Insert new edge first (so we have its id for the supersede)
    const { data: newEdge, error: insErr } = await supabase
      .from("sapphire_relationships")
      .insert({
        source_entity_id: sourceRow.id,
        target_entity_id: targetRow.id,
        relationship_type: relType,
        attributes,
        valid_from: validFrom,
      })
      .select("id")
      .single();
    if (insErr) return `relate: insert error — ${insErr.message}`;

    // 3. Supersede any other currently-valid same-shape edges
    const { data: superseded, error: supErr } = await supabase
      .from("sapphire_relationships")
      .update({
        valid_until: new Date().toISOString(),
        superseded_by_id: newEdge.id,
        superseded_reason: supersedeReason,
      })
      .eq("source_entity_id", sourceRow.id)
      .eq("relationship_type", relType)
      .is("valid_until", null)
      .neq("id", newEdge.id)
      .select("id");

    if (supErr) {
      // Don't fail the operation — the new edge IS in. Just note.
      console.warn(`[relate] supersede side-effect failed: ${supErr.message}`);
    }

    const supersededCount = (superseded || []).length;
    const supersededNote = supersededCount > 0
      ? ` Superseded ${supersededCount} prior ${relType} edge(s).`
      : "";

    return `Relationship created: ${sourceName} -[${relType}]-> ${targetName}. ID: ${newEdge.id}.${supersededNote}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNRELATE — close out a relationship without replacing it
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class UnrelateTool implements Tool {
  definition: ToolDefinition = {
    name: "unrelate",
    description: "Mark a currently-valid relationship as ended (sets valid_until=now). Use when a relationship STOPS without being replaced — e.g. 'project completed', 'no longer at that gym'. For replacement use relate (which auto-supersedes).",
    parameters: {
      relationship_id: { type: "string", description: "UUID of the relationship to close." },
      reason: { type: "string", description: "Optional reason for the unrelate (audit trail)." },
    },
    required: ["relationship_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const id = String(args.relationship_id || "").trim();
    const reason = args.reason ? String(args.reason) : null;
    if (!id) return "unrelate: relationship_id required.";

    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("sapphire_relationships")
      .update({
        valid_until: new Date().toISOString(),
        superseded_reason: reason,
      })
      .eq("id", id)
      .is("valid_until", null)
      .select("id, relationship_type")
      .maybeSingle();
    if (error) return `unrelate: Supabase error — ${error.message}`;
    if (!data) return `unrelate: no currently-valid relationship found with id ${id} (may already be ended).`;
    return `Relationship ${data.id} (${data.relationship_type}) ended.`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAPH_QUERY — 1-hop and 2-hop traversal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class GraphQueryTool implements Tool {
  definition: ToolDefinition = {
    name: "graph_query",
    description:
      "Traverse the graph from a starting entity along a relationship type. Returns all entities reached. Default depth=1 (one hop). depth=2 follows two hops.\n\n" +
      "Examples:\n" +
      "• 'Who are Architect's children?' → graph_query(start='Ace Richie', start_type='person', traverse='PARENT_OF', depth=1)\n" +
      "• 'Where does Aliza go to school?' → graph_query(start='Aliza', start_type='person', traverse='AT_SCHOOL', depth=1)\n" +
      "• 'What projects does Architect work on?' → graph_query(start='Ace Richie', start_type='person', traverse='WORKS_ON', depth=1)\n\n" +
      "include_history defaults false (currently-valid edges only). Set true to include superseded relationships in the traversal.",
    parameters: {
      start_name: { type: "string", description: "Starting entity name." },
      start_type: { type: "string", description: "Starting entity type.", enum: [...ENTITY_TYPES] },
      traverse: { type: "string", description: "Relationship type to follow.", enum: [...RELATIONSHIP_TYPES] },
      depth: { type: "number", description: "Hops to traverse. 1 (direct) or 2 (friends-of-friends). Default 1." },
      include_history: { type: "boolean", description: "Include superseded edges in traversal. Default false." },
    },
    required: ["start_name", "start_type", "traverse"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const startName = String(args.start_name || "").trim();
    const startType = String(args.start_type || "");
    const traverse = String(args.traverse || "");
    const depth = Math.max(1, Math.min(2, Number(args.depth) || 1));
    const includeHistory = args.include_history === true;

    if (!ENTITY_TYPES.includes(startType as EntityType)) return `graph_query: start_type '${startType}' invalid.`;
    if (!RELATIONSHIP_TYPES.includes(traverse as RelationshipType)) return `graph_query: traverse '${traverse}' invalid.`;

    const supabase = await getSupabase();

    // Resolve start entity
    const { data: startRow } = await supabase
      .from("sapphire_entities")
      .select("id")
      .eq("name", startName)
      .eq("entity_type", startType)
      .maybeSingle();
    if (!startRow) return `graph_query: start entity '${startName}' (${startType}) not found.`;

    // Hop 1
    let q1 = supabase
      .from("sapphire_relationships")
      .select("id, target_entity_id, valid_from, valid_until, attributes")
      .eq("source_entity_id", startRow.id)
      .eq("relationship_type", traverse);
    if (!includeHistory) q1 = q1.is("valid_until", null);
    const { data: hop1Edges } = await q1.limit(50);

    if (!hop1Edges || hop1Edges.length === 0) {
      return `graph_query: no ${traverse} edges from '${startName}'${includeHistory ? "" : " (currently valid)"}.`;
    }

    const hop1TargetIds = hop1Edges.map((e: any) => e.target_entity_id);
    const { data: hop1Targets } = await supabase
      .from("sapphire_entities")
      .select("id, name, entity_type")
      .in("id", hop1TargetIds);
    const targetMap = new Map((hop1Targets || []).map((t: any) => [t.id, t]));

    const hop1Lines = hop1Edges.map((e: any) => {
      const target = targetMap.get(e.target_entity_id) as any;
      const status = e.valid_until ? `[ENDED ${String(e.valid_until).slice(0, 10)}]` : "[active]";
      return `  ${target?.name || "(unknown)"} (${target?.entity_type || "?"}) ${status}`;
    });

    let result = `Graph traversal from '${startName}' via [${traverse}] (depth=${depth}):\n${hop1Lines.join("\n")}`;

    // Hop 2 (if requested)
    if (depth >= 2 && hop1TargetIds.length > 0) {
      let q2 = supabase
        .from("sapphire_relationships")
        .select("id, source_entity_id, target_entity_id, valid_from, valid_until")
        .in("source_entity_id", hop1TargetIds)
        .eq("relationship_type", traverse);
      if (!includeHistory) q2 = q2.is("valid_until", null);
      const { data: hop2Edges } = await q2.limit(100);
      if (hop2Edges && hop2Edges.length > 0) {
        const hop2TargetIds = hop2Edges.map((e: any) => e.target_entity_id);
        const { data: hop2Targets } = await supabase
          .from("sapphire_entities")
          .select("id, name, entity_type")
          .in("id", hop2TargetIds);
        const tMap2 = new Map((hop2Targets || []).map((t: any) => [t.id, t]));
        const hop2Lines = hop2Edges.map((e: any) => {
          const src = targetMap.get(e.source_entity_id) as any;
          const tgt = tMap2.get(e.target_entity_id) as any;
          return `  ${src?.name || "?"} -> ${tgt?.name || "?"} (${tgt?.entity_type || "?"})`;
        });
        result += `\n\nHop 2 (${hop1TargetIds.length} sources, ${hop2Edges.length} edges):\n${hop2Lines.join("\n")}`;
      }
    }

    return result;
  }
}
