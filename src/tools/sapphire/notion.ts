// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Notion Tools
// Session 114 — 2026-04-24
//
// Three tools: create_page, append_to_page, search_notion.
// Daily-page architecture: Sapphire creates one page per day under a parent
// page Ace shares with the integration. Brief + wrap-up are appended as blocks.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { getNotionToken } from "../../proactive/sapphire-oauth";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function notionFetch(
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const tokenRes = await getNotionToken();
  if (!tokenRes.ok) return { ok: false, error: tokenRes.error };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenRes.token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };

  const opts: RequestInit = { ...init, headers };
  if (init.jsonBody !== undefined) opts.body = JSON.stringify(init.jsonBody);

  let resp: Response;
  try {
    resp = await fetch(`${NOTION_API}${path}`, opts);
  } catch (e: any) {
    return { ok: false, error: `Notion network error: ${e.message}` };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unreadable>");
    return { ok: false, error: `Notion ${resp.status}: ${body.slice(0, 300)}` };
  }
  const data = await resp.json();
  return { ok: true, data };
}

// ── Helper: text → Notion rich_text + paragraph blocks ──────────────────────
function textToParagraphs(text: string): unknown[] {
  // Split on blank lines for paragraphs, on \n for line breaks within
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  return paragraphs.map((p) => {
    // Notion rich_text caps at 2000 chars per chunk
    const chunks: string[] = [];
    for (let i = 0; i < p.length; i += 1900) chunks.push(p.slice(i, i + 1900));
    return {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: chunks.map((c) => ({ type: "text", text: { content: c } })),
      },
    };
  });
}

function headingBlock(text: string, level: 1 | 2 | 3 = 2): unknown {
  return {
    object: "block",
    type: `heading_${level}`,
    [`heading_${level}`]: {
      rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }],
    },
  };
}

function dividerBlock(): unknown {
  return { object: "block", type: "divider", divider: {} };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CREATE PAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class NotionCreatePageTool implements Tool {
  definition: ToolDefinition = {
    name: "notion_create_page",
    description:
      "Create a new Notion page under a parent page. Used for daily operations log pages and one-off notes.",
    parameters: {
      parent_page_id: { type: "string", description: "Parent Notion page ID (UUID format with or without dashes)." },
      title: { type: "string", description: "Page title." },
      body: { type: "string", description: "Optional initial body text. Plain text; double newlines = paragraph breaks." },
    },
    required: ["parent_page_id", "title"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const parent = String(args.parent_page_id || "").replace(/-/g, "");
    const title = String(args.title || "").slice(0, 200);
    const body = args.body ? String(args.body) : "";

    if (!parent) return "notion_create_page: parent_page_id required.";
    if (!title) return "notion_create_page: title required.";

    const children: unknown[] = [];
    if (body.trim()) {
      children.push(...textToParagraphs(body));
    }

    const result = await notionFetch("/pages", {
      method: "POST",
      jsonBody: {
        parent: { page_id: parent },
        properties: {
          title: {
            title: [{ type: "text", text: { content: title } }],
          },
        },
        children,
      },
    });

    if (!result.ok) return `notion_create_page: ${result.error}`;
    return `Created Notion page "${title}". ID: ${result.data.id}. URL: ${result.data.url}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APPEND TO PAGE — used to add brief / wrap-up sections to daily pages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class NotionAppendToPageTool implements Tool {
  definition: ToolDefinition = {
    name: "notion_append_to_page",
    description:
      "Append content to an existing Notion page. Used for morning brief, evening wrap, ad-hoc notes Ace wants logged.\n\n" +
      "Examples:\n" +
      "• 'add to today: called pediatrician, scheduled Tuesday' → notion_append_to_page(page_id='<today_page_id>', body='Called pediatrician — scheduled Tuesday.')\n" +
      "• 'log this: bought groceries $87 at HEB' → notion_append_to_page(page_id='<today_page_id>', heading='Expenses', body='Groceries — $87 at HEB.')",
    parameters: {
      page_id: { type: "string", description: "Notion page ID." },
      heading: { type: "string", description: "Optional section heading (rendered as H2)." },
      body: { type: "string", description: "Body content. Double newlines = paragraph breaks." },
      with_divider: { type: "boolean", description: "Prepend a divider before the content. Default true." },
    },
    required: ["page_id", "body"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const pageId = String(args.page_id || "").replace(/-/g, "");
    const heading = args.heading ? String(args.heading) : "";
    const body = String(args.body || "");
    const withDivider = args.with_divider !== false;

    if (!pageId) return "notion_append_to_page: page_id required.";
    if (!body.trim()) return "notion_append_to_page: body required.";

    const children: unknown[] = [];
    if (withDivider) children.push(dividerBlock());
    if (heading) children.push(headingBlock(heading, 2));
    children.push(...textToParagraphs(body));

    const result = await notionFetch(`/blocks/${pageId}/children`, {
      method: "PATCH",
      jsonBody: { children },
    });

    if (!result.ok) return `notion_append_to_page: ${result.error}`;
    return `Appended ${children.length} block(s) to page ${pageId}.`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEARCH NOTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class NotionSearchTool implements Tool {
  definition: ToolDefinition = {
    name: "notion_search",
    description:
      "Search Ace's Notion workspace. Use when he asks 'find that note about X' or 'where did I write about Y'. Only searches pages shared with the Sapphire integration.",
    parameters: {
      query: { type: "string", description: "Search keywords." },
      filter_pages_only: { type: "boolean", description: "If true, only return pages (not databases). Default true." },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query || "").trim();
    const pagesOnly = args.filter_pages_only !== false;

    if (!query) return "notion_search: query required.";

    const body: any = { query, page_size: 10 };
    if (pagesOnly) body.filter = { property: "object", value: "page" };

    const result = await notionFetch("/search", {
      method: "POST",
      jsonBody: body,
    });

    if (!result.ok) return `notion_search: ${result.error}`;
    const items = (result.data.results as any[]) || [];
    if (items.length === 0) return `No Notion pages match "${query}".`;

    const lines = items.map((p: any) => {
      const titleProp = p.properties?.title?.title?.[0]?.plain_text
        || p.properties?.Name?.title?.[0]?.plain_text
        || p.child_page?.title
        || "(untitled)";
      return `• ${titleProp} — ${p.url}`;
    });
    return `Notion results for "${query}":\n${lines.join("\n")}`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIND-OR-CREATE DAILY PAGE — internal helper used by Phase 5 brief jobs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../../config";

export async function findOrCreateDailyPage(
  date: Date,
  parentPageId: string,
): Promise<{ ok: true; pageId: string; url: string } | { ok: false; error: string }> {
  const isoDate = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const friendly = date.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(config.memory.supabaseUrl!, (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!);

  // Check if we already have a page for this date
  const { data: existing } = await supabase
    .from("sapphire_daily_pages")
    .select("notion_page_id")
    .eq("date", isoDate)
    .maybeSingle();

  if (existing?.notion_page_id) {
    return { ok: true, pageId: existing.notion_page_id, url: `https://www.notion.so/${existing.notion_page_id.replace(/-/g, "")}` };
  }

  // Create new daily page
  const result = await notionFetch("/pages", {
    method: "POST",
    jsonBody: {
      parent: { page_id: parentPageId.replace(/-/g, "") },
      properties: {
        title: {
          title: [{ type: "text", text: { content: friendly } }],
        },
      },
      children: [
        headingBlock(`📅 ${friendly}`, 1),
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: `Daily operations log. Updated by Sapphire automatically.` } }],
          },
        },
      ],
    },
  });

  if (!result.ok) return { ok: false, error: result.error };

  const pageId = result.data.id;
  const url = result.data.url;

  // Persist to sapphire_daily_pages
  await supabase.from("sapphire_daily_pages").upsert(
    { date: isoDate, notion_page_id: pageId, status: "pending" },
    { onConflict: "date" },
  );

  return { ok: true, pageId, url };
}

