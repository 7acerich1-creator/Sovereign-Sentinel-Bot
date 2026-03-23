// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Mesh Workflows
// /mesh <goal> → decompose → plan → execute → report
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider, Tool, ToolDefinition } from "../types";
import { AgentLoop } from "./loop";

interface MeshStep {
  id: number;
  description: string;
  status: "pending" | "running" | "done" | "failed";
  output?: string;
  dependsOn?: number[];
}

export class MeshWorkflow {
  private llm: LLMProvider;
  private agentLoop: AgentLoop;

  constructor(llm: LLMProvider, agentLoop: AgentLoop) {
    this.llm = llm;
    this.agentLoop = agentLoop;
  }

  async execute(goal: string, reportProgress: (msg: string) => Promise<void>): Promise<string> {
    // Step 1: Decompose goal into subtasks
    await reportProgress("🔮 *Decomposing goal into subtasks...*");

    const planResponse = await this.llm.generate(
      [{ role: "user", content: `Decompose this goal into 3-7 concrete, sequential subtasks. Return ONLY a numbered list, one task per line.\n\nGoal: ${goal}` }],
      { systemPrompt: "You are a task decomposition engine. Output only numbered subtasks.", maxTokens: 500 }
    );

    const steps: MeshStep[] = planResponse.content
      .split("\n")
      .filter((line) => /^\d+[\.\)]\s/.test(line.trim()))
      .map((line, i) => ({
        id: i + 1,
        description: line.replace(/^\d+[\.\)]\s*/, "").trim(),
        status: "pending" as const,
      }));

    if (steps.length === 0) {
      return "Could not decompose the goal into subtasks.";
    }

    await reportProgress(
      `📋 *Mesh Plan (${steps.length} steps):*\n${steps.map((s) => `${s.id}. ${s.description}`).join("\n")}`
    );

    // Step 2: Execute each subtask
    const outputs: string[] = [];
    for (const step of steps) {
      step.status = "running";
      await reportProgress(`⚡ Step ${step.id}/${steps.length}: ${step.description}`);

      try {
        const stepPrompt = `Complete this specific subtask as part of a larger workflow.\n\nOverall Goal: ${goal}\n\nCurrent Step: ${step.description}\n\nPrevious steps completed:\n${outputs.map((o, i) => `Step ${i + 1}: ${o.slice(0, 200)}`).join("\n")}\n\nComplete this step and provide the result.`;

        const response = await this.llm.generate(
          [{ role: "user", content: stepPrompt }],
          { maxTokens: 1500 }
        );

        step.output = response.content;
        step.status = "done";
        outputs.push(response.content);
      } catch (err: any) {
        step.status = "failed";
        step.output = `Error: ${err.message}`;
        outputs.push(`(failed: ${err.message})`);
      }
    }

    // Step 3: Synthesize final report
    const report = steps.map((s) =>
      `**Step ${s.id}** (${s.status}): ${s.description}\n${s.output?.slice(0, 500) || "(no output)"}`
    ).join("\n\n");

    const completed = steps.filter((s) => s.status === "done").length;
    const failed = steps.filter((s) => s.status === "failed").length;

    return `🏗️ *MESH WORKFLOW COMPLETE*\n\n` +
      `Goal: ${goal}\n` +
      `Results: ${completed}/${steps.length} completed, ${failed} failed\n\n` +
      report;
  }
}

export class MeshTool implements Tool {
  private mesh: MeshWorkflow;
  private reportFn: ((msg: string) => Promise<void>) | null = null;

  constructor(mesh: MeshWorkflow) {
    this.mesh = mesh;
  }

  setReporter(fn: (msg: string) => Promise<void>): void {
    this.reportFn = fn;
  }

  definition: ToolDefinition = {
    name: "mesh_workflow",
    description: "Decompose a complex goal into subtasks, plan execution order, run each step, and report progress.",
    parameters: {
      goal: { type: "string", description: "The complex goal to accomplish" },
    },
    required: ["goal"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const report = this.reportFn || (async (msg: string) => console.log(msg));
    return this.mesh.execute(String(args.goal), report);
  }
}
