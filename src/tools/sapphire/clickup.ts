import { Tool, ToolContext } from "../../types";
import axios from "axios";

export async function getClickUpSummaryForBrief(): Promise<string> {
  const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_PERSONAL_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;
  if (!token || !listId) return "";

  try {
    const url = `https://api.clickup.com/api/v2/list/${listId}/task`;
    const response = await axios.get(url, { headers: { "Authorization": token } });
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
    description: "Interact with ClickUp tasks. Use 'verify' to test connection.",
    parameters: {
      action: { type: "string" as const, description: "Action: list, create, update, verify", enum: ["list", "create", "update", "verify"] },
      list_id: { type: "string" as const, description: "The ClickUp List ID" },
      task_id: { type: "string" as const, description: "The ClickUp Task ID" },
      name: { type: "string" as const, description: "Task name" },
      description: { type: "string" as const, description: "Task description" },
      status: { type: "string" as const, description: "Task status" },
    },
    required: ["action"],
  };

  async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
    const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_PERSONAL_TOKEN;
    if (!token) {
      return "Error: ClickUp API token not configured. Set CLICKUP_API_TOKEN in Railway.";
    }

    const headers = {
      "Authorization": token,
      "Content-Type": "application/json"
    };

    try {
      let url = "";
      let method = "GET";
      let body = null;

      const listId = args.list_id || process.env.CLICKUP_LIST_ID;

      switch (args.action) {
        case "verify":
          url = "https://api.clickup.com/api/v2/user";
          break;
        case "list":
          if (!listId) return "Error: No list_id provided or configured.";
          url = `https://api.clickup.com/api/v2/list/${listId}/task`;
          break;
        case "create":
          if (!listId) return "Error: No list_id provided or configured.";
          url = `https://api.clickup.com/api/v2/list/${listId}/task`;
          method = "POST";
          body = { name: args.name, description: args.description };
          break;
        case "update":
          if (!args.task_id) return "Error: task_id required for update.";
          url = `https://api.clickup.com/api/v2/task/${args.task_id}`;
          method = "PUT";
          body = { name: args.name, description: args.description, status: args.status };
          break;
      }

      console.log(`[ClickUp] Request: ${method} ${url} | Token prefix: ${token.substring(0, 5)}`);
      
      const response = await axios({ method, url, data: body, headers, timeout: 10000 });
      
      if (args.action === "verify") {
        return `Connection Verified. Authenticated as: ${response.data.user?.username} (${response.data.user?.email})`;
      }

      return JSON.stringify(response.data);
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;
      
      console.error(`[ClickUp] API Error ${status}:`, data);
      
      if (status === 403) {
        return `Error 403 (Forbidden): Your token is valid but doesn't have permission to access List ${args.list_id || 'unspecified'}. Make sure the token creator has access to this list in ClickUp.`;
      }
      
      if (status === 401) {
        return "Error 401: Unauthorized. Your token is invalid.";
      }

      return `ClickUp Error ${status || error.message}: ${JSON.stringify(data || {})}`;
    }
  }
}
