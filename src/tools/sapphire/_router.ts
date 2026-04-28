// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Tool Tiering + Intent Router
// Session 114 (S114r) — 2026-04-25
//
// Per Anthropic + research findings: don't load all 27 tools every message.
// Default = 8 core tools (~2000 tokens). Specialist tiers load only when
// the message intent matches keyword patterns. Drops always-loaded context
// by ~5000 tokens. This is the canonical "Tool Search Tool" pattern adapted
// to keyword routing (no extra LLM call needed for classification).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool } from "../../types";
import {
  SetReminderTool, ListRemindersTool, CancelReminderTool,
  GmailInboxTool, GmailSearchTool, GmailSendTool, GmailDraftTool,
  CalendarListTool, CalendarCreateEventTool, CalendarRescheduleTool,
  NotionCreatePageTool, NotionAppendToPageTool, NotionSearchTool, NotionSetParentPageTool,
  RememberFactTool, RecallFactsTool,
  AnalyzePdfTool,
  ResearchBriefTool,
  SaveFamilyMemberTool, GetFamilyTool,
  CreatePlanTool, ApprovePlanTool, AdvancePlanTool, RecordStepResultTool, CancelPlanTool,
  AddNewsSourceTool, RemoveNewsSourceTool, ListNewsSourcesTool,
  SetPieceTool, RemovePieceTool, CreatePieceTool, ListPiecesTool, ViewSelfPromptTool, ViewIdentityHistoryTool,
  RecordFollowupTool, ListFollowupsTool, CompleteFollowupTool, CancelFollowupTool,
  WriteDiaryEntryTool, ReadDiaryTool, ReadSignificanceTool,
  ReadTeamRosterTool,
} from "./index";

// ── TIER definitions ───────────────────────────────────────────────────────

/** Always loaded — the 8 most-frequent PA tools. ~2000 token budget. */
function tierCore(): Tool[] {
  return [
    new SetReminderTool(),
    new ListRemindersTool(),
    new CancelReminderTool(),
    new GmailInboxTool(),
    new CalendarListTool(),
    new RememberFactTool(),
    new RecallFactsTool(),
    new NotionAppendToPageTool(),
  ];
}

/** Email composition (search/send/draft) — when message implies sending email. */
function tierEmailWrite(): Tool[] {
  return [new GmailSearchTool(), new GmailSendTool(), new GmailDraftTool()];
}

/** Calendar mutations — when message implies adding/moving events. */
function tierCalendarWrite(): Tool[] {
  return [new CalendarCreateEventTool(), new CalendarRescheduleTool()];
}

/** Notion non-append — page creation, search, parent setup. */
function tierNotion(): Tool[] {
  return [new NotionCreatePageTool(), new NotionSearchTool(), new NotionSetParentPageTool()];
}

/** Family profile management. */
function tierFamily(): Tool[] {
  return [new SaveFamilyMemberTool(), new GetFamilyTool()];
}

/** PDF + research. PDF auto-injected when document attached. */
function tierDocs(): Tool[] {
  return [new AnalyzePdfTool(), new ResearchBriefTool()];
}

/** Multi-step planner meta-tools. */
function tierPlanner(): Tool[] {
  return [
    new CreatePlanTool(),
    new ApprovePlanTool(),
    new AdvancePlanTool(),
    new RecordStepResultTool(),
    new CancelPlanTool(),
  ];
}

/** News source management (rare — only when explicitly configuring). */
function tierNews(): Tool[] {
  return [new AddNewsSourceTool(), new RemoveNewsSourceTool(), new ListNewsSourcesTool()];
}

/** Self-modification (Phase 3) — only when Ace asks her to change herself or
 *  she's noticing a meta-state (mood, mode, loop). */
function tierSelfMod(): Tool[] {
  return [
    new SetPieceTool(),
    new RemovePieceTool(),
    new CreatePieceTool(),
    new ListPiecesTool(),
    new ViewSelfPromptTool(),
    new ViewIdentityHistoryTool(),
  ];
}

/** S121 — Anticipatory followups. Loaded when Ace promises to circle back / mentions a deadline / asks to be reminded about a thread. */
function tierFollowups(): Tool[] {
  return [
    new RecordFollowupTool(),
    new ListFollowupsTool(),
    new CompleteFollowupTool(),
    new CancelFollowupTool(),
  ];
}

/** S121 — Diary + significance. Loaded for evening wraps, "what did you notice", or "anniversary" type asks. */
function tierDiary(): Tool[] {
  return [
    new WriteDiaryEntryTool(),
    new ReadDiaryTool(),
    new ReadSignificanceTool(),
  ];
}

/** S121d — Team roster lookup. Loaded whenever team composition / who-does-what comes up. */
function tierRoster(): Tool[] {
  return [new ReadTeamRosterTool()];
}

// ── Intent matchers ─────────────────────────────────────────────────────────
// Keyword + regex matchers per tier. False positives are cheap (extra tool
// loaded), false negatives are bad (right tool unavailable). So err on the
// side of including a tier when ambiguous.

interface TierMatcher {
  name: string;
  match: (text: string, hasAttachment: boolean) => boolean;
  load: () => Tool[];
}

