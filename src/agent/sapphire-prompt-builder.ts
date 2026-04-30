// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Assembled Prompt Builder (ddxfish pattern)
// Session 114 (S114u) — 2026-04-25
//
// Implements ddxfish/sapphire's library + active-state + spice architecture:
//   1. PIECES JSON is a LIBRARY — each section has multiple named pieces
//   2. ACTIVE STATE (sapphire_known_facts table) selects which keys are live
//   3. SPICE — random snippet per turn with lookahead + exclusion
//   4. URGENT ALERT framing — spice is rendered with bold language so the
//      LLM actually notices and uses it
//
// Self-modification (Phase 3) lets Sapphire call set_piece/create_piece to
// change her own active selection at runtime.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";
import { readFileSync } from "fs";
import { join } from "path";

const PIECES_PATH = join(__dirname, "..", "data", "sapphire-prompt-pieces.json");
const SPICES_PATH = join(__dirname, "..", "data", "sapphire-spices.json");

// ── LIBRARY (loaded once, hot-reloadable via reloadLibrary) ────────────────

type PieceLibrary = Record<string, Record<string, string>>;
type SpiceLibrary = Record<string, string[]>;

let CACHED_PIECES: PieceLibrary | null = null;
let CACHED_SPICES: SpiceLibrary | null = null;

export function reloadLibrary(): void {
  CACHED_PIECES = null;
  CACHED_SPICES = null;
}

function loadPieces(): PieceLibrary {
  if (!CACHED_PIECES) {
    try {
      const raw = JSON.parse(readFileSync(PIECES_PATH, "utf-8"));
      // Strip _comment / _* meta keys from sections
      const cleaned: PieceLibrary = {};
      for (const [section, pieces] of Object.entries(raw)) {
        if (section.startsWith("_")) continue;
        cleaned[section] = pieces as Record<string, string>;
      }
      CACHED_PIECES = cleaned;
    } catch (e: any) {
      console.error(`[SapphirePromptBuilder] Failed to load pieces: ${e.message}`);
      CACHED_PIECES = {};
    }
  }
  return CACHED_PIECES!;
}

function loadSpices(): SpiceLibrary {
  if (!CACHED_SPICES) {
    try {
      CACHED_SPICES = JSON.parse(readFileSync(SPICES_PATH, "utf-8"));
    } catch (e: any) {
      console.error(`[SapphirePromptBuilder] Failed to load spices: ${e.message}`);
      CACHED_SPICES = {};
    }
  }
  return CACHED_SPICES!;
}

export function getLibrary(): { pieces: PieceLibrary; spices: SpiceLibrary } {
  return { pieces: loadPieces(), spices: loadSpices() };
}

// ── ACTIVE STATE (persisted in sapphire_known_facts) ──────────────────────

// Single-value sections store one active key.
// Multi-value sections (extras, emotions) store CSV of active keys.
// Keys in sapphire_known_facts:
//   active_persona, active_relationship, active_goals, active_format,
//   active_scenario, active_extras (CSV), active_emotions (CSV),
//   current_spice, next_spice

const SINGLE_SECTIONS = ["persona", "relationship", "goals", "format", "scenario"] as const;
const MULTI_SECTIONS = ["extras", "emotions"] as const;
type SingleSection = (typeof SINGLE_SECTIONS)[number];
type MultiSection = (typeof MULTI_SECTIONS)[number];
export type SectionName = SingleSection | MultiSection;

// S125 (2026-04-29) — flipped from the parallel-system "executive_pa / cold
// executor" defaults back to the longtime-handler tone (Ron-from-Jay-Kelly).
// The cold pieces (executive_pa, strategic_partner, high_agency_execution,
// results_only) are still in the library for explicit selection but no longer
// the fallback when the DB is empty.
const DEFAULTS: Record<string, string> = {
  active_persona: "longtime_handler",
  active_relationship: "trusted_assistant",
  active_goals: "be_present_useful",
  active_format: "warm_concise",
  active_scenario: "default",
  active_extras: "discernment,memory_routing,what_you_can_do,family_first,no_loops,no_tool_retry_loops,complex_task_protocol",
  active_emotions: "focused",
};

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

