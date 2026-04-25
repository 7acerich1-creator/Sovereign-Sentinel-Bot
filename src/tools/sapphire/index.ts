// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Personal Assistant Tools (Index)
// Single import surface for all Sapphire PA tools.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { SetReminderTool, ListRemindersTool, CancelReminderTool } from "./reminders";
import { GmailInboxTool, GmailSearchTool, GmailSendTool, GmailDraftTool } from "./gmail";
import { CalendarListTool, CalendarCreateEventTool, CalendarRescheduleTool } from "./calendar";
import { NotionCreatePageTool, NotionAppendToPageTool, NotionSearchTool, NotionSetParentPageTool } from "./notion";
import { RememberFactTool, RecallFactsTool } from "./facts";
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
};

// ── Bundle factory — returns all 16 PA tools ───────────────────────────────
export function buildSapphirePATools(): Tool[] {
  return [
    new SetReminderTool(),
    new ListRemindersTool(),
    new CancelReminderTool(),
    new GmailInboxTool(),
    new GmailSearchTool(),
    new GmailSendTool(),
    new GmailDraftTool(),
    new CalendarListTool(),
    new CalendarCreateEventTool(),
    new CalendarRescheduleTool(),
    new NotionCreatePageTool(),
    new NotionAppendToPageTool(),
    new NotionSearchTool(),
    new NotionSetParentPageTool(),
    new RememberFactTool(),
    new RecallFactsTool(),
  ];
}
