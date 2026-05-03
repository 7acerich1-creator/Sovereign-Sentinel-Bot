// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire — Goals + Progress Journal
// Hierarchical goals (parent/child) with timestamped progress entries.
// Lets Sapphire say "you've moved on Plan X 3 times this month" instead
// of acknowledging each request fresh.
//
// Tables: public.sapphire_goals + public.sapphire_goal_progress
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolContext, ToolDefinition } from "../../types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

interface GoalRow {
  id: string;
  parent_id: string | null;
  title: string;
  target: string | null;
  status: "active" | "paused" | "achieved" | "dropped";
  created_at: string;
  updated_at: string;
  achieved_at: string | null;
}

interface ProgressRow {
  id: string;
  goal_id: string;
  note: string;
  created_at: string;
}

async function sb<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error(`[Goals] ${init.method || "GET"} ${path} ${resp.status}: ${txt.slice(0, 200)}`);
      return null;
    }
    if (resp.status === 204) return null;
    return (await resp.json()) as T;
  } catch (err: any) {
    console.error(`[Goals] error: ${err.message}`);
    return null;
  }
}

export class GoalsTool implements Tool {
  definition: ToolDefinition = {
    name: "goals",
    description:
      "Manage Architect's hierarchical goals + progress journal. Use 'set' to create a goal (optionally with parent_id for sub-goals). Use 'update' to change status (active/paused/achieved/dropped) or title/target. Use 'log_progress' to record a timestamped note against a goal. Use 'list' to enumerate goals filtered by status. Use 'status' to fetch one goal with its full progress history. The journal lets you say 'you've moved on this 3 times this month' instead of acknowledging each request fresh.",
    parameters: {
      action: {
        type: "string",
        description: "Action to perform",
        enum: ["set", "update", "log_progress", "list", "status"],
      },
      title: {
        type: "string",
        description: "Goal title (required for 'set')",
      },
      target: {
        type: "string",
        description: "Optional target / definition of done (e.g. '$1.2M liquid', '100K minds liberated')",
      },
      parent_id: {
        type: "string",
        description: "Optional parent goal UUID for hierarchical sub-goals",
      },
      goal_id: {
        type: "string",
        description: "Goal UUID (required for update / log_progress / status)",
      },
      status: {
        type: "string",
        description: "New status (for 'update'): active | paused | achieved | dropped",
        enum: ["active", "paused", "achieved", "dropped"],
      },
      note: {
        type: "string",
        description: "Progress note text (required for 'log_progress')",
      },
      filter_status: {
        type: "string",
        description: "Optional status filter for 'list' (default: active)",
      },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    if (!SUPABASE_URL || !SUPABASE_KEY) return "❌ Goals tool: Supabase not configured.";

    const action = String(args.action || "");
    switch (action) {
      case "set": {
        const title = String(args.title || "").trim();
        if (!title) return "Error: title is required for 'set'.";
        const target = args.target ? String(args.target) : null;
        const parent_id = args.parent_id ? String(args.parent_id) : null;
        const rows = await sb<GoalRow[]>("sapphire_goals", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ title, target, parent_id }),
        });
        if (!rows || rows.length === 0) return "❌ Failed to create goal.";
        const g = rows[0];
        return `✅ Goal created — ${g.id}\n  Title: ${g.title}${target ? `\n  Target: ${target}` : ""}${parent_id ? `\n  Parent: ${parent_id}` : ""}`;
      }

      case "update": {
        const goal_id = String(args.goal_id || "");
        if (!goal_id) return "Error: goal_id is required for 'update'.";
        const patch: Record<string, unknown> = {};
        if (args.title) patch.title = String(args.title);
        if (args.target !== undefined) patch.target = args.target ? String(args.target) : null;
        if (args.status) {
          const s = String(args.status);
          if (!["active", "paused", "achieved", "dropped"].includes(s)) return `Error: invalid status '${s}'.`;
          patch.status = s;
          if (s === "achieved") patch.achieved_at = new Date().toISOString();
        }
        if (Object.keys(patch).length === 0) return "Error: nothing to update — pass title / target / status.";
        const rows = await sb<GoalRow[]>(`sapphire_goals?id=eq.${goal_id}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(patch),
        });
        if (!rows || rows.length === 0) return `❌ No goal found with id ${goal_id}.`;
        const g = rows[0];
        return `✅ Goal ${goal_id} updated\n  Title: ${g.title}\n  Status: ${g.status}${g.target ? `\n  Target: ${g.target}` : ""}`;
      }

      case "log_progress": {
        const goal_id = String(args.goal_id || "");
        const note = String(args.note || "").trim();
        if (!goal_id) return "Error: goal_id is required for 'log_progress'.";
        if (!note) return "Error: note is required for 'log_progress'.";
        const rows = await sb<ProgressRow[]>("sapphire_goal_progress", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ goal_id, note }),
        });
        if (!rows || rows.length === 0) return "❌ Failed to log progress.";
        const p = rows[0];
        return `✅ Progress logged on goal ${goal_id}\n  Note: ${p.note}\n  At: ${p.created_at}`;
      }

      case "list": {
        const filterStatus = args.filter_status ? String(args.filter_status) : "active";
        const goals = await sb<GoalRow[]>(
          `sapphire_goals?status=eq.${filterStatus}&order=created_at.desc&limit=50`
        );
        if (!goals || goals.length === 0) return `(No goals with status='${filterStatus}'.)`;
        const lines = goals.map((g) => {
          const parent = g.parent_id ? ` ↳ parent=${g.parent_id.slice(0, 8)}` : "";
          const target = g.target ? ` — ${g.target}` : "";
          return `• [${g.id.slice(0, 8)}] ${g.title}${target}${parent}`;
        });
        return `📋 Goals (${filterStatus}, ${goals.length}):\n${lines.join("\n")}`;
      }

      case "status": {
        const goal_id = String(args.goal_id || "");
        if (!goal_id) return "Error: goal_id is required for 'status'.";
        const goals = await sb<GoalRow[]>(`sapphire_goals?id=eq.${goal_id}&limit=1`);
        if (!goals || goals.length === 0) return `❌ No goal found with id ${goal_id}.`;
        const g = goals[0];
        const progress = await sb<ProgressRow[]>(
          `sapphire_goal_progress?goal_id=eq.${goal_id}&order=created_at.desc&limit=20`
        );
        const progressLines = (progress || []).map(
          (p) => `  • ${p.created_at.slice(0, 10)} — ${p.note}`
        );
        const progressBlock = progressLines.length > 0
          ? `\n📓 Progress (${progressLines.length}):\n${progressLines.join("\n")}`
          : "\n📓 No progress logged yet.";
        return [
          `🎯 ${g.title}`,
          `  ID: ${g.id}`,
          `  Status: ${g.status}`,
          g.target ? `  Target: ${g.target}` : "",
          g.parent_id ? `  Parent: ${g.parent_id}` : "",
          `  Created: ${g.created_at}`,
          g.achieved_at ? `  Achieved: ${g.achieved_at}` : "",
        ].filter(Boolean).join("\n") + progressBlock;
      }

      default:
        return `Unknown action: ${action}. Use: set | update | log_progress | list | status.`;
    }
  }
}
