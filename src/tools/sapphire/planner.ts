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
      "Decompose a multi-step goal into a 'Makefile' style workflow. Identifies targets, dependencies, and recipes. Returns a plan ID. Use when Ace asks for something complex. After this, Ace approves, then you call execute_workflow.",
    parameters: {
      goal: { type: "string", description: "What Ace wants accomplished." },
      steps: {
        type: "string",
        description: "Numbered list of steps. MANDATORY: For research, analysis, or data compilation, use 'BURST EXECUTION'. This means executing all steps immediately in one session. Do NOT schedule research over days. Example: '1. [TARGET] Search BlueSky accounts (Immediate)\\n2. Extract bios (Immediate) Needs: 1\\n3. [TARGET] Compile Notion Hub (Immediate) Needs: 2'",
      },
    },
    required: ["goal", "steps"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const goal = String(args.goal || "").trim();
    const stepsRaw = String(args.steps || "").trim();
    if (!goal) return "create_plan: goal required.";

    const steps = stepsRaw.split("\n").map(s => s.trim()).filter(Boolean);
    const supabase = await getSupabase();

    // Create parent plan
    const { data: plan, error: planError } = await supabase
      .from("sapphire_plans")
      .insert({ goal, chat_id: ACE_CHAT_ID, status: "awaiting_approval", steps: steps.map((s, i) => ({ idx: i+1, text: s, done: false })) })
      .select("id")
      .single();

    if (planError) return `create_plan: ${planError.message}`;

    // Create workflow steps (The Makefile)
    const workflowSteps = steps.map((s, i) => {
      const isTarget = s.includes("[TARGET]");
      const depsMatch = s.match(/Needs:\s*(\d+)/);
      const deps = depsMatch ? [depsMatch[1]] : [];
      return {
        plan_id: plan.id,
        target_name: s.replace(/\[TARGET\]|Needs:\s*\d+/g, "").trim(),
        dependencies: deps,
        recipe: `Execute Step ${i+1}: ${s}`,
        status: "stale"
      };
    });

    const { error: wfError } = await supabase.from("sapphire_workflow_steps").insert(workflowSteps);
    if (wfError) console.warn(`[Planner] Warning: workflow steps table might not exist: ${wfError.message}`);

    return `Plan drafted (id ${plan.id.slice(0, 8)}). Workflow targets locked. Waiting for Ace to approve_plan.`;
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

export class ExecuteWorkflowTool implements Tool {
  definition: ToolDefinition = {
    name: "execute_workflow",
    description: "Autonomously advance a workflow using 'Make' logic. Identifies the first stale target with all dependencies built, and provides the recipe. Use when Ace says 'do it' or 'continue' on a plan.",
    parameters: { plan_id: { type: "string", description: "Plan UUID or 8-char prefix." } },
    required: ["plan_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idRaw = String(args.plan_id || "").trim();
    const supabase = await getSupabase();

    let q = supabase.from("sapphire_plans").select("id, status").in("status", ["approved", "executing"]);
    if (idRaw.length === 8) q = q.ilike("id", `${idRaw}%`); else q = q.eq("id", idRaw);
    const { data: plans } = await q.limit(1);
    if (!plans || plans.length === 0) return `execute_workflow: no executable plan matches "${idRaw}".`;

    const planId = plans[0].id;

    // Fetch steps
    const { data: steps } = await supabase.from("sapphire_workflow_steps").select("*").eq("plan_id", planId);
    if (!steps || steps.length === 0) return `execute_workflow: no workflow steps found for plan ${planId}. Use advance_plan for legacy plans.`;

    // Dependency check loop
    const builtIds = new Set(steps.filter(s => s.status === "built").map((s, i) => String(i + 1)));
    const nextStep = steps.find(s => s.status === "stale" && (s.dependencies as string[]).every(d => builtIds.has(d)));

    if (!nextStep) {
      const allDone = steps.every(s => s.status === "built");
      if (allDone) {
        await supabase.from("sapphire_plans").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", planId);
        return `Workflow complete. All targets built for plan ${planId.slice(0, 8)}.`;
      }
      return `Workflow stalled. All remaining steps have unfulfilled dependencies. Check step statuses.`;
    }

    await supabase.from("sapphire_workflow_steps").update({ status: "building" }).eq("id", nextStep.id);
    if (plans[0].status === "approved") await supabase.from("sapphire_plans").update({ status: "executing" }).eq("id", planId);

    return `TARGET: ${nextStep.target_name}\nRECIPE: ${nextStep.recipe}\n\nExecute this target, then call record_workflow_artifact with plan_id="${planId.slice(0, 8)}" target_name="${nextStep.target_name}" artifact="{...results}"`;
  }
}

export class RecordWorkflowArtifactTool implements Tool {
  definition: ToolDefinition = {
    name: "record_workflow_artifact",
    description: "Mark a workflow target as 'built' and store its artifact. This persists data across session restarts.",
    parameters: {
      plan_id: { type: "string", description: "Plan UUID or 8-char prefix." },
      target_name: { type: "string", description: "Name of the target step being built." },
      artifact: { type: "string", description: "JSON string of findings, results, or data." }
    },
    required: ["plan_id", "target_name", "artifact"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const idRaw = String(args.plan_id || "").trim();
    const targetName = String(args.target_name || "").trim();
    const artifactRaw = String(args.artifact || "{}");
    const supabase = await getSupabase();

    let q = supabase.from("sapphire_workflow_steps").select("id").eq("target_name", targetName);
    if (idRaw.length === 8) q = q.ilike("plan_id", `${idRaw}%`); else q = q.eq("plan_id", idRaw);
    const { data: steps } = await q.limit(1);

    if (!steps || steps.length === 0) return `record_workflow_artifact: target "${targetName}" not found for plan ${idRaw}.`;

    const artifact = JSON.parse(artifactRaw);
    const { error } = await supabase.from("sapphire_workflow_steps")
      .update({ status: "built", artifact, updated_at: new Date().toISOString() })
      .eq("id", steps[0].id);

    if (error) return `record_workflow_artifact: ${error.message}`;
    return `Target "${targetName}" built and artifact stored. Use execute_workflow to build the next target.`;
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
