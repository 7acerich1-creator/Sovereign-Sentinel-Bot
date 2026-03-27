// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — System Utilities Tool
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolContext, ToolDefinition } from "../types";

export class SystemTool implements Tool {
  definition: ToolDefinition = {
    name: "get_system_info",
    description: "Get current system status, including time, date, and and uptime.",
    parameters: {
      includeUptime: { type: "boolean", description: "Whether to include system uptime" },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const now = new Date();
    let response = `🕒 Current Time: ${now.toLocaleString()}\n📅 Current Date: ${now.toDateString()}\n🌐 Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    
    if (args.includeUptime) {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      response += `\n🚀 Uptime: ${hours}h ${minutes}m`;
    }

    return response;
  }
}
