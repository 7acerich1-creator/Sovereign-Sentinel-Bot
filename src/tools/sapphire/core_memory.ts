// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire — Core Memory + Archival Memory + Temporal Supersession
// S125+ Phase 5 (2026-04-30) — Letta-style + Zep-lite memory operations
//
// Core memory (Letta/MemGPT pattern):
//   • Sapphire-owned in-context state, always visible to her every turn.
//   • Stored in public.sapphire_core_memory as slotted entries.
//   • She updates via core_append/core_replace tool actions instead of
//     framework-auto-plumbed state.
//
// Archival memory (Letta pattern):
//   • Sapphire-owned long-term semantic memory.
//   • Wraps Pinecone with explicit namespace control.
//   • She decides when to insert, what namespace to put it in, what to
//     metadata to attach.
//
// Temporal supersession (Zep-lite):
//   • Pinecone metadata extended with valid_from / superseded_at / superseded_by_id.
//   • When a fact changes (Aliza switched schools), Sapphire calls supersede
//     to mark prior facts as outdated.
//   • Recall filters out superseded by default unless include_history=true.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

// ── Supabase helper ────────────────────────────────────────────────────────

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// ── Constants ──────────────────────────────────────────────────────────────

const CORE_MEMORY_HARD_CAP_PER_SLOT = 800;     // chars per slot
const CORE_MEMORY_HARD_CAP_TOTAL = 6000;       // chars across all slots ≈ 1500 tokens

// ── Slot reader (also used by sapphire-pa-context.ts to inject) ─────────────

