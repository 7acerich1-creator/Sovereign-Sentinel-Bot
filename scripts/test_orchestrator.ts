// Test the task orchestrator end-to-end
import { CreateTaskForAceTool } from "../src/tools/sapphire/task_orchestrator";

(async () => {
  const tool = new CreateTaskForAceTool();
  const result = await tool.execute({
    title: "Review the funnel copy and design sales pages",
    description: "Ace's request from 2026-04-30 conversation. He wanted this on his list — Sapphire only got it onto MC, ClickUp + Notion lookups silently failed due to env var name mismatch (CLICKUP_TOKEN vs CLICKUP_API_TOKEN, NOTION_TOKEN vs NOTION_API_KEY). This task is the second-time creation post-S125l hotfix to verify all three surfaces now work.",
    priority: "High",
    category: "Infrastructure",
  });
  console.log("RESULT:", result);
})().catch((e) => { console.error(e); process.exit(1); });