interface ActiveState {
  persona: string;
  relationship: string;
  goals: string;
  format: string;
  scenario: string;
  extras: string[];
  emotions: string[];
  current_spice: string;
  next_spice: string;
}

async function loadActiveState(): Promise<ActiveState> {
  const out: ActiveState = {
    persona: DEFAULTS.active_persona,
    relationship: DEFAULTS.active_relationship,
    goals: DEFAULTS.active_goals,
    format: DEFAULTS.active_format,
    scenario: DEFAULTS.active_scenario,
    extras: DEFAULTS.active_extras.split(","),
    emotions: DEFAULTS.active_emotions.split(","),
    current_spice: "",
    next_spice: "",
  };

  try {
    const supabase = await getSupabase();
    const keys = [
      "active_persona", "active_relationship", "active_goals", "active_format", "active_scenario",
      "active_extras", "active_emotions", "current_spice", "next_spice",
    ];
    const { data } = await supabase
      .from("sapphire_known_facts")
      .select("key, value")
      .in("key", keys);
    for (const row of (data ?? []) as any[]) {
      const v = String(row.value || "");
      switch (row.key) {
        case "active_persona": out.persona = v || out.persona; break;
        case "active_relationship": out.relationship = v || out.relationship; break;
        case "active_goals": out.goals = v || out.goals; break;
        case "active_format": out.format = v || out.format; break;
        case "active_scenario": out.scenario = v || out.scenario; break;
        case "active_extras": out.extras = v.split(",").map((s) => s.trim()).filter(Boolean); break;
        case "active_emotions": out.emotions = v.split(",").map((s) => s.trim()).filter(Boolean); break;
        case "current_spice": out.current_spice = v; break;
        case "next_spice": out.next_spice = v; break;
      }
    }
  } catch (e: any) {
    console.warn(`[SapphirePromptBuilder] active state load failed: ${e.message} — using defaults`);
  }
  return out;
}

async function saveActiveValue(key: string, value: string): Promise<void> {
  try {
    const supabase = await getSupabase();
    await supabase
      .from("sapphire_known_facts")
      .upsert({ key, value, category: "preferences" }, { onConflict: "key" });
  } catch (e: any) {
    console.warn(`[SapphirePromptBuilder] save ${key} failed: ${e.message}`);
  }
}

// ── SPICE: lookahead + exclusion ──────────────────────────────────────────

