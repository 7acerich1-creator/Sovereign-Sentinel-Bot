// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Crew Dispatch Engine
// Supabase-backed inter-agent task routing
// Replaces in-memory AgentComms with persistent, cross-process dispatch
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolContext, ToolDefinition } from "../types";

const SUPABASE_URL = process.env.SUPABASE_URL;
// SESSION 31: Use service role key for crew_dispatch writes — bypasses RLS.
// Root cause: anon key was blocked by RLS policies on crew_dispatch, briefings, tasks tables.
// Every failed write triggered an agent retry loop, which burned more LLM tokens reporting the failure.
// Falls back to anon key if service role isn't set (old behavior).
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// ── Types ──

export interface DispatchTask {
  from_agent: string;
  to_agent: string;
  task_type: string;
  payload: Record<string, unknown>;
  priority?: number;
  parent_id?: string;
  chat_id?: string;
}

export interface DispatchRecord extends DispatchTask {
  id: string;
  status: "pending" | "claimed" | "in_progress" | "completed" | "failed";
  result?: string;
  created_at: string;
  claimed_at?: string;
  completed_at?: string;
}

// ── Predefined Pipeline Routes ──
// Alfred → Yuki (timestamped hooks) + Anita (cleaned transcript) + Sapphire (summary)
// Yuki → Anita ONLY (viral package for caption weaponization)
// Anita → Yuki (platform-ready posts for distribution) + Vector (metrics/analytics only)
// Yuki is the SOLE distribution endpoint — she posts to Buffer and publishes video.
// Vector NEVER posts. He analyzes performance and recommends strategy changes.

// SESSION 36: Pipeline routes DISABLED. These auto-handoffs never fire because
// agents produce freeform briefs, not structured payloads with the required keys.
// ContentEngine + VidRush handle all production deterministically.
// Alfred's value is PIPELINE_URL → VidRush trigger (handled in index.ts auto-pipeline block).
// Vector's value is analytics → crew_dispatch optimization tasks (handled in his directive).
// Keeping the structure for Option C (future: structured agent-to-agent handoffs).
export const PIPELINE_ROUTES: Record<string, Array<{ to: string; task_type: string; payloadKey: string }>> = {
  // alfred: [
  //   { to: "yuki", task_type: "viral_clip_extraction", payloadKey: "timestamped_hooks" },
  //   { to: "anita", task_type: "narrative_weaponization", payloadKey: "cleaned_transcript" },
  //   { to: "sapphire", task_type: "architectural_sync", payloadKey: "core_summary" },
  // ],
  // yuki: [
  //   { to: "anita", task_type: "caption_weaponization", payloadKey: "viral_package" },
  // ],
  // anita: [
  //   { to: "yuki", task_type: "content_for_distribution", payloadKey: "platform_posts" },
  // ],
};

// ── Core Dispatch Functions ──

/**
 * Dispatch a task to another agent via Supabase crew_dispatch table.
 * Returns the dispatch ID for tracking.
 */
