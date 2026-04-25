// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Knowledge Writer Tool
// Agents embed insights to Pinecone semantic memory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from "crypto";
import type { Tool, ToolContext, ToolDefinition } from "../types";
import { PineconeMemory, KnowledgeNode } from "../memory/pinecone";

/**
 * Allows any agent to write a knowledge node to Pinecone.
 * Each instance is bound to a specific agent and namespace.
 */
export class KnowledgeWriterTool implements Tool {
  private pinecone: PineconeMemory;
  private agentName: string;
  private defaultNamespace: string;

  definition: ToolDefinition;

  constructor(pinecone: PineconeMemory, agentName: string, defaultNamespace: string) {
    this.pinecone = pinecone;
    this.agentName = agentName;
    this.defaultNamespace = defaultNamespace;

    this.definition = {
      name: "write_knowledge",
      description: `Store a NOVEL insight, hook, pattern, or discovery in the crew's permanent semantic memory (Pinecone). ONLY use for things that are: (a) genuinely new — not a routine result, (b) reusable across future tasks — a pattern, rule, or discovery, NOT a one-off summary, (c) brand/business scope only — for personal Ace stuff use remember_fact. Routine completions are auto-extracted by the system; you only need to call this for STAND-OUT learnings the auto-extractor would miss. If unsure, skip — better to write nothing than write noise.`,
      parameters: {
        content: {
          type: "string",
          description: "The insight or knowledge to store (1-3 sentences, specific and actionable)",
        },
        type: {
          type: "string",
          description: "Knowledge type: hook | insight | protocol | research | briefing | clip | content | funnel | brand",
          enum: ["hook", "insight", "protocol", "research", "briefing", "clip", "content", "funnel", "brand"],
        },
        niche: {
          type: "string",
          description: "Content niche if applicable: dark_psychology | self_improvement | burnout | quantum | general",
          enum: ["dark_psychology", "self_improvement", "burnout", "quantum", "general"],
        },
        tags: {
          type: "string",
          description: "Comma-separated tags for filtering (e.g. 'high_contrast,instagram,hook')",
        },
      },
      required: ["content", "type"],
    };
  }

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const content = String(args.content || "");
    const type = String(args.type || "insight") as KnowledgeNode["type"];
    const niche = String(args.niche || "general");
    const tagsStr = String(args.tags || "");

    if (!content || content.length < 10) {
      return "Error: Content must be at least 10 characters.";
    }

    // ── S114q: HARD GUARD — Sapphire must NEVER use write_knowledge for personal stuff ──
    // Prompt rule wasn't enough; Gemini Flash kept picking the wrong tool.
    // Programmatic block: if Sapphire's write looks personal, refuse and redirect.
    if (this.agentName === "sapphire") {
      const lower = content.toLowerCase();
      const personalSignals = [
        " ace", "ace's", "your daughter", "your son", "your wife", "your partner",
        "your kids", "your family", "your home", "your house", "your appointment",
        "your birthday", "your anniversary", "your gym", "your doctor", "got it,",
        "remembered", "i've noted", "i've saved", "i'll remind", "remind you",
        "your meeting", "your call", "your event", "his daughter", "his son",
        "his wife", "his preference", "for you, ", "you said", "you told me",
      ];
      const hits = personalSignals.filter((s) => lower.includes(s));
      if (hits.length > 0) {
        return `❌ write_knowledge BLOCKED: this looks like personal info about Ace (matched: ${hits.slice(0, 3).join(", ")}). The brand namespace is for business intelligence ONLY. Use **remember_fact** for personal stuff — it writes to the sapphire-personal namespace. If you genuinely need a brand insight, rephrase to remove personal references.`;
      }
    }

    if (!this.pinecone.isReady()) {
      return "Pinecone not available — knowledge not stored.";
    }

    const node: KnowledgeNode = {
      id: randomUUID(),
      content,
      agent_name: this.agentName,
      niche,
      type,
      namespace: this.defaultNamespace,
      tags: tagsStr ? tagsStr.split(",").map((t) => t.trim()) : [niche],
      timestamp: new Date().toISOString(),
    };

    const ok = await this.pinecone.writeKnowledge(node);
    if (ok) {
      return `Knowledge stored in ${this.defaultNamespace}: [${type}] "${content.slice(0, 80)}..." — now permanently accessible to all agents.`;
    }
    return "Failed to write knowledge to Pinecone. Check logs.";
  }
}
