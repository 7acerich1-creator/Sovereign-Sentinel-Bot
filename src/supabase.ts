import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

export const supabase: SupabaseClient = createClient(
  config.supabase.url,
  config.supabase.anonKey
);

// ── Status: Revenue + Habits + Mission Metrics ──
export async function getSystemStatus() {
  const [revenue, habits, metrics, pendingCommands] = await Promise.all([
    supabase
      .from("revenue_log")
      .select("amount")
      .then(({ data }) =>
        (data || []).reduce((sum, r) => sum + Number(r.amount), 0)
      ),
    supabase
      .from("habits")
      .select("*")
      .eq("status", "Active")
      .then(({ data }) => data || []),
    supabase
      .from("mission_metrics")
      .select("liberation_count")
      .limit(1)
      .single()
      .then(({ data }) => data),
    supabase
      .from("command_queue")
      .select("id")
      .eq("status", "Pending")
      .then(({ data }) => (data || []).length),
  ]);

  return {
    revenue,
    target: 1_200_000,
    progress: ((revenue / 1_200_000) * 100).toFixed(2),
    activeHabits: habits.length,
    habits: habits.map((h) => `${h.habit_name} (streak: ${h.streak_count})`),
    liberationCount: metrics?.liberation_count ?? 0,
    pendingCommands,
  };
}

// ── Intent: Push to command_queue ──
export async function pushIntent(command: string, senderId: string) {
  const { data, error } = await supabase.from("command_queue").insert({
    sender_id: senderId,
    recipient_id: "system",
    payload: { command, source: "telegram" },
    status: "Pending",
  }).select();

  if (error) throw error;
  return data?.[0];
}

// ── Glitch: Read recent anomalies ──
export async function getRecentGlitches(limit = 5) {
  const { data, error } = await supabase
    .from("glitch_log")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// ── Calibrate: Update personality_config ──
export async function calibratePersonality(
  slider: string,
  value: number
) {
  // Upsert into personality_config
  const { data, error } = await supabase
    .from("personality_config")
    .upsert(
      {
        agent_name: "gravity-claw",
        voice_tone_frequency: value,
        prompt_blueprint: `Calibrated: ${slider} → ${value}`,
      },
      { onConflict: "agent_name" }
    )
    .select();

  if (error) throw error;
  return data?.[0];
}

// ── Log a glitch ──
export async function logGlitch(
  severity: "Critical" | "Minor" | "Biological Drag",
  description: string,
  resolution?: string
) {
  const { error } = await supabase.from("glitch_log").insert({
    severity,
    description,
    resolution_steps: resolution || null,
  });
  if (error) throw error;
}

// ── Sync Activity: Push to sync_log (For Mission Control Feed) ──
export async function logSyncActivity(
  type: string,
  title: string,
  detail: string,
  status: "success" | "error" = "success"
) {
  const { error } = await supabase.from("sync_log").insert({
    type: type.toUpperCase(),
    title,
    detail,
    status,
    timestamp: new Date().toISOString(),
  });
  if (error) {
    console.error("Failed to log sync activity:", error);
    // Non-blocking but log to glitch_log if it fails
    await logGlitch("Minor", `Sync log failure: ${error.message}`);
  }
}
