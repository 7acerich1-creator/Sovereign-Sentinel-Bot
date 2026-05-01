// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Self-Healing Layer 3 — Boot-Time Smoke Test
// S126 — 2026-04-30
//
// Runs the FIRST thing in main() after dotenv. Validates that the
// runtime substrate the bot depends on is actually wired:
//   • Required Supabase tables exist + readable
//   • Per-agent LLM env vars set (the keys for each agent's chain)
//   • Pinecone namespaces reachable
//   • Tool-name uniqueness across the registered tool array
//
// CRITICAL failures (table missing, agent's primary key unset)
// trigger a Telegram alert via Sapphire's bot AND mark the failed
// dependency so callers can refuse to register the affected
// surface (e.g., don't register MemoryTool if agent_core_memory
// is missing — better to be visibly broken than silently broken).
//
// WARNING failures (sub-optimal but functional) log only.
//
// Every run logs to public.smoke_test_runs so we can chart
// "which dependencies are flaky over time" on Mission Control.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import { randomUUID } from "crypto";

export type SmokeSeverity = "critical" | "warning" | "info";

export type SmokeResult = {
  name: string;
  severity: SmokeSeverity;
  passed: boolean;
  details?: string;
};

export type SmokeReport = {
  bootId: string;
  results: SmokeResult[];
  criticalFailed: SmokeResult[];
  warningFailed: SmokeResult[];
  startedAt: number;
  finishedAt: number;
};

// ── Configuration: what to check ──

// Tables the bot writes to or reads from. If any are missing,
// silent failures will follow. (List sourced from
// project_self_healing_architecture.md.)
const REQUIRED_TABLES = [
  "agent_core_memory",
  "agent_diary",
  "agent_significance",
  "agent_spend",
  "conditional_reminders",
  "sapphire_entities",
  "sapphire_relationships",
  "anita_audience_segments",
  "anita_experiments",
  "sapphire_known_facts",
  "sapphire_reminders",
  "sapphire_followups",
  "sapphire_plans",
  "messages_log",
  "niche_cooldown",
  "pipeline_rotation_state",
  "youtube_comments_seen",
  "tasks",
  "briefings",
  "crew_dispatch",
  "sovereign_metrics",
  "relationship_context",
  "deploy_events",
  "bot_health_pulses",
  "smoke_test_runs",
];

// Env-var dependencies per LLM provider. If an agent's primary
// provider's key is missing, that agent will silently failover
// to its secondary on every turn — wasteful and a sign of misconfig.
const LLM_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

// Bot tokens — each agent gets their own Telegram bot.
const AGENT_TOKEN_VARS: Record<string, string> = {
  veritas: "VERITAS_TOKEN",
  sapphire: "SAPPHIRE_TOKEN",
  alfred: "ALFRED_TOKEN",
  yuki: "YUKI_TOKEN",
  anita: "ANITA_TOKEN",
  vector: "VECTOR_TOKEN",
};

// Other infra dependencies that are critical when the system tries
// to use them (some are degraded-mode fine — those are warnings).
type EnvCheck = { var: string; severity: SmokeSeverity; reason: string };
const INFRA_ENVS: EnvCheck[] = [
  { var: "SUPABASE_URL",                 severity: "critical", reason: "all persistence" },
  { var: "SUPABASE_SERVICE_ROLE_KEY",    severity: "critical", reason: "service writes" },
  { var: "PINECONE_HOST",                severity: "warning",  reason: "semantic recall (degrades to keyword)" },
  { var: "PINECONE_API_KEY",             severity: "warning",  reason: "semantic recall (degrades to keyword)" },
  { var: "PINECONE_INDEX",               severity: "warning",  reason: "semantic recall (degrades to keyword)" },
  { var: "RAILWAY_API_TOKEN",            severity: "warning",  reason: "Layer 2 auto-retry (manual redeploy still works)" },
  { var: "RAILWAY_WEBHOOK_SECRET",       severity: "warning",  reason: "Layer 1 webhook auth (alerts still flow if secret unset)" },
];

// Pinecone namespaces the bot writes to — if any 404s, writes
// will silently fail. (Per-agent namespaces from S125+ Phase 8.)
const PINECONE_NAMESPACES = [
  "sapphire-personal",
  "anita-personal",
  "yuki-personal",
  "vector-personal",
  "veritas-personal",
  "alfred-personal",
  "shared",
  "sovereign-synthesis",
];

// ── Individual checks ──

