// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Learning Loop Tools (S125k, 2026-04-29)
//
// Two tools that let Sapphire be honest about her limits and accumulate
// signal toward code changes:
//
// 1. log_email_classification — when an email alert fires and Ace
//    classifies it ("noise", "important", "urgent", "unsure"), Sapphire
//    records the pattern. Detects when 5+ "noise" classifications match a
//    sender or subject pattern, then proactively offers to file a code change.
//
// 2. request_code_change — when Sapphire identifies a system-level
//    limitation that can't be fixed from her tool surface (a scheduled
//    job behavior, a missing tool, a watcher's filter logic), she files
//    it to the deferred_builds table so it surfaces next time Ace works
//    with Claude on code.
//
// Architecture: Sapphire is the LEARNING LAYER between simple rule-based
// watchers and Ace's actual preferences. Watchers stay simple. Sapphire
// learns. Ace + Claude ship code based on what she learned.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


import type { Tool, ToolDefinition } from "../../types";
import { getSapphireSupabase } from "./_supabase";

// Extract email domain from "Name <user@domain.com>" or "user@domain.com"
function extractDomain(sender: string): string {
  const m = sender.match(/@([\w.-]+)/);
  return m ? m[1].toLowerCase() : sender.slice(0, 60);
}

// ━━━ LOG EMAIL CLASSIFICATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class LogEmailClassificationTool implements Tool {
  definition: ToolDefinition = {
    name: "log_email_classification",
    description:
      "Record Ace's verdict on an email alert that fired. Use when an email-watcher alert surfaced a message and Ace replied with his read on it (noise/important/urgent/unsure). " +
      "After logging, this checks whether the same sender_domain has 5+ 'noise' classifications. If so, returns a NOISE_PATTERN_DETECTED signal so you can offer to file a code change via request_code_change.\n\n" +
      "Examples:\n" +
      "• Watcher surfaced 'HubSpot 2FA reminder' → Ace says 'just noise, ignore those' → log_email_classification(subject='Check your 2FA backup codes', sender='HubSpot', verdict='noise', reasoning='auto-generated 2FA reminder, not actionable')\n" +
      "• Watcher surfaced an email from a school → Ace says 'YES important, school stuff always' → log_email_classification(subject='...', sender='principal@school.edu', verdict='important', reasoning='school sender, always important')",
    parameters: {
      subject: { type: "string", description: "Email subject as it appeared in the alert" },
      sender: { type: "string", description: "Email sender (e.g. 'HubSpot' or 'noreply@hubspot.com' or 'Name <addr>')" },
      verdict: { type: "string", description: "Ace's read: 'noise' | 'important' | 'urgent' | 'unsure'" },
      reasoning: { type: "string", description: "Why Ace gave that verdict (helps detect patterns later). Optional but valuable." },
      snippet: { type: "string", description: "Optional. A short excerpt of the email body if available, for pattern matching." },
    },
    required: ["subject", "sender", "verdict"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const subject = String(args.subject || "").trim().slice(0, 300);
    const sender = String(args.sender || "").trim().slice(0, 200);
    const verdict = String(args.verdict || "").trim().toLowerCase();
    const reasoning = args.reasoning ? String(args.reasoning).trim().slice(0, 500) : null;
    const snippet = args.snippet ? String(args.snippet).trim().slice(0, 500) : null;
    if (!subject) return "log_email_classification: subject is required.";
    if (!sender) return "log_email_classification: sender is required.";
    if (!["noise", "important", "urgent", "unsure"].includes(verdict)) {
      return "log_email_classification: verdict must be noise|important|urgent|unsure.";
    }
    const senderDomain = extractDomain(sender);
    const supabase = await getSapphireSupabase();

    const { error } = await supabase.from("email_classifications").insert({
      subject, sender, sender_domain: senderDomain, verdict, reasoning, snippet,
    });
    if (error) return `log_email_classification: ${error.message}`;

    // Pattern detection: same sender_domain, 5+ noise verdicts → flag
    if (verdict === "noise") {
      const { count } = await supabase
        .from("email_classifications")
        .select("*", { count: "exact", head: true })
        .eq("sender_domain", senderDomain)
        .eq("verdict", "noise");
      if ((count ?? 0) >= 5) {
        return `Logged. NOISE_PATTERN_DETECTED — sender_domain "${senderDomain}" has ${count} noise classifications. Offer Ace: "We've now flagged ${count} emails from ${senderDomain} as noise. Want me to file a code change so Claude can update the watcher's filter to exclude them?"`;
      }
      if ((count ?? 0) >= 3) {
        return `Logged. (${count} noise verdicts now logged for ${senderDomain} — pattern emerging, threshold for code-change offer is 5.)`;
      }
    }
    return `Logged Ace's "${verdict}" verdict on "${subject.slice(0, 60)}" from ${senderDomain}.`;
  }
}



