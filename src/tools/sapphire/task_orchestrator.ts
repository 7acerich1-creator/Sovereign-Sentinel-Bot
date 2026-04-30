// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Task Orchestrator (S125l, 2026-04-29)
//
// One tool that writes a new task to all three of Ace's surfaces in a single
// call: ClickUp (primary task home), Mission Control's tasks table (dashboard),
// and today's Notion Daily Tasks & Goals page (his daily check surface).
//
// Why: Sapphire was promising "I'll propose a task in Mission Control" and
// not actually calling propose_task. Plus when she did call it she never also
// hit ClickUp + Notion. Three separate tool calls = three chances to skip.
// One orchestrator = one decision point.
//
// Architecture (per Ace's spec, 2026-04-29 conversation):
//   ClickUp    → primary task management (where work actually lives)
//   Notion     → read surface (he checks daily on Daily Tasks & Goals page)
//   MC         → strategic dashboard (he checks rarely or when she points)
//   Sapphire   → the orchestration layer that writes to all three
//
// When Ace says "create a task" / "put this in mission control" / "add to my
// list" / similar — Sapphire calls THIS tool, not the underlying three.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DAILY_TASKS_HUB_ID = "3507db89ef7381b6a21beb07f930a882"; // 📁 Daily Tasks & Goals folder

const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_DEFAULT_LIST_ID || process.env.CLICKUP_LIST_ID;

// ━━━ HELPERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function createMcTask(title: string, description: string, priority: string, category: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        title: title.slice(0, 200),
        description: description.slice(0, 2000),
        priority, // 'High'|'Medium'|'Low' per check constraint
        type: "human",
        status: "To Do",
        category,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn(`[task_orchestrator] MC tasks insert failed ${res.status}: ${err.slice(0, 200)}`);
      return null;
    }
    const rows = (await res.json()) as any[];
    return rows[0]?.id || null;
  } catch (e: any) {
    console.warn(`[task_orchestrator] MC tasks error: ${e.message}`);
    return null;
  }
}

