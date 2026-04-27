import { Tool, ToolDefinition } from "../../types";

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

export interface ClickUpTask {
  id: string;
  name: string;
  status: { status: string };
  priority?: { priority: string; color: string };
  due_date?: string;
  url: string;
}

export class ClickUpTool implements Tool {
  definition: ToolDefinition = {
    name: "clickup_manage_tasks",
    description: "Fetch, create, or update tasks in ClickUp. Use this to help Ace stay on top of his mission objectives.",
    parameters: {
      action: { 
        type: "string", 
        description: "Action to perform: 'list' (default), 'create', or 'update_status'.",
        enum: ["list", "create", "update_status"]
      },
      list_id: { type: "string", description: "The ClickUp List ID. Defaults to env config if not provided." },
      task_name: { type: "string", description: "For 'create': the name of the new task." },
      task_id: { type: "string", description: "For 'update_status': the ID of the task to update." },
      status: { type: "string", description: "For 'update_status': the new status (e.g., 'complete')." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, _context?: any): Promise<string> {
    const token = process.env.CLICKUP_API_TOKEN;
    const defaultListId = process.env.CLICKUP_LIST_ID;
    
    if (!token) return "❌ ClickUp error: CLICKUP_API_TOKEN not configured.";
    
    const action = String(args.action || "list");
    const listId = String(args.list_id || defaultListId || "").trim();

    try {
      switch (action) {
        case "list":
          return await this.listTasks(token, listId);
        case "create":
          return await this.createTask(token, listId, String(args.task_name));
        case "update_status":
          return await this.updateTaskStatus(token, String(args.task_id), String(args.status));
        default:
          return `Unknown action: ${action}`;
      }
    } catch (err: any) {
      return `❌ ClickUp API error: ${err.message}`;
    }
  }

  private async listTasks(token: string, listId: string): Promise<string> {
    if (!listId) return "ClickUp error: No List ID provided.";
    
    const resp = await fetch(`${CLICKUP_API_BASE}/list/${listId}/task?subtasks=true`, {
      headers: { "Authorization": token }
    });
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { tasks: ClickUpTask[] };
    const tasks = data.tasks || [];

    if (tasks.length === 0) return "No tasks found in this list.";

    return tasks.map(t => {
      const priority = t.priority ? ` [${t.priority.priority.toUpperCase()}]` : "";
      const due = t.due_date ? ` (Due: ${new Date(parseInt(t.due_date)).toLocaleDateString()})` : "";
      return `• ${t.name}${priority}${due} [ID: ${t.id}]`;
    }).join("\n");
  }

  private async createTask(token: string, listId: string, name: string): Promise<string> {
    if (!listId || !name) return "ClickUp error: list_id and task_name required.";
    
    const resp = await fetch(`${CLICKUP_API_BASE}/list/${listId}/task`, {
      method: "POST",
      headers: { 
        "Authorization": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name })
    });
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as any;
    return `✅ Task created: ${data.name} (ID: ${data.id})`;
  }

  private async updateTaskStatus(token: string, taskId: string, status: string): Promise<string> {
    if (!taskId || !status) return "ClickUp error: task_id and status required.";
    
    const resp = await fetch(`${CLICKUP_API_BASE}/task/${taskId}`, {
      method: "PUT",
      headers: { 
        "Authorization": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return `✅ Task ${taskId} status updated to: ${status}`;
  }
}

/**
 * Static helper for background jobs (like Morning Brief)
 */
export async function getClickUpSummaryForBrief(): Promise<string> {
  const token = process.env.CLICKUP_API_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;
  if (!token || !listId) return "";

  try {
    const tool = new ClickUpTool();
    const result = await tool.execute({ action: "list", list_id: listId });
    if (result.startsWith("•")) {
      return result;
    }
    return "";
  } catch {
    return "";
  }
}