// ━━━ REQUEST CODE CHANGE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RequestCodeChangeTool implements Tool {
  definition: ToolDefinition = {
    name: "request_code_change",
    description:
      "File a code-change request for the architect to ship next session with Claude. Use when you identify a system limitation you can't fix from your tool surface alone — a scheduled-job behavior, a missing tool, a watcher's filter logic, an API integration gap. The entry persists in deferred_builds table so it surfaces later when Ace works with Claude.\n\n" +
      "Use this REGULARLY — every time you notice 'I can't do X from chat alone,' file it. Better to over-log than to silently fail. Ace explicitly wants this; it's how the system gets smarter.\n\n" +
      "Examples:\n" +
      "• 5+ noise classifications from same sender → request_code_change(title='Add HubSpot domain to email watcher exclusion list', category='watcher_filter', why_it_matters='5 HubSpot emails classified as noise; watcher keeps surfacing them', what_was_tried='Logged each one, no tool to disable per-sender', recommended_fix='Add HUBSPOT_NOISE_DOMAINS env var or hardcode exclusion in isPriorityEmail() function')\n" +
      "• Ace asks for behavior I can't enforce → request_code_change(title='Add disable_email_triage tool to Sapphire surface', category='tool_gap', why_it_matters='Ace asked me to stop email alerts; I have no tool to disable the watcher', what_was_tried='Agreed conversationally, watcher kept firing', recommended_fix='Add email_triage_enabled flag to sapphire_known_facts; have runEmailTriagePoll check it')",
    parameters: {
      title: { type: "string", description: "Short title of the code change. Imperative voice. e.g. 'Add HubSpot to email noise exclusions'." },
      category: { type: "string", description: "watcher_filter | tool_gap | scheduled_job | prompt_rule | data_schema | other" },
      why_it_matters: { type: "string", description: "Concrete reason this matters. Reference patterns, counts, Ace's stated need." },
      what_was_tried: { type: "string", description: "Optional. What you tried first that didn't work, to save the architect debugging time." },
      recommended_fix: { type: "string", description: "Optional but valuable. Your best guess at the surgical fix — file path, function name, env var, etc." },
      related_subjects: { type: "array", description: "Optional. Array of strings — email subjects, related ids — for context." },
    },
    required: ["title", "category", "why_it_matters"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const title = String(args.title || "").trim().slice(0, 200);
    const category = String(args.category || "other").trim().slice(0, 60);
    const why = String(args.why_it_matters || "").trim().slice(0, 1500);
    const tried = args.what_was_tried ? String(args.what_was_tried).trim().slice(0, 1500) : null;
    const fix = args.recommended_fix ? String(args.recommended_fix).trim().slice(0, 1500) : null;
    const related = Array.isArray(args.related_subjects)
      ? (args.related_subjects as any[]).map((s) => String(s).slice(0, 200)).slice(0, 20)
      : null;

    if (!title) return "request_code_change: title required.";
    if (!why) return "request_code_change: why_it_matters required.";

    const supabase = await getSapphireSupabase();
    const { data, error } = await supabase
      .from("deferred_builds")
      .insert({
        title,
        category,
        why_it_matters: why,
        what_was_tried: tried,
        recommended_fix: fix,
        related_subjects: related,
        filed_by: "sapphire",
      })
      .select("id, filed_at")
      .single();

    if (error) return `request_code_change: ${error.message}`;
    return `Filed code-change request: "${title}". ID: ${(data as any).id}. Category: ${category}. Will surface next time Ace works with Claude.`;
  }
}

// ━━━ LIST DEFERRED BUILDS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ListDeferredBuildsTool implements Tool {
  definition: ToolDefinition = {
    name: "list_deferred_builds",
    description:
      "List code-change requests filed via request_code_change. Use when Ace asks 'what have you flagged for Claude' / 'show me the backlog' / 'what code changes are pending'. Defaults to status=pending.",
    parameters: {
      status: { type: "string", description: "Optional. pending | in_review | shipped | rejected. Default: pending." },
      limit: { type: "number", description: "Optional. Max entries. Default 20." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const status = args.status ? String(args.status).trim().toLowerCase() : "pending";
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const supabase = await getSapphireSupabase();
    const { data, error } = await supabase
      .from("deferred_builds")
      .select("id, title, category, why_it_matters, recommended_fix, filed_at, status")
      .eq("status", status)
      .order("filed_at", { ascending: false })
      .limit(limit);
    if (error) return `list_deferred_builds: ${error.message}`;
    if (!data || data.length === 0) return `No deferred builds with status="${status}".`;

    const lines = (data as any[]).map((b, i) => {
      const when = new Date(b.filed_at).toLocaleString("en-US", {
        timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      return `${i + 1}. [${b.category}] ${b.title}\n   Filed ${when} • Why: ${b.why_it_matters.slice(0, 140)}${b.recommended_fix ? `\n   Fix: ${b.recommended_fix.slice(0, 140)}` : ""}`;
    });
    return `Deferred builds (status=${status}, ${data.length} total):\n\n${lines.join("\n\n")}`;
  }
}
