// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Personal Assistant Tools (Index)
// Single import surface for all Sapphire PA tools.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { SetReminderTool, ListRemindersTool, CancelReminderTool, CancelReminderSeriesTool } from "./reminders";
import { GmailInboxTool, GmailSearchTool, GmailSendTool, GmailDraftTool } from "./gmail";
import { CalendarListTool, CalendarCreateEventTool, CalendarRescheduleTool } from "./calendar";
import { NotionCreatePageTool, NotionAppendToPageTool, NotionSearchTool, NotionSetParentPageTool, NotionGetBlocksTool, NotionUpdateBlockTool, NotionDeleteBlockTool } from "./notion";
import { RememberFactTool, RecallFactsTool } from "./facts";
import { AnalyzePdfTool } from "./pdf";
import { ResearchBriefTool } from "./research";
import { SaveFamilyMemberTool, GetFamilyTool } from "./family";
import { CreatePlanTool, ApprovePlanTool, AdvancePlanTool, RecordStepResultTool, CancelPlanTool, ExecuteWorkflowTool, RecordWorkflowArtifactTool } from "./planner";
import { AddNewsSourceTool, RemoveNewsSourceTool, ListNewsSourcesTool } from "./news";
import { SetPieceTool, RemovePieceTool, CreatePieceTool, ListPiecesTool, ViewSelfPromptTool, ViewIdentityHistoryTool } from "./self_mod";
import { RecordFollowupTool, ListFollowupsTool, CompleteFollowupTool, CancelFollowupTool } from "./followups";
import { WriteDiaryEntryTool, ReadDiaryTool, ReadSignificanceTool } from "./diary";
import { ReadTeamRosterTool } from "./roster";
import { YoutubeTranscriptTool, YoutubeSearchTool } from "./youtube";
// S125c — Mission Control surface tools so "send to MC" stops routing to Notion
import { FileBriefingTool, ProposeTaskTool } from "../action-surface";
// S125g — Web search grounding so she stops hallucinating facts (Jay Kelly fix)
import { WebSearchTool } from "./web_search";
// S125k — Learning loop tools so Sapphire can be honest about her limits
// and accumulate signal toward code changes (HubSpot 2FA noise pattern + capability gaps)
import { LogEmailClassificationTool, RequestCodeChangeTool, ListDeferredBuildsTool } from "./learning";
// S125l — Task orchestrator: one tool to write a task to ClickUp + MC + Notion
// in a single call. Closes the gap where Sapphire was promising "I'll propose
// a task" and not actually calling the tool.
import { CreateTaskForAceTool } from "./task_orchestrator";
// Phase 2 — Conditional/threshold-triggered reminders. Architect's
// bank-account use case (revenue hits $X → fire alert).
import { ConditionalRemindersTool } from "./conditional_reminders";
import type { Tool } from "../../types";

export {
  SetReminderTool,
  ListRemindersTool,
  CancelReminderTool,
  CancelReminderSeriesTool,
  GmailInboxTool,
  GmailSearchTool,
  GmailSendTool,
  GmailDraftTool,
  CalendarListTool,
  CalendarCreateEventTool,
  CalendarRescheduleTool,
  NotionCreatePageTool,
  NotionAppendToPageTool,
  NotionSearchTool,
  NotionSetParentPageTool,
  NotionGetBlocksTool,
  NotionUpdateBlockTool,
  NotionDeleteBlockTool,
  RememberFactTool,
  RecallFactsTool,
  AnalyzePdfTool,
  ResearchBriefTool,
  SaveFamilyMemberTool,
  GetFamilyTool,
  CreatePlanTool,
  ApprovePlanTool,
  AdvancePlanTool,
  RecordStepResultTool,
  CancelPlanTool,
  AddNewsSourceTool,
  RemoveNewsSourceTool,
  ListNewsSourcesTool,
  SetPieceTool,
  RemovePieceTool,
  CreatePieceTool,
  ListPiecesTool,
  ViewSelfPromptTool,
  ViewIdentityHistoryTool,
  RecordFollowupTool,
  ListFollowupsTool,
  CompleteFollowupTool,
  CancelFollowupTool,
  WriteDiaryEntryTool,
  ReadDiaryTool,
  ReadSignificanceTool,
  ReadTeamRosterTool,
  YoutubeTranscriptTool,
  YoutubeSearchTool,
};

// ── S125+ Phase 4: FAT COMPOSABLE TOOL SURFACE ─────────────────────────────
//
// Sapphire's surface consolidated from 39 narrow tools to 15 fat ones.
// Each fat tool takes an `action` arg and dispatches internally to the narrow
// classes (now hidden behind the fat surface). Schema cost ~5,250 tokens vs
// ~7,500 prior; selection accuracy recovered to the 78%+ zone.
//
// The four pack functions below are kept as stubs for backward compat with
// callers in src/index.ts. All tools live in buildSapphireCoreTools now;
// Workflow/Research/Life return [] (deprecated — folded into core).
//
// Adding a new capability in Phase 4+:
//   1. Implement the narrow tool class in its domain file (notion.ts, etc.)
//   2. Add a new action to the relevant fat tool in _fat.ts
//   3. Update the fat tool's description with the action
//   That's it. No pack reshuffling needed.
// ── ─────────────────────────────────────────────────────────────────────────

import {
  RemindersTool, GmailTool, CalendarTool, NotionTool, MemoryTool, FamilyTool,
  FollowupsTool, ResearchTool, MissionControlTool, SelfTool, LearningTool,
  PlanTool, DiaryTool,
} from "./_fat";

export function buildSapphireCoreTools(): Tool[] {
  return [
    // Time / metric / followup-based proactive surfaces (3)
    new RemindersTool(),
    new ConditionalRemindersTool(),
    new FollowupsTool(),
    // Communications (2)
    new GmailTool(),
    new CalendarTool(),
    // Memory layers (2)
    new MemoryTool(),
    new FamilyTool(),
    // External knowledge surfaces (1)
    new ResearchTool(),
    // Workspace surfaces (2)
    new NotionTool(),
    new MissionControlTool(),
    // Multi-step + reflective + self-mod (3)
    new PlanTool(),
    new DiaryTool(),
    new SelfTool(),
    // Feedback loop + crew (2)
    new LearningTool(),
    new ReadTeamRosterTool(),
    // 15 tools total. Down from 39. Schema cost ~5,250 tokens. Selection
    // accuracy curve recovered (Anthropic / Jenova / Writer benchmarks).
  ];
}

// DEPRECATED stubs — all tools live in buildSapphireCoreTools now. Phase 5 may
// re-introduce specialty packs if needed (e.g. for the other crew agents).
export function buildSapphireWorkflowTools(): Tool[] { return []; }
export function buildSapphireResearchTools(): Tool[] { return []; }
export function buildSapphireLifeTools(): Tool[] { return []; }