async function checkSupabaseTable(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
): Promise<SmokeResult> {
  try {
    // SELECT 1 FROM <table> LIMIT 0 — catches missing tables AND wrong column names.
    // PostgREST equivalent: HEAD with limit 0 still validates the relation.
    const url = `${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`;
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Range: "0-0",
      },
    });
    if (res.status >= 200 && res.status < 400) {
      return { name: `supabase_table:${table}`, severity: "critical", passed: true };
    }
    return {
      name: `supabase_table:${table}`,
      severity: "critical",
      passed: false,
      details: `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return {
      name: `supabase_table:${table}`,
      severity: "critical",
      passed: false,
      details: e?.message?.slice(0, 200) ?? "unknown error",
    };
  }
}

function checkEnvVar(name: string, severity: SmokeSeverity, reason: string): SmokeResult {
  const v = process.env[name];
  if (v && v.trim().length > 0) {
    return { name: `env:${name}`, severity, passed: true };
  }
  return {
    name: `env:${name}`,
    severity,
    passed: false,
    details: `unset — needed for: ${reason}`,
  };
}

function checkAgentChain(agentName: string, chain: string[]): SmokeResult[] {
  const results: SmokeResult[] = [];
  // Primary provider key must be set; fallback can be unset and we'd warn.
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const envVar = LLM_ENV_VARS[provider];
    if (!envVar) continue;
    const present = !!(process.env[envVar] && process.env[envVar]!.trim().length > 0);
    const severity: SmokeSeverity = i === 0 ? "critical" : "warning";
    results.push({
      name: `agent:${agentName}:${provider}:${envVar}`,
      severity,
      passed: present,
      details: present
        ? undefined
        : i === 0
        ? `primary provider ${provider} for ${agentName} has no key`
        : `fallback provider ${provider} for ${agentName} has no key`,
    });
  }
  return results;
}

function checkAgentToken(agentName: string): SmokeResult {
  const envVar = AGENT_TOKEN_VARS[agentName];
  if (!envVar) {
    return { name: `agent_token:${agentName}`, severity: "info", passed: true };
  }
  const present = !!(process.env[envVar] && process.env[envVar]!.trim().length > 0);
  return {
    name: `agent_token:${agentName}:${envVar}`,
    severity: agentName === "sapphire" || agentName === "veritas" ? "critical" : "warning",
    passed: present,
    details: present ? undefined : `${envVar} unset — ${agentName} bot won't initialize`,
  };
}

async function checkPineconeNamespaces(): Promise<SmokeResult[]> {
  const host = process.env.PINECONE_HOST;
  const apiKey = process.env.PINECONE_API_KEY;
  if (!host || !apiKey) {
    // Already covered by INFRA_ENVS warnings; skip the per-namespace probe.
    return [
      {
        name: "pinecone_namespaces",
        severity: "warning",
        passed: false,
        details: "PINECONE_HOST or PINECONE_API_KEY unset; skipping namespace probe",
      },
    ];
  }

  try {
    const res = await fetch(`${host}/describe_index_stats`, {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      return [
        {
          name: "pinecone:describe_index_stats",
          severity: "warning",
          passed: false,
          details: `HTTP ${res.status}`,
        },
      ];
    }
    const stats = (await res.json()) as { namespaces?: Record<string, { vectorCount?: number }> };
    const namespaces = stats?.namespaces || {};
    return PINECONE_NAMESPACES.map((ns) => {
      const present = ns in namespaces;
      return {
        name: `pinecone_namespace:${ns}`,
        // Missing namespaces are warnings — Pinecone autocreates on first write.
        // But namespace 404 on FIRST write is the silent-failure surface; we want it surfaced.
        severity: "warning" as SmokeSeverity,
        passed: present,
        details: present
          ? `${namespaces[ns]?.vectorCount ?? 0} vectors`
          : "namespace empty or not yet created (first write will create it)",
      };
    });
  } catch (e: any) {
    return [
      {
        name: "pinecone:probe",
        severity: "warning",
        passed: false,
        details: e?.message?.slice(0, 200) ?? "probe failed",
      },
    ];
  }
}

export function checkToolNameUniqueness(toolNames: string[]): SmokeResult {
  const seen = new Map<string, number>();
  for (const n of toolNames) {
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  const dupes: string[] = [];
  for (const [k, v] of seen.entries()) {
    if (v > 1) dupes.push(`${k} (×${v})`);
  }
  if (dupes.length === 0) {
    return { name: "tool_uniqueness", severity: "critical", passed: true };
  }
  return {
    name: "tool_uniqueness",
    severity: "critical",
    passed: false,
    details: `duplicate tool names: ${dupes.join(", ")}`,
  };
}

// ── Telegram alert (uses Sapphire's bot directly, not the agent loop) ──
async function sendBootAlert(text: string): Promise<void> {
  const token = process.env.SAPPHIRE_TOKEN || process.env.VERITAS_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    process.env.ARCHITECT_CHAT_ID ||
    process.env.TELEGRAM_AUTHORIZED_USER_ID ||
    process.env.AUTHORIZED_USER_ID ||
    "8593700720";
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        parse_mode: "Markdown",
      }),
    });
  } catch (e) {
    console.error("[BootSmokeTest] Telegram alert failed:", e);
  }
}

