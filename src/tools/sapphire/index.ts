// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Personal Assistant Tools (Index)
// Single import surface for all Sapphire PA tools.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { SetReminderTool, ListRemindersTool, CancelReminderTool } from "./reminders";
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
import { YoutubeTranscriptTool } from "./youtube";
import type { Tool } from "../../types";

export {
  SetReminderTool,
  ListRemindersTool,
  CancelReminderTool,
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
};

// ── Modular Packs for Selective Tool Tiering (S121) ──────────────────────

// Core Pack (Reminders, Notion, Memory) — the essentials
export function buildSapphireCoreTools(): Tool[] {
  return [
    new SetReminderTool(),
    new ListRemindersTool(),
    new CancelReminderTool(),
    new NotionCreatePageTool(),
    new NotionAppendToPageTool(),
    new NotionSearchTool(),
    new NotionGetBlocksTool(),
    new NotionUpdateBlockTool(),
    new RememberFactTool(),
    new RecallFactsTool(),
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
export function buildSapphireResearchTools(): Tool[] {
  return [
    new ResearchBriefTool(),
    new YoutubeTranscriptTool(),
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
