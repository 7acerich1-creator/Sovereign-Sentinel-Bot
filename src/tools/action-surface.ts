// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Action Surface Layer
// Gives every agent a visible output surface.
// Without this, agent work evaporates into crew_dispatch.result.
// With this, every agent's output is reviewable in Mission Control.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";

const SUPABASE_URL = process.env.SUPABASE_URL;
// SESSION 31: Use service role key for action surface writes — bypasses RLS.
// tasks, briefings, content_drafts tables all blocked by RLS with anon key (401 errors).
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function supabasePost(table: string, data: Record<string, unknown>): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(data),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[ActionSurface] ${table} POST failed ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const rows = (await resp.json()) as any[];
    return rows?.[0]?.id || null;
  } catch (err: any) {
    console.error(`[ActionSurface] ${table} error: ${err.message}`);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. PROPOSE TASK — Any agent can propose a task for Ace's review
//    Writes to the `tasks` table with type "ai" and status "To Do"
//    Ace reviews in Mission Control → moves to "In Progress" = approval
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ProposeTaskTool implements Tool {
  private agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  definition: ToolDefinition = {
    name: "propose_task",
    description:
      "Propose a task for the Architect's review. This is how you surface work you've identified that needs doing. " +
      "The task appears in Mission Control as 'To Do' — when the Architect moves it to 'In Progress', that's your green light to execute. " +
      "Use this proactively: if you see an opportunity, a gap, or something that needs attention, propose it.",
    parameters: {
      title: {
        type: "string",
        description: "Short, clear task title (what needs to be done)",
      },
      description: {
        type: "string",
        description: "Detailed description: what, why, expected outcome, and your recommended approach",
      },
      priority: {
        type: "string",
        description: "Priority level: low, medium, high",
      },
      category: {
        type: "string",
        description: "Category: Content, Outreach, Infrastructure, Revenue, Strategy, Distribution, Analytics",
      },
    },
    required: ["title", "description"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const title = String(args.title);
    const description = String(args.description);
    const priority = String(args.priority || "medium");
    const category = String(args.category || "General");

    const agentDisplay = this.agentName.charAt(0).toUpperCase() + this.agentName.slice(1);

    const id = await supabasePost("tasks", {
      title,
      description: `[Proposed by ${agentDisplay}]\n\n${description}`,
      type: "ai",
      status: "To Do",
      priority: priority.charAt(0).toUpperCase() + priority.slice(1),
      assigned_to: agentDisplay,
      category,
    });

    if (id) {
      return `✅ Task proposed and visible in Mission Control.\n` +
        `ID: ${id}\n` +
        `Title: ${title}\n` +
        `Priority: ${priority}\n` +
        `Status: To Do (awaiting Architect review)\n` +
        `When the Architect moves this to "In Progress", execute immediately.`;
    }
    return "❌ Failed to propose task — Supabase connection issue.";
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. SAVE CONTENT DRAFT — Anita/Alfred/Yuki store generated content
//    Writes to `content_drafts` table for review in Mission Control
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class SaveContentDraftTool implements Tool {
  private agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  definition: ToolDefinition = {
    name: "save_content_draft",
    description:
      "Save a content draft for the Architect's review. Use this whenever you produce content that should be reviewed " +
      "before publishing: email copy, social captions, hooks, thread scripts, landing page text, ad copy. " +
      "This makes your work VISIBLE in Mission Control instead of disappearing into dispatch results. " +
      "The Architect can approve, reject, or request revisions.",
    parameters: {
      title: {
        type: "string",
        description: "Title of the content piece (e.g., 'Welcome Email v2', 'TikTok Hook — Dark Psychology')",
      },
      body: {
        type: "string",
        description: "The full content draft text",
      },
      draft_type: {
        type: "string",
        description: "Type (MUST be one of these exact values): email, caption, hook, thread, landing_page, script, blog, ad_copy, social_post, video_script, newsletter, tweet, post, other",
      },
      platform: {
        type: "string",
        description: "Target platform: tiktok, instagram, x, youtube, threads, email, website",
      },
      niche: {
        type: "string",
        description: "Content niche: dark_psychology, self_improvement, burnout, quantum",
      },
    },
    required: ["title", "body", "draft_type"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const title = String(args.title);
    const body = String(args.body);
    const platform = args.platform ? String(args.platform) : null;
    const niche = args.niche ? String(args.niche) : null;

    // Validate draft_type against DB CHECK constraint — fallback to "other" if unrecognized
    const VALID_DRAFT_TYPES = ["email", "caption", "hook", "thread", "landing_page", "script", "blog", "ad_copy", "social_post", "video_script", "newsletter", "tweet", "post", "other"];
    const rawType = String(args.draft_type || "other").toLowerCase().trim();
    const draftType = VALID_DRAFT_TYPES.includes(rawType) ? rawType : "other";

    const id = await supabasePost("content_drafts", {
      agent_name: this.agentName,
      title,
      body,
      draft_type: draftType,
      platform,
      niche,
      status: "pending_review",
      metadata: {
        word_count: body.split(/\s+/).length,
        char_count: body.length,
      },
    });

    if (id) {
      return `✅ Content draft saved and visible in Mission Control.\n` +
        `ID: ${id}\n` +
        `Title: ${title}\n` +
        `Type: ${draftType}\n` +
        `Platform: ${platform || "unspecified"}\n` +
        `Status: Pending Review\n` +
        `The Architect will review and approve before publishing.`;
    }
    return `❌ Failed to save draft — Supabase POST returned null. Check Railway logs for [ActionSurface] errors. draft_type="${draftType}", title="${title.slice(0, 50)}"`.trim();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. FILE BRIEFING — Sapphire/Veritas/Vector file strategic reports
//    Writes to `briefings` table for Ace's intelligence feed
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class FileBriefingTool implements Tool {
  private agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  definition: ToolDefinition = {
    name: "file_briefing",
    description:
      "File a strategic briefing for the Architect. Use this for status reports, trend analysis, revenue reports, " +
      "risk alerts, system status updates, or any intelligence the Architect needs to see. " +
      "This surfaces your analysis in Mission Control's briefing feed instead of burying it in dispatch results. " +
      "Set requires_action=true and include action_items if the Architect needs to do something.",
    parameters: {
      title: {
        type: "string",
        description: "Briefing title (e.g., 'Daily Trend Scan — March 29', 'Revenue Alert: Churn Spike')",
      },
      body: {
        type: "string",
        description: "Full briefing content — analysis, findings, recommendations",
      },
      briefing_type: {
        type: "string",
        description: "Type: strategic_analysis, system_status, revenue_report, trend_scan, risk_alert, pipeline_status, weekly_summary, other",
      },
      priority: {
        type: "string",
        description: "Priority: low, medium, high, critical",
      },
      requires_action: {
        type: "string",
        description: "Set to 'true' if the Architect needs to take action based on this briefing",
      },
      action_items: {
        type: "string",
        description: "JSON array of action item strings (e.g., '[\"Drop first YouTube URL\", \"Approve TikTok batch\"]')",
      },
    },
    required: ["title", "body", "briefing_type"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const title = String(args.title);
    const body = String(args.body);
    const briefingType = String(args.briefing_type || "other");
    const priority = String(args.priority || "medium");
    const requiresAction = args.requires_action === "true" || args.requires_action === true;

    let actionItems: string[] = [];
    try {
      if (args.action_items) {
        actionItems = typeof args.action_items === "string"
          ? JSON.parse(args.action_items)
          : (args.action_items as string[]);
      }
    } catch {
      actionItems = [];
    }

    const id = await supabasePost("briefings", {
      agent_name: this.agentName,
      title,
      body,
      briefing_type: briefingType,
      priority,
      requires_action: requiresAction,
      action_items: actionItems,
      status: "unread",
    });

    if (id) {
      // S122c (2026-04-26): canonicalized marker.
      // The dispatch poller's relay regex is `/✅ Briefing filed:\s*([0-9a-f-]{8,})/i`.
      // First line MUST be exactly `✅ Briefing filed: <id>` so the relay fires
      // for ALL crew agents that use this tool — not just the ones with hardened
      // directives that restate the marker themselves. Tail block keeps the rest
      // of the structured context for agents that paste tool output verbatim.
      return `✅ Briefing filed: ${id}\n` +
        `Visible in Mission Control.\n` +
        `Title: ${title}\n` +
        `Type: ${briefingType}\n` +
        `Priority: ${priority}\n` +
        `Requires Action: ${requiresAction ? "YES" : "No"}\n` +
        `${actionItems.length > 0 ? `Action Items: ${actionItems.join(", ")}` : ""}`;
    }
    return "❌ Failed to file briefing — Supabase connection issue.";
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. CHECK APPROVED TASKS — Agent checks for tasks Ace has approved
//    Reads from `tasks` table where status = "In Progress" and assigned_to = agent
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CheckApprovedTasksTool implements Tool {
  private agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  definition: ToolDefinition = {
    name: "check_approved_tasks",
    description:
      "Check for tasks the Architect has approved for you. These are tasks with status 'In Progress' assigned to you. " +
      "The Architect reviews proposed tasks and moves them to 'In Progress' as approval. " +
      "When you find approved tasks, execute them immediately.",
    parameters: {},
    required: [],
  };

  async execute(): Promise<string> {
    if (!SUPABASE_URL || !SUPABASE_KEY) return "❌ Supabase not configured.";

    try {
      const agentDisplay = this.agentName.charAt(0).toUpperCase() + this.agentName.slice(1);
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/tasks?assigned_to=eq.${agentDisplay}&status=eq.In%20Progress&order=created_at.desc&limit=10`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      if (!resp.ok) return "❌ Failed to check tasks.";
      const tasks = (await resp.json()) as any[];

      if (tasks.length === 0) {
        return "No approved tasks in your queue. Propose new tasks if you identify opportunities.";
      }

      return `📋 ${tasks.length} APPROVED TASK(S) — Execute immediately:\n\n` +
        tasks.map((t: any) =>
          `• [${t.id}] ${t.title}\n  Priority: ${t.priority}\n  ${t.description?.slice(0, 200) || "(no description)"}`
        ).join("\n\n");
    } catch (err: any) {
      return `❌ Error: ${err.message}`;
    }
  }
}
