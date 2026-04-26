// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Crew Prompt Builder (ddxfish pattern, generic)
// Session 117 (2026-04-25) — extends Sapphire's prompt-builder pattern
// to the 5 other Maven Crew bots: Veritas, Yuki, Alfred, Anita, Vector.
//
// Each bot has:
//   - A pieces library at src/data/{agent}-prompt-pieces.json
//   - Active-state rows in Supabase bot_active_state WHERE agent='{agent}'
//   - Sections: persona, relationship, goals, format, scenario, extras (CSV
//     multi), emotions (CSV multi). Single-value sections store one active
//     key; multi-value sections store CSV of active keys.
//
// Usage at boot:
//   const veritasPrompt = await assembleCrewPrompt('veritas');
//   personalityMap['veritas'].prompt_blueprint = veritasPrompt;
//
// Per-turn dynamic assembly (spice rotation, scenario auto-shift) is a
// future optimization — for v1 we assemble once at boot from the active
// state and use that as the static blueprint.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync } from "fs";
import { join } from "path";
import { config } from "../config";

export type CrewAgent = "veritas" | "yuki" | "alfred" | "anita" | "vector";

type PieceLibrary = Record<string, Record<string, string>>;

const SINGLE_SECTIONS = ["persona", "relationship", "goals", "format", "scenario"] as const;
const MULTI_SECTIONS = ["extras", "emotions"] as const;

interface ActiveState {
  persona: string;
  relationship: string;
  goals: string;
  format: string;
  scenario: string;
  extras: string[];
  emotions: string[];
}

const CACHED_LIBRARIES: Record<string, PieceLibrary> = {};

function loadPieces(agent: CrewAgent): PieceLibrary {
  if (CACHED_LIBRARIES[agent]) return CACHED_LIBRARIES[agent];
  const path = join(__dirname, "..", "data", `${agent}-prompt-pieces.json`);
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const cleaned: PieceLibrary = {};
    for (const [section, pieces] of Object.entries(raw)) {
      if (section.startsWith("_")) continue;
      cleaned[section] = pieces as Record<string, string>;
    }
    CACHED_LIBRARIES[agent] = cleaned;
    return cleaned;
  } catch (e: any) {
    console.error(`[CrewPromptBuilder] Failed to load pieces for ${agent}: ${e.message}`);
    CACHED_LIBRARIES[agent] = {};
    return {};
  }
}

async function loadActiveState(agent: CrewAgent): Promise<ActiveState> {
  const out: ActiveState = {
    persona: "", relationship: "", goals: "", format: "", scenario: "",
    extras: [], emotions: [],
  };
  if (!config.memory.supabaseUrl) return out;
  try {
    const m = await import("@supabase/supabase-js");
    const supabase = m.createClient(
      config.memory.supabaseUrl!,
      (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
    );
    const { data } = await supabase
      .from("bot_active_state")
      .select("key, value")
      .eq("agent", agent);
    for (const row of (data ?? []) as any[]) {
      const v = String(row.value || "");
      switch (row.key) {
        case "active_persona": out.persona = v; break;
        case "active_relationship": out.relationship = v; break;
        case "active_goals": out.goals = v; break;
        case "active_format": out.format = v; break;
        case "active_scenario": out.scenario = v; break;
        case "active_extras": out.extras = v.split(",").map((s) => s.trim()).filter(Boolean); break;
        case "active_emotions": out.emotions = v.split(",").map((s) => s.trim()).filter(Boolean); break;
      }
    }
  } catch (e: any) {
    console.warn(`[CrewPromptBuilder] active state load failed for ${agent}: ${e.message}`);
  }
  return out;
}

/**
 * Assemble the calibrated system prompt for a crew agent from its pieces
 * library + active state. Called once per agent at boot.
 *
 * Returns the assembled prompt string. Falls back to a minimal identity
 * stub if the pieces file is missing or active state is empty.
 */
export async function assembleCrewPrompt(agent: CrewAgent): Promise<string> {
  const pieces = loadPieces(agent);
  const state = await loadActiveState(agent);

  const sections: string[] = [];

  // # IDENTITY (persona + relationship)
  const persona = pieces.persona?.[state.persona] || "";
  const relationship = pieces.relationship?.[state.relationship] || "";
  if (persona || relationship) {
    sections.push("# IDENTITY");
    if (persona) sections.push(persona);
    if (relationship) sections.push(relationship);
    sections.push("");
  }

  // # GOALS
  const goals = pieces.goals?.[state.goals] || "";
  if (goals) {
    sections.push("# GOALS");
    sections.push(goals);
    sections.push("");
  }

  // # FORMAT
  const format = pieces.format?.[state.format] || "";
  if (format) {
    sections.push("# FORMAT");
    sections.push(format);
    sections.push("");
  }

  // # CURRENT MOMENT (scenario + emotional tone)
  const scenario = pieces.scenario?.[state.scenario] || "";
  const emotionLines = state.emotions
    .map((k) => pieces.emotions?.[k])
    .filter(Boolean) as string[];
  if (scenario || emotionLines.length > 0) {
    sections.push("# CURRENT MOMENT");
    if (scenario) sections.push(scenario);
    if (emotionLines.length > 0) sections.push(`Emotional tone: ${emotionLines.join(" ")}`);
    sections.push("");
  }

  // # RULES (extras — multi-value)
  const extraLines = state.extras
    .map((k) => pieces.extras?.[k])
    .filter(Boolean) as string[];
  if (extraLines.length > 0) {
    sections.push("# RULES");
    for (const line of extraLines) sections.push(`- ${line}`);
    sections.push("");
  }

  const assembled = sections.join("\n").trim();

  if (!assembled) {
    console.warn(`[CrewPromptBuilder] ${agent}: assembled prompt is empty — pieces file or active state may be missing. Returning minimal stub.`);
    return `You are ${agent.charAt(0).toUpperCase() + agent.slice(1)}, a Maven Crew agent for Sovereign Synthesis.`;
  }

  return assembled;
}

/**
 * Reload the pieces library cache (useful if pieces JSON edited at runtime).
 */
export function reloadCrewPiecesCache(): void {
  for (const k of Object.keys(CACHED_LIBRARIES)) delete CACHED_LIBRARIES[k];
}
