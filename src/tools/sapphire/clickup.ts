import { Tool } from "../../types";
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
    description: "Interact with ClickUp tasks (list, create, update). Requires task_id or list_id.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "update"] },
        list_id: { type: "string", description: "The ClickUp List ID" },
        task_id: { type: "string", description: "The ClickUp Task ID" },
        name: { type: "string", description: "Task name" },
        description: { type: "string", description: "Task description" },
        status: { type: "string", description: "Task status" },
      },
      required: ["action"],
    },
  };

  async execute(args: any): Promise<any> {
    const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_PERSONAL_TOKEN;
    if (!token) {
      console.error("[ClickUp] No API token found in environment (checked CLICKUP_API_TOKEN and CLICKUP_PERSONAL_TOKEN)");
      return "Error: ClickUp API token not configured.";
    }

    // Debug log with masking
    console.log(`[ClickUp] Executing ${args.action} | Token: ${token.substring(0, 6)}...${token.substring(token.length - 4)}`);

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
        case "list":
          if (!listId) return "Error: No list_id provided or configured in environment.";
          url = `https://api.clickup.com/api/v2/list/${listId}/task`;
          break;
        case "create":
          if (!listId) return "Error: No list_id provided or configured in environment.";
          url = `https://api.clickup.com/api/v2/list/${listId}/task`;
          method = "POST";
          body = { name: args.name, description: args.description };
          break;
        case "update":
          if (!args.task_id) return "Error: task_id is required for update action.";
          url = `https://api.clickup.com/api/v2/task/${args.task_id}`;
          method = "PUT";
          body = { name: args.name, description: args.description, status: args.status };
          break;
      }

      const response = await axios({ 
        method, 
        url, 
        data: body, 
        headers,
        timeout: 10000 
      });

      console.log(`[ClickUp] ${args.action} successful.`);
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;
      console.error(`[ClickUp] API Error: ${status} - ${JSON.stringify(data)}`);
      
      if (status === 401) {
        return "Error 401: Unauthorized. Your ClickUp API Token is invalid or expired. Check Railway variables.";
      }
      
      return `Error: ${status || error.message} - ${JSON.stringify(data || {})}`;
    }
  }
}
