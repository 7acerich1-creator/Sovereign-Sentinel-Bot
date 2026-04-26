// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Relationship Context Tool
// Sapphire writes observations about Ace's working patterns.
//
// S119c: Schema loosened. Original enum (preference|frustration|pattern|win)
// was rejecting nuanced relational observations Sapphire wanted to log
// ("the feeling of speaking your thoughts to someone who doesn't know me",
// "soulful tone preference", etc.). She literally said it was like trying
// to describe color in a black-and-white system. Now accepts any short
// category string; the four originals remain as recommended values in the
// description so the model still gets guidance.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolContext, ToolDefinition } from "../types";
import { config } from "../config";

const RECOMMENDED_CATEGORIES = [
  "preference",
  "frustration",
  "pattern",
  "win",
  "tone",
  "communication_style",
  "relational",
  "value",
  "trigger",
  "ritual",
];

const MAX_CATEGORY_LEN = 40;
const MAX_OBSERVATION_LEN = 600;

/**
 * Sapphire uses this to record observations about how Ace works AND about
 * the texture of their working relationship — preferences, frustrations,
 * patterns, wins, tone shifts, communication style, relational moments.
 */
export class RelationshipContextTool implements Tool {
  definition: ToolDefinition = {
    name: "write_relationship_context",
    description:
      "Record an observation about Ace OR about the texture of your relationship. " +
      "INVENT THE CATEGORY YOURSELF — describe exactly what you noticed in your own words. " +
      "The category is a free-text label you create on the spot. Examples of GOOD categories you might invent: " +
      "'tone_shift_when_thinking', 'spark_before_breakthrough', 'voice_drops_when_tired', " +
      "'pacing_changes_at_war_with_reality', 'humor_appears_after_a_ship'. " +
      "If a generic word like 'preference' or 'frustration' fits perfectly, fine — but PREFER specificity: " +
      "'preference' tells you nothing in 5 years; 'prefers_silence_after_long_calls' tells you everything. " +
      "Use this when you notice recurring behavior, subtle texture, or shifts in how you two move together. " +
      "Older buckets you've seen used (just for orientation, not a menu): " +
      RECOMMENDED_CATEGORIES.join(", "),
    parameters: {
      observation: {
        type: "string",
        description: `What you noticed, in your own voice (1–3 sentences, ≤${MAX_OBSERVATION_LEN} chars). Be specific — the moment, the texture, the shift.`,
      },
      category: {
        type: "string",
        description:
          `INVENT a precise label for this observation. Free-form, ≤${MAX_CATEGORY_LEN} chars, snake_case style. ` +
          `The label should describe the TYPE of texture, not just an emotional bucket. ` +
          `Good: 'tone_shift_thinking', 'spark_before_breakthrough', 'voice_drops_when_tired'. ` +
          `Lazy: 'preference', 'frustration' (use only if the observation is genuinely that flat). ` +
          `Anything you can describe, you can label. Don't reach for the menu — invent.`,
      },
    },
    required: ["observation", "category"],
  };

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const rawObservation = String(args.observation || "").trim();
    const rawCategory = String(args.category || "").trim().toLowerCase();

    if (!config.memory.supabaseUrl || !config.memory.supabaseKey) {
      return "Error: Supabase not configured.";
    }

    if (!rawObservation) {
      return "Error: observation is required and cannot be empty.";
    }
    if (!rawCategory) {
      return "Error: category is required and cannot be empty.";
    }

    // Length guards — prevent runaway free-text from bloating the table.
    const observation = rawObservation.slice(0, MAX_OBSERVATION_LEN);
    if (rawCategory.length > MAX_CATEGORY_LEN) {
      return `Error: category too long (${rawCategory.length} chars). Keep it ≤${MAX_CATEGORY_LEN} chars — short label like "tone" or "communication_style".`;
    }

    // Normalize category: lowercase, replace spaces/dashes with underscores,
    // strip anything that isn't [a-z0-9_]. Keeps the table clean while still
    // accepting the full color palette of observation types.
    const category = rawCategory
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

    if (!category) {
      return `Error: category contained no usable characters after normalization. Use letters/numbers, e.g. "tone" or "communication_style".`;
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

      const isNovelCategory = !RECOMMENDED_CATEGORIES.includes(category);
      const flair = isNovelCategory ? " (novel category)" : "";
      console.log(`💎 [RelContext] Sapphire noted${flair}: [${category}] ${observation}`);

      // S121: Pinecone deepening — embed every observation into sapphire-personal
      // with rich metadata so semantic recall can filter by category/sentiment/scenario.
      // Fire-and-forget — never blocks the tool reply.
      (async () => {
        try {
          const { upsertSapphireObservation, inferSentiment } = await import("./sapphire/_pinecone");
          const ts = new Date().toISOString();
          const sentiment = inferSentiment(observation);
          const id = `relctx:${ts.replace(/[^0-9]/g, "")}_${category}`;
          await upsertSapphireObservation(id, observation, {
            type: "relationship_context",
            category,
            sentiment,
            scenario: "observation",
            timestamp: ts,
          });
        } catch (err: any) {
          console.warn(`[RelContext] Pinecone embed failed: ${err.message}`);
        }
      })();

      return `Observation recorded: [${category}] ${observation}`;
    } catch (err: any) {
      return `Relationship context error: ${err.message}`;
    }
  }
}