export async function dispatchTask(task: DispatchTask): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[CrewDispatch] Supabase not configured");
    return null;
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/crew_dispatch`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        from_agent: task.from_agent,
        to_agent: task.to_agent,
        task_type: task.task_type,
        payload: task.payload,
        priority: task.priority || 5,
        parent_id: task.parent_id || null,
        chat_id: task.chat_id || null,
        status: "pending",
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[CrewDispatch] POST failed ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const rows = (await resp.json()) as any[];
    const id = rows?.[0]?.id;
    console.log(`📡 [CrewDispatch] ${task.from_agent} → ${task.to_agent} | type: ${task.task_type} | id: ${id}`);
    return id;
  } catch (err: any) {
    console.error(`[CrewDispatch] Error: ${err.message}`);
    return null;
  }
}

/**
 * Claim pending tasks for a specific agent.
 * Atomically marks them as "claimed" so no other poller grabs them.
 */
export async function claimTasks(agentName: string, limit = 5): Promise<DispatchRecord[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  try {
    // 1. Fetch pending tasks for this agent
    const fetchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/crew_dispatch?to_agent=eq.${agentName}&status=eq.pending&order=priority.asc,created_at.asc&limit=${limit}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    if (!fetchResp.ok) return [];
    const tasks = (await fetchResp.json()) as DispatchRecord[];
    if (tasks.length === 0) return [];

    // 2. Claim them (update status to "claimed")
    const ids = tasks.map((t) => t.id);
    await fetch(
      `${SUPABASE_URL}/rest/v1/crew_dispatch?id=in.(${ids.join(",")})`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          status: "claimed",
          claimed_at: new Date().toISOString(),
        }),
      }
    );

    console.log(`📥 [CrewDispatch] ${agentName} claimed ${tasks.length} task(s)`);
    return tasks;
  } catch (err: any) {
    console.error(`[CrewDispatch] Claim error: ${err.message}`);
    return [];
  }
}

/**
 * Batched claim: fetch ALL pending tasks across all agents in ONE query.
 * Returns a Map of agentName → DispatchRecord[].
 * This replaces 6 individual claimTasks() calls with 1 GET + 1 PATCH.
 */
export async function claimAllPending(agentNames: string[], limitPerAgent = 1): Promise<Map<string, DispatchRecord[]>> {
  const result = new Map<string, DispatchRecord[]>();
  if (!SUPABASE_URL || !SUPABASE_KEY || agentNames.length === 0) return result;

  try {
    // Single query: fetch pending for ALL agents at once
    const agentList = agentNames.join(",");
    const totalLimit = agentNames.length * limitPerAgent * 2; // Fetch extra to handle priority sorting per agent
    const fetchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/crew_dispatch?to_agent=in.(${agentList})&status=eq.pending&order=priority.asc,created_at.asc&limit=${totalLimit}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    if (!fetchResp.ok) {
      // Signal 503 to caller for backoff
      if (fetchResp.status === 503) {
        throw new Error(`503_BACKOFF`);
      }
      return result;
    }

    const allTasks = (await fetchResp.json()) as DispatchRecord[];
    if (allTasks.length === 0) return result;

    // Group by agent, respecting limitPerAgent
    const toClaim: DispatchRecord[] = [];
    const agentCounts = new Map<string, number>();

    for (const task of allTasks) {
      const count = agentCounts.get(task.to_agent) || 0;
      if (count < limitPerAgent) {
        toClaim.push(task);
        agentCounts.set(task.to_agent, count + 1);
        const arr = result.get(task.to_agent) || [];
        arr.push(task);
        result.set(task.to_agent, arr);
      }
    }

    if (toClaim.length === 0) return result;

    // Single PATCH to claim all at once
    const ids = toClaim.map((t) => t.id);
    await fetch(
      `${SUPABASE_URL}/rest/v1/crew_dispatch?id=in.(${ids.join(",")})`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          status: "claimed",
          claimed_at: new Date().toISOString(),
        }),
      }
    );

    console.log(`📥 [CrewDispatch] Batched claim: ${toClaim.length} task(s) for [${[...agentCounts.keys()].join(", ")}]`);
    return result;
  } catch (err: any) {
    if (err.message === "503_BACKOFF") throw err; // Re-throw for caller to handle
    console.error(`[CrewDispatch] Batch claim error: ${err.message}`);
    return result;
  }
}

/**
 * Complete a dispatch task with result.
 *
 * S114p: ALSO triggers business learning loop — successful completions get
 * a 1-line insight extracted via Gemini Flash and written to that agent's
 * Pinecone namespace. Best-effort, fire-and-forget. The business learns from
 * itself; without this, agents execute and forget. Skipped for failures.
 */
export async function completeDispatch(
  taskId: string,
  status: "completed" | "failed",
  result?: string
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !taskId) return;

  // Capture the full task before patching (we need agent + task_type + payload for extraction)
  let agent = "";
  let taskType = "";
  let dispatchPayload: any = null;
  if (status === "completed" && result && result.length >= 50) {
    try {
      // S119c: also fetch payload — needed to recover reply_id for email_reply_draft tasks
      const lookupResp = await fetch(`${SUPABASE_URL}/rest/v1/crew_dispatch?id=eq.${taskId}&select=to_agent,task_type,payload`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (lookupResp.ok) {
        const rows = (await lookupResp.json()) as any[];
        if (rows && rows[0]) {
          agent = String(rows[0].to_agent || "");
          taskType = String(rows[0].task_type || "");
          dispatchPayload = rows[0].payload || null;
        }
      }
    } catch { /* silent */ }
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/crew_dispatch?id=eq.${taskId}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status,
        result: result?.slice(0, 4000) || null,
        completed_at: new Date().toISOString(),
      }),
    });
  } catch (err: any) {
    console.error(`[CrewDispatch] Complete error: ${err.message}`);
  }

  // ── Fire learning loop (don't await — never block dispatch result) ──
  if (status === "completed" && agent && result && result.length >= 50) {
    import("./insight-extractor")
      .then(({ extractAndStoreInsight }) => extractAndStoreInsight(agent, taskType, result))
      .catch((e) => console.warn(`[InsightExtractor] ${e.message}`));
  }

  // ── S119c/d: Email reply draft → Telegram approval prompt ──
  // When Anita finishes drafting an inbound-email reply, fire the
  // ✉️ Anita's Draft Reply approval card to the Architect's Telegram.
  //
  // S119d FIX: Anita stores the draft in content_drafts table FIRST, then her
  // crew_dispatch.result is just a meta-summary ("task complete"). So the regex
  // approach (extractDraftFromAgentResult) didn't match. Pull the body straight
  // from content_drafts instead — most recent Anita email draft for this dispatch.
  // Never blocks the dispatch loop; failures are logged.
  if (status === "completed" && taskType === "email_reply_draft" && dispatchPayload) {
    const replyId = String(dispatchPayload.reply_id || "");
    if (replyId) {
      // Try freeform text first (cheap), fall back to content_drafts lookup
      let draftText = result ? extractDraftFromAgentResult(result) : null;

      if (!draftText) {
        try {
          const draftResp = await fetch(
            `${SUPABASE_URL}/rest/v1/content_drafts?agent_name=eq.anita&draft_type=eq.email&order=created_at.desc&limit=1&select=body,created_at`,
            { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
          );
          if (draftResp.ok) {
            const drafts = (await draftResp.json()) as any[];
            if (drafts?.[0]?.body) {
              draftText = String(drafts[0].body).trim();
              console.log(
                `[EmailReply] Pulled draft from content_drafts for replyId=${replyId} ` +
                  `(${draftText.length} chars, draft created_at=${drafts[0].created_at})`
              );
            }
          }
        } catch (err: any) {
          console.warn(`[EmailReply] content_drafts lookup failed: ${err.message}`);
        }
      }

      if (draftText) {
        import("../proactive/email-reply-handler")
          .then(({ notifyDraftReady }) => notifyDraftReady(replyId, draftText!))
          .catch((e) => console.warn(`[EmailReply] notifyDraftReady error: ${e.message}`));
      } else {
        console.warn(
          `[EmailReply] Could not recover draft for replyId=${replyId}. ` +
            `Result: ${result?.slice(0, 200) || "(empty)"}`
        );
      }
    }
  }
}

/**
 * S119c: Extract Anita's draft text from her freeform crew_dispatch result.
 * Anita reports back like: "Email reply draft created... Draft content: \"Hey,\n..."
 * Tries multiple patterns — falls back to null if no match.
 */
function extractDraftFromAgentResult(result: string): string | null {
  if (!result) return null;
  const patterns: RegExp[] = [
    /Draft content:\s*"([\s\S]+?)"(?:\s*$|\s*\.\s*$)/i,
    /Draft content:\s*"([\s\S]+)"/i,
    /Draft:\s*"([\s\S]+?)"(?:\s*$|\s*\.\s*$)/i,
    /Email reply:\s*"([\s\S]+?)"(?:\s*$|\s*\.\s*$)/i,
    /Reply text:\s*"([\s\S]+?)"(?:\s*$|\s*\.\s*$)/i,
  ];
  for (const re of patterns) {
    const m = result.match(re);
    if (m && m[1]) {
      return m[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\t/g, "\t")
        .trim();
    }
  }
  // Last-resort: if the result contains a multi-line draft after a colon, grab it
  const colonMatch = result.match(/(?:Draft|Reply)[:\s][\s\S]+?\n([\s\S]+)$/i);
  if (colonMatch && colonMatch[1] && colonMatch[1].length >= 10) {
    return colonMatch[1].trim();
  }
  return null;
}

/**
 * Trigger the predefined pipeline handoffs for an agent.
 * Called after an agent completes its work to auto-dispatch downstream.
 */
export async function triggerPipelineHandoffs(
  fromAgent: string,
  outputs: Record<string, unknown>,
  parentId?: string,
  chatId?: string
): Promise<string[]> {
  const routes = PIPELINE_ROUTES[fromAgent];
  if (!routes) return [];

  // ── CIRCUIT BREAKER: Don't cascade failures ──
  // If the upstream agent's response is an error/failure, STOP the chain.
  // This prevents the death spiral: failed task → briefing about failure → dispatch about briefing → repeat.
  const response = typeof outputs.response === "string" ? outputs.response : "";
  const isFailure = response.toLowerCase().includes("all llm providers failed") ||
    response.toLowerCase().includes("error:") ||
    response.toLowerCase().includes("tool execution error") ||
    response.startsWith("⚠️") ||
    response.includes("SYSTEM STATUS: DEGRADED") ||
    response.includes("completely broken");

  if (isFailure) {
    console.warn(`🛑 [CrewDispatch] CIRCUIT BREAKER: ${fromAgent} output is a failure/error — NOT dispatching downstream. Stopping cascade.`);
    return [];
  }

  const dispatchIds: string[] = [];

  for (const route of routes) {
    // ONLY dispatch if the agent produced the SPECIFIC structured payload key.
    // Session 33 FIX: Removed the "full response fallback" that was causing infinite ping-pong loops.
    // Old behavior: if payloadKey wasn't found, forwarded the entire freeform response.
    // This meant EVERY agent completion dispatched downstream, even error messages and briefings.
    // New behavior: no structured key = no dispatch. Agents must produce the expected output format.
    const payloadData = outputs[route.payloadKey];

    if (!payloadData) {
      console.log(`[CrewDispatch] Skipping ${fromAgent} → ${route.to}: no "${route.payloadKey}" in outputs (no fallback)`);
      continue;
    }

    const id = await dispatchTask({
      from_agent: fromAgent,
      to_agent: route.to,
      task_type: route.task_type,
      payload: {
        [route.payloadKey]: payloadData,
        source_agent: fromAgent,
        pipeline: true,
      },
      parent_id: parentId,
      chat_id: chatId,
      priority: 3, // Pipeline tasks are high priority
    });

    if (id) dispatchIds.push(id);
  }

  return dispatchIds;
}

/**
 * Get dispatch status for a parent task and all its children.
 */
export async function getPipelineStatus(parentId: string): Promise<DispatchRecord[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/crew_dispatch?or=(id.eq.${parentId},parent_id.eq.${parentId})&order=created_at.asc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    if (!resp.ok) return [];
    return (await resp.json()) as DispatchRecord[];
  } catch {
    return [];
  }
}

/**
 * Walk the full pipeline chain for a given dispatch.
 * Finds the root ancestor, then fetches ALL dispatches in the tree.
 * Returns { rootId, chain } where chain includes every dispatch in the pipeline.
 */
export async function getFullPipelineChain(dispatchId: string, parentId?: string): Promise<{ rootId: string; chain: DispatchRecord[] }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { rootId: dispatchId, chain: [] };

  // Walk up to the root: keep following parent_id until there is none
  let rootId = parentId || dispatchId;
  const seen = new Set<string>();
  while (true) {
    if (seen.has(rootId)) break; // safety against cycles
    seen.add(rootId);
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/crew_dispatch?id=eq.${rootId}&select=parent_id`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (!resp.ok) break;
      const rows = (await resp.json()) as Array<{ parent_id?: string }>;
      if (!rows[0]?.parent_id) break; // this IS the root
      rootId = rows[0].parent_id;
    } catch { break; }
  }

  // Now fetch every dispatch that shares this root (root itself + all descendants via recursive parent_id)
  // Supabase doesn't do recursive CTEs via REST, so we fetch in waves
  const chain: DispatchRecord[] = [];
  const queue = [rootId];
  const fetched = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (fetched.has(currentId)) continue;
    fetched.add(currentId);

    try {
      // Fetch this node + its direct children
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/crew_dispatch?or=(id.eq.${currentId},parent_id.eq.${currentId})&select=*&order=created_at.asc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (!resp.ok) continue;
      const rows = (await resp.json()) as DispatchRecord[];
      for (const row of rows) {
        if (!chain.find(c => c.id === row.id)) {
          chain.push(row);
          // Queue children for the next wave
          if (row.id !== currentId) queue.push(row.id);
        }
      }
    } catch { continue; }
  }

  return { rootId, chain };
}

