// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Multi-Step Planner Meta-Tool (Gap 10)
// Session 114 (S114n) — 2026-04-25
//
// The "plan my anniversary" pattern. Sapphire decomposes a complex goal into
// 3-8 ordered steps, persists to sapphire_plans, returns the plan for Ace to
// approve. After approval, advance_plan executes one step at a time.
// Plan state survives Railway redeploys (it's in Supabase).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

const ACE_CHAT_ID = String(config.telegram.authorizedUserIds[0] || "");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CREATE PLAN — write a numbered plan, awaiting Ace's approval
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CreatePlanTool implements Tool {
  definition: ToolDefinition = {
    name: "create_plan",
    description:
      "Decompose a multi-step goal into 3-8 ordered steps. Use when Ace asks for something that requires several actions in sequence (book flight, reserve hotel, set reminders, draft notes). Returns the plan ID and a numbered list. Ace must call approve_plan before steps execute.",
    parameters: {
      goal: { type: "string", description: "What Ace wants accomplished, in plain English." },
      steps: {
        type: "string",
        description: "Numbered list of steps you want to take. Each step on its own line, prefixed with a number. Example: '1. Search flights HOU→AUS Friday morning under $400\\n2. Reserve top option\\n3. Book hotel near airport\\n4. Set reminder 2h before departure\\n5. Add to calendar'",
      },
    },
    required: ["goal", "steps"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const goal = String(args.goal || "").trim();
    const stepsRaw = String(args.steps || "").trim();
    if (!goal) return "create_plan: goal required.";
    if (!stepsRaw) return "create_plan: steps required.";

    const steps = stepsRaw
      .split("\n")
      .map((s) => s.replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean);
    if (steps.length === 0) return "create_plan: parsed zero steps.";
    if (steps.length > 12) return "create_plan: too many steps (max 12). Break into smaller plans.";

    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("sapphire_plans")
      .insert({
        goal,
        steps: steps.map((text, i) => ({ idx: i + 1, text, done: false })),
        chat_id: ACE_CHAT_ID,
        status: "awaiting_approval",
      })
      .select("id")
      .single();

    if (error) return `create_plan: ${error.message}`;

    const lines = steps.map((s, i) => `${i + 1}. ${s}`);
    return `Plan drafted (id ${data.id.slice(0, 8)}):\n\nGoal: ${goal}\n\nSteps:\n${lines.join("\n")}\n\nApprove with: approve_plan plan_id="${data.id}". Cancel with: cancel_plan plan_id="${data.id}".`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APPROVE PLAN — Ace gives go-ahead, status flips to approved
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ApprovePlanTool implements Tool {
  definition: ToolDefinition = {
    name: "approve_plan",
    description: "Mark a plan as approved by Ace so steps can execute. Use when Ace says 'approved', 'go ahead', 'yes do it' on a draft plan.",
    parameters: { plan_id: { type: "string", description: "Plan UUID or 8-char prefix." } },
    required: ["plan_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idRaw = String(args.plan_id || "").trim();
    if (!idRaw) return "approve_plan: plan_id required.";
    const supabase = await getSupabase();

    let q = supabase.from("sapphire_plans").select("id, goal").eq("status", "awaiting_approval");
    if (idRaw.length === 8) q = q.ilike("id", `${idRaw}%`); else q = q.eq("id", idRaw);
    const { data: rows } = await q.limit(1);
    if (!rows || rows.length === 0) return `approve_plan: no awaiting plan matches "${idRaw}".`;

    const fullId = rows[0].id;
    const { error } = await supabase
      .from("sapphire_plans")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", fullId);
    if (error) return `approve_plan: ${error.message}`;
    return `Plan approved: "${rows[0].goal}". Ready to execute. Use advance_plan to run the next step.`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADVANCE PLAN — return the next pending step text + bumps current_step
// (Sapphire then calls the appropriate domain tool for that step)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class AdvancePlanTool implements Tool {
  definition: ToolDefinition = {
    name: "advance_plan",
    description: "Get the next step of an approved plan to execute. Returns the step text — you then call the appropriate tool to do it (set_reminder, calendar_create_event, gmail_draft, etc), and call record_step_result to mark it done.",
    parameters: { plan_id: { type: "string", description: "Plan UUID or 8-char prefix." } },
    required: ["plan_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idRaw = String(args.plan_id || "").trim();
    if (!idRaw) return "advance_plan: plan_id required.";
    const supabase = await getSupabase();

    let q = supabase.from("sapphire_plans").select("*").in("status", ["approved", "executing"]);
    if (idRaw.length === 8) q = q.ilike("id", `${idRaw}%`); else q = q.eq("id", idRaw);
    const { data: rows } = await q.limit(1);
    if (!rows || rows.length === 0) return `advance_plan: no executable plan matches "${idRaw}".`;

    const plan = rows[0] as any;
    const steps = plan.steps as Array<{ idx: number; text: string; done: boolean }>;
    const next = steps.find((s) => !s.done);
    if (!next) {
      await supabase.from("sapphire_plans").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", plan.id);
      return `Plan complete: "${plan.goal}". All steps done.`;
    }

    if (plan.status === "approved") {
      await supabase.from("sapphire_plans").update({ status: "executing" }).eq("id", plan.id);
    }

    return `Next step (${next.idx}/${steps.length}): ${next.text}\n\nExecute this with the appropriate tool, then call record_step_result with plan_id="${plan.id}" step_idx=${next.idx} result="<what happened>".`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RECORD STEP RESULT — mark a step done with its outcome
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RecordStepResultTool implements Tool {
  definition: ToolDefinition = {
    name: "record_step_result",
    description: "Mark a plan step as done with its outcome. Call after executing each step.",
    parameters: {
      plan_id: { type: "string", description: "Plan UUID or 8-char prefix." },
      step_idx: { type: "number", description: "Which step number (1-based)." },
      result: { type: "string", description: "What happened. One sentence." },
    },
    required: ["plan_id", "step_idx", "result"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idRaw = String(args.plan_id || "").trim();
    const stepIdx = Number(args.step_idx);
    const result = String(args.result || "").trim();
    if (!idRaw || !stepIdx || !result) return "record_step_result: plan_id, step_idx, result all required.";

    const supabase = await getSupabase();
    let q = supabase.from("sapphire_plans").select("*");
    if (idRaw.length === 8) q = q.ilike("id", `${idRaw}%`); else q = q.eq("id", idRaw);
    const { data: rows } = await q.limit(1);
    if (!rows || rows.length === 0) return `record_step_result: no plan matches "${idRaw}".`;

    const plan = rows[0] as any;
    const steps = (plan.steps as Array<{ idx: number; text: string; done: boolean }>).map((s) =>
      s.idx === stepIdx ? { ...s, done: true } : s,
    );
    const results = [...(plan.results || []), { step_idx: stepIdx, result, ts: new Date().toISOString() }];

    const allDone = steps.every((s) => s.done);
    const update: Record<string, unknown> = { steps, results, current_step: stepIdx };
    if (allDone) {
      update.status = "completed";
      update.completed_at = new Date().toISOString();
    }

    const { error } = await supabase.from("sapphire_plans").update(update).eq("id", plan.id);
    if (error) return `record_step_result: ${error.message}`;
    return allDone ? `Step ${stepIdx} done. Plan COMPLETE: "${plan.goal}".` : `Step ${stepIdx} done. ${steps.length - stepIdx} step(s) remaining. Call advance_plan for next.`;
  }
}

export class CancelPlanTool implements Tool {
  definition: ToolDefinition = {
    name: "cancel_plan",
    description: "Cancel a pending or in-progress plan.",
    parameters: { plan_id: { type: "string", description: "Plan UUID or 8-char prefix." } },
    required: ["plan_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idRaw = String(args.plan_id || "").trim();
    if (!idRaw) return "cancel_plan: plan_id required.";
    const supabase = await getSupabase();
    let q = supabase.from("sapphire_plans").update({ status: "cancelled" });
    if (idRaw.length === 8) {
      const { data } = await supabase.from("sapphire_plans").select("id").ilike("id", `${idRaw}%`).limit(1);
      if (!data || data.length === 0) return `cancel_plan: no plan matches "${idRaw}".`;
      q = q.eq("id", data[0].id);
    } else {
      q = q.eq("id", idRaw);
    }
    const { error } = await q;
    if (error) return `cancel_plan: ${error.message}`;
    return `Plan cancelled.`;
  }
}
