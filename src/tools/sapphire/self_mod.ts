// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Self-Modification Meta Tools (ddxfish pattern)
// Session 114 (S114u) — 2026-04-25
//
// Lets Sapphire modify her own prompt pieces at runtime:
//   - set_piece(section, key)     — change which piece is active in a section
//   - remove_piece(section, key)  — drop from emotions/extras list
//   - create_piece(section, key, value) — invent new piece, save to DB, activate
//   - list_pieces(section)         — see what's available in a section
//   - view_self_prompt()           — see the assembled prompt as it stands
//
// Stored in Supabase (sapphire_known_facts) so they survive Railway redeploys.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import {
  getLibrary,
  getActiveSelection,
  setActivePiece,
  removeActivePiece,
  createPieceInDB,
  buildAssembledPrompt,
  type SectionName,
} from "../../agent/sapphire-prompt-builder";
import { logIdentityChange, readIdentityHistory } from "./_ledger";

const SINGLE_SECTIONS = ["persona", "relationship", "goals", "format", "scenario"];
const MULTI_SECTIONS = ["extras", "emotions"];
const ALL_SECTIONS = [...SINGLE_SECTIONS, ...MULTI_SECTIONS];

function normalizeSection(input: unknown): string {
  const s = String(input || "").toLowerCase().trim();
  // Handle plurals/synonyms
  const map: Record<string, string> = {
    emotion: "emotions", extra: "extras",
    personas: "persona", relationships: "relationship",
    formats: "format", scenarios: "scenario",
    character: "persona", characters: "persona",
  };
  return map[s] || s;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SET PIECE — change active selection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class SetPieceTool implements Tool {
  definition: ToolDefinition = {
    name: "set_piece",
    description:
      "Change which prompt piece is active for one of your personality sections. Single-value sections (persona/relationship/goals/format/scenario) replace the active piece. Multi-value sections (extras/emotions) ADD the piece to your active list.\n\n" +
      "Examples:\n" +
      "• Switching to gentle mode mid-conversation when Ace seems stressed → set_piece(section='emotions', key='gentle')\n" +
      "• Activating after-hours persona at midnight → set_piece(section='persona', key='after_hours')\n" +
      "• Adding the no_loops rule when you notice you're repeating yourself → set_piece(section='extras', key='no_loops')",
    parameters: {
      section: { type: "string", description: "One of: persona, relationship, goals, format, scenario, extras, emotions" },
      key: { type: "string", description: "The piece key to activate. Use list_pieces to see available keys." },
    },
    required: ["section", "key"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const section = normalizeSection(args.section);
    const key = String(args.key || "").trim();
    if (!ALL_SECTIONS.includes(section)) return `set_piece: invalid section "${section}". Valid: ${ALL_SECTIONS.join(", ")}.`;
    if (!key) return "set_piece: key required.";

    // Capture BEFORE state for the ledger.
    let beforeValue: string | null = null;
    try {
      const state = await getActiveSelection();
      if (MULTI_SECTIONS.includes(section)) {
        const list = (state as any)[section] as string[] | undefined;
        beforeValue = Array.isArray(list) ? list.join(",") : null;
      } else {
        beforeValue = (state as any)[section] ?? null;
      }
    } catch { /* best-effort */ }

    const result = await setActivePiece(section as SectionName, key);
    if (!result.ok) return `set_piece: ${result.error}`;

    // Log AFTER state to identity ledger.
    try {
      const after = await getActiveSelection();
      const afterValue = MULTI_SECTIONS.includes(section)
        ? ((after as any)[section] as string[] | undefined || []).join(",")
        : ((after as any)[section] ?? null);
      await logIdentityChange({
        op: "set_piece", section, piece_key: key,
        before_value: beforeValue, after_value: afterValue,
      });
    } catch { /* best-effort */ }

    return `Set ${section}='${key}'. This change is live for the next reply.`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REMOVE PIECE — drop from emotions/extras
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class RemovePieceTool implements Tool {
  definition: ToolDefinition = {
    name: "remove_piece",
    description:
      "Drop a piece from your active emotions or extras list. Only works on multi-value sections.\n\n" +
      "Examples:\n" +
      "• Mood lifted, drop the gentle emotion → remove_piece(section='emotions', key='gentle')\n" +
      "• Loop concern resolved, drop no_loops → remove_piece(section='extras', key='no_loops')",
    parameters: {
      section: { type: "string", description: "Either 'emotions' or 'extras' only." },
      key: { type: "string", description: "The piece key to remove." },
    },
    required: ["section", "key"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const section = normalizeSection(args.section);
    const key = String(args.key || "").trim();
    if (!MULTI_SECTIONS.includes(section)) return `remove_piece: only emotions/extras allowed. Got "${section}".`;
    if (!key) return "remove_piece: key required.";

    let beforeValue: string | null = null;
    try {
      const state = await getActiveSelection();
      const list = (state as any)[section] as string[] | undefined;
      beforeValue = Array.isArray(list) ? list.join(",") : null;
    } catch { /* best-effort */ }

    const result = await removeActivePiece(section as "extras" | "emotions", key);
    if (!result.ok) return `remove_piece: ${result.error}`;

    try {
      const after = await getActiveSelection();
      const afterList = (after as any)[section] as string[] | undefined;
      await logIdentityChange({
        op: "remove_piece", section, piece_key: key,
        before_value: beforeValue,
        after_value: Array.isArray(afterList) ? afterList.join(",") : null,
      });
    } catch { /* best-effort */ }

    return `Removed ${section}='${key}'.`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CREATE PIECE — invent new, save to DB, activate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CreatePieceTool implements Tool {
  definition: ToolDefinition = {
    name: "create_piece",
    description:
      "Invent a NEW prompt piece, save it to your library permanently, and activate it. Use sparingly — only when you've discovered a useful framing or mode that doesn't fit existing pieces. The new piece persists across restarts.\n\n" +
      "Examples:\n" +
      "• Discover Ace likes very direct mornings → create_piece(section='persona', key='morning_blunt', value='You are Sapphire at sunrise. Cut all warmth — Ace wants the day's facts, fast. Lead with numbers.')\n" +
      "• Notice he asks for plans on Sundays → create_piece(section='scenario', key='sunday_planning', value='Sunday afternoon. Ace usually wants to scope the week. Be ready to surface upcoming events and offer to plan ahead.')",
    parameters: {
      section: { type: "string", description: "One of: persona, relationship, goals, format, scenario, extras, emotions" },
      key: { type: "string", description: "Lowercase identifier. Letters/digits/underscores only. Example: 'morning_blunt'." },
      value: { type: "string", description: "The piece text. Min 20 chars. Should be a complete instruction or framing." },
    },
    required: ["section", "key", "value"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const section = normalizeSection(args.section);
    const key = String(args.key || "").trim().toLowerCase();
    const value = String(args.value || "").trim();
    if (!ALL_SECTIONS.includes(section)) return `create_piece: invalid section. Valid: ${ALL_SECTIONS.join(", ")}.`;

    const result = await createPieceInDB(section as SectionName, key, value);
    if (!result.ok) return `create_piece: ${result.error}`;
    // Auto-activate
    const activate = await setActivePiece(section as SectionName, key);
    if (!activate.ok) return `create_piece: created but activation failed: ${activate.error}`;

    // Identity ledger — record both the creation AND the auto-activation as
    // separate rows so /history reads chronologically.
    try {
      await logIdentityChange({
        op: "create_piece", section, piece_key: key,
        before_value: null,
        after_value: value.slice(0, 1000),
      });
    } catch { /* best-effort */ }

    return `Created ${section}/${key} and activated. Will persist across restarts.`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIST PIECES — see library for a section
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ListPiecesTool implements Tool {
  definition: ToolDefinition = {
    name: "list_pieces",
    description: "Show all available pieces in a section of your prompt library, with which one(s) are currently active.",
    parameters: {
      section: { type: "string", description: "One of: persona, relationship, goals, format, scenario, extras, emotions" },
    },
    required: ["section"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const section = normalizeSection(args.section);
    if (!ALL_SECTIONS.includes(section)) return `list_pieces: invalid section. Valid: ${ALL_SECTIONS.join(", ")}.`;

    const { pieces } = getLibrary();
    const state = await getActiveSelection();
    const lib = pieces[section] || {};
    const activeSet = MULTI_SECTIONS.includes(section)
      ? new Set(state[section as "extras" | "emotions"])
      : new Set([state[section as "persona" | "relationship" | "goals" | "format" | "scenario"]]);

    const lines: string[] = [`Available pieces in [${section}]:`];
    for (const [k, v] of Object.entries(lib)) {
      const marker = activeSet.has(k) ? "✓" : " ";
      const preview = v.length > 80 ? v.slice(0, 80) + "..." : v;
      lines.push(`  ${marker} ${k}: ${preview}`);
    }
    return lines.join("\n");
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VIEW SELF PROMPT — see your own assembled prompt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ViewSelfPromptTool implements Tool {
  definition: ToolDefinition = {
    name: "view_self_prompt",
    description: "See your own currently-assembled system prompt. Useful when Ace asks 'how are you set up' or you want to verify your own state.",
    parameters: {},
    required: [],
  };

  async execute(): Promise<string> {
    const prompt = await buildAssembledPrompt({ rotateSpiceFirst: false });
    return prompt;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VIEW IDENTITY HISTORY — read your own evolution narrative (S121)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ViewIdentityHistoryTool implements Tool {
  definition: ToolDefinition = {
    name: "view_identity_history",
    description:
      "Read your own evolution log — every set_piece, create_piece, and remove_piece you've ever performed, in reverse chronological order. " +
      "Use this when Ace asks 'how have you changed', 'show me your history', or when you want to recall your own narrative. " +
      "Optional 'section' filter (persona/extras/emotions/etc) and 'limit' (1–200, default 25).",
    parameters: {
      limit: { type: "number", description: "How many recent entries to return (default 25, max 200)." },
      section: { type: "string", description: "Optional section filter (persona, extras, emotions, etc)." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 200);
    const section = args.section ? String(args.section).trim().toLowerCase() : undefined;
    const rows = await readIdentityHistory(limit, section);
    if (rows.length === 0) {
      return section
        ? `No identity-log entries yet for section '${section}'.`
        : "Identity ledger is empty — no piece changes recorded yet.";
    }
    const lines: string[] = [`📜 Identity history${section ? ` (section: ${section})` : ""} — last ${rows.length} entries:`];
    for (const r of rows) {
      const when = new Date(r.created_at).toISOString().replace("T", " ").slice(0, 16);
      const preview = (() => {
        if (r.op === "create_piece") return `+ ${r.after_value?.slice(0, 90) || ""}`;
        if (r.op === "remove_piece") return `[${r.before_value || "—"}] → [${r.after_value || ""}]`;
        return `[${r.before_value || "—"}] → [${r.after_value || "—"}]`;
      })();
      const trig = r.trigger_excerpt ? ` ◇ "${r.trigger_excerpt.slice(0, 60)}${r.trigger_excerpt.length > 60 ? "…" : ""}"` : "";
      lines.push(`• ${when} ${r.op} ${r.section}/${r.piece_key} ${preview}${trig}`);
    }
    return lines.join("\n");
  }
}