const MATCHERS: TierMatcher[] = [
  {
    name: "email_write",
    match: (t) =>
      /\b(send|draft|reply|email .+ to|reply to|forward|@\S+\.\w+)\b/i.test(t)
      || /\bemail\b.*\b(to|about|saying|telling)\b/i.test(t),
    load: tierEmailWrite,
  },
  {
    name: "calendar_write",
    match: (t) =>
      /\b(schedule|add to (my )?calendar|book|set up (a )?meeting|create (an? )?event|reschedule|move (my|the) [\w ]*meeting|put .+ on (my )?calendar)\b/i.test(t),
    load: tierCalendarWrite,
  },
  {
    name: "notion",
    match: (t) =>
      /\b(notion|notes? page|find (my|the) note|search (my )?notes?|create (a )?page|new page|share (a |the )?page)\b/i.test(t),
    load: tierNotion,
  },
  {
    name: "family",
    match: (t) =>
      /\b(daughter|son|wife|husband|partner|spouse|kid|kids|child|children|family|mom|dad|mother|father|sister|brother|grandparent|nephew|niece|aunt|uncle|cousin|allerg|pediatrician|school|nanny|babysit|birthday|bday|bdays|dob)\b/i.test(t)
      // Also match common names already saved as family — Aliza, Maddy
      || /\b(aliza|maddy|maya)\b/i.test(t),
    load: tierFamily,
  },
  {
    name: "docs",
    match: (t, hasAtt) =>
      hasAtt
      || /\b(research|background[- ]check|look up|find out about|what'?s the (going )?rate|who is|what (does|is) [\w ]+ company|investigate)\b/i.test(t)
      || /\b(pdf|document|attached|contract|statement|flyer|invoice|receipt)\b/i.test(t),
    load: tierDocs,
  },
  {
    name: "planner",
    match: (t) =>
      /\b(plan (my|a|the) [\w ]+|approve (the )?plan|advance (the )?plan|next step|cancel (the )?plan|step \d+ done|multi[- ]step)\b/i.test(t)
      || /\bplan (my )?(anniversary|birthday|trip|vacation|party|wedding|move|launch|event)\b/i.test(t),
    load: tierPlanner,
  },
  {
    name: "news",
    match: (t) =>
      /\b(news source|rss|subscribe to news|add news|remove news|list (my )?news|news feeds?)\b/i.test(t),
    load: tierNews,
  },
  {
    name: "self_mod",
    match: (t) =>
      /\b(your (persona|mood|emotion|format|scenario|prompt|setup|configuration)|how are you (set up|configured)|change your(self)?|switch (to|your)|update your prompt|view your prompt|list your pieces|create (a )?(new )?piece|set piece|remove piece)\b/i.test(t)
      // Also when Ace tells her she's stuck in a pattern or asks her to be different
      || /\b(stop being|be more|tone (it )?down|tone up|loosen up|be quieter|be louder|drop the closing|skip the italic)\b/i.test(t)
      // S121: identity history / evolution narrative requests
      || /\b(your (history|evolution|changes|journey)|how have you changed|how you'?ve grown|show me your (log|history|changes|evolution)|when did you (become|switch|change)|view (your )?identity|identity log|identity history|history command|\/history)\b/i.test(t),
    load: tierSelfMod,
  },
  {
    name: "followups",
    match: (t) =>
      /\b(circle back|come back to|remind me about|follow ?up|loop back|check on|chase up|looking out for|waiting on|tracking|in (a |the )?(few|couple) (days|weeks|hours)|by (next|this) (week|month)|deadline|when (it|that)'?s done)\b/i.test(t)
      || /\b(list (my|the) follow ?ups?|cancel (a |the )?follow ?up|done with [\w ]+ followup|complete (the )?follow ?up)\b/i.test(t),
    load: tierFollowups,
  },
  {
    name: "diary",
    match: (t) =>
      /\b(diary|journal|what did you notice|wrap up the day|evening wrap|end of day|reflect on (today|this week)|on this (date|day) (in|years? ago)|a year ago today|what'?s significant)\b/i.test(t)
      || /\b(write down|note (that|to yourself)|log (an? )?(observation|reflection))\b/i.test(t),
    load: tierDiary,
  },
  {
    // S121d — load whenever Ace asks about team composition or any agent's role.
    // Sapphire's baked-in picture is stale (Buffer/X dead, TikTok/IG deferred,
    // roles shifted post-S119) — she MUST call read_team_roster to refresh.
    name: "roster",
    match: (t) =>
      /\b(team|crew|maven|roster|who('?s| is) on|who does|who handles|tell me about (yuki|veritas|alfred|vector|anita|sapphire)|what does (yuki|veritas|alfred|vector|anita) do|the (full )?(team|crew) (structure|breakdown|layout)|agents)\b/i.test(t),
    load: tierRoster,
  },
];

// ── Public API ──────────────────────────────────────────────────────────────

export interface TieredToolSelection {
  tools: Tool[];
  loadedTiers: string[];
  toolCount: number;
  approxTokens: number;
}

/**
 * Select tools to load for a Sapphire DM message. Always includes core,
 * conditionally adds specialist tiers based on intent.
 */
export function selectToolsForMessage(
  userMessage: string,
  hasAttachment: boolean,
): TieredToolSelection {
  const text = userMessage || "";
  const tools: Tool[] = tierCore();
  const loadedTiers: string[] = ["core"];

  for (const m of MATCHERS) {
    if (m.match(text, hasAttachment)) {
      tools.push(...m.load());
      loadedTiers.push(m.name);
    }
  }

  // Approx token estimate: each tool def is ~200-300 tokens (name + desc + params)
  const approxTokens = tools.length * 250;

  return { tools, loadedTiers, toolCount: tools.length, approxTokens };
}