/**
 * Check if a full pipeline chain is complete (all dispatches are completed or failed).
 * Returns the chain if complete, null if still in progress.
 */
export async function checkPipelineComplete(dispatchId: string, parentId?: string): Promise<DispatchRecord[] | null> {
  const { chain } = await getFullPipelineChain(dispatchId, parentId);
  if (chain.length === 0) return null;

  const allDone = chain.every(d => d.status === "completed" || d.status === "failed");
  return allDone ? chain : null;
}

// ── LLM-Callable Tool ──

export class CrewDispatchTool implements Tool {
  definition: ToolDefinition = {
    name: "crew_dispatch",
    description:
      "Dispatch tasks to other Maven Crew agents. Use this to send work to Sapphire (operations), Alfred (content intelligence), " +
      "Yuki (distribution & creative — SOLE posting authority), Anita (conversion & nurture), or Vector (revenue intelligence — analytics only, NOT posting). " +
      "Also check pipeline status and claim tasks assigned to you.",
    parameters: {
      action: {
        type: "string",
        description: "Action to perform",
        enum: ["dispatch", "status", "claim", "complete"],
      },
      to_agent: {
        type: "string",
        description: "Target agent name (sapphire, alfred, yuki, anita, vector, veritas)",
      },
      task_type: {
        type: "string",
        description: "Type of task (e.g., viral_clip_extraction, narrative_weaponization, content_scheduling)",
      },
      payload: {
        type: "string",
        description: "JSON string of task payload / instructions",
      },
      task_id: {
        type: "string",
        description: "Task ID for status check or completion",
      },
      result: {
        type: "string",
        description: "Result text when completing a task",
      },
      priority: {
        type: "number",
        description: "Priority 1-10 (1 = highest). Default 5.",
      },
    },
    required: ["action"],
  };

