import { Tool, ToolContext } from "../../types";
import axios from "axios";

export async function getClickUpSummaryForBrief(): Promise<string> {
  const token = (process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_PERSONAL_TOKEN || "").trim();
  const listId = process.env.CLICKUP_LIST_ID;
  if (!token || !listId) return "";

  try {
    const url = `https://api.clickup.com/api/v2/list/${listId}/task`;
    const response = await axios.get(url, { 
      headers: { 
        "Authorization": token,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://app.clickup.com/"
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
    const rawToken = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_PERSONAL_TOKEN;
    if (!rawToken) {
      return "Error: ClickUp API token not configured. Set CLICKUP_API_TOKEN in Railway.";
    }
    
    const token = rawToken.trim();

    const headers = {
      "Authorization": token,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://app.clickup.com",
      "Referer": "https://app.clickup.com/",
      "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site"
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
      
      if (status === 403 && (typeof data === 'string' && (data.includes('CloudFront') || data.includes('request could not be satisfied')))) {
        return "Error 403: ClickUp's CloudFront firewall is still blocking the request. This usually means the outbound IP of the server is flagged. Try a different Personal Token or check if ClickUp is down.";
      }
      
      if (status === 403) {
        return `Error 403 (Forbidden): Your token is valid but doesn't have permission to access List ${args.list_id || 'unspecified'}.`;
      }
      
      if (status === 401) {
        return "Error 401: Unauthorized. Your token is invalid or has expired.";
      }

      return `ClickUp Error ${status || error.message}: ${JSON.stringify(data || {})}`;
    }
  }
}
