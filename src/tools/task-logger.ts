// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Supabase Task Logger
// Logs all bot commands/actions to command_queue table
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

export interface TaskLogEntry {
  command: string;
  agent_name: string;
  chat_id?: string;
  status?: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
}

/**
 * Log a task/command to Supabase command_queue.
 * Non-blocking — failures are logged but never throw.
 */
export async function logTask(entry: TaskLogEntry): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[TaskLogger] Supabase not configured — skipping log");
    return null;
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/command_queue`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        command: entry.command,
        agent_name: entry.agent_name,
        chat_id: entry.chat_id || null,
        status: entry.status || "pending",
        result: entry.result || null,
        completed_at: entry.status === "completed" || entry.status === "failed"
          ? new Date().toISOString()
          : null,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[TaskLogger] Supabase ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const rows = (await resp.json()) as any[];
    const id = rows?.[0]?.id || null;
    console.log(`[TaskLogger] Logged: ${entry.agent_name}/${entry.command} → ${entry.status} (id: ${id})`);
    return id;
  } catch (err: any) {
    console.error(`[TaskLogger] Error: ${err.message}`);
    return null;
  }
}

/**
 * Update an existing task's status and result.
 */
export async function updateTask(
  taskId: string,
  status: "in_progress" | "completed" | "failed",
  result?: string
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !taskId) return;

  try {
    const body: Record<string, unknown> = { status };
    if (result) body.result = result.slice(0, 2000);
    if (status === "completed" || status === "failed") {
      body.completed_at = new Date().toISOString();
    }

    await fetch(`${SUPABASE_URL}/rest/v1/command_queue?id=eq.${taskId}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    console.error(`[TaskLogger] Update error: ${err.message}`);
  }
}