// ── Persistence ──
async function persistResults(report: SmokeReport): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  // One row per check
  const rows = report.results.map((r) => ({
    boot_id: report.bootId,
    check_name: r.name,
    severity: r.severity,
    passed: r.passed,
    details: r.details ? r.details.slice(0, 4000) : null,
  }));
  if (rows.length === 0) return;

  try {
    await fetch(`${supabaseUrl}/rest/v1/smoke_test_runs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
  } catch (e) {
    console.error("[BootSmokeTest] persist failed:", e);
  }
}

// ── Public entry point ──

export type SmokeOptions = {
  agentChains?: Record<string, string[]>;     // e.g. { sapphire: ['anthropic','gemini','groq'] }
  toolNames?: string[];                       // global tool registry names
  alertOnCritical?: boolean;                  // default true
  persist?: boolean;                          // default true
};

export async function runBootSmokeTest(opts: SmokeOptions = {}): Promise<SmokeReport> {
  const startedAt = Date.now();
  const bootId = randomUUID();
  const results: SmokeResult[] = [];

  // 1. Infra env vars
  for (const e of INFRA_ENVS) {
    results.push(checkEnvVar(e.var, e.severity, e.reason));
  }

  // 2. Per-agent chains
  if (opts.agentChains) {
    for (const [agent, chain] of Object.entries(opts.agentChains)) {
      results.push(...checkAgentChain(agent, chain));
      results.push(checkAgentToken(agent));
    }
  }

  // 3. Supabase tables (skip if SUPABASE_URL/SERVICE_KEY missing — already a critical above)
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    // Run in parallel batches of 8 to keep boot time bounded
    const batchSize = 8;
    for (let i = 0; i < REQUIRED_TABLES.length; i += batchSize) {
      const batch = REQUIRED_TABLES.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((t) => checkSupabaseTable(supabaseUrl, serviceKey, t)),
      );
      results.push(...batchResults);
    }
  } else {
    results.push({
      name: "supabase_tables_probe",
      severity: "critical",
      passed: false,
      details: "skipped — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY unset",
    });
  }

  // 4. Pinecone namespaces
  results.push(...(await checkPineconeNamespaces()));

  // 5. Tool name uniqueness
  if (opts.toolNames && opts.toolNames.length > 0) {
    results.push(checkToolNameUniqueness(opts.toolNames));
  }

  const finishedAt = Date.now();
  const criticalFailed = results.filter((r) => !r.passed && r.severity === "critical");
  const warningFailed = results.filter((r) => !r.passed && r.severity === "warning");

  const report: SmokeReport = {
    bootId,
    results,
    criticalFailed,
    warningFailed,
    startedAt,
    finishedAt,
  };

  // ── Console summary ──
  console.log(
    `🩺 [BootSmokeTest] ran ${results.length} checks in ${finishedAt - startedAt}ms — ` +
      `${criticalFailed.length} critical, ${warningFailed.length} warnings`,
  );
  if (criticalFailed.length > 0) {
    console.error("🚨 [BootSmokeTest] CRITICAL FAILURES:");
    for (const f of criticalFailed) {
      console.error(`   ✗ ${f.name}${f.details ? ` — ${f.details}` : ""}`);
    }
  }
  if (warningFailed.length > 0) {
    console.warn("⚠️  [BootSmokeTest] warnings:");
    for (const f of warningFailed.slice(0, 12)) {
      console.warn(`   ~ ${f.name}${f.details ? ` — ${f.details}` : ""}`);
    }
    if (warningFailed.length > 12) {
      console.warn(`   ~ ...and ${warningFailed.length - 12} more`);
    }
  }

  // ── Persist ──
  if (opts.persist !== false) {
    await persistResults(report);
  }

  // ── Alert on critical ──
  if (opts.alertOnCritical !== false && criticalFailed.length > 0) {
    const lines = criticalFailed.slice(0, 12).map(
      (f) => `• \`${f.name}\`${f.details ? ` — ${f.details}` : ""}`,
    );
    const more = criticalFailed.length > 12 ? `\n…and ${criticalFailed.length - 12} more.` : "";
    const text =
      `🚨 *Boot Smoke Test — CRITICAL FAILURES*\n` +
      `Boot id: \`${bootId}\`\n` +
      `${criticalFailed.length} critical / ${warningFailed.length} warnings\n\n` +
      lines.join("\n") +
      more +
      `\n\nThe affected surfaces will degrade or refuse to register. ` +
      `Reply \`/diagnose\` for Sapphire to walk the failure.`;
    await sendBootAlert(text);
  }

  return report;
}

// Helper: which surfaces should refuse to register, given the report?
export function surfaceShouldRefuse(report: SmokeReport, prefix: string): boolean {
  return report.criticalFailed.some((r) => r.name.startsWith(prefix));
}