function pickSpice(exclude = ""): string {
  const spices = loadSpices();
  const pool: string[] = [];
  for (const cat of Object.values(spices)) pool.push(...cat);
  if (pool.length === 0) return "";
  const candidates = pool.filter((s) => s !== exclude);
  return candidates.length > 0
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Rotate spice: next becomes current, pre-pick a new next that excludes current.
 * Persists to Supabase. Called once per Sapphire DM message.
 */
export async function rotateSpice(): Promise<{ current: string; next: string }> {
  const state = await loadActiveState();
  const newCurrent = state.next_spice || pickSpice();
  const newNext = pickSpice(newCurrent);
  await Promise.all([
    saveActiveValue("current_spice", newCurrent),
    saveActiveValue("next_spice", newNext),
  ]);
  return { current: newCurrent, next: newNext };
}

// ── Time-aware piece auto-selection (only when active is the default) ─────

// S125 (2026-04-29) — Ace works nights. His day starts ~2pm CDT and he sleeps
// ~6-8am CDT. The original 9-to-5 mapping was inverted: morning_focus was
// firing while he was going to bed and after_hours was firing while he was
// working. Mapping below uses his actual rhythm; see user_schedule memory.
//   14:00–17:00 CDT = his morning  -> morning_focus
//   17:00–01:00 CDT = main awake   -> longtime_handler (the warm default)
//   01:00–14:00 CDT = late night + asleep -> after_hours (quiet, unobtrusive)
function autoPersonaForTime(currentActive: string): string {
  if (currentActive !== DEFAULTS.active_persona) return currentActive;
  const cdtHour = (new Date().getUTCHours() - 5 + 24) % 24;
  if (cdtHour >= 14 && cdtHour < 17) return "morning_focus";
  if (cdtHour >= 17 || cdtHour < 1) return "longtime_handler";
  return "after_hours";
}

function autoScenarioForTime(currentActive: string): string {
  if (currentActive !== DEFAULTS.active_scenario) return currentActive;
  const cdtHour = (new Date().getUTCHours() - 5 + 24) % 24;
  // 2pm-5pm CDT = Ace's actual morning window
  if (cdtHour >= 14 && cdtHour < 17) return "morning_brief";
  return "default";
}

// ── PUBLIC: Build the assembled prompt ────────────────────────────────────

export interface BuildOptions {
  voiceOut?: boolean;
  rotateSpiceFirst?: boolean; // default true — rotate spice then build
}

export async function buildAssembledPrompt(opts: BuildOptions = {}): Promise<string> {
  // Rotate spice unless caller already did
  if (opts.rotateSpiceFirst !== false) {
    await rotateSpice();
  }

  const pieces = loadPieces();
  const state = await loadActiveState();

  const personaKey = autoPersonaForTime(state.persona);
  const scenarioKey = autoScenarioForTime(state.scenario);
  const formatKey = opts.voiceOut ? "voice_mode" : state.format;

  const sections: string[] = [];

  // # IDENTITY
  const persona = pieces.persona?.[personaKey] || pieces.persona?.[DEFAULTS.active_persona] || "";
  const relationship = pieces.relationship?.[state.relationship] || pieces.relationship?.[DEFAULTS.active_relationship] || "";
  if (persona || relationship) {
    sections.push("# IDENTITY");
    if (persona) sections.push(persona);
    if (relationship) sections.push(relationship);
    sections.push("");
  }

  // # GOALS
  const goals = pieces.goals?.[state.goals] || pieces.goals?.[DEFAULTS.active_goals] || "";
  if (goals) {
    sections.push("# GOALS");
    sections.push(goals);
    sections.push("");
  }

  // # FORMAT
  const format = pieces.format?.[formatKey] || pieces.format?.[DEFAULTS.active_format] || "";
  if (format) {
    sections.push("# FORMAT");
    sections.push(format);
    sections.push("");
  }

  // # SCENARIO + EMOTIONS
  const scenario = pieces.scenario?.[scenarioKey] || "";
  const emotionLines = state.emotions
    .map((k) => pieces.emotions?.[k])
    .filter(Boolean) as string[];
  if (scenario || emotionLines.length > 0) {
    sections.push("# CURRENT MOMENT");
    if (scenario) sections.push(scenario);
    if (emotionLines.length > 0) sections.push(`Emotional tone: ${emotionLines.join(" ")}`);
    sections.push("");
  }

  // # RULES (extras)
  const extraLines = state.extras
    .map((k) => pieces.extras?.[k])
    .filter(Boolean) as string[];
  // ALWAYS inject hidden_thinking for S121d intuitive reasoning upgrade
  if (pieces.extras?.["hidden_thinking"] && !state.extras.includes("hidden_thinking")) {
    extraLines.push(pieces.extras["hidden_thinking"]);
  }
  if (extraLines.length > 0) {
    sections.push("# RULES");
    for (const line of extraLines) sections.push(`- ${line}`);
    sections.push("");
  }

  // # NOW — inject actual current date/time so Gemini knows "today" exists.
  // Without this, she computes relative dates ("Friday at 2pm") against her
  // training cutoff and submits past dates that get rejected by set_reminder.
  const now = new Date();
  const cdtOffset = -5; // CDT — Ace's timezone
  const nowCdt = new Date(now.getTime() + cdtOffset * 60 * 60 * 1000);
  const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][nowCdt.getUTCDay()];
  const monthName = ["January","February","March","April","May","June","July","August","September","October","November","December"][nowCdt.getUTCMonth()];
  const cdtFormatted = `${dayName}, ${monthName} ${nowCdt.getUTCDate()}, ${nowCdt.getUTCFullYear()} at ${String(nowCdt.getUTCHours()).padStart(2,"0")}:${String(nowCdt.getUTCMinutes()).padStart(2,"0")} CDT`;
  sections.push(`# NOW`);
  sections.push(`Current time: ${cdtFormatted} (UTC: ${now.toISOString()})`);
  sections.push(`When converting natural-language times like "Friday at 2pm" or "tomorrow morning" to ISO 8601 for set_reminder/calendar_create_event, calculate FROM THIS TIMESTAMP. Never use a year other than ${nowCdt.getUTCFullYear()} unless Ace explicitly asks for a different year.`);
  sections.push("");

  // # URGENT ALERT — the spice line, with attention-grabbing framing per ddxfish
  if (state.current_spice) {
    sections.push(`URGENT ALERT for THIS reply only: ${state.current_spice}`);
    sections.push("");
  }

  return sections.join("\n");
}

