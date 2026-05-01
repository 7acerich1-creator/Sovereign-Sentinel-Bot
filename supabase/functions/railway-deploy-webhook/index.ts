// ============================================================
// RAILWAY DEPLOY WEBHOOK — SELF-HEALING LAYER 1 + 2
// S126 — 2026-04-30
//
// Layer 1: Receives Railway deploy webhooks. On any FAILED /
//   CRASHED status, posts a Telegram alert via Sapphire's bot
//   so the Architect knows within ~30s that the build broke.
// Layer 2: Classifies the failure (transient vs. code-bug) by
//   pulling deployment logs from Railway GraphQL. Transient
//   errors (network timeouts, PyPI BrokenPipe, 5xx, rate-limit)
//   trigger ONE auto-redeploy via the deploymentRedeploy
//   mutation. Code-bug errors escalate to the Architect with
//   the first 800 chars of the error log.
//
// Idempotency: every deployment_id is tracked in `deploy_events`
//   with a retry_count. Auto-retry is capped at 1 per deployment.
//
// Trust model: webhook source is verified by a shared secret in
//   the URL path (?secret=...). Railway does not currently sign
//   webhooks with HMAC, so this is the cheapest reliable check.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ── Error classification patterns (locked in memory file) ──
const TRANSIENT_PATTERNS: RegExp[] = [
  /BrokenPipeError/i,
  /Connection reset/i,
  /Read timed out/i,
  /Connection timed out/i,
  /503 Service Unavailable/i,
  /502 Bad Gateway/i,
  /504 Gateway Timeout/i,
  /429 Too Many Requests/i,
  /Network is unreachable/i,
  /i\/o timeout/i,
  /TLS handshake timeout/i,
  /temporary failure in name resolution/i,
  /no space left on device.{0,40}image pull/i, // pull-time disk pressure usually clears
  /context deadline exceeded/i,
  /unexpected EOF/i,
  /failed to fetch.{0,40}registry/i,
  /Could not resolve host/i,
  /pip install.{0,200}(BrokenPipe|reset|timeout)/i,
];

const CODE_BUG_PATTERNS: RegExp[] = [
  /error TS\d+:/,                       // tsc errors
  /Cannot find module/,
  /SyntaxError/,
  /Module not found/,
  /is not a function/,
  /Cannot read propert(y|ies)/,
  /ReferenceError/,
  /TypeError(?!.*timeout)/,             // exclude TypeError: timeout
  /UnhandledPromiseRejection/,
  /npm ERR! ENOTFOUND.{0,40}package\.json/i, // missing package
  /Failed to compile/i,
  /Build failed.{0,40}exit code 1/i,
];

type Classification = "transient" | "code_bug" | "unknown";

function classifyError(logExcerpt: string): Classification {
  if (!logExcerpt) return "unknown";
  // Check code-bug FIRST — a transient pattern in the same log doesn't override
  // a clear tsc/syntax error. Code bugs are the more authoritative signal.
  for (const p of CODE_BUG_PATTERNS) {
    if (p.test(logExcerpt)) return "code_bug";
  }
  for (const p of TRANSIENT_PATTERNS) {
    if (p.test(logExcerpt)) return "transient";
  }
  return "unknown";
}

// ── Telegram alert via Sapphire's bot ──
async function sendTelegramAlert(
  text: string,
  opts: { parseMode?: "Markdown" | "MarkdownV2" | "HTML" } = {}
): Promise<{ ok: boolean; error?: string }> {
  const token = Deno.env.get("SAPPHIRE_TOKEN");
  const chatId = Deno.env.get("ARCHITECT_CHAT_ID") ||
    Deno.env.get("TELEGRAM_AUTHORIZED_USER_ID") ||
    "8593700720";
  if (!token) return { ok: false, error: "SAPPHIRE_TOKEN not set" };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4096),
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

// ── Railway GraphQL helpers ──
const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";

