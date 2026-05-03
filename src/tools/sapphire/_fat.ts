// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire — Fat Composable Tool Surface (S125+ Phase 4, 2026-04-30)
//
// Consolidates 39 narrow tools to ~14 fat composable ones for Sapphire's DM
// surface. Each fat tool takes an `action` arg and dispatches internally to
// the existing narrow tool classes. No logic duplication — pure thin router.
//
// Why this matters (Anthropic engineering blog "Writing tools for agents",
// Jenova/Writer benchmarks):
//   • 78% selection accuracy at ~10 tools, drops to 13.62% at 100+ tools.
//   • Sapphire was at 39 tools — already in the "compromised accuracy" zone.
//   • Fat tools with action enums recover the accuracy curve while preserving
//     full capability surface.
//
// Mappings (old narrow → new fat):
//   reminders         ← set_reminder, list_reminders, cancel_reminder, cancel_reminder_series
//   gmail             ← gmail_inbox, gmail_search, gmail_send, gmail_create_draft
//   calendar          ← calendar_list, calendar_create_event, calendar_reschedule
//   notion            ← notion_create_page, notion_append_to_page, notion_search,
//                       notion_set_parent_page, notion_get_blocks, notion_update_block,
//                       notion_delete_block
//   memory            ← remember_fact, recall_facts
//   family            ← save_family_member, get_family
//   followups         ← record_followup, list_followups, complete_followup, cancel_followup
//   research          ← research_brief, analyze_pdf, web_search, youtube_search,
//                       youtube_get_transcript
//   mission_control   ← file_briefing, propose_task, create_task_for_ace
//   self              ← set_piece, remove_piece, create_piece, list_pieces,
//                       view_self_prompt, view_identity_history
//   learning          ← log_email_classification, request_code_change, list_deferred_builds
//   plan              ← create_plan, approve_plan, advance_plan, record_step_result,
//                       execute_workflow, record_workflow_artifact, cancel_plan
//   diary             ← write_diary_entry, read_diary, read_significance
//
// Already fat (kept as-is, names unchanged):
//   conditional_reminders (Phase 2), team_roster, news (3 actions baked in)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition, ToolContext } from "../../types";

// Import narrow tool classes — fat tools dispatch to these
import {
  SetReminderTool, ListRemindersTool, CancelReminderTool, CancelReminderSeriesTool,
} from "./reminders";
import {
  GmailInboxTool, GmailSearchTool, GmailSendTool, GmailDraftTool,
} from "./gmail";
import {
  CalendarListTool, CalendarCreateEventTool, CalendarRescheduleTool,
} from "./calendar";
import {
  NotionCreatePageTool, NotionAppendToPageTool, NotionSearchTool,
  NotionSetParentPageTool, NotionGetBlocksTool, NotionUpdateBlockTool,
  NotionDeleteBlockTool,
} from "./notion";
import { RememberFactTool, RecallFactsTool } from "./facts";
import { SaveFamilyMemberTool, GetFamilyTool } from "./family";
import {
  RecordFollowupTool, ListFollowupsTool,
  CompleteFollowupTool, CancelFollowupTool,
} from "./followups";
import { ResearchBriefTool } from "./research";
import { AnalyzePdfTool } from "./pdf";
import { WebSearchTool } from "./web_search";
import { YoutubeSearchTool, YoutubeTranscriptTool } from "./youtube";
import { FileBriefingTool, ProposeTaskTool } from "../action-surface";
import { CreateTaskForAceTool } from "./task_orchestrator";
import {
  SetPieceTool, RemovePieceTool, CreatePieceTool, ListPiecesTool,
  ViewSelfPromptTool, ViewIdentityHistoryTool,
} from "./self_mod";
import {
  LogEmailClassificationTool, RequestCodeChangeTool, ListDeferredBuildsTool,
} from "./learning";
import {
  CreatePlanTool, ApprovePlanTool, AdvancePlanTool, RecordStepResultTool,
  ExecuteWorkflowTool, RecordWorkflowArtifactTool, CancelPlanTool,
} from "./planner";
import {
  WriteDiaryEntryTool, ReadDiaryTool, ReadSignificanceTool,
} from "./diary";
// Phase 5 — core memory (Letta-style) + archival memory + temporal supersession
import {
  CoreMemoryViewTool, CoreMemoryAppendTool, CoreMemoryReplaceTool,
  ArchivalInsertTool, ArchivalSearchTool, SupersedeMemoryTool,
} from "./core_memory";
// Phase 6 — Zep-style temporal knowledge graph (Postgres-as-graph)
import {
  EntityUpsertTool, EntityGetTool, RelateTool, UnrelateTool, GraphQueryTool,
} from "./temporal_graph";

// ── Helper: dispatch to a narrow tool by action ─────────────────────────────