export async function readAllCoreMemory(): Promise<Array<{ slot: string; content: string; updated_at: string }>> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("sapphire_core_memory")
      .select("slot, content, updated_at")
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    return data as any[];
  } catch {
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CORE_VIEW — Sapphire reads her own current core memory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CoreMemoryViewTool implements Tool {
  definition: ToolDefinition = {
    name: "core_memory_view",
    description: "Read all of Sapphire's current core memory slots. Use this when she wants to inspect her own state before deciding what to update.",
    parameters: {
      slot: { type: "string", description: "Optional. If provided, return only this slot." },
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const slot = args.slot ? String(args.slot).trim() : null;
    const all = await readAllCoreMemory();
    const filtered = slot ? all.filter((r) => r.slot === slot) : all;
    if (filtered.length === 0) {
      return slot ? `core_memory_view: no entry for slot '${slot}'.` : "core_memory_view: no slots populated yet.";
    }
    const lines = filtered.map((r) =>
      `[${r.slot}] (updated ${r.updated_at.slice(0, 16).replace("T", " ")})\n  ${r.content}`,
    );
    return `Core memory (${filtered.length} slot${filtered.length === 1 ? "" : "s"}):\n${lines.join("\n\n")}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CORE_APPEND — append to (or create) a slot. Hard-capped to prevent runaway growth.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CoreMemoryAppendTool implements Tool {
  definition: ToolDefinition = {
    name: "core_memory_append",
    description:
      "Append text to a core memory slot (creates the slot if missing). Use this when something new is true about Architect's world that should be in her always-visible context. Hard-capped at " + CORE_MEMORY_HARD_CAP_PER_SLOT + " chars per slot — if appending would overflow, OLDEST content in that slot is trimmed.",
    parameters: {
      slot: { type: "string", description: "Slot name (e.g. 'current_priorities', 'current_projects', 'recent_themes')." },
      text: { type: "string", description: "Text to append." },
    },
    required: ["slot", "text"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const slot = String(args.slot || "").trim();
    const text = String(args.text || "").trim();
    if (!slot) return "core_memory_append: slot required.";
    if (!text) return "core_memory_append: text required.";

    const supabase = await getSupabase();

    // Fetch existing slot
    const { data: existing } = await supabase
      .from("sapphire_core_memory")
      .select("content")
      .eq("slot", slot)
      .maybeSingle();

    let next = existing?.content ? `${existing.content}\n${text}` : text;

    // Trim from start if over cap
    if (next.length > CORE_MEMORY_HARD_CAP_PER_SLOT) {
      next = next.slice(next.length - CORE_MEMORY_HARD_CAP_PER_SLOT);
      // Re-align to a line boundary
      const firstNl = next.indexOf("\n");
      if (firstNl > 0 && firstNl < 200) next = next.slice(firstNl + 1);
    }

    const { error } = await supabase
      .from("sapphire_core_memory")
      .upsert({ slot, content: next, updated_at: new Date().toISOString(), updated_by: "sapphire" }, { onConflict: "slot" });

    if (error) return `core_memory_append: Supabase error — ${error.message}`;
    return `Appended to core memory slot '${slot}'. Slot now ${next.length} chars.`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CORE_REPLACE — full replace of a slot's content
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CoreMemoryReplaceTool implements Tool {
  definition: ToolDefinition = {
    name: "core_memory_replace",
    description:
      "Replace the entire content of a core memory slot (creates if missing). Use this when an old understanding is no longer accurate — Architect's priorities shifted, a project ended, etc. For incremental updates use core_memory_append.",
    parameters: {
      slot: { type: "string", description: "Slot name." },
      content: { type: "string", description: "New full content for the slot. Capped at " + CORE_MEMORY_HARD_CAP_PER_SLOT + " chars." },
    },
    required: ["slot", "content"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const slot = String(args.slot || "").trim();
    let content = String(args.content || "").trim();
    if (!slot) return "core_memory_replace: slot required.";
    if (!content) return "core_memory_replace: content required.";

    if (content.length > CORE_MEMORY_HARD_CAP_PER_SLOT) {
      content = content.slice(0, CORE_MEMORY_HARD_CAP_PER_SLOT);
    }

    const supabase = await getSupabase();
    const { error } = await supabase
      .from("sapphire_core_memory")
      .upsert({ slot, content, updated_at: new Date().toISOString(), updated_by: "sapphire" }, { onConflict: "slot" });

    if (error) return `core_memory_replace: Supabase error — ${error.message}`;
    return `Replaced core memory slot '${slot}' (${content.length} chars).`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ARCHIVAL_INSERT — Sapphire-controlled write to Pinecone with chosen namespace
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PINECONE_HOST = process.env.PINECONE_HOST;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;

const ALLOWED_ARCHIVAL_NAMESPACES = [
  "sapphire-personal",      // primary personal memory
  "shared",                 // cross-cutting insights
  "sovereign-synthesis",    // brand-related context Sapphire wants to preserve
] as const;

type ArchivalNamespace = (typeof ALLOWED_ARCHIVAL_NAMESPACES)[number];

async function embedText(text: string): Promise<number[] | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
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
        const data = (await res.json()) as any;
        const vec = data.embedding?.values;
        if (vec && vec.length > 0) return vec;
      }
    } catch { /* fallthrough */ }
  }

  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000), dimensions: 1024 }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const vec = data.data?.[0]?.embedding;
        if (vec && vec.length > 0) return vec;
      }
    } catch { /* fallthrough */ }
  }

  return null;
}

export class ArchivalInsertTool implements Tool {
  definition: ToolDefinition = {
    name: "archival_insert",
    description:
      "Write a long-term memory to Pinecone. Sapphire decides namespace + content + metadata. Use when something happened in the conversation worth remembering across sessions but not big enough for core memory.\n\n" +
      "Examples:\n" +
      "• Architect tells you a new fact about a project — archival_insert(namespace='sapphire-personal', content='Architect mentioned [project] is now [status]', topic='project_status')\n" +
      "• Architect surfaces a recurring failure mode — archival_insert(namespace='shared', content='Recurring failure: [pattern] — fix is [fix]', topic='failure_pattern')\n\n" +
      "valid_from is auto-set to now(). superseded_at is null until you (or another turn) supersede this entry.",
    parameters: {
      namespace: { type: "string", description: "Target namespace.", enum: [...ALLOWED_ARCHIVAL_NAMESPACES] },
      content: { type: "string", description: "The text to store + embed." },
      topic: { type: "string", description: "Topic tag for grouping (e.g. 'project_status', 'failure_pattern', 'family_event')." },
      metadata: { type: "object", description: "Optional extra metadata (key/value pairs)." },
    },
    required: ["namespace", "content", "topic"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!PINECONE_HOST || !PINECONE_API_KEY) return "archival_insert: PINECONE_HOST/API_KEY not configured.";

    const namespace = String(args.namespace || "");
    const content = String(args.content || "").trim();
    const topic = String(args.topic || "").trim();
    const extraMeta = (args.metadata as Record<string, any>) || {};

    if (!ALLOWED_ARCHIVAL_NAMESPACES.includes(namespace as ArchivalNamespace)) {
      return `archival_insert: namespace '${namespace}' not allowed. Use: ${ALLOWED_ARCHIVAL_NAMESPACES.join(", ")}`;
    }
    if (!content || content.length < 8) return "archival_insert: content required (≥8 chars).";
    if (!topic) return "archival_insert: topic required.";

    const vec = await embedText(content);
    if (!vec) return "archival_insert: embedding failed (no API key worked).";

    const id = `archival:${topic}:${Date.now()}`;
    const now = new Date().toISOString();

    try {
      const res = await fetch(`${PINECONE_HOST}/vectors/upsert`, {
        method: "POST",
        headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace,
          vectors: [{
            id,
            values: vec,
            metadata: {
              ...extraMeta,
              type: "archival",
              topic,
              value: content.slice(0, 1500),
              valid_from: now,
              superseded_at: null,
              superseded_by_id: null,
              timestamp: now,
              source: "sapphire",
            },
          }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return `archival_insert: Pinecone ${res.status} — ${body.slice(0, 200)}`;
      }
      return `Archival memory inserted into ${namespace} as topic '${topic}' (id ${id}).`;
    } catch (e: any) {
      return `archival_insert: ${e.message}`;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ARCHIVAL_SEARCH — explicit search across namespaces with temporal filtering
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ArchivalSearchTool implements Tool {
  definition: ToolDefinition = {
    name: "archival_search",
    description:
      "Search archival Pinecone memory. Differs from automatic recall (which fires on every turn) — this is Sapphire's explicit lookup when she needs to verify something specific. Excludes superseded memories by default.",
    parameters: {
      query: { type: "string", description: "Semantic search query." },
      namespace: { type: "string", description: "Optional namespace filter. If omitted, searches all archival namespaces.", enum: [...ALLOWED_ARCHIVAL_NAMESPACES] },
      k: { type: "number", description: "Top-k results to return. Default 5." },
      include_history: { type: "boolean", description: "If true, include superseded memories. Default false (current-truth only)." },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!PINECONE_HOST || !PINECONE_API_KEY) return "archival_search: PINECONE_HOST/API_KEY not configured.";

    const query = String(args.query || "").trim();
    if (!query) return "archival_search: query required.";

    const k = Math.max(1, Math.min(20, Number(args.k) || 5));
    const includeHistory = args.include_history === true;
    const targetNamespace = args.namespace ? String(args.namespace) : null;

    const vec = await embedText(query);
    if (!vec) return "archival_search: embedding failed.";

    const namespacesToQuery = targetNamespace
      ? [targetNamespace]
      : (ALLOWED_ARCHIVAL_NAMESPACES as readonly string[]);

    const allMatches: any[] = [];
    for (const ns of namespacesToQuery) {
      try {
        const res = await fetch(`${PINECONE_HOST}/query`, {
          method: "POST",
          headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ namespace: ns, vector: vec, topK: k, includeMetadata: true }),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as any;
        for (const m of (data.matches || [])) {
          allMatches.push({ ...m, _ns: ns });
        }
      } catch { /* skip namespace */ }
    }

    // Filter out superseded unless include_history
    let filtered = allMatches;
    if (!includeHistory) {
      filtered = filtered.filter((m) => !m.metadata?.superseded_at);
    }

    filtered.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    const top = filtered.slice(0, k);

    if (top.length === 0) return `No archival memory matches '${query}' (include_history=${includeHistory}).`;

    const lines = top.map((m, i) => {
      const value = String(m.metadata?.value || m.metadata?.content || "").slice(0, 200);
      const topic = m.metadata?.topic || m.metadata?.type || "(no topic)";
      const supersededFlag = m.metadata?.superseded_at ? " [SUPERSEDED]" : "";
      return `[${i + 1}] (${m._ns} / ${topic}, sim ${Number(m.score).toFixed(2)})${supersededFlag}\n  ${value}`;
    });
    return `Archival search results for '${query}':\n${lines.join("\n\n")}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SUPERSEDE — mark a prior memory as no-longer-current (Zep-lite temporal model)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class SupersedeMemoryTool implements Tool {
  definition: ToolDefinition = {
    name: "memory_supersede",
    description:
      "Mark a prior archival memory as superseded by a new one. Use when something has changed (Architect switched a fact, a project status updated, a person changed roles). The superseded memory stays in Pinecone but recall excludes it by default.\n\n" +
      "WORKFLOW:\n" +
      "1. archival_search(query=...) to find the prior memory's id\n" +
      "2. archival_insert(namespace=..., content=..., topic=...) to write the new memory — note the new id from the response\n" +
      "3. memory_supersede(old_id=..., new_id=..., namespace=..., reason=...)\n\n" +
      "This is the Zep-lite temporal pattern. A full graph DB (Neo4j) is deferred to Phase 6.",
    parameters: {
      old_id: { type: "string", description: "Pinecone vector id to mark superseded." },
      new_id: { type: "string", description: "Pinecone vector id of the new replacement." },
      namespace: { type: "string", description: "Namespace where old_id lives.", enum: [...ALLOWED_ARCHIVAL_NAMESPACES] },
      reason: { type: "string", description: "Why it's being superseded (for audit trail)." },
    },
    required: ["old_id", "new_id", "namespace"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!PINECONE_HOST || !PINECONE_API_KEY) return "memory_supersede: PINECONE_HOST/API_KEY not configured.";

    const oldId = String(args.old_id || "").trim();
    const newId = String(args.new_id || "").trim();
    const namespace = String(args.namespace || "");
    const reason = args.reason ? String(args.reason) : "(no reason given)";

    if (!oldId || !newId) return "memory_supersede: old_id and new_id required.";
    if (!ALLOWED_ARCHIVAL_NAMESPACES.includes(namespace as ArchivalNamespace)) {
      return `memory_supersede: namespace '${namespace}' not allowed.`;
    }

    // Pinecone update endpoint: PATCH metadata
    try {
      const res = await fetch(`${PINECONE_HOST}/vectors/update`, {
        method: "POST",
        headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace,
          id: oldId,
          setMetadata: {
            superseded_at: new Date().toISOString(),
            superseded_by_id: newId,
            superseded_reason: reason.slice(0, 500),
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return `memory_supersede: Pinecone ${res.status} — ${body.slice(0, 200)}`;
      }
      return `Marked ${oldId} as superseded by ${newId} in ${namespace}. Reason logged.`;
    } catch (e: any) {
      return `memory_supersede: ${e.message}`;
    }
  }
}