async function railwayGql<T = any>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: T; errors?: any[] }> {
  const res = await fetch(RAILWAY_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  return json;
}

async function fetchDeploymentLogs(
  token: string,
  deploymentId: string,
  limit = 200,
): Promise<string> {
  const query = `
    query DeploymentLogs($deploymentId: String!, $limit: Int) {
      deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
        timestamp
        message
        severity
      }
    }
  `;
  try {
    const out = await railwayGql<{ deploymentLogs: Array<{ message: string; severity?: string }> }>(
      token,
      query,
      { deploymentId, limit },
    );
    if (out.errors?.length) {
      // Try the build-logs variant — Railway sometimes routes differently
      const bquery = `
        query BuildLogs($deploymentId: String!, $limit: Int) {
          buildLogs(deploymentId: $deploymentId, limit: $limit) {
            timestamp
            message
          }
        }
      `;
      const bout = await railwayGql<{ buildLogs: Array<{ message: string }> }>(
        token,
        bquery,
        { deploymentId, limit },
      );
      if (bout.data?.buildLogs?.length) {
        return bout.data.buildLogs.map((l) => l.message).join("\n");
      }
      return "";
    }
    return (out.data?.deploymentLogs ?? []).map((l) => l.message).join("\n");
  } catch (_e) {
    return "";
  }
}

async function redeployDeployment(
  token: string,
  deploymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const mutation = `
    mutation Redeploy($id: String!) {
      deploymentRedeploy(id: $id) {
        id
        status
      }
    }
  `;
  try {
    const out = await railwayGql<{ deploymentRedeploy: { id: string; status: string } }>(
      token,
      mutation,
      { id: deploymentId },
    );
    if (out.errors?.length) {
      return { ok: false, error: JSON.stringify(out.errors).slice(0, 300) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

// ── Idempotency helpers ──
async function getRetryCount(supabase: SupabaseClient, deploymentId: string): Promise<number> {
  const { data } = await supabase
    .from("deploy_events")
    .select("retry_count")
    .eq("deployment_id", deploymentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.retry_count ?? 0;
}

async function logDeployEvent(
  supabase: SupabaseClient,
  fields: {
    deployment_id: string;
    project_id?: string;
    service_id?: string;
    environment_id?: string;
    status: string;
    classification?: string;
    action_taken?: string;
    retry_count?: number;
    error_excerpt?: string;
    raw_payload?: unknown;
  },
): Promise<void> {
  try {
    await supabase.from("deploy_events").insert({
      deployment_id: fields.deployment_id,
      project_id: fields.project_id ?? null,
      service_id: fields.service_id ?? null,
      environment_id: fields.environment_id ?? null,
      status: fields.status,
      classification: fields.classification ?? null,
      action_taken: fields.action_taken ?? null,
      retry_count: fields.retry_count ?? 0,
      error_excerpt: fields.error_excerpt ? fields.error_excerpt.slice(0, 4000) : null,
      raw_payload: fields.raw_payload ?? null,
    });
  } catch (e) {
    console.error("deploy_events insert failed:", e);
  }
}

// ── Format the Telegram alert body ──
function formatAlert(opts: {
  status: string;
  classification: Classification;
  action: "alert_only" | "auto_redeploy" | "escalated" | "redeploy_failed";
  serviceName?: string;
  projectName?: string;
  deploymentId: string;
  errorExcerpt: string;
  retryCount: number;
}): string {
  const head = (() => {
    if (opts.action === "auto_redeploy") return "🔁 *Railway auto-retry triggered*";
    if (opts.action === "redeploy_failed") return "🚨 *Railway redeploy MUTATION FAILED*";
    if (opts.action === "escalated") return "🚨 *Railway build broken — code bug detected*";
    return "⚠️ *Railway deploy alert*";
  })();

  const proj = opts.projectName || "?";
  const svc = opts.serviceName || "?";
  const sev =
    opts.classification === "transient"
      ? "transient (network/timeout)"
      : opts.classification === "code_bug"
      ? "code bug (no auto-retry)"
      : "unknown";
  const errExc = opts.errorExcerpt
    ? "\n\n*Last log excerpt:*\n```\n" + opts.errorExcerpt.slice(0, 800) + "\n```"
    : "";

  const advice = (() => {
    if (opts.action === "auto_redeploy") {
      return "\n\nA single retry was issued. If the next deploy event fails, this will escalate.";
    }
    if (opts.action === "escalated") {
      return "\n\nReply `/diagnose` and Sapphire will pull the full log + cross-reference past incidents.";
    }
    if (opts.action === "redeploy_failed") {
      return "\n\nManual redeploy required from the Railway dashboard.";
    }
    return "";
  })();

  return [
    head,
    `Status: \`${opts.status}\``,
    `Service: \`${svc}\``,
    `Project: \`${proj}\``,
    `Deployment: \`${opts.deploymentId}\``,
    `Classification: ${sev}`,
    `Retry count: ${opts.retryCount}`,
    errExc,
    advice,
  ].join("\n");
}

// ── Entry point ──
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Shared-secret auth (cheapest reliable verification)
  const url = new URL(req.url);
  const expected = Deno.env.get("RAILWAY_WEBHOOK_SECRET");
  const provided = url.searchParams.get("secret") || req.headers.get("x-webhook-secret");
  if (expected && expected !== provided) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const status: string = payload?.status || payload?.deployment?.status || "UNKNOWN";
  const deploymentId: string =
    payload?.deployment?.id || payload?.deploymentId || "unknown";
  const projectName: string | undefined = payload?.project?.name;
  const serviceName: string | undefined = payload?.service?.name;
  const projectId: string | undefined = payload?.project?.id;
  const serviceId: string | undefined = payload?.service?.id;
  const environmentId: string | undefined = payload?.environment?.id;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const railwayToken = Deno.env.get("RAILWAY_API_TOKEN") || "";

  // Only act on terminal-failure states
  const failedStates = new Set(["FAILED", "CRASHED", "REMOVED"]);
  const successStates = new Set(["SUCCESS", "DEPLOYED"]);

  if (successStates.has(status)) {
    // Log only — useful for canary correlation
    await logDeployEvent(supabase, {
      deployment_id: deploymentId,
      project_id: projectId,
      service_id: serviceId,
      environment_id: environmentId,
      status,
      classification: "n/a",
      action_taken: "no_op",
      raw_payload: payload,
    });
    return new Response(JSON.stringify({ ok: true, action: "logged_success" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!failedStates.has(status)) {
    // Lifecycle event we don't act on (BUILDING, DEPLOYING, etc.)
    return new Response(JSON.stringify({ ok: true, action: "ignored", status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── FAILED / CRASHED / REMOVED handling ──
  let logs = "";
  if (railwayToken && deploymentId !== "unknown") {
    logs = await fetchDeploymentLogs(railwayToken, deploymentId);
  }
  const classification = classifyError(logs);
  const priorRetries = await getRetryCount(supabase, deploymentId);

  // Layer 2 — auto-retry transient errors, exactly once per deployment
  let action: "alert_only" | "auto_redeploy" | "escalated" | "redeploy_failed" = "alert_only";
  let nextRetry = priorRetries;

  if (classification === "transient" && priorRetries < 1 && railwayToken) {
    const r = await redeployDeployment(railwayToken, deploymentId);
    if (r.ok) {
      action = "auto_redeploy";
      nextRetry = priorRetries + 1;
    } else {
      action = "redeploy_failed";
    }
  } else if (classification === "code_bug") {
    action = "escalated";
  } else if (classification === "transient" && priorRetries >= 1) {
    // Already retried once; escalate
    action = "escalated";
  }

  await logDeployEvent(supabase, {
    deployment_id: deploymentId,
    project_id: projectId,
    service_id: serviceId,
    environment_id: environmentId,
    status,
    classification,
    action_taken: action,
    retry_count: nextRetry,
    error_excerpt: logs,
    raw_payload: payload,
  });

  // ── Alert ──
  const alertText = formatAlert({
    status,
    classification,
    action,
    projectName,
    serviceName,
    deploymentId,
    errorExcerpt: logs,
    retryCount: nextRetry,
  });
  const alert = await sendTelegramAlert(alertText, { parseMode: "Markdown" });

  return new Response(
    JSON.stringify({
      ok: true,
      action,
      classification,
      retry_count: nextRetry,
      alert_sent: alert.ok,
      alert_error: alert.error,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