// ── Parent page ID storage (the page Ace shares with the integration) ──────
export async function getNotionParentPageId(): Promise<string | null> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(config.memory.supabaseUrl!, (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!);
  const { data } = await supabase
    .from("sapphire_known_facts")
    .select("value")
    .eq("key", "notion_parent_page_id")
    .maybeSingle();
  return data?.value || null;
}

export async function setNotionParentPageId(pageId: string): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(config.memory.supabaseUrl!, (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!);
  await supabase.from("sapphire_known_facts").upsert(
    { key: "notion_parent_page_id", value: pageId.replace(/-/g, ""), category: "preferences" },
    { onConflict: "key" },
  );
}

export class NotionSetParentPageTool implements Tool {
  definition: ToolDefinition = {
    name: "notion_set_parent_page",
    description:
      "Tell Sapphire which Notion page should be the parent for daily operations log pages. Use after Ace shares a Notion page with the Sapphire integration.",
    parameters: {
      page_id_or_url: { type: "string", description: "Notion page ID or full Notion page URL." },
    },
    required: ["page_id_or_url"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const raw = String(args.page_id_or_url || "").trim();
    if (!raw) return "notion_set_parent_page: page_id_or_url required.";

    // Extract ID from URL if needed
    let id = raw;
    const urlMatch = raw.match(/([a-f0-9]{32})/i) || raw.match(/([a-f0-9-]{36})/i);
    if (urlMatch) id = urlMatch[1];
    id = id.replace(/-/g, "");
    if (id.length !== 32) return `notion_set_parent_page: could not parse a valid Notion page ID from "${raw}".`;

    // Verify the integration can access it
    const verify = await notionFetch(`/pages/${id}`, { method: "GET" });
    if (!verify.ok) {
      return `notion_set_parent_page: cannot access that page. Make sure you've added the Sapphire integration to it via "..." → "Connect to" → "Sapphire". Error: ${verify.error}`;
    }

    await setNotionParentPageId(id);
    return `Notion parent page set to ${id}. Daily pages will now be created here.`;
  }
}
