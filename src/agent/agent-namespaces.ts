// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW — Agent Namespace Registry (S130h, 2026-05-04)
//
// SINGLE SOURCE OF TRUTH for the namespace each agent writes/reads under.
// Before this module landed, two separate AGENT_NAMESPACES maps existed:
//   1. src/index.ts:4753 — used to set agent identity at boot
//   2. src/agent/insight-extractor.ts:22-29 — used by extractor to write
// They disagreed (index.ts was missing veritas entirely → fell to "general"
// which nothing queried). Plus a hardcoded override at index.ts:673 forced
// Veritas onto Sapphire's namespace. Net result: 336 Veritas writes pooled
// in the wrong silo for weeks; Vector/Yuki/Anita/Alfred had zero or near-zero
// writes anywhere.
//
// DESIGN PRINCIPLE: namespace = agent_name. Decoupled from role labels so
// the agent's role can evolve (Anita: Propagandist → Marketing Lead, etc.)
// without invalidating the namespace contract or breaking recall paths.
// Roles change semantically; namespaces stay stable structurally.
//
// LEGACY_NAMESPACES preserves the OLD names so the transitional dual-read
// in loop.ts can pull existing data while new writes flow to the new lanes.
// Once the legacy lanes age out (insights produced before ~2026-05-04), this
// map can be retired.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Canonical namespace per agent. agent_name → Pinecone namespace.
 * The namespace is named after the agent itself for stability across
 * role evolutions. The Architect's Phase 7 reframe (2026-04-30) shifted
 * roles meaningfully — what doesn't shift is which agent is which.
 */
export const AGENT_NAMESPACES: Record<string, string> = {
  sapphire: "sapphire",
  veritas: "veritas",
  alfred: "alfred",
  yuki: "yuki",
  anita: "anita",
  vector: "vector",
};

/**
 * Legacy namespace each agent USED to write to. Used during the dual-read
 * transition: when an agent recalls memory, query BOTH the new namespace
 * AND the legacy one so old insights stay accessible until they age out.
 *
 * Notes on the legacy mapping:
 * - sapphire AND veritas both wrote to "brand" historically (sapphire
 *   intentionally; veritas because of the bug). Both should dual-read it.
 * - "general" was the fallback when no map entry existed; veritas's writes
 *   may have landed there briefly before the index.ts:673 override took hold.
 * - "shared" is intentionally NOT in any agent's legacy list because every
 *   agent already queries it directly per the existing recall logic.
 */
export const LEGACY_NAMESPACES: Record<string, string[]> = {
  sapphire: ["brand"],
  veritas: ["brand", "general"], // brand from the override bug; general from earlier fallback
  alfred: ["hooks"],
  yuki: ["clips"],
  anita: ["content"],
  vector: ["funnels"],
};

/**
 * Resolve the canonical namespace for an agent. Returns null if the agent
 * is unknown — callers should treat that as a configuration error and log
 * it visibly rather than silently falling through to a default.
 */
export function namespaceFor(agentName: string): string | null {
  const ns = AGENT_NAMESPACES[agentName.toLowerCase()];
  return ns || null;
}

/**
 * Resolve any legacy namespaces an agent should ALSO read from during the
 * transitional period. Used by the agent loop's recall path so existing
 * data isn't orphaned when the canonical map changes.
 */
export function legacyNamespacesFor(agentName: string): string[] {
  return LEGACY_NAMESPACES[agentName.toLowerCase()] || [];
}
