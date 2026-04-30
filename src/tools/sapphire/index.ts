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
// S125+ Phase 2 — Conditional/threshold-triggered reminders. Architect's
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

// ── Modular Packs for Selective Tool Tiering (S121) ──────────────────────

// Core Pack (Reminders, Notion, Memory, Mission Control) — the essentials
// S125c added FileBriefingTool + ProposeTaskTool so "send to Mission Control"
// has a tool that actually writes to the MC data layer (Supabase briefings/tasks
// tables read by sovereign-mission-control.vercel.app). Without these she was
// pattern-matching MC requests onto NotionCreatePageTool and creating private
// Notion pages titled "Mission Control" instead of filing in MC.
export function buildSapphireCoreTools(): Tool[] {
  return [
    new SetReminderTool(),
    new ListRemindersTool(),
    new CancelReminderTool(),
    new CancelReminderSeriesTool(),
    new NotionCreatePageTool(),
    new NotionAppendToPageTool(),
    new NotionSearchTool(),
    new NotionGetBlocksTool(),
    new NotionUpdateBlockTool(),
    new NotionDeleteBlockTool(),
    new RememberFactTool(),
    new RecallFactsTool(),
    new FileBriefingTool("sapphire"),
    new ProposeTaskTool("sapphire"),
    new WebSearchTool(),
    new LogEmailClassificationTool(),
    new RequestCodeChangeTool(),
    new ListDeferredBuildsTool(),
    new CreateTaskForAceTool(),
    new ConditionalRemindersTool(),
  ];
}

// Workflow Pack (The 'Make' Protocol)
export function buildSapphireWorkflowTools(): Tool[] {
  return [
    new CreatePlanTool(),
    new ApprovePlanTool(),
    new AdvancePlanTool(),
    new RecordStepResultTool(),
    new ExecuteWorkflowTool(),
    new RecordWorkflowArtifactTool(),
    new CancelPlanTool(),
  ];
}

// Research Pack (Search, Fetch, Briefs)
// S125+ Phase 2: YoutubeSearchTool added — closes the gap where "is there a YouTube
// video showing X?" had no structured-URL-returning tool. Sapphire should prefer
// youtube_search over web_search when Architect explicitly asks for video content.
export function buildSapphireResearchTools(): Tool[] {
  return [
    new ResearchBriefTool(),
    new YoutubeTranscriptTool(),
    new YoutubeSearchTool(),
  ];
}

// Life Pack (Gmail, Calendar, Family) — HEAVY TOOLS
// Load these only when managing schedules/comms.
export function buildSapphireLifeTools(): Tool[] {
  return [
    new GmailInboxTool(),
    new GmailSearchTool(),
    new GmailSendTool(),
    new GmailDraftTool(),
    new CalendarListTool(),
    new CalendarCreateEventTool(),
    new CalendarRescheduleTool(),
    new SaveFamilyMemberTool(),
    new GetFamilyTool(),
  ];
}
