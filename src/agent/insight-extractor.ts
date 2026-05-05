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

// S130i (2026-05-04): EXTRACTION_PROMPT loosened.
// Old prompt told Gemini to SKIP if "the task was routine" — but daily
// trend scans, weekly briefings, and metric sweeps ARE routine BY DESIGN
// and still produce real intelligence. Result: 1 `shared` write in three
// weeks across all agents. The prompt now SKIPS only on truly content-less
// output (errors, confirmations, empty responses) and biases toward
// `shared:true` whenever the insight could apply to other agents' work.
const EXTRACTION_PROMPT = (agent: string, taskType: string, result: string): string =>
  `An agent just finished a task. Extract ONE reusable insight from its output.

Agent: ${agent}
Task type: ${taskType}
Result text:
"""
${result.slice(0, 3000)}
"""

Rules:
1. Extract a SINGLE 1-3 sentence insight that future agents could benefit from.
2. The insight should be a PATTERN, RULE, DECISION, FINDING, or DIRECTIVE — not a verbatim summary, but a distilled takeaway someone could apply later.
3. SKIP only if the result is one of: an error message ("All LLM providers failed", "max iterations"), a pure confirmation ("Briefing filed: <uuid>", "✅ Done"), an empty/missing response, or output so thin there's literally nothing to distill.
4. Mark "shared": true whenever the insight involves ANY of: brand decisions, customer behavior, cross-agent rules, metric thresholds, directives that name another agent (e.g. "Vector should…", "Yuki must…"), Architect-confirmed rules, or anything tagged "rule"/"decision"/"threshold"/"baseline". When in doubt, prefer shared:true — it's better to over-promote than have insights orphaned.

Respond as STRICT JSON only (no markdown, no preamble):
{"insight": "<the insight>", "type": "<hook|insight|protocol|research|briefing|clip|content|funnel|brand>", "shared": <true|false>}

Or respond exactly: SKIP (nothing else) if rule 3 applies.`;

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
 *
 * S130i (2026-05-04): Added structured logging at every gate so we can SEE
 * why insights aren't landing. Previously failures were invisible — the
 * shared namespace had 1 entry in three weeks and we couldn't tell if the
 * extractor wasn't firing, Gemini was SKIPping, or writes were failing.
 */
export async function extractAndStoreInsight(
  agent: string,
  taskType: string,
  result: string,
): Promise<void> {
  if (!pineconeRef?.isReady()) {
    console.log(`🧠 [InsightExtractor] ${agent}/${taskType}: SKIPPED (Pinecone not ready)`);
    return;
  }
  if (!result || result.length < 50) {
    console.log(`🧠 [InsightExtractor] ${agent}/${taskType}: SKIPPED (result too short: ${result?.length || 0} chars)`);
    return;
  }

  // Skip extraction for known-meta tasks that produce no new learning
  const SKIP_TASK_TYPES = ["stasis_self_check", "heartbeat", "noop"];
  if (SKIP_TASK_TYPES.includes(taskType)) {
    console.log(`🧠 [InsightExtractor] ${agent}/${taskType}: SKIPPED (meta task type)`);
    return;
  }

  console.log(`🧠 [InsightExtractor] ${agent}/${taskType}: extracting from ${result.length} char result...`);
  const extraction = await geminiExtract(agent, taskType, result);
  if (!extraction) {
    console.log(`🧠 [InsightExtractor] ${agent}/${taskType}: Gemini returned SKIP or unparsable`);
    return;
  }

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
  const ownOk = await pineconeRef.writeKnowledge(node);
  console.log(`🧠 [InsightExtractor] ${agent}/${taskType}: wrote to ${namespace} (ok=${ownOk}) — "${extraction.insight.slice(0, 80)}…"`);

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
    const sharedOk = await pineconeRef.writeKnowledge(sharedNode);
    console.log(`🧠 [InsightExtractor] ${agent}/${taskType}: ALSO wrote to shared (ok=${sharedOk}) — cross-cutting`);
  }
}
