import { Tool, ToolContext } from "../../types";
import axios from "axios";

// Using the Cloudflare Proxy to bypass ClickUp's bot block on Railway
const PROXY_BASE = "https://clickup-proxy.empoweredservices2013.workers.dev";

export async function getClickUpSummaryForBrief(): Promise<string> {
  const token = (process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_PERSONAL_TOKEN || "").trim();
  const listId = process.env.CLICKUP_LIST_ID;
  if (!token || !listId) return "";

  try {
    const url = `${PROXY_BASE}/api/v2/list/${listId}/task`;
    const response = await axios.get(url, { 
      headers: { 
        "Authorization": token,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      } 
    });
    const tasks = response.data.tasks || [];
    if (tasks.length === 0) return "No pending tasks.";
    return tasks.slice(0, 5).map((t: any) => `• ${t.name} (${t.status.status})`).join("\n");
  } catch (error) {
    console.error("[ClickUp] Brief summary fetch failed");
    return "";
  }
}

export class ClickUpTool implements Tool {
  definition = {
    name: "clickup_manage_tasks",
    description:
      "Manage Ace's ClickUp tasks via Sovereign Proxy. " +
      "Full CRUD: 'list' (read tasks in a list), 'create' (add a new task), 'update' (edit an existing task's name/description/status — pass task_id), 'delete' (remove a task — pass task_id), 'verify' (test connection). " +
      "Use 'update' to keep Ace's task state current as he completes things; use 'delete' to clear out tasks that are no longer relevant. " +
      "Both are required for keeping his queue real-time, not just append-only.",
    parameters: {
      action: { type: "string" as const, description: "Action: list, create, update, delete, verify", enum: ["list", "create", "update", "delete", "verify"] },
      list_id: { type: "string" as const, description: "The ClickUp List ID (defaults to CLICKUP_LIST_ID env var)" },
      task_id: { type: "string" as const, description: "The ClickUp Task ID — required for update and delete" },
      name: { type: "string" as const, description: "Task name (for create or update)" },
      description: { type: "string" as const, description: "Task description (for create or update)" },
      status: { type: "string" as const, description: "Task status (for update — e.g. 'in progress', 'complete')" },
    },
    required: ["action"],
  };

  async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
    const rawToken = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_PERSONAL_TOKEN;
    if (!rawToken) {
      return "Error: ClickUp API token not configured. Set CLICKUP_API_TOKEN in Railway.";
    }
    
    const token = rawToken.trim();

    const headers = {
      "Authorization": token,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json"
    };

    try {
      let url = "";
      let method = "GET";
      let body = null;

      const listId = args.list_id || process.env.CLICKUP_LIST_ID;

      switch (args.action) {
        case "verify":
          url = `${PROXY_BASE}/api/v2/user`;
          break;
        case "list":
          if (!listId) return "Error: No list_id provided or configured.";
          url = `${PROXY_BASE}/api/v2/list/${listId}/task`;
          break;
        case "create":
          if (!listId) return "Error: No list_id provided or configured.";
          url = `${PROXY_BASE}/api/v2/list/${listId}/task`;
          method = "POST";
          body = { name: args.name, description: args.description };
          break;
        case "update": {
          if (!args.task_id) return "Error: task_id required for update.";
          url = `${PROXY_BASE}/api/v2/task/${args.task_id}`;
          method = "PUT";
          // Only include fields the caller actually set — ClickUp accepts partial updates.
          // Sending `null` for unspecified fields can clobber existing values.
          const updateBody: Record<string, unknown> = {};
          if (args.name !== undefined && args.name !== null) updateBody.name = args.name;
          if (args.description !== undefined && args.description !== null) updateBody.description = args.description;
          if (args.status !== undefined && args.status !== null) updateBody.status = args.status;
          body = updateBody;
          break;
        }
        case "delete":
          if (!args.task_id) return "Error: task_id required for delete.";
          url = `${PROXY_BASE}/api/v2/task/${args.task_id}`;
          method = "DELETE";
          break;
      }

      console.log(`[ClickUp] Proxy Request: ${method} ${url} | Token prefix: ${token.substring(0, 5)}`);
      
      const response = await axios({ method, url, data: body, headers, timeout: 15000 });
      
      if (args.action === "verify") {
        return `Connection Verified via Proxy. Authenticated as: ${response.data.user?.username} (${response.data.user?.email})`;
      }

      if (args.action === "delete") {
        // ClickUp returns 204 No Content on success — there's no body. Synthesize a clean confirmation.
        return `✅ Task deleted: ${args.task_id}`;
      }

      if (args.action === "update") {
        return `✅ Task updated: ${args.task_id}\n${JSON.stringify(response.data)}`;
      }

      return JSON.stringify(response.data);
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;
      
      console.error(`[ClickUp Proxy] API Error ${status}:`, data);
      
      if (status === 403) {
        return "Error 403: Forbidden. Even through the proxy, ClickUp is rejecting this. Check if your token is actually correct and has access to the workspace.";
      }
      
      if (status === 401) {
        return "Error 401: Unauthorized. Your token is invalid.";
      }

      return `ClickUp Proxy Error ${status || error.message}: ${JSON.stringify(data || {})}`;
    }
  }
}