async function createClickUpTask(title: string, description: string, priority: string): Promise<{ id: string; url: string } | null> {
  if (!CLICKUP_TOKEN || !CLICKUP_LIST_ID) return null;
  // ClickUp priority mapping: 1=urgent, 2=high, 3=normal, 4=low
  const cuPriority = priority === "High" ? 2 : priority === "Medium" ? 3 : 4;
  try {
    const res = await fetch(`https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`, {
      method: "POST",
      headers: {
        Authorization: CLICKUP_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: title.slice(0, 200),
        description: description.slice(0, 4000),
        priority: cuPriority,
        status: "to do",
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn(`[task_orchestrator] ClickUp create failed ${res.status}: ${err.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as any;
    return { id: data.id, url: data.url };
  } catch (e: any) {
    console.warn(`[task_orchestrator] ClickUp error: ${e.message}`);
    return null;
  }
}

async function findOrCreateTodayPage(): Promise<string | null> {
  if (!NOTION_TOKEN) return null;
  // Use Ace's CDT date for the title format ("April 29 - Tasks & Goals")
  const cdtNow = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const monthName = ["January","February","March","April","May","June","July","August","September","October","November","December"][cdtNow.getUTCMonth()];
  const dayNum = cdtNow.getUTCDate();
  const targetTitle = `${monthName} ${dayNum} - Tasks & Goals`;

  try {
    // Search children of the Daily Tasks & Goals hub for one matching today's title
    const res = await fetch(`https://api.notion.com/v1/blocks/${DAILY_TASKS_HUB_ID}/children?page_size=20`, {
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const child = (data.results || []).find((b: any) =>
      b.type === "child_page" && b.child_page?.title === targetTitle,
    );
    if (child) return child.id;

    // Not found — create
    const createRes = await fetch(`https://api.notion.com/v1/pages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { page_id: DAILY_TASKS_HUB_ID },
        properties: { title: { title: [{ text: { content: targetTitle } }] } },
      }),
    });
    if (!createRes.ok) return null;
    const created = (await createRes.json()) as any;
    return created.id;
  } catch {
    return null;
  }
}

async function appendToNotionPage(pageId: string, blocks: any[]): Promise<boolean> {
  if (!NOTION_TOKEN) return false;
  try {
    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ children: blocks }),
    });
    return res.ok;
  } catch {
    return false;
  }
}



// ━━━ THE TOOL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CreateTaskForAceTool implements Tool {
  definition: ToolDefinition = {
    name: "create_task_for_ace",
    description:
      "Create a task across all three of Ace's surfaces in ONE call: ClickUp (primary task home), Mission Control tasks table (dashboard), today's Notion Daily Tasks & Goals page (his daily check). " +
      "Use this WHENEVER Ace gives you something he wants done — 'put X in mission control', 'add this to my list', 'I want to do Y', 'remind me to handle Z later', or anything that produces a real piece of work.\n\n" +
      "DO NOT use propose_task, clickup_manage_tasks, and notion_append_to_page separately for the same task — this orchestrator does all three in one shot. DO NOT say 'I'll create a task' without calling THIS tool in the same turn (see execute_what_you_say rule).\n\n" +
      "Examples:\n" +
      "• Ace: 'Have Claude redesign the landing pages' → create_task_for_ace(title='Have Claude redesign all landing pages via Claude Design', description='Use Claude Design to overhaul every landing page on sovereign-synthesis.com', priority='High', category='Infrastructure')\n" +
      "• Ace: 'Anita newsletter, I have a plan' → create_task_for_ace(title='Anita newsletter — execute Ace plan', description='Get Ace plan into operational spec, build template + cadence + list source', priority='Medium', category='Outreach')",
    parameters: {
      title: { type: "string", description: "Short title (imperative voice, max ~120 chars). What needs to be done." },
      description: { type: "string", description: "Full description: what + why + outcome. Reference Ace's exact words when relevant. Max 2000 chars." },
      priority: { type: "string", description: "'High' | 'Medium' | 'Low' (exact case). Default Medium if unsure." },
      category: { type: "string", description: "Content | Outreach | Infrastructure | Revenue | Strategy | Distribution | Analytics" },
    },
    required: ["title", "description", "priority", "category"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const title = String(args.title || "").trim();
    const description = String(args.description || "").trim();
    const priority = String(args.priority || "Medium").trim();
    const category = String(args.category || "Strategy").trim();
    if (!title) return "create_task_for_ace: title required.";
    if (!description) return "create_task_for_ace: description required.";
    if (!["High", "Medium", "Low"].includes(priority)) {
      return `create_task_for_ace: priority must be exactly 'High', 'Medium', or 'Low'. Got: '${priority}'`;
    }

    const results: { mc?: string; clickup?: { id: string; url: string }; notion?: string; failures: string[] } = { failures: [] };

    // 1. Mission Control tasks table
    const mcId = await createMcTask(title, description, priority, category);
    if (mcId) results.mc = mcId;
    else results.failures.push("MC tasks insert");

    // 2. ClickUp (primary task home) — silent skip if not configured
    const cu = await createClickUpTask(title, description, priority);
    if (cu) results.clickup = cu;
    else if (CLICKUP_TOKEN && CLICKUP_LIST_ID) results.failures.push("ClickUp create");

    // 3. Notion daily page
    const notionPageId = await findOrCreateTodayPage();
    if (notionPageId) {
      const noteText = `[${priority.toUpperCase()}] ${title} — ${category}` +
        (cu?.url ? ` (ClickUp: ${cu.url})` : "") +
        (mcId ? ` (MC id: ${mcId.slice(0, 8)})` : "");
      const ok = await appendToNotionPage(notionPageId, [
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: [{ type: "text", text: { content: noteText.slice(0, 1900) } }] },
        },
      ]);
      if (ok) results.notion = notionPageId;
      else results.failures.push("Notion append");
    } else {
      results.failures.push("Notion daily page lookup");
    }

    const surfaces: string[] = [];
    if (results.mc) surfaces.push(`Mission Control (id ${results.mc.slice(0, 8)})`);
    if (results.clickup) surfaces.push(`ClickUp (${results.clickup.url})`);
    if (results.notion) surfaces.push(`Notion daily page`);

    if (surfaces.length === 0) {
      return `create_task_for_ace: ALL surfaces failed. Failures: ${results.failures.join(", ")}. Nothing was written.`;
    }

    let summary = `Task "${title.slice(0, 80)}" created on: ${surfaces.join(" + ")}.`;
    if (results.failures.length > 0) {
      summary += ` Partial — ${results.failures.length} surface(s) failed: ${results.failures.join(", ")}.`;
    }
    return summary;
  }
}
