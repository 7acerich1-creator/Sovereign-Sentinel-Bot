// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Protocol Reader + Writer
// Signal vs. Noise Matrix — CEO Standing Orders
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool } from "../types";
import { config } from "../config";

/**
 * Reads all active protocols for a given niche (+ global "all" protocols).
 * Used by Alfred, Yuki, Anita before executing any content task.
 */
export class ProtocolReaderTool implements Tool {
  name = "read_protocols";
  description =
    "Read all active Architect protocols for a given niche. Returns niche-specific directives plus all global directives. Call this BEFORE executing any content creation task.";

  parameters = {
    type: "object" as const,
    properties: {
      niche: {
        type: "string",
        description:
          "Content niche: dark_psychology | self_improvement | burnout | quantum | all",
      },
    },
    required: ["niche"],
  };

  async execute(params: { niche: string }): Promise<string> {
    const { niche } = params;

    if (!config.memory.supabaseUrl || !config.memory.supabaseAnonKey) {
      return "Error: Supabase not configured — cannot read protocols.";
    }

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        config.memory.supabaseUrl,
        config.memory.supabaseAnonKey
      );

      // Fetch niche-specific + global ("all") active protocols
      const { data, error } = await supabase
        .from("protocols")
        .select("protocol_name, niche, directive, created_by")
        .eq("active", true)
        .or(`niche.eq.${niche},niche.eq.all`)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[ProtocolReader] Supabase error:", error.message);
        return `Error reading protocols: ${error.message}`;
      }

      if (!data || data.length === 0) {
        return `No active protocols found for niche "${niche}".`;
      }

      const formatted = data
        .map(
          (p: any, i: number) =>
            `[${i + 1}] ${p.protocol_name} (${p.niche})\n   ${p.directive}`
        )
        .join("\n\n");

      return `⚡ ARCHITECT PROTOCOLS — ${data.length} active directives for "${niche}":\n\n${formatted}\n\n— These are standing orders. Apply every directive to your output.`;
    } catch (err: any) {
      return `Protocol reader error: ${err.message}`;
    }
  }
}

/**
 * Writes new protocols to Supabase. Sapphire-exclusive tool.
 * Triggered by messages containing "standing directive" or "new protocol".
 */
export class ProtocolWriterTool implements Tool {
  name = "write_protocol";
  description =
    "Write a new Architect protocol to the protocols table. Use when the Architect issues a 'standing directive' or 'new protocol'. Extract the protocol name, niche, and directive from context.";

  parameters = {
    type: "object" as const,
    properties: {
      protocol_name: {
        type: "string",
        description: "Snake_case name for the protocol (e.g. visual_inversion_dark_psychology)",
      },
      niche: {
        type: "string",
        description: "Target niche: dark_psychology | self_improvement | burnout | quantum | all",
      },
      directive: {
        type: "string",
        description: "The full protocol instruction text",
      },
    },
    required: ["protocol_name", "niche", "directive"],
  };

  async execute(params: {
    protocol_name: string;
    niche: string;
    directive: string;
  }): Promise<string> {
    const { protocol_name, niche, directive } = params;

    if (!config.memory.supabaseUrl || !config.memory.supabaseAnonKey) {
      return "Error: Supabase not configured — cannot write protocol.";
    }

    const validNiches = [
      "dark_psychology",
      "self_improvement",
      "burnout",
      "quantum",
      "all",
    ];
    if (!validNiches.includes(niche)) {
      return `Invalid niche "${niche}". Must be one of: ${validNiches.join(", ")}`;
    }

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        config.memory.supabaseUrl,
        config.memory.supabaseAnonKey
      );

      const { data, error } = await supabase
        .from("protocols")
        .insert({
          protocol_name,
          niche,
          directive,
          active: true,
          created_by: "sapphire",
        })
        .select("id, protocol_name")
        .single();

      if (error) {
        console.error("[ProtocolWriter] Supabase error:", error.message);
        return `Error writing protocol: ${error.message}`;
      }

      console.log(`📡 [ProtocolWriter] New protocol locked: ${protocol_name} (${niche})`);
      return `Protocol "${protocol_name}" locked. All crew members will execute this on every ${niche === "all" ? "niche" : niche} task going forward.`;
    } catch (err: any) {
      return `Protocol writer error: ${err.message}`;
    }
  }
}
