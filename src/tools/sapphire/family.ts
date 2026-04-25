// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — Family Profiles Tools (Gap 8)
// Session 114 (S114n) — 2026-04-25
//
// First-class family member records so Sapphire can surface relevant context
// without Ace having to repeat himself.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";
import { config } from "../../config";

const VALID_RELATIONSHIPS = ["daughter", "son", "spouse", "partner", "mother", "father", "sibling", "grandparent", "other"];

async function getSupabase() {
  const m = await import("@supabase/supabase-js");
  return m.createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAVE / UPDATE family member
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class SaveFamilyMemberTool implements Tool {
  definition: ToolDefinition = {
    name: "save_family_member",
    description:
      "Add or update a family member's profile (name + DOB + school + allergies + doctor + activities). Upsert by name. Use this INSTEAD OF remember_fact when the info is about a specific family member.\n\n" +
      "Examples:\n" +
      "• 'My daughter Maya was born March 14 2019, allergic to peanuts, goes to St Anne's' → save_family_member(name='Maya', relationship='daughter', date_of_birth='2019-03-14', allergies='peanuts', school=\"St Anne's\")\n" +
      "• 'My wife Sarah, doctor is Dr. Lee at Riverside' → save_family_member(name='Sarah', relationship='spouse', doctor='Dr. Lee at Riverside')\n" +
      "• 'Aliza born May 19 2015, Maddy born August 5 2017' → call this twice, once per daughter",
    parameters: {
      name: { type: "string", description: "Family member's name." },
      relationship: { type: "string", description: "One of: daughter, son, spouse, partner, mother, father, sibling, grandparent, other." },
      date_of_birth: { type: "string", description: "Optional. ISO date YYYY-MM-DD." },
      allergies: { type: "string", description: "Optional. Comma-separated list, e.g. 'peanuts, dairy'." },
      school: { type: "string", description: "Optional. School/daycare name." },
      doctor: { type: "string", description: "Optional. Doctor name + clinic." },
      current_activities: { type: "string", description: "Optional. Comma-separated, e.g. 'soccer, piano lessons, ballet'." },
      notes: { type: "string", description: "Optional. Free-form additional context." },
      emergency_contact: { type: "string", description: "Optional. Phone or email for emergencies." },
    },
    required: ["name", "relationship"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name || "").trim();
    const relationship = String(args.relationship || "").trim().toLowerCase();
    if (!name) return "save_family_member: name required.";
    if (!VALID_RELATIONSHIPS.includes(relationship)) {
      return `save_family_member: relationship must be one of ${VALID_RELATIONSHIPS.join(", ")}.`;
    }

    const allergies = args.allergies ? String(args.allergies).split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const activities = args.current_activities ? String(args.current_activities).split(",").map((s) => s.trim()).filter(Boolean) : undefined;

    const row: Record<string, unknown> = { name, relationship };
    if (args.date_of_birth) row.date_of_birth = String(args.date_of_birth);
    if (allergies !== undefined) row.allergies = allergies;
    if (args.school) row.school = String(args.school);
    if (args.doctor) row.doctor = String(args.doctor);
    if (activities !== undefined) row.current_activities = activities;
    if (args.notes) row.notes = String(args.notes);
    if (args.emergency_contact) row.emergency_contact = String(args.emergency_contact);

    const supabase = await getSupabase();
    const { error } = await supabase
      .from("sapphire_family_profiles")
      .upsert(row, { onConflict: "name" });
    if (error) return `save_family_member: ${error.message}`;
    return `Saved profile for ${name} (${relationship}).`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET family member(s)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class GetFamilyTool implements Tool {
  definition: ToolDefinition = {
    name: "get_family",
    description:
      "Look up family member(s). Use when Ace asks 'when is Maya's birthday', 'what's the kids' doctor', 'who has soccer'. Without args, returns all family members.",
    parameters: {
      name: { type: "string", description: "Optional. Filter by exact name." },
      relationship: { type: "string", description: "Optional. Filter by relationship (daughter, son, spouse, etc)." },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const supabase = await getSupabase();
    let q = supabase.from("sapphire_family_profiles").select("*").order("relationship", { ascending: true });
    if (args.name) q = q.ilike("name", String(args.name));
    if (args.relationship) q = q.eq("relationship", String(args.relationship).toLowerCase());

    const { data, error } = await q;
    if (error) return `get_family: ${error.message}`;
    if (!data || data.length === 0) return "No family members on file. Tell Sapphire to remember them.";

    const lines: string[] = [];
    for (const m of data as any[]) {
      const parts: string[] = [`${m.name} (${m.relationship})`];
      if (m.date_of_birth) {
        const dob = new Date(m.date_of_birth);
        const ageYears = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        parts.push(`born ${m.date_of_birth} (age ${ageYears})`);
      }
      if (m.allergies?.length > 0) parts.push(`allergies: ${m.allergies.join(", ")}`);
      if (m.school) parts.push(`school: ${m.school}`);
      if (m.doctor) parts.push(`doctor: ${m.doctor}`);
      if (m.current_activities?.length > 0) parts.push(`activities: ${m.current_activities.join(", ")}`);
      if (m.notes) parts.push(`notes: ${m.notes}`);
      if (m.emergency_contact) parts.push(`emergency: ${m.emergency_contact}`);
      lines.push(parts.join(" | "));
    }
    return lines.join("\n");
  }
}
