// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Personal Assistant Tools (Index)
// Single import surface for all Sapphire PA tools.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { SetReminderTool, ListRemindersTool, CancelReminderTool } from "./reminders";
import { GmailInboxTool, GmailSearchTool, GmailSendTool, GmailDraftTool } from "./gmail";
import { CalendarListTool, CalendarCreateEventTool, CalendarRescheduleTool } from "./calendar";
import { NotionCreatePageTool, NotionAppendToPageTool, NotionSearchTool, NotionSetParentPageTool } from "./notion";
import { RememberFactTool, RecallFactsTool } from "./facts";
import { AnalyzePdfTool } from "./pdf";
import { ResearchBriefTool } from "./research";
import { SaveFamilyMemberTool, GetFamilyTool } from "./family";
import { CreatePlanTool, ApprovePlanTool, AdvancePlanTool, RecordStepResultTool, CancelPlanTool } from "./planner";
import { AddNewsSourceTool, RemoveNewsSourceTool, ListNewsSourcesTool } from "./news";
import { SetPieceTool, RemovePieceTool, CreatePieceTool, ListPiecesTool, ViewSelfPromptTool } from "./self_mod";
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
};

// ── Bundle factory — returns all 27 PA tools ───────────────────────────────
export function buildSapphirePATools(): Tool[] {
  return [
    // Reminders (3)
    new SetReminderTool(),
    new ListRemindersTool(),
    new CancelReminderTool(),
    // Gmail (4)
    new GmailInboxTool(),
    new GmailSearchTool(),
    new GmailSendTool(),
    new GmailDraftTool(),
    // Calendar (3)
    new CalendarListTool(),
    new CalendarCreateEventTool(),
    new CalendarRescheduleTool(),
    // Notion (4)
    new NotionCreatePageTool(),
    new NotionAppendToPageTool(),
    new NotionSearchTool(),
    new NotionSetParentPageTool(),
    // Memory (2)
    new RememberFactTool(),
    new RecallFactsTool(),
    // Documents (1) — Gap 2
    new AnalyzePdfTool(),
    // Research (1) — Gap 3
    new ResearchBriefTool(),
    // Family (2) — Gap 8
    new SaveFamilyMemberTool(),
    new GetFamilyTool(),
    // Multi-step planner meta-tools (5) — Gap 10
    new CreatePlanTool(),
    new ApprovePlanTool(),
    new AdvancePlanTool(),
    new RecordStepResultTool(),
    new CancelPlanTool(),
    // News brief management (3) — Gap 7
    new AddNewsSourceTool(),
    new RemoveNewsSourceTool(),
    new ListNewsSourcesTool(),
    // Self-modification meta tools (5) — S114u ddxfish pattern
    new SetPieceTool(),
    new RemovePieceTool(),
    new CreatePieceTool(),
    new ListPiecesTool(),
    new ViewSelfPromptTool(),
  ];
}
