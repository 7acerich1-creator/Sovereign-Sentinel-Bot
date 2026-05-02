// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW — Generic Crew Agent Context Prefix
// S127 (2026-05-01)
//
// Why this exists:
//   Phase 8 of the agentic refactor (2026-04-30) generalized the memory
//   STORAGE across all crew agents — agent_core_memory table, per-agent
//   Pinecone namespaces, sleeptime consolidator iterating all agents,
//   per-agent reflection cadences. Storage shipped, writes are firing.
//
//   But the per-turn READ injection only got built for Sapphire (in
//   sapphire-pa-context.ts). When Architect @-mentions Anita with "what's
//   the campaign status?", her own current_campaigns slot — fresh,
//   sleeptime-updated — sits in the database she can't see, because nothing
//   prepends it to her turn. Same for Yuki's platform_health, Vector's
//   current_metrics_state, Veritas's current_crew_signals, Alfred's
//   current_pipeline_state.
//
//   This module closes that gap. One function, called once per non-dispatch
//   crew message, prepends:
//     1. Lightweight state header (date, who's asking, agent identity)
//     2. The agent's OWN core memory slots (read fresh on each turn)
//     3. Pinecone semantic recall against {agentName}-personal namespace
//
// Sapphire still uses buildPersonalContextPrefix (sapphire-pa-context.ts) —
// her version is richer (assembled prompt, plans, executive mandate, multi-
// namespace recall). This is the leaner crew sibling.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readAllCoreMemory } from "../tools/sapphire/core_memory";
import type { PineconeMemory } from "../memory/pinecone";

const ACE_TZ = "America/Chicago";

// Per-agent "personal" namespace. Convention from Phase 8 ship — see
// project_self_healing_architecture.md and crew strategy session 2026-04-30.
function personalNamespace(agentName: string): string {
  return `${agentName}-personal`;
}

export interface BuildAgentContextOptions {
  agentName: string;
  userMessage?: string;
  /** Optional: pass the live PineconeMemory instance for semantic recall.
   *  If omitted, recall is skipped (core memory + header still inject). */
  pinecone?: PineconeMemory | null;
  /** Optional caller name for the header (defaults to "Architect"). */
  fromName?: string;
}

/**
 * Build a context prefix for a non-Sapphire crew agent.
 * Returns a string to prepend to message.content before processMessage.
 *
 * Safe defaults: every step is wrapped in try/catch and falls back to a
 * minimal header on failure. Never throws.
 */
export async function buildAgentContextPrefix(
  opts: BuildAgentContextOptions,
): Promise<string> {
  const { agentName, userMessage = "", pinecone, fromName = "Architect" } = opts;
  const parts: string[] = [];

  // ── 1. State header ──────────────────────────────────────────────────────
  try {
    const now = new Date();
    const dateStr = now.toLocaleString("en-US", {
      timeZone: ACE_TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    parts.push(
      `[CONTEXT: ${fromName} just sent you a message. You are ${agentName}. ` +
        `${dateStr}. This prefix is auto-injected — read it, then respond to the user message at the end.]`,
    );
  } catch {
    parts.push(`[CONTEXT: message from ${fromName}. You are ${agentName}.]`);
  }

  // ── 2. Core memory slots (the agent's own current understanding) ────────
  // Sleeptime consolidator writes these every cycle. Reflection updates them.
  // This is the agent reading their own state-of-the-world before responding.
  try {
    const slots = await readAllCoreMemory(agentName);
    if (slots.length > 0) {
      const lines = slots.map(
        (s) => `[${s.slot}] (updated ${s.updated_at.slice(0, 10)})\n  ${s.content}`,
      );
      parts.push(
        `# YOUR CORE MEMORY (your current understanding of your domain — fresh from sleeptime consolidator. ` +
          `Update via core_memory_append / core_memory_replace if it's wrong or stale.)\n${lines.join("\n\n")}`,
      );
    }
  } catch (e: any) {
    console.warn(`[AgentContext/${agentName}] core memory fetch failed: ${e.message}`);
  }

  // ── 3. Pinecone semantic recall against agent's own personal namespace ──
  // Mirrors Sapphire's PA prefix recall. Tight defaults: k=3, minScore=0.78.
  // Only fires if Pinecone is wired in AND the user message is substantive.
  if (pinecone && pinecone.isReady() && userMessage && userMessage.length > 10) {
    try {
      const ns = personalNamespace(agentName);
      const recalls = await pinecone.queryRelevant(userMessage, 3, ns, 0.78);
      if (recalls.length > 0) {
        const lines = recalls.map(
          (r, i) =>
            `  [${i + 1}] (sim ${r.score.toFixed(2)}, type=${r.type}) ${r.content.slice(0, 280)}`,
        );
        parts.push(
          `# RELEVANT TO THIS MESSAGE (recalled from your personal Pinecone namespace ${ns}):\n${lines.join("\n")}`,
        );
      }
    } catch (e: any) {
      console.warn(`[AgentContext/${agentName}] Pinecone recall failed: ${e.message}`);
    }
  }

  return parts.join("\n\n");
}
