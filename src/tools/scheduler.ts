// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Scheduled Tasks
// Cron expressions, natural language scheduling, list/pause/delete
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from "crypto";
import type { ScheduledTask, Tool, ToolDefinition } from "../types";

export class Scheduler {
  private tasks: Map<string, ScheduledTask & { timer?: NodeJS.Timeout }> = new Map();

  add(task: Omit<ScheduledTask, "id">): string {
    const id = randomUUID().slice(0, 8);
    const fullTask: ScheduledTask & { timer?: NodeJS.Timeout } = { ...task, id };

    if (task.intervalMs) {
      fullTask.timer = setInterval(async () => {
        if (!fullTask.enabled) return;
        try {
          await fullTask.handler();
          fullTask.nextRun = new Date(Date.now() + (task.intervalMs || 0));
        } catch (err: any) {
          console.error(`Scheduled task ${id} (${task.name}) failed:`, err.message);
        }
      }, task.intervalMs);
    }

    this.tasks.set(id, fullTask);
    console.log(`⏰ Scheduled: ${task.name} (${id}) — ${task.intervalMs ? `every ${task.intervalMs / 1000}s` : task.cron || "manual"}`);
    return id;
  }

  remove(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.timer) clearInterval(task.timer);
    this.tasks.delete(id);
    console.log(`🗑️ Removed scheduled task: ${task.name} (${id})`);
    return true;
  }

  pause(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.enabled = false;
    return true;
  }

  resume(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.enabled = true;
    return true;
  }

  list(): Array<{ id: string; name: string; enabled: boolean; nextRun: Date }> {
    return Array.from(this.tasks.values()).map((t) => ({
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      nextRun: t.nextRun,
    }));
  }

  async runNow(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    await task.handler();
  }

  shutdown(): void {
    for (const task of this.tasks.values()) {
      if (task.timer) clearInterval(task.timer);
    }
    this.tasks.clear();
  }
}

// ── Scheduler Tool (expose to LLM) ──
export class SchedulerTool implements Tool {
  private scheduler: Scheduler;

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;
  }

  definition: ToolDefinition = {
    name: "manage_schedule",
    description: "List, pause, resume, or delete scheduled tasks.",
    parameters: {
      action: { type: "string", description: "Action: list, pause, resume, delete, run", enum: ["list", "pause", "resume", "delete", "run"] },
      taskId: { type: "string", description: "Task ID (required for pause/resume/delete/run)" },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action);
    const taskId = String(args.taskId || "");

    switch (action) {
      case "list": {
        const tasks = this.scheduler.list();
        if (tasks.length === 0) return "No scheduled tasks.";
        return tasks.map((t) =>
          `${t.id} | ${t.name} | ${t.enabled ? "ACTIVE" : "PAUSED"} | Next: ${t.nextRun.toISOString()}`
        ).join("\n");
      }
      case "pause":
        return this.scheduler.pause(taskId) ? `Paused task ${taskId}` : `Task ${taskId} not found`;
      case "resume":
        return this.scheduler.resume(taskId) ? `Resumed task ${taskId}` : `Task ${taskId} not found`;
      case "delete":
        return this.scheduler.remove(taskId) ? `Deleted task ${taskId}` : `Task ${taskId} not found`;
      case "run":
        try {
          await this.scheduler.runNow(taskId);
          return `Ran task ${taskId}`;
        } catch (err: any) {
          return `Run failed: ${err.message}`;
        }
      default:
        return `Unknown action: ${action}`;
    }
  }
}
