// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Relationship Context Tool
// Sapphire writes observations about Ace's working patterns
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolContext, ToolDefinition } from "../types";
import { config } from "../config";

/**
 * Sapphire uses this to record observations about how Ace works —
 * preferences, frustrations, patterns, wins.
 */
export class RelationshipContextTool implements Tool {
  definition: ToolDefinition = {
    name: "write_relationship_context",
    description:
      "Record an observation about how Ace works — his preferences, frustrations, patterns, or wins. Use this when you notice recurring behaviors or important moments. These observations help you calibrate your tone and approach.",
    parameters: {
      observation: {
        type: "string",
        description: "Brief observation about Ace's working style or moment (1-2 sentences)",
      },
      category: {
        type: "string",
        description: "Category: preference | frustration | pattern | win",
        enum: ["preference", "frustration", "pattern", "win"],
      },
    },
    required: ["observation", "category"],
  };

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const observation = String(args.observation || "");
    const category = String(args.category || "");

    if (!config.memory.supabaseUrl || !config.memory.supabaseKey) {
      return "Error: Supabase not configured.";
    }

    const validCategories = ["preference", "frustration", "pattern", "win"];
    if (!validCategories.includes(category)) {
      return `Invalid category "${category}". Must be one of: ${validCategories.join(", ")}`;
    }

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        config.memory.supabaseUrl,
        config.memory.supabaseKey
      );

      const { error } = await supabase
        .from("relationship_context")
        .insert({ observation, category });

      if (error) {
        return `Error writing observation: ${error.message}`;
      }

      console.log(`💎 [RelContext] Sapphire noted: [${category}] ${observation}`);
      return `Observation recorded: [${category}] ${observation}`;
    } catch (err: any) {
      return `Relationship context error: ${err.message}`;
    }
  }
}
