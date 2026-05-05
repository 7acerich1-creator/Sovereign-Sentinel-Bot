// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Business Learning Loop
// Session 114 — 2026-04-25
//
// Every successful crew_dispatch completion → Gemini Flash extracts ONE
// reusable insight → writes to that agent's Pinecone namespace.
// Cross-cutting insights (mention multiple agents, brand, customers) ALSO
// write to the `shared` namespace.
//
// This is what makes the business learn about itself. Without this, agents
// execute and forget. With this, every task contributes to institutional
// semantic memory that all agents can query.
//
// Cost: ~150 input tokens + ~80 output tokens per completed task at Gemini
// Flash rates ($0.075/M in, $0.30/M out) ≈ $0.00003/task. Even at 1000
// tasks/month = $0.03/month. Effectively free.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { PineconeMemory, KnowledgeNode } from "../memory/pinecone";
import { randomUUID } from "crypto";
// S130h (2026-05-04): single source of truth for agent namespaces.
// Was a duplicated local map; the duplicate disagreed with the one in
// src/index.ts (which was missing veritas entirely). Both now import from
// src/agent/agent-namespaces.ts.
import { AGENT_NAMESPACES } from "./agent-namespaces";

interface ExtractionResult {
  insight: string;
  type: "hook" | "insight" | "protocol" | "research" | "briefing" | "clip" | "content" | "funnel" | "brand";
  shared: boolean;  // true = also write to `shared` namespace
}

const EXTRACTION_PROMPT = (agent: string, taskType: string, result: string): string =>
  `An agent just finished a task. Extract ONE reusable insight from it.

Agent: ${agent}
Task type: ${taskType}
Result text:
"""
${result.slice(0, 3000)}
"""

Rules:
1. Extract a SINGLE crisp 1-2 sentence insight that future tasks could benefit from.
2. NOT a summary of what happened. A reusable PATTERN, RULE, or DISCOVERY.
3. If the task was routine and produced no novel learning, respond exactly: SKIP
4. If the insight involves brand decisions, customer behavior, or cross-agent patterns, mark "shared": true.

Respond as STRICT JSON only:
{"insight": "<the insight, or empty if SKIP>", "type": "<hook|insight|protocol|research|briefing|clip|content|funnel|brand>", "shared": <true|false>}

Or just SKIP if nothing worth keeping.`;

async function geminiExtract(
  agent: string,
  taskType: string,
  result: string,
): Promise<ExtractionResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: EXTRACTION_PROMPT(agent, taskType, result) }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 256, responseMimeType: "application/json" },
        }),
      },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    if (!text || text.toUpperCase() === "SKIP") return null;

    // Parse JSON response
    try {
      const parsed = JSON.parse(text);
      if (!parsed.insight || parsed.insight.length < 15) return null;
      return {
        insight: String(parsed.insight),
        type: (parsed.type || "insight") as ExtractionResult["type"],
        shared: parsed.shared === true,
      };
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

let pineconeRef: PineconeMemory | null = null;

export function setPineconeForExtraction(p: PineconeMemory): void {
  pineconeRef = p;
}

/**
 * Called after a crew_dispatch task completes successfully. Best-effort —
 * any failure is silent so it never blocks the actual dispatch result.
 */
export async function extractAndStoreInsight(
  agent: string,
  taskType: string,
  result: string,
): Promise<void> {
  if (!pineconeRef?.isReady()) return;
  if (!result || result.length < 50) return; // Nothing to learn from a 1-line result

  // Skip extraction for known-meta tasks that produce no new learning
  const SKIP_TASK_TYPES = ["stasis_self_check", "heartbeat", "noop"];
  if (SKIP_TASK_TYPES.includes(taskType)) return;

  const extraction = await geminiExtract(agent, taskType, result);
  if (!extraction) return;

  const namespace = AGENT_NAMESPACES[agent] || "general";
  const tags = [taskType, extraction.type];

  // Write to agent's namespace
  const node: KnowledgeNode = {
    id: randomUUID(),
    content: extraction.insight,
    agent_name: agent,
    type: extraction.type,
    namespace,
    tags,
    timestamp: new Date().toISOString(),
  };
  await pineconeRef.writeKnowledge(node);

  // If cross-cutting, also write to shared namespace
  if (extraction.shared) {
    const sharedNode: KnowledgeNode = {
      id: randomUUID(),
      content: extraction.insight,
      agent_name: agent,
      type: extraction.type,
      namespace: "shared",
      tags: [...tags, "cross_cutting"],
      timestamp: new Date().toISOString(),
    };
    await pineconeRef.writeKnowledge(sharedNode);
  }
}