function unknownAction(toolName: string, action: string, valid: string[]): string {
  return `${toolName}: unknown action '${action}'. Valid actions: ${valid.join(", ")}.`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. reminders — time-based reminders (NOT threshold-based; for those use conditional_reminders)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RemindersTool implements Tool {
  private setT = new SetReminderTool();
  private listT = new ListRemindersTool();
  private cancelT = new CancelReminderTool();
  private cancelSeriesT = new CancelReminderSeriesTool();

  definition: ToolDefinition = {
    name: "reminders",
    description:
      "Time-based reminders (clock-driven). For metric-threshold-driven alerts use conditional_reminders instead.\n\n" +
      "ACTIONS:\n" +
      "• set — schedule a reminder. Required: text, fire_at (ISO8601 — convert natural language yourself first). Optional: recurrence_rule, force_create.\n" +
      "• list — list active reminders. Optional: keyword filter, window_hours (default 168), include_all_statuses.\n" +
      "• cancel — cancel a single reminder. Required: id (full UUID or 8-char prefix).\n" +
      "• cancel_series — cancel ALL pending reminders matching keyword and/or recurrence_rule. Optional: dry_run to preview.\n\n" +
      "VAGUE TIMES: When Ace says 'later tonight' / 'this evening' / 'in a bit' WITHOUT a specific time, pick a sensible default (evening → 8pm CDT, late night → 11pm CDT) and just CONFIRM the time in your acknowledgment. DO NOT ping-pong asking for an exact minute — that wastes his attention. He'll correct you if it's wrong.\n\n" +
      "Before setting a recurring reminder, FIRST call list with a keyword to check for duplicates (per reminder_dedup doctrine).",
    parameters: {
      action: { type: "string", description: "set | list | cancel | cancel_series", enum: ["set", "list", "cancel", "cancel_series"] },
      text: { type: "string", description: "[set] The reminder text Sapphire will DM Ace at fire_at." },
      fire_at: { type: "string", description: "[set] ISO8601 timestamp. Convert natural language ('tonight at 8', 'tomorrow 9am') to ISO yourself; Ace is CDT (UTC-5). For vague evening times default to 8pm CDT (01:00:00Z next day)." },
      recurrence_rule: { type: "string", description: "[set, cancel_series] 'daily' | 'weekday' | 'weekend' | 'weekly:mon,wed,fri' | 'monthly:15'. Leave empty for one-off." },
      force_create: { type: "boolean", description: "[set] Bypass the dedup-preflight that warns about overlapping reminders in the same hour. Only use for intentional distinct reminders at similar times." },
      id: { type: "string", description: "[cancel] Full UUID or 8-char prefix of the reminder to cancel." },
      keyword: { type: "string", description: "[list, cancel_series] Case-insensitive substring to match against reminder messages." },
      window_hours: { type: "number", description: "[list] Lookahead window in hours from now. Default 168 (1 week)." },
      include_all_statuses: { type: "boolean", description: "[list] If true, also returns fired/cancelled/failed. Use for troubleshooting." },
      dry_run: { type: "boolean", description: "[cancel_series] Preview what would be cancelled without changing anything." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "set":
        // S127 — Param remap fix. Fat schema uses `text`, narrow tool reads `message`.
        // Without this, every set_reminder call returned "set_reminder: message is required."
        // Accept both names so the dispatch is forgiving.
        return this.setT.execute({
          message: args.text ?? args.message,
          fire_at: args.fire_at,
          recurrence_rule: args.recurrence_rule,
          force_create: args.force_create,
        });
      case "list":
        // Fat: keyword | Narrow: query
        return this.listT.execute({
          window_hours: args.window_hours,
          query: args.keyword ?? args.query,
          include_all_statuses: args.include_all_statuses,
        });
      case "cancel":
        // Fat: id | Narrow: reminder_id
        return this.cancelT.execute({
          reminder_id: args.id ?? args.reminder_id,
        });
      case "cancel_series":
        // Fat: keyword | Narrow: message_contains
        return this.cancelSeriesT.execute({
          message_contains: args.keyword ?? args.message_contains,
          recurrence_rule: args.recurrence_rule,
          dry_run: args.dry_run,
        });
      default:
        return unknownAction("reminders", action, ["set", "list", "cancel", "cancel_series"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. gmail — inbox triage + search + send + draft
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class GmailTool implements Tool {
  private inboxT = new GmailInboxTool();
  private searchT = new GmailSearchTool();
  private sendT = new GmailSendTool();
  private draftT = new GmailDraftTool();

  definition: ToolDefinition = {
    name: "gmail",
    description:
      "Gmail operations on Architect's connected accounts.\n\n" +
      "ACTIONS:\n" +
      "• inbox — list recent unread/important. Optional: account ('empoweredservices2013' or '7ace.rich1'), limit.\n" +
      "• search — Gmail-syntax search ('from:x', 'subject:y', etc.). Required: query. Optional: account, limit.\n" +
      "• send — compose and send an email. Required: to, subject, body. Optional: account, cc, bcc.\n" +
      "• draft — create a draft (don't send). Same params as send.\n\n" +
      "When Architect gives a verdict on an alert ('noise', 'important', 'urgent'), separately call learning(action='log_email_classification', ...) to feed the watcher's filter dataset.",
    parameters: {
      action: { type: "string", description: "inbox | search | send | draft", enum: ["inbox", "search", "send", "draft"] },
      account: { type: "string", description: "[all] 'empoweredservices2013' or '7ace.rich1'. Defaults to primary." },
      query: { type: "string", description: "[search] Gmail-syntax search string." },
      to: { type: "string", description: "[send, draft] Recipient email." },
      cc: { type: "string", description: "[send, draft] CC (comma-separated)." },
      bcc: { type: "string", description: "[send, draft] BCC (comma-separated)." },
      subject: { type: "string", description: "[send, draft] Email subject." },
      body: { type: "string", description: "[send, draft] Email body (plain text)." },
      limit: { type: "number", description: "[inbox, search] Max results, default 10 (inbox) / 20 (search)." },
      hours_back: { type: "number", description: "[inbox] Look back N hours for unread/recent. Default 24." },
      unread_only: { type: "boolean", description: "[inbox] Only return unread messages. Default true." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    // S129b — Param remap. Narrow tools read `max`, `unread_only`, `hours_back`.
    // Fat exposes `limit` historically; translate to `max` and pass through inbox-specific knobs.
    switch (action) {
      case "inbox":
        return this.inboxT.execute({
          account: args.account,
          max: args.limit ?? args.max,
          unread_only: args.unread_only,
          hours_back: args.hours_back,
        });
      case "search":
        return this.searchT.execute({
          account: args.account,
          query: args.query,
          max: args.limit ?? args.max,
        });
      case "send": return this.sendT.execute(args);
      case "draft": return this.draftT.execute(args);
      default: return unknownAction("gmail", action, ["inbox", "search", "send", "draft"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. calendar — list / create / reschedule on Google Calendar
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CalendarTool implements Tool {
  private listT = new CalendarListTool();
  private createT = new CalendarCreateEventTool();
  private rescheduleT = new CalendarRescheduleTool();

  definition: ToolDefinition = {
    name: "calendar",
    description:
      "Google Calendar operations on Architect's connected accounts.\n\n" +
      "ACTIONS:\n" +
      "• list — list upcoming events. Optional: account, days_ahead (default 7), limit.\n" +
      "• create — create a new event. Required: title, start (ISO8601 or natural). Optional: end, location, description, attendees, account.\n" +
      "• reschedule — move an existing event. Required: event_id, new_start. Optional: new_end, account.\n\n" +
      "Two accounts: 'empoweredservices2013' (primary) and '7ace.rich1'. Plus the 'Girls special events' calendar — use account='girls_special_events' for kids' school events.",
    parameters: {
      action: { type: "string", description: "list | create | reschedule", enum: ["list", "create", "reschedule"] },
      account: { type: "string", description: "[all] 'empoweredservices2013', '7ace.rich1', or 'girls_special_events'." },
      title: { type: "string", description: "[create] Event title (mapped to Google Calendar 'summary')." },
      start: { type: "string", description: "[create] Start time (ISO8601 or natural)." },
      end: { type: "string", description: "[create, reschedule] End time. If omitted, defaults to start + 1 hour." },
      location: { type: "string", description: "[create] Location string." },
      description: { type: "string", description: "[create] Event description." },
      attendees: { type: "array", description: "[create] List of attendee emails.", items: { type: "string", description: "email" } },
      event_id: { type: "string", description: "[reschedule] The Google Calendar event ID." },
      new_start: { type: "string", description: "[reschedule] New start time." },
      new_end: { type: "string", description: "[reschedule] New end time." },
      days_ahead: { type: "number", description: "[list] Lookahead window in days from now. Default 2 days." },
      limit: { type: "number", description: "[list] Max results, default 20." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    // S129b — Param remap. Narrow CalendarListTool reads time_min/time_max/max,
    // CalendarCreateEventTool reads `summary` (not `title`).
    switch (action) {
      case "list": {
        // Translate days_ahead → time_max if not explicitly passed.
        const daysAhead = Number(args.days_ahead);
        const timeMax = args.time_max
          ? args.time_max
          : (Number.isFinite(daysAhead) && daysAhead > 0
              ? new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString()
              : undefined);
        return this.listT.execute({
          account: args.account,
          time_min: args.time_min,
          time_max: timeMax,
          max: args.limit ?? args.max,
        });
      }
      case "create":
        return this.createT.execute({
          account: args.account,
          summary: args.title ?? args.summary,
          start: args.start,
          end: args.end,
          location: args.location,
          description: args.description,
          attendees: args.attendees,
        });
      case "reschedule": return this.rescheduleT.execute(args);
      default: return unknownAction("calendar", action, ["list", "create", "reschedule"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. notion — pages, blocks, search
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class NotionTool implements Tool {
  private createT = new NotionCreatePageTool();
  private appendT = new NotionAppendToPageTool();
  private searchT = new NotionSearchTool();
  private setParentT = new NotionSetParentPageTool();
  private getBlocksT = new NotionGetBlocksTool();
  private updateBlockT = new NotionUpdateBlockTool();
  private deleteBlockT = new NotionDeleteBlockTool();

  definition: ToolDefinition = {
    name: "notion",
    description:
      "Notion workspace operations. Canonical structure under 🧭 Daily Life is locked at 5 folders (📁 Daily Briefs, 📁 Daily Tasks & Goals, 📁 Daily Reflections, 📁 Complex Tasks, 📁 Long-term Projects) — see notion_canonical_structure doctrine.\n\n" +
      "ACTIONS:\n" +
      "• create_page — create a new page. Self-checks for duplicate titles (returns existing URL on collision). Required: title. Optional: parent_page_id, hub_name (e.g. '📁 Complex Tasks'), body, force (true to allow intentional duplicates).\n" +
      "• append — append content to existing page. Required: page_id, body. Optional: heading, with_divider (default true). BEFORE appending, call get_blocks to check for existing duplicate sections.\n" +
      "• search — semantic search over Architect's Notion. Required: query. Optional: filter_pages_only (default true).\n" +
      "• set_parent — set the daily-page parent. Required: page_id_or_url.\n" +
      "• get_blocks — list child blocks of a page (returns block IDs). Required: block_id.\n" +
      "• update_block — modify a block's text. Required: block_id, text. Optional: type ('paragraph', 'heading_2', etc.).\n" +
      "• delete_block — archive a block. Required: block_id.\n\n" +
      "When duplicates exist, archive them — never leave them sitting (per signal_discipline_s125 rule 3, now enforced structurally by create_page's auto-dedup).",
    parameters: {
      action: { type: "string", description: "create_page | append | search | set_parent | get_blocks | update_block | delete_block",
        enum: ["create_page", "append", "search", "set_parent", "get_blocks", "update_block", "delete_block"] },
      title: { type: "string", description: "[create_page] Page title." },
      parent_page_id: { type: "string", description: "[create_page] Parent page ID. If omitted, uses configured default." },
      hub_name: { type: "string", description: "[create_page] Hub folder name (e.g. '📁 Complex Tasks')." },
      body: { type: "string", description: "[create_page, append] Body text." },
      force: { type: "boolean", description: "[create_page] Bypass dedup-check. Default false." },
      page_id: { type: "string", description: "[append] Target page ID. Use 'today_page_id' for today's daily page." },
      heading: { type: "string", description: "[append] Optional H2 heading prepended to the body." },
      with_divider: { type: "boolean", description: "[append] Prepend a divider. Default true." },
      query: { type: "string", description: "[search] Search query." },
      filter_pages_only: { type: "boolean", description: "[search] Pages only (no databases). Default true." },
      page_id_or_url: { type: "string", description: "[set_parent] Notion page ID or URL." },
      block_id: { type: "string", description: "[get_blocks, update_block, delete_block] Block ID." },
      text: { type: "string", description: "[update_block] New block text." },
      type: { type: "string", description: "[update_block] Block type, default 'paragraph'." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "create_page": return this.createT.execute(args);
      case "append": return this.appendT.execute(args);
      case "search": return this.searchT.execute(args);
      case "set_parent": return this.setParentT.execute(args);
      case "get_blocks": return this.getBlocksT.execute(args);
      case "update_block": return this.updateBlockT.execute(args);
      case "delete_block": return this.deleteBlockT.execute(args);
      default: return unknownAction("notion", action, ["create_page", "append", "search", "set_parent", "get_blocks", "update_block", "delete_block"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. memory — Sapphire's standing facts (Architect's preferences, decisions, tracked items)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class MemoryTool implements Tool {
  private rememberT = new RememberFactTool();
  private recallT = new RecallFactsTool();
  private coreViewT = new CoreMemoryViewTool();
  private coreAppendT = new CoreMemoryAppendTool();
  private coreReplaceT = new CoreMemoryReplaceTool();
  private archivalInsertT = new ArchivalInsertTool();
  private archivalSearchT = new ArchivalSearchTool();
  private supersedeT = new SupersedeMemoryTool();
  // Phase 6 — temporal graph
  private entityUpsertT = new EntityUpsertTool();
  private entityGetT = new EntityGetTool();
  private relateT = new RelateTool();
  private unrelateT = new UnrelateTool();
  private graphQueryT = new GraphQueryTool();

  definition: ToolDefinition = {
    name: "memory",
    description:
      "Memory operations across THREE layers (Letta-style memory hierarchy):\n\n" +
      "LAYER 1 — STANDING FACTS (key/value, structured):\n" +
      "• remember — save a fact. Required: key (slug like 'preferred_dentist'), value. Optional: category.\n" +
      "• recall — retrieve facts by keyword/category. Optional: keyword, category, limit.\n\n" +
      "LAYER 2 — CORE MEMORY (Sapphire-owned in-context state, ALWAYS visible to her):\n" +
      "• core_view — inspect current core memory slots. Optional: slot filter.\n" +
      "• core_append — append to a slot (creates if missing). Required: slot, text. Hard-capped at 800 chars/slot.\n" +
      "• core_replace — full replace of a slot. Required: slot, content. Use when an old understanding is no longer accurate.\n" +
      "Slot examples: 'current_priorities', 'current_projects', 'current_concerns', 'recent_themes'.\n\n" +
      "LAYER 3 — ARCHIVAL MEMORY (Sapphire-controlled Pinecone):\n" +
      "• archival_insert — write to long-term semantic memory. Required: namespace ('sapphire-personal' | 'shared' | 'sovereign-synthesis'), content, topic. Optional: metadata.\n" +
      "• archival_search — explicit search across archival namespaces. Required: query. Optional: namespace, k, include_history.\n" +
      "• supersede — mark a prior archival entry as no-longer-current (Zep-lite temporal model). Required: old_id, new_id, namespace. Optional: reason.\n\n" +
      "LAYER 4 — TEMPORAL KNOWLEDGE GRAPH (S125+ Phase 6, Zep-style in Postgres):\n" +
      "• entity_upsert — create/update a graph node. Required: name, entity_type ('person'|'project'|'task'|'place'|'organization'|'event'|'concept'|'document'). Optional: attributes.\n" +
      "• entity_get — look up an entity by name+type or by id.\n" +
      "• relate — create a relationship between two entities. AUTO-SUPERSEDES any prior currently-valid (source, type, target) edge. Use when a fact changes (Aliza switches schools, project status updates).\n" +
      "  Required: source_name, source_type, relationship_type (PARENT_OF | CHILD_OF | SIBLING_OF | PARTNER_OF | AT_SCHOOL | HAS_DOCTOR | HAS_THERAPIST | WORKS_AT | WORKS_ON | HAS_STATUS | BELONGS_TO | DEPENDS_ON | BLOCKS | OWNS | ATTENDED | SCHEDULED_FOR | OCCURRED_AT | REFERENCES | CONTRADICTS | EXTENDS | INSTANCE_OF | RELATED_TO), target_name, target_type. Optional: attributes, valid_from, supersede_reason.\n" +
      "• unrelate — close a relationship without replacing it. Required: relationship_id. Optional: reason.\n" +
      "• graph_query — traverse from a starting entity along a relationship type. 1 or 2 hops. Required: start_name, start_type, traverse. Optional: depth (1|2), include_history.\n\n" +
      "ROUTING GUIDE (4 layers):\n" +
      "• Family info structured (DOB/school/allergies/doctor) → family.save (different tool — structured fields, NOT graph)\n" +
      "• One-off facts ('preferred dentist is Dr. X') → memory.remember\n" +
      "• Current-state things ALWAYS visible ('Architect just shifted priorities') → memory.core_append/replace\n" +
      "• Long-term semantic searchable but not always-visible → memory.archival_insert\n" +
      "• When a fact CHANGES (Aliza switched schools) → memory.relate creates new edge, auto-supersedes old; OR archival_insert + supersede for unstructured\n" +
      "• Structured RELATIONSHIPS between entities ('Architect WORKS_ON Sovereign Synthesis', 'Aliza AT_SCHOOL Pacific Elementary') → memory.relate (graph)\n" +
      "• Walking relationships ('what projects does Architect work on?', 'where do the kids go to school?') → memory.graph_query, NOT a vector search",
    parameters: {
      action: {
        type: "string",
        description: "remember | recall | core_view | core_append | core_replace | archival_insert | archival_search | supersede | entity_upsert | entity_get | relate | unrelate | graph_query",
        enum: [
          "remember", "recall",
          "core_view", "core_append", "core_replace",
          "archival_insert", "archival_search", "supersede",
          "entity_upsert", "entity_get", "relate", "unrelate", "graph_query",
        ],
      },
      // Layer 1 — facts
      key: { type: "string", description: "[remember] Slug-style key." },
      value: { type: "string", description: "[remember] The fact text." },
      category: { type: "string", description: "[remember, recall] Optional category." },
      keyword: { type: "string", description: "[recall] Substring filter." },
      limit: { type: "number", description: "[recall] Max results, default 10." },
      // Layer 2 — core memory
      slot: { type: "string", description: "[core_*] Slot name." },
      text: { type: "string", description: "[core_append] Text to append." },
      content: { type: "string", description: "[core_replace, archival_insert] Content body." },
      // Layer 3 — archival
      namespace: { type: "string", description: "[archival_insert, archival_search, supersede] Pinecone namespace. Agents typically write to their own *-personal namespace; use 'shared' or 'sovereign-synthesis' for cross-cutting insights.", enum: ["sapphire-personal", "anita-personal", "yuki-personal", "vector-personal", "veritas-personal", "alfred-personal", "shared", "sovereign-synthesis"] },
      query: { type: "string", description: "[archival_search] Semantic query." },
      k: { type: "number", description: "[archival_search] Top-k results, default 5." },
      include_history: { type: "boolean", description: "[archival_search, graph_query] Include superseded entries. Default false." },
      topic: { type: "string", description: "[archival_insert] Topic tag." },
      metadata: { type: "object", description: "[archival_insert] Optional extra metadata." },
      old_id: { type: "string", description: "[supersede] Pinecone ID of the now-outdated entry." },
      new_id: { type: "string", description: "[supersede] Pinecone ID of the replacement entry." },
      reason: { type: "string", description: "[supersede, unrelate] Reason / audit note." },
      // Layer 4 — temporal knowledge graph
      name: { type: "string", description: "[entity_upsert, entity_get] Entity name." },
      entity_type: { type: "string", description: "[entity_upsert, entity_get] Entity type from controlled vocabulary.", enum: ["person", "project", "task", "place", "organization", "event", "concept", "document"] },
      attributes: { type: "object", description: "[entity_upsert, relate] Optional structured attributes (jsonb)." },
      id: { type: "string", description: "[entity_get] Look up by UUID instead of name+type." },
      source_name: { type: "string", description: "[relate] Source entity name." },
      source_type: { type: "string", description: "[relate] Source entity type.", enum: ["person", "project", "task", "place", "organization", "event", "concept", "document"] },
      relationship_type: { type: "string", description: "[relate] Edge type from controlled vocabulary.", enum: ["PARENT_OF", "CHILD_OF", "SIBLING_OF", "PARTNER_OF", "AT_SCHOOL", "HAS_DOCTOR", "HAS_THERAPIST", "WORKS_AT", "WORKS_ON", "HAS_STATUS", "BELONGS_TO", "DEPENDS_ON", "BLOCKS", "OWNS", "ATTENDED", "SCHEDULED_FOR", "OCCURRED_AT", "REFERENCES", "CONTRADICTS", "EXTENDS", "INSTANCE_OF", "RELATED_TO"] },
      target_name: { type: "string", description: "[relate] Target entity name." },
      target_type: { type: "string", description: "[relate] Target entity type.", enum: ["person", "project", "task", "place", "organization", "event", "concept", "document"] },
      valid_from: { type: "string", description: "[relate] Optional ISO8601. Default now()." },
      supersede_reason: { type: "string", description: "[relate] Audit reason if this auto-supersedes a prior edge." },
      relationship_id: { type: "string", description: "[unrelate] UUID of the relationship to close." },
      start_name: { type: "string", description: "[graph_query] Starting entity name." },
      start_type: { type: "string", description: "[graph_query] Starting entity type.", enum: ["person", "project", "task", "place", "organization", "event", "concept", "document"] },
      traverse: { type: "string", description: "[graph_query] Relationship type to follow.", enum: ["PARENT_OF", "CHILD_OF", "SIBLING_OF", "PARTNER_OF", "AT_SCHOOL", "HAS_DOCTOR", "HAS_THERAPIST", "WORKS_AT", "WORKS_ON", "HAS_STATUS", "BELONGS_TO", "DEPENDS_ON", "BLOCKS", "OWNS", "ATTENDED", "SCHEDULED_FOR", "OCCURRED_AT", "REFERENCES", "CONTRADICTS", "EXTENDS", "INSTANCE_OF", "RELATED_TO"] },
      depth: { type: "number", description: "[graph_query] 1 (direct) or 2 (friends-of-friends). Default 1." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    // agent name from ToolContext routes core/archival to per-agent storage.
    const agentName = ctx.agentName || "sapphire";
    switch (action) {
      // inject agent_name from ToolContext for actions that scope by agent.
      // Agents calling memory.core_* automatically write to THEIR own slot rows.
      // archival_* defaults to {agent}-personal namespace if not explicitly overridden.
      // Graph actions (entity_upsert/relate/etc.) operate on the SHARED graph (Phase 6 decision).
      case "remember": return this.rememberT.execute(args);
      case "recall":
        // S129b — Param remap. Narrow RecallFactsTool reads `key_match` and `max`,
        // not `keyword` / `limit`. Translate.
        return this.recallT.execute({
          query: args.query,
          category: args.category,
          key_match: args.keyword ?? args.key_match,
          max: args.limit ?? args.max,
        });
      case "core_view": return this.coreViewT.execute({ ...args, agent_name: agentName });
      case "core_append": return this.coreAppendT.execute({ ...args, agent_name: agentName });
      case "core_replace": return this.coreReplaceT.execute({ ...args, agent_name: agentName });
      case "archival_insert": return this.archivalInsertT.execute({ ...args, namespace: args.namespace || `${agentName}-personal` });
      case "archival_search": return this.archivalSearchT.execute({ ...args, namespace: args.namespace || `${agentName}-personal` });
      case "supersede": return this.supersedeT.execute(args);
      case "entity_upsert": return this.entityUpsertT.execute(args);
      case "entity_get": return this.entityGetT.execute(args);
      case "relate": return this.relateT.execute(args);
      case "unrelate": return this.unrelateT.execute(args);
      case "graph_query": return this.graphQueryT.execute(args);
      default: return unknownAction("memory", action, [
        "remember", "recall",
        "core_view", "core_append", "core_replace",
        "archival_insert", "archival_search", "supersede",
        "entity_upsert", "entity_get", "relate", "unrelate", "graph_query",
      ]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. family — daughters Aliza & Maddy, plus other family members
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class FamilyTool implements Tool {
  private saveT = new SaveFamilyMemberTool();
  private getT = new GetFamilyTool();

  definition: ToolDefinition = {
    name: "family",
    description:
      "Family-member structured memory: Aliza, Maddy, and any other relatives. ALWAYS call get before answering questions about family members — never claim 'I don't remember' without checking first (per family_first doctrine).\n\n" +
      "ACTIONS:\n" +
      "• save — create or update a family member's structured info. Required: name. Optional: relationship, dob, school, allergies, doctor, notes, current_activities, emergency_contact.\n" +
      "• get — retrieve family member info. Optional: name (returns specific member if given, else returns all).",
    parameters: {
      action: { type: "string", description: "save | get", enum: ["save", "get"] },
      name: { type: "string", description: "[save, get] Person's name (e.g. 'Aliza', 'Maddy')." },
      relationship: { type: "string", description: "[save, get] e.g. 'daughter', 'son', 'wife'." },
      dob: { type: "string", description: "[save] Date of birth (YYYY-MM-DD). Mapped to date_of_birth on save." },
      school: { type: "string", description: "[save] Current school." },
      allergies: { type: "string", description: "[save] Allergies / dietary restrictions (comma-separated)." },
      doctor: { type: "string", description: "[save] Pediatrician / primary care." },
      notes: { type: "string", description: "[save] Free-form notes." },
      current_activities: { type: "string", description: "[save] Current sports, classes, hobbies (comma-separated)." },
      emergency_contact: { type: "string", description: "[save] Backup contact name + phone." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "save":
        // S129b — Param remap. Narrow SaveFamilyMemberTool reads `date_of_birth`, not `dob`.
        return this.saveT.execute({
          name: args.name,
          relationship: args.relationship,
          date_of_birth: args.dob ?? args.date_of_birth,
          school: args.school,
          allergies: args.allergies,
          doctor: args.doctor,
          notes: args.notes,
          current_activities: args.current_activities,
          emergency_contact: args.emergency_contact,
        });
      case "get": return this.getT.execute(args);
      default: return unknownAction("family", action, ["save", "get"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. followups — anticipatory circle-backs ("circle back to me on X in 3 days")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class FollowupsTool implements Tool {
  private recordT = new RecordFollowupTool();
  private listT = new ListFollowupsTool();
  private completeT = new CompleteFollowupTool();
  private cancelT = new CancelFollowupTool();

  definition: ToolDefinition = {
    name: "followups",
    description:
      "Architect-flagged anticipatory circle-backs. Distinct from reminders (clock-driven) and conditional_reminders (metric-driven) — these are 'remind me about X around when Y happens / by deadline Z' threads Sapphire surfaces proactively.\n\n" +
      "ACTIONS:\n" +
      "• record — log a new followup. Required: topic, due_at. Optional: detail, source_excerpt.\n" +
      "• list — show outstanding followups. Optional: keyword filter.\n" +
      "• complete — mark a followup done. Required: id.\n" +
      "• cancel — remove a followup. Required: id.\n\n" +
      "Trigger words from Architect: 'circle back', 'come back to', 'follow up on', 'check on', 'looking out for', 'in a few days', 'by next week', 'when X is done'.",
    parameters: {
      action: { type: "string", description: "record | list | complete | cancel", enum: ["record", "list", "complete", "cancel"] },
      topic: { type: "string", description: "[record] Short label for the followup." },
      detail: { type: "string", description: "[record] Optional longer detail." },
      due_at: { type: "string", description: "[record] When to surface (ISO8601 or natural)." },
      source_excerpt: { type: "string", description: "[record] Optional quote from the conversation that triggered it." },
      id: { type: "string", description: "[complete, cancel] Followup ID." },
      keyword: { type: "string", description: "[list] Filter by keyword." },
      limit: { type: "number", description: "[list] Max results, default 20." },
      status: { type: "string", description: "[list] Filter by status (pending | done | cancelled). Default pending.", enum: ["pending", "done", "cancelled"] },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "record": return this.recordT.execute(args);
      case "list":
        // S129b — narrow ListFollowupsTool reads `limit` and `status`; expose them.
        return this.listT.execute({
          limit: args.limit,
          status: args.status,
        });
      case "complete": return this.completeT.execute(args);
      case "cancel": return this.cancelT.execute(args);
      default: return unknownAction("followups", action, ["record", "list", "complete", "cancel"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. research — web search, YouTube search, transcript, PDF, deeper research brief
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ResearchTool implements Tool {
  private briefT = new ResearchBriefTool();
  private pdfT = new AnalyzePdfTool();
  private webT = new WebSearchTool();
  private ytSearchT = new YoutubeSearchTool();
  private ytTranscriptT = new YoutubeTranscriptTool();

  definition: ToolDefinition = {
    name: "research",
    description:
      "Multi-source research operations. NOTE: web_search is also available as Anthropic's NATIVE server tool (Claude can invoke it without going through this client tool); prefer the native one when reasoning during a turn. Use this client web_search for fallback paths or when on Gemini/Groq.\n\n" +
      "ACTIONS:\n" +
      "• web_search — Gemini-grounded web search returning prose + source URLs. Required: query.\n" +
      "• youtube_search — structured YouTube video search returning {title, videoId, url, channelTitle}. Required: query. Optional: max_results (default 5), order ('relevance' | 'date' | 'rating' | 'viewCount'). PREFER this over web_search when Architect asks for video content — returns clickable URLs, not prose.\n" +
      "• youtube_transcript — fetch a YouTube video's transcript. Required: url.\n" +
      "• analyze_pdf — extract structured info from a PDF (dates, names, addresses, amounts, links). Required: file_path or attachment_id.\n" +
      "• research_brief — DuckDuckGo scrape + summarize for heavier background. Required: topic. Optional: depth ('shallow' | 'deep').\n\n" +
      "Curation: when relaying results, filter for substance over entertainment (per concept_mode in warm_concise format). Documentary > clickbait.",
    parameters: {
      action: { type: "string", description: "web_search | youtube_search | youtube_transcript | analyze_pdf | research_brief",
        enum: ["web_search", "youtube_search", "youtube_transcript", "analyze_pdf", "research_brief"] },
      query: { type: "string", description: "[web_search, youtube_search] Search query." },
      url: { type: "string", description: "[youtube_transcript] YouTube video URL." },
      file_path: { type: "string", description: "[analyze_pdf] PDF file path on disk." },
      attachment_id: { type: "string", description: "[analyze_pdf] Telegram attachment ID (mapped to file_id on dispatch)." },
      focus: { type: "string", description: "[analyze_pdf] What to extract: 'all' | 'dates' | 'addresses' | 'amounts' | 'links' | free-form. Default 'all'." },
      topic: { type: "string", description: "[research_brief] Topic to research." },
      depth: { type: "string", description: "[research_brief] 'shallow' or 'deep'.", enum: ["shallow", "deep"] },
      max_results: { type: "number", description: "[youtube_search] Max results (1-10), default 5." },
      order: { type: "string", description: "[youtube_search] Result order.", enum: ["relevance", "date", "rating", "viewCount"] },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "web_search": return this.webT.execute(args);
      case "youtube_search": return this.ytSearchT.execute(args);
      case "youtube_transcript": return this.ytTranscriptT.execute(args);
      case "analyze_pdf":
        // S129b — Param remap. AnalyzePdfTool reads `file_id` and `focus`,
        // not `attachment_id`. Translate; file_path passes through.
        return this.pdfT.execute({
          file_id: args.attachment_id ?? args.file_id,
          file_path: args.file_path,
          focus: args.focus,
        });
      case "research_brief": return this.briefT.execute(args);
      default: return unknownAction("research", action, ["web_search", "youtube_search", "youtube_transcript", "analyze_pdf", "research_brief"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. mission_control — file briefings + propose tasks + create-task orchestrator
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class MissionControlTool implements Tool {
  private briefingT = new FileBriefingTool("sapphire");
  private proposeT = new ProposeTaskTool("sapphire");
  private createTaskT = new CreateTaskForAceTool();

  definition: ToolDefinition = {
    name: "mission_control",
    description:
      "Surface tools for Architect's Mission Control dashboard at sovereign-mission-control.vercel.app. NEVER use notion.create_page to fulfill an MC request — that creates Notion pages titled 'Mission Control' instead of writing to MC's data layer.\n\n" +
      "ACTIONS:\n" +
      "• file_briefing — write a narrative report / status update / analysis. Required: title, body. Optional: category.\n" +
      "• propose_task — propose a single task that needs Architect review. Required: title, why. Optional: priority.\n" +
      "• create_task — THE ORCHESTRATOR. Writes to ClickUp + tasks table + today's Notion Daily Tasks & Goals page in one call. Use this when Architect gives you something he wants done. Required: title, description, priority ('High' | 'Medium' | 'Low'), category. (See task_creation_workflow doctrine.)",
    parameters: {
      action: { type: "string", description: "file_briefing | propose_task | create_task", enum: ["file_briefing", "propose_task", "create_task"] },
      title: { type: "string", description: "[all] Title of the briefing/task/proposal." },
      body: { type: "string", description: "[file_briefing] Narrative body." },
      why: { type: "string", description: "[propose_task] Why this matters." },
      description: { type: "string", description: "[create_task] Task description." },
      priority: { type: "string", description: "[propose_task, create_task] 'High' | 'Medium' | 'Low'.", enum: ["High", "Medium", "Low"] },
      category: { type: "string", description: "[file_briefing, create_task] Category tag." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "file_briefing": return this.briefingT.execute(args);
      case "propose_task": return this.proposeT.execute(args);
      case "create_task": return this.createTaskT.execute(args);
      default: return unknownAction("mission_control", action, ["file_briefing", "propose_task", "create_task"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. self — Sapphire's own persona/format/identity-history pieces (self-modification)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class SelfTool implements Tool {
  private setPieceT = new SetPieceTool();
  private removePieceT = new RemovePieceTool();
  private createPieceT = new CreatePieceTool();
  private listPiecesT = new ListPiecesTool();
  private viewPromptT = new ViewSelfPromptTool();
  private viewHistoryT = new ViewIdentityHistoryTool();

  definition: ToolDefinition = {
    name: "self",
    description:
      "Sapphire's self-modification surface. Architect uses these to swap her persona, format, scenario, emotions, or extras pieces — or invent new ones. Phase 3 (S125+) doctrine pieces (signal_discipline_s125, personal_intelligence_ace) demonstrate the pattern.\n\n" +
      "ACTIONS:\n" +
      "• set_piece — switch which piece is active for a section. Required: section ('persona' | 'goals' | 'format' | 'scenario' | 'extras' | 'emotions' | 'relationship'), key.\n" +
      "• remove_piece — deactivate a piece (multi-value sections only). Required: section, key.\n" +
      "• create_piece — author a new piece. Required: section, key, body.\n" +
      "• list_pieces — list available pieces. Optional: section filter.\n" +
      "• view_self_prompt — show Sapphire's currently-assembled system prompt.\n" +
      "• view_identity_history — show timeline of identity changes.",
    parameters: {
      action: { type: "string", description: "set_piece | remove_piece | create_piece | list_pieces | view_self_prompt | view_identity_history",
        enum: ["set_piece", "remove_piece", "create_piece", "list_pieces", "view_self_prompt", "view_identity_history"] },
      section: { type: "string", description: "[set_piece, remove_piece, create_piece, list_pieces, view_identity_history] Section name.",
        enum: ["persona", "goals", "format", "scenario", "extras", "emotions", "relationship"] },
      key: { type: "string", description: "[set_piece, remove_piece, create_piece] Piece key (slug)." },
      body: { type: "string", description: "[create_piece] Piece body text (mapped to 'value' on dispatch)." },
      limit: { type: "number", description: "[view_identity_history] Max history entries, default 20." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "set_piece": return this.setPieceT.execute(args);
      case "remove_piece": return this.removePieceT.execute(args);
      case "create_piece":
        // S129b — Param remap. Narrow CreatePieceTool reads `value`, not `body`.
        return this.createPieceT.execute({
          section: args.section,
          key: args.key,
          value: args.body ?? args.value,
        });
      case "list_pieces": return this.listPiecesT.execute(args);
      case "view_self_prompt": return (this.viewPromptT.execute as any)();
      case "view_identity_history": return this.viewHistoryT.execute(args);
      default: return unknownAction("self", action, ["set_piece", "remove_piece", "create_piece", "list_pieces", "view_self_prompt", "view_identity_history"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. learning — feedback loop to Claude (request_code_change, log email verdicts)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class LearningTool implements Tool {
  private logEmailT = new LogEmailClassificationTool();
  private requestCodeT = new RequestCodeChangeTool();
  private listDeferredT = new ListDeferredBuildsTool();

  definition: ToolDefinition = {
    name: "learning",
    description:
      "Feedback loop tools. When Architect surfaces a behavior gap or a noise pattern, route it here so Claude can pick it up next session.\n\n" +
      "ACTIONS:\n" +
      "• log_email_classification — log Architect's verdict on an alerted email. Required: subject, sender, verdict ('noise' | 'important' | 'urgent' | 'unsure'), reasoning. Triggers NOISE_PATTERN_DETECTED at 5+ noise verdicts from same sender_domain.\n" +
      "• request_code_change — file a deferred build for Claude. Required: category, title, why_it_matters, recommended_fix. Use whenever Architect says 'flag this for Claude' / 'file a code change'.\n" +
      "• list_deferred_builds — show pending code-change requests waiting for Claude.",
    parameters: {
      action: { type: "string", description: "log_email_classification | request_code_change | list_deferred_builds",
        enum: ["log_email_classification", "request_code_change", "list_deferred_builds"] },
      subject: { type: "string", description: "[log_email_classification] Email subject." },
      sender: { type: "string", description: "[log_email_classification] Sender email." },
      verdict: { type: "string", description: "[log_email_classification] Architect's verdict.",
        enum: ["noise", "important", "urgent", "unsure"] },
      reasoning: { type: "string", description: "[log_email_classification] Architect's reason." },
      snippet: { type: "string", description: "[log_email_classification] Optional first ~500 chars of the email body for pattern context." },
      category: { type: "string", description: "[request_code_change] e.g. 'watcher_filter', 'tool_gap', 'doctrine'." },
      title: { type: "string", description: "[request_code_change] Title of the change." },
      why_it_matters: { type: "string", description: "[request_code_change] Justification." },
      recommended_fix: { type: "string", description: "[request_code_change] Suggested fix." },
      what_was_tried: { type: "string", description: "[request_code_change] Optional — what Sapphire already attempted before deferring." },
      related_subjects: { type: "array", description: "[request_code_change] Optional — related email subjects/cases that motivated this.", items: { type: "string", description: "subject or case ID" } },
      limit: { type: "number", description: "[list_deferred_builds] Max entries, default 20." },
      status: { type: "string", description: "[list_deferred_builds] Filter by status. Default 'pending'.", enum: ["pending", "shipped", "wontfix"] },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "log_email_classification": return this.logEmailT.execute(args);
      case "request_code_change": return this.requestCodeT.execute(args);
      case "list_deferred_builds": return this.listDeferredT.execute(args);
      default: return unknownAction("learning", action, ["log_email_classification", "request_code_change", "list_deferred_builds"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. plan — multi-step plan/workflow orchestration (when Architect gives a complex goal)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class PlanTool implements Tool {
  private createT = new CreatePlanTool();
  private approveT = new ApprovePlanTool();
  private advanceT = new AdvancePlanTool();
  private recordStepT = new RecordStepResultTool();
  private executeT = new ExecuteWorkflowTool();
  private recordArtifactT = new RecordWorkflowArtifactTool();
  private cancelT = new CancelPlanTool();

  definition: ToolDefinition = {
    name: "plan",
    description:
      "Multi-step plan orchestration. Use when Architect gives you a complex goal that requires sequenced steps and dependencies (per complex_task_protocol doctrine).\n\n" +
      "ACTIONS:\n" +
      "• create — start a new plan. Required: goal, steps (array of {title, description}). Returns plan_id.\n" +
      "• approve — confirm the plan and begin execution. Required: plan_id.\n" +
      "• advance — move to the next step. Required: plan_id.\n" +
      "• record_step — record a step's result. Required: plan_id, step_index, result.\n" +
      "• execute — run a registered workflow (mesh pattern). Required: plan_id.\n" +
      "• record_artifact — store a workflow output. Required: plan_id, target_name, artifact (JSON-serializable).\n" +
      "• cancel — abort a plan. Required: plan_id, reason.",
    parameters: {
      action: { type: "string", description: "create | approve | advance | record_step | execute | record_artifact | cancel",
        enum: ["create", "approve", "advance", "record_step", "execute", "record_artifact", "cancel"] },
      goal: { type: "string", description: "[create] What the plan aims to achieve." },
      steps: { type: "array", description: "[create] Array of step objects.", items: { type: "object", description: "{title, description}" } },
      plan_id: { type: "string", description: "[approve, advance, record_step, execute, record_artifact, cancel] Plan ID." },
      step_index: { type: "number", description: "[record_step] Zero-indexed step (mapped to step_idx on dispatch)." },
      result: { type: "string", description: "[record_step] Step result." },
      target_name: { type: "string", description: "[record_artifact] Logical name of the workflow step that produced the artifact." },
      artifact: { type: "string", description: "[record_artifact] JSON-stringified artifact payload." },
      artifact_id: { type: "string", description: "[record_artifact] (deprecated alias — use 'target_name' + 'artifact' instead)." },
      content: { type: "string", description: "[record_artifact] (deprecated alias — use 'artifact' instead)." },
      reason: { type: "string", description: "[cancel] Reason for cancellation." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "create": return this.createT.execute(args);
      case "approve": return this.approveT.execute(args);
      case "advance": return this.advanceT.execute(args);
      case "record_step":
        // S129b — Param remap. Narrow RecordStepResultTool reads `step_idx`, not `step_index`.
        return this.recordStepT.execute({
          plan_id: args.plan_id,
          step_idx: args.step_index ?? args.step_idx,
          result: args.result,
        });
      case "execute": return this.executeT.execute(args);
      case "record_artifact":
        // S129b — Param remap. Narrow RecordWorkflowArtifactTool reads `artifact` and `target_name`,
        // not `artifact_id` / `content`. Accept both name styles.
        return this.recordArtifactT.execute({
          plan_id: args.plan_id,
          target_name: args.target_name ?? args.artifact_id,
          artifact: args.artifact ?? args.content,
        });
      case "cancel": return this.cancelT.execute(args);
      default: return unknownAction("plan", action, ["create", "approve", "advance", "record_step", "execute", "record_artifact", "cancel"]);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 13. diary — Sapphire's reflective journal (significance tracking, evening wraps)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class DiaryTool implements Tool {
  private writeT = new WriteDiaryEntryTool();
  private readT = new ReadDiaryTool();
  private signifT = new ReadSignificanceTool();

  definition: ToolDefinition = {
    name: "diary",
    description:
      "Sapphire's reflective journal — what she noticed today, anniversary echoes, significance tracking, post-turn reflection. Used by evening wrap + morning brief schedulers but also callable directly when Architect asks 'what did you notice today' / 'on this date last year' / 'reflect on this week'.\n\n" +
      "ACTIONS:\n" +
      "• write — log a diary entry. Required: text. Optional: tags (array), date (default today).\n" +
      "• read — retrieve recent entries. Optional: days_back (default 7), tag filter, limit.\n" +
      "• read_significance — find anniversary/significance hits for a date. Optional: date (default today).\n" +
      "• reflect — S125+ Phase 5C: post-turn reflection (Reflexion paper pattern). Sapphire briefly reviews her own substantive turn — what worked, what didn't, takeaway. Auto-tagged 'reflection'. Required: turn_summary (1 sentence on the user's request), what_worked, what_didnt, takeaway (~1-2 lines each). Use ONLY on substantive/exploratory turns, NOT on quick transactional ones (would be noise).",
    parameters: {
      action: { type: "string", description: "write | read | read_significance | reflect", enum: ["write", "read", "read_significance", "reflect"] },
      text: { type: "string", description: "[write] Diary text." },
      tags: { type: "array", description: "[write] Optional tags.", items: { type: "string", description: "tag" } },
      date: { type: "string", description: "[write, read_significance] ISO date." },
      days_back: { type: "number", description: "[read] Lookback window, default 7." },
      tag: { type: "string", description: "[read] Filter by tag." },
      limit: { type: "number", description: "[read] Max entries." },
      turn_summary: { type: "string", description: "[reflect] One-sentence summary of what Architect asked for this turn." },
      what_worked: { type: "string", description: "[reflect] What landed well in the response." },
      what_didnt: { type: "string", description: "[reflect] What missed or could be better." },
      takeaway: { type: "string", description: "[reflect] Lesson to carry forward." },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(args.action || "").toLowerCase();
    // per-agent diary via ctx.agentName
    const agentName = ctx.agentName || "sapphire";
    const argsWithAgent = { ...args, agent_name: agentName };
    switch (action) {
      case "write": return this.writeT.execute(argsWithAgent);
      case "read": return this.readT.execute(argsWithAgent);
      case "read_significance": return this.signifT.execute(argsWithAgent);
      case "reflect": {
        const turnSummary = String(args.turn_summary || "").trim();
        const worked = String(args.what_worked || "").trim();
        const didnt = String(args.what_didnt || "").trim();
        const takeaway = String(args.takeaway || "").trim();
        if (!turnSummary || !takeaway) {
          return "diary reflect: turn_summary and takeaway required (Reflexion-pattern post-turn reflection).";
        }
        const reflectionText =
          `[reflection] ${turnSummary}\n` +
          `  ✓ ${worked || "(nothing surfaced)"}\n` +
          `  ✗ ${didnt || "(nothing missed)"}\n` +
          `  → ${takeaway}`;
        // column is `entry`, not `text`. Bug from Phase 5.
        return this.writeT.execute({
          entry: reflectionText,
          tags: ["reflection"],
          agent_name: agentName,
        });
      }
      default: return unknownAction("diary", action, ["write", "read", "read_significance", "reflect"]);
    }
  }
}
