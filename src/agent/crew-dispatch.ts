// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Crew Dispatch Engine
// Supabase-backed inter-agent task routing
// Replaces in-memory AgentComms with persistent, cross-process dispatch
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolContext, ToolDefinition } from "../types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

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

export const PIPELINE_ROUTES: Record<string, Array<{ to: string; task_type: string; payloadKey: string }>> = {
  alfred: [
    { to: "yuki", task_type: "viral_clip_extraction", payloadKey: "timestamped_hooks" },
    { to: "anita", task_type: "narrative_weaponization", payloadKey: "cleaned_transcript" },
    { to: "sapphire", task_type: "architectural_sync", payloadKey: "core_summary" },
  ],
  yuki: [
    { to: "anita", task_type: "caption_weaponization", payloadKey: "viral_package" },
  ],
  anita: [
    { to: "yuki", task_type: "content_for_distribution", payloadKey: "platform_posts" },
  ],
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
 * Complete a dispatch task with result.
 */
export async function completeDispatch(
  taskId: string,
  status: "completed" | "failed",
  result?: string
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !taskId) return;

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

  const dispatchIds: string[] = [];

  for (const route of routes) {
    // Try the specific payload key first, then fall back to the full response
    let payloadData = outputs[route.payloadKey];
    let usedFallback = false;

    if (!payloadData && outputs.response) {
      // Fallback: the agent produced freeform text instead of structured keys.
      // Pass the full response so the downstream agent can work with it.
      payloadData = outputs.response;
      usedFallback = true;
      console.log(`[CrewDispatch] ${fromAgent} → ${route.to}: "${route.payloadKey}" not found, forwarding full response`);
    }

    if (!payloadData) {
      console.log(`[CrewDispatch] Skipping ${fromAgent} → ${route.to}: no "${route.payloadKey}" and no response in outputs`);
      continue;
    }

    const id = await dispatchTask({
      from_agent: fromAgent,
      to_agent: route.to,
      task_type: route.task_type,
      payload: {
        [route.payloadKey]: payloadData,
        directive: usedFallback
          ? `Process this ${route.task_type} task using the content provided. The upstream agent (${fromAgent}) provided a freeform response — extract what you need.`
          : undefined,
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