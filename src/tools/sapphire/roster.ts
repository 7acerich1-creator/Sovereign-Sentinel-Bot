// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Live Team Roster (S121d)
//
// Reads PERSONA_REGISTRY at runtime so Sapphire never relies on her stale
// baked-in picture of who does what. Single source of truth = personas.ts.
// When Ace asks "who's on the team" / "what does Anita do" / "tell me
// the roster" — this is what Sapphire calls.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { PERSONA_REGISTRY } from "../../agent/personas";

// Curator is absorbed/legacy per the registry comment — exclude from public roster.
const HIDDEN = new Set(["curator"]);

export class ReadTeamRosterTool implements Tool {
  definition: ToolDefinition = {
    name: "read_team_roster",
    description:
      "Read the LIVE current team roster — every Maven Crew agent's name, role, goal, and style — pulled fresh from the source-of-truth code. " +
      "Use this BEFORE describing the team to Ace, or whenever someone asks who's on the team / what does X do / tell me the crew. " +
      "Your baked-in picture of the team WILL be stale (Buffer is dead, X is dead, TikTok/IG are deferred, agents have shifted roles). " +
      "Always call this tool first when team composition or role specifics matter.",
    parameters: {
      agent: {
        type: "string",
        description: "Optional — single agent name to look up (veritas, sapphire, alfred, yuki, anita, vector). Omit to get the full crew.",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filter = args.agent ? String(args.agent).trim().toLowerCase() : null;
    const entries = Object.entries(PERSONA_REGISTRY).filter(([key]) => {
      if (HIDDEN.has(key)) return false;
      if (filter) return key === filter;
      return true;
    });

    if (entries.length === 0) {
      return filter
        ? `No agent named '${filter}' in the registry. Active agents: ${Object.keys(PERSONA_REGISTRY).filter((k) => !HIDDEN.has(k)).join(", ")}.`
        : "Roster is empty.";
    }

    const lines: string[] = [];
    lines.push(filter ? `Agent profile (${filter}):` : `📋 Maven Crew — live roster (${entries.length} active):`);
    lines.push("");
    for (const [key, p] of entries) {
      lines.push(`• ${p.name} — ${p.role}`);
      lines.push(`    Goal: ${p.goal}`);
      lines.push(`    Style: ${p.style}`);
      lines.push("");
    }
    lines.push("(Sapphire is the PA, NOT a Maven Crew operative. Crew = Yuki, Veritas, Alfred, Vector, Anita.)");
    return lines.join("\n");
  }
}