// ── PUBLIC: state introspection (for self-mod tools) ─────────────────────

export async function getActiveSelection(): Promise<ActiveState> {
  return loadActiveState();
}

export async function setActivePiece(section: SectionName, key: string): Promise<{ ok: boolean; error?: string }> {
  const pieces = loadPieces();
  if (!pieces[section]) return { ok: false, error: `Unknown section "${section}".` };
  if (!(key in pieces[section])) {
    const avail = Object.keys(pieces[section]).join(", ");
    return { ok: false, error: `Piece "${key}" not in section "${section}". Available: ${avail}.` };
  }

  const isMulti = (MULTI_SECTIONS as readonly string[]).includes(section);
  if (isMulti) {
    const state = await loadActiveState();
    const current = section === "extras" ? state.extras : state.emotions;
    if (current.includes(key)) return { ok: true }; // already active
    const next = [...current, key];
    await saveActiveValue(`active_${section}`, next.join(","));
  } else {
    await saveActiveValue(`active_${section}`, key);
  }
  return { ok: true };
}

export async function removeActivePiece(section: MultiSection, key: string): Promise<{ ok: boolean; error?: string }> {
  if (!(MULTI_SECTIONS as readonly string[]).includes(section)) {
    return { ok: false, error: `Can only remove from multi-value sections (extras, emotions). "${section}" is single-value.` };
  }
  const state = await loadActiveState();
  const current = section === "extras" ? state.extras : state.emotions;
  const next = current.filter((k) => k !== key);
  await saveActiveValue(`active_${section}`, next.join(","));
  return { ok: true };
}

// New piece creation persists to Supabase (NOT JSON file — Railway redeploy
// would wipe JSON edits). Loaded into the library merge at runtime.
export async function createPieceInDB(
  section: SectionName,
  key: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!key.match(/^[a-z0-9_]+$/)) {
    return { ok: false, error: `Key must be lowercase letters, digits, underscores only. Got: "${key}".` };
  }
  if (value.length < 20) return { ok: false, error: "Piece value too short (need >=20 chars)." };

  try {
    const supabase = await getSupabase();
    await supabase.from("sapphire_known_facts").upsert(
      {
        key: `piece_${section}_${key}`,
        value,
        category: "preferences",
      },
      { onConflict: "key" },
    );
  } catch (e: any) {
    return { ok: false, error: `Save failed: ${e.message}` };
  }

  // Inject into runtime library cache so it's immediately usable
  const pieces = loadPieces();
  if (!pieces[section]) pieces[section] = {};
  pieces[section][key] = value;

  return { ok: true };
}

// On startup / first build, merge any DB-stored pieces into the library
let PIECES_DB_MERGED = false;
export async function mergePiecesFromDB(): Promise<void> {
  if (PIECES_DB_MERGED) return;
  try {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("sapphire_known_facts")
      .select("key, value")
      .like("key", "piece_%");
    const pieces = loadPieces();
    for (const row of (data ?? []) as any[]) {
      const m = row.key.match(/^piece_([a-z]+)_([a-z0-9_]+)$/);
      if (!m) continue;
      const [, section, key] = m;
      if (!pieces[section]) pieces[section] = {};
      pieces[section][key] = String(row.value);
    }
    PIECES_DB_MERGED = true;
  } catch (e: any) {
    console.warn(`[SapphirePromptBuilder] DB merge failed: ${e.message}`);
  }
}
