// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Agent Swarms
// Spawn specialized sub-agents that collaborate on complex tasks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from "crypto";
import type { LLMProvider, LLMMessage, Tool, ToolDefinition } from "../types";

interface SwarmAgent {
  id: string;
  role: string;
  systemPrompt: string;
  tools: Tool[];
}

interface SwarmResult {
  agentId: string;
  role: string;
  output: string;
  tokensUsed: number;
}

const AGENT_TEMPLATES: Record<string, { systemPrompt: string }> = {
  researcher: {
    systemPrompt: "You are a research specialist. Gather information, verify facts, and provide comprehensive analysis. Use available tools to search and retrieve data.",
  },
  coder: {
    systemPrompt: "You are a coding specialist. Write clean, efficient code. Read files, understand context, and produce working implementations.",
  },
  reviewer: {
    systemPrompt: "You are a quality reviewer. Analyze work product for errors, improvements, and consistency. Provide constructive feedback.",
  },
  strategist: {
    systemPrompt: "You are a strategic advisor for the Sovereign Synthesis mission. Analyze opportunities, risks, and provide actionable recommendations aligned with the $1.2M objective.",
  },
  writer: {
    systemPrompt: "You are a content specialist. Write engaging, high-velocity content that transmits the Firmware Update. Match the Sovereign Synthesis voice and lexicon.",
  },
};

export class AgentSwarm {
  private llm: LLMProvider;
  private availableTools: Tool[];

  constructor(llm: LLMProvider, tools: Tool[]) {
    this.llm = llm;
    this.availableTools = tools;
  }

  async runSwarm(
    goal: string,
    agentRoles: string[] = ["researcher", "coder", "reviewer"]
  ): Promise<string> {
    console.log(`🐝 Swarm initiated: ${agentRoles.join(", ")} — Goal: ${goal.slice(0, 100)}`);

    const results: SwarmResult[] = [];

    // Phase 1: Each agent works on the goal
    for (const role of agentRoles) {
      const template = AGENT_TEMPLATES[role] || { systemPrompt: `You are a ${role} specialist.` };

      const prompt = results.length > 0
        ? `Goal: ${goal}\n\nPrevious agent outputs:\n${results.map((r) => `[${r.role}]: ${r.output.slice(0, 1000)}`).join("\n\n")}\n\nBuild on the previous work. Add your specialized perspective.`
        : `Goal: ${goal}\n\nYou are the first agent in this swarm. Provide your specialized analysis.`;

      try {
        const response = await this.llm.generate(
          [{ role: "user", content: prompt }],
          { systemPrompt: template.systemPrompt, maxTokens: 2000 }
        );

        results.push({
          agentId: randomUUID().slice(0, 8),
          role,
          output: response.content,
          tokensUsed: response.usage?.totalTokens || 0,
        });

        console.log(`✅ Swarm agent [${role}] complete — ${response.usage?.totalTokens || 0} tokens`);
      } catch (err: any) {
        results.push({
          agentId: randomUUID().slice(0, 8),
          role,
          output: `Agent error: ${err.message}`,
          tokensUsed: 0,
        });
      }
    }

    // Phase 2: Synthesize results
    const synthesisPrompt = `Synthesize the following agent outputs into a final, cohesive response.

Goal: ${goal}

${results.map((r) => `--- ${r.role.toUpperCase()} ---\n${r.output}`).join("\n\n")}

Produce a unified response that combines the best insights from each agent. Be direct and actionable.`;

    const synthesis = await this.llm.generate(
      [{ role: "user", content: synthesisPrompt }],
      { systemPrompt: "You are a synthesis engine. Combine multiple perspectives into one clear output.", maxTokens: 3000 }
    );

    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0) + (synthesis.usage?.totalTokens || 0);
    console.log(`🐝 Swarm complete — ${results.length} agents — ${totalTokens} total tokens`);

    return synthesis.content;
  }
}

// ── Swarm Tool ──
export class SwarmTool implements Tool {
  private swarm: AgentSwarm;

  constructor(swarm: AgentSwarm) {
    this.swarm = swarm;
  }

  definition: ToolDefinition = {
    name: "run_swarm",
    description: "Deploy a swarm of specialized AI agents to collaboratively solve a complex task. Available roles: researcher, coder, reviewer, strategist, writer.",
    parameters: {
      goal: { type: "string", description: "The goal or task for the swarm to accomplish" },
      agents: { type: "string", description: "Comma-separated agent roles (default: researcher,coder,reviewer)" },
    },
    required: ["goal"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const goal = String(args.goal);
    const agents = args.agents ? String(args.agents).split(",").map((a) => a.trim()) : undefined;
    return this.swarm.runSwarm(goal, agents);
  }
}