  private agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const action = String(args.action);

    switch (action) {
      case "dispatch": {
        const toAgent = String(args.to_agent || "");
        if (!toAgent) return "Error: to_agent is required for dispatch.";

        let payload: Record<string, unknown> = {};
        try {
          payload = args.payload ? JSON.parse(String(args.payload)) : {};
        } catch {
          payload = { instructions: String(args.payload || "") };
        }

        const id = await dispatchTask({
          from_agent: this.agentName,
          to_agent: toAgent,
          task_type: String(args.task_type || "general"),
          payload,
          priority: Number(args.priority) || 5,
          chat_id: context.chatId,
        });

        return id
          ? `✅ Task dispatched to ${toAgent} (id: ${id}, type: ${args.task_type || "general"})`
          : "❌ Dispatch failed — check Supabase connection.";
      }

      case "claim": {
        const tasks = await claimTasks(this.agentName);
        if (tasks.length === 0) return "No pending tasks in your queue.";

        return tasks
          .map((t) =>
            `📋 Task ${t.id}\n  From: ${t.from_agent}\n  Type: ${t.task_type}\n  Payload: ${JSON.stringify(t.payload).slice(0, 500)}`
          )
          .join("\n\n");
      }

      case "status": {
        const taskId = String(args.task_id || "");
        if (!taskId) return "Error: task_id required for status check.";

        const records = await getPipelineStatus(taskId);
        if (records.length === 0) return "No records found for that task ID.";

        return records
          .map((r) =>
            `${r.from_agent} → ${r.to_agent} | ${r.status} | ${r.task_type}${r.result ? ` | Result: ${r.result.slice(0, 200)}` : ""}`
          )
          .join("\n");
      }

      case "complete": {
        const taskId = String(args.task_id || "");
        if (!taskId) return "Error: task_id required for completion.";

        const status = String(args.result || "").toLowerCase().includes("fail") ? "failed" as const : "completed" as const;
        await completeDispatch(taskId, status, String(args.result || "Task completed"));
        return `✅ Task ${taskId} marked as ${status}.`;
      }

      default:
        return `Unknown action: ${action}. Use: dispatch, claim, status, or complete.`;
    }
  }
}