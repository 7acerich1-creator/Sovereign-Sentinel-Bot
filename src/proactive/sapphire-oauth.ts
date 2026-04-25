// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire OAuth (Personal Assistant)
// Session 114 — 2026-04-24
//
// OOB OAuth flow for Sapphire's Gmail + Calendar access.
// Reuses existing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET (single Google
// OAuth client, two account labels: empoweredservices2013 + 7ace.rich1).
//
// Refresh tokens land in Supabase table `sapphire_credentials`, NOT in
// Railway env vars. Survives every redeploy. No env paste required from Ace.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { config } from "../config";

// ── Account labels ──────────────────────────────────────────────────────────
export type SapphireAccountLabel = "empoweredservices2013" | "7ace.rich1";

export const SAPPHIRE_GOOGLE_ACCOUNTS: SapphireAccountLabel[] = [
  "empoweredservices2013",
  "7ace.rich1",
];

// ── Scopes Sapphire needs ───────────────────────────────────────────────────
// Read inbox, send, manage drafts/labels, full calendar access.
const SAPPHIRE_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

// Real OAuth callback URL — Google deprecated OOB in 2022 and the existing
// OAuth client now rejects it (verified live 2026-04-24: "Error 400:
// redirect_uri_mismatch"). The redirect URI must be registered in the GCP
// console for this OAuth client. Endpoint is handled inline in webhooks.ts.
const OAUTH_REDIRECT_URI = process.env.SAPPHIRE_OAUTH_REDIRECT_URI
  || "https://gravity-claw-production-d849.up.railway.app/api/sapphire-oauth-callback";

// ── 1. Generate consent URL ─────────────────────────────────────────────────
export function generateGoogleConsentUrl(accountLabel: SapphireAccountLabel): string | null {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: SAPPHIRE_GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // forces refresh_token issuance every time
    // login_hint helps Google preselect the right account when Ace has multiple sessions
    login_hint: accountLabel === "empoweredservices2013"
      ? "empoweredservices2013@gmail.com"
      : "7ace.rich1@gmail.com",
    state: `sapphire-${accountLabel}-${Date.now()}`,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ── 2. Exchange auth code for refresh token + persist ───────────────────────
export async function exchangeCodeForRefreshToken(
  accountLabel: SapphireAccountLabel,
  authCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not set in Railway env." };
  }

  let resp: Response;
  try {
    resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: authCode.trim(),
        grant_type: "authorization_code",
        redirect_uri: OAUTH_REDIRECT_URI,
      }).toString(),
    });
  } catch (e: any) {
    return { ok: false, error: `Token endpoint network error: ${e.message}` };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unreadable>");
    return { ok: false, error: `Token endpoint ${resp.status}: ${body.slice(0, 300)}` };
  }

  const data = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  if (!data.refresh_token) {
    return {
      ok: false,
      error:
        "Google did not return a refresh_token. This usually means the same account was already authorized previously without `prompt=consent`. " +
        "Fix: revoke the app at https://myaccount.google.com/permissions, then re-run /auth_google.",
    };
  }

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;
  const scopes = data.scope ? data.scope.split(" ") : SAPPHIRE_GOOGLE_SCOPES;

  // Persist to sapphire_credentials
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );

  const { error: dbErr } = await supabase
    .from("sapphire_credentials")
    .upsert(
      {
        account_label: accountLabel,
        service: "google",
        refresh_token: data.refresh_token,
        access_token: data.access_token ?? null,
        access_token_expires_at: expiresAt,
        scopes,
        notes: `Authorized via OOB on ${new Date().toISOString()}`,
      },
      { onConflict: "account_label,service" },
    );

  if (dbErr) {
    return { ok: false, error: `Supabase upsert failed: ${dbErr.message}` };
  }

  return { ok: true };
}

// ── 3. Fetch a valid access token (refresh on demand) ───────────────────────
//
// Strategy: read the cached access_token if it has >60s left. Otherwise refresh
// using refresh_token, write the new access_token + expiry back to Supabase,
// return the fresh token.
export async function getValidGoogleAccessToken(
  accountLabel: SapphireAccountLabel,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not set." };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );

  const { data: row, error: readErr } = await supabase
    .from("sapphire_credentials")
    .select("refresh_token, access_token, access_token_expires_at")
    .eq("account_label", accountLabel)
    .eq("service", "google")
    .maybeSingle();

  if (readErr) {
    return { ok: false, error: `Supabase read failed: ${readErr.message}` };
  }
  if (!row) {
    return {
      ok: false,
      error: `No credentials for ${accountLabel}. Ace must run /auth_google_${accountLabel === "empoweredservices2013" ? "primary" : "secondary"} first.`,
    };
  }

  // If cached access token has >60s left, use it.
  if (row.access_token && row.access_token_expires_at) {
    const expMs = new Date(row.access_token_expires_at).getTime();
    if (expMs - Date.now() > 60_000) {
      return { ok: true, token: row.access_token };
    }
  }

  // Refresh.
  let resp: Response;
  try {
    resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch (e: any) {
    return { ok: false, error: `Refresh network error: ${e.message}` };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unreadable>");
    return { ok: false, error: `Refresh ${resp.status}: ${body.slice(0, 300)}` };
  }

  const data = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    return { ok: false, error: "Refresh returned no access_token." };
  }

  const newExpiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  // Cache it back.
  await supabase
    .from("sapphire_credentials")
    .update({
      access_token: data.access_token,
      access_token_expires_at: newExpiresAt,
    })
    .eq("account_label", accountLabel)
    .eq("service", "google");

  return { ok: true, token: data.access_token };
}

// ── 4. Notion token storage (simpler — just paste the integration token) ────
export async function storeNotionToken(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token || token.length < 30) {
    return { ok: false, error: "Notion token looks too short. Should start with `secret_` or `ntn_`." };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );

  const { error } = await supabase
    .from("sapphire_credentials")
    .upsert(
      {
        account_label: "notion",
        service: "notion",
        refresh_token: token, // re-use field — Notion tokens don't expire
        scopes: ["pages.read", "pages.write", "databases.read", "databases.write"],
        notes: `Stored ${new Date().toISOString()}`,
      },
      { onConflict: "account_label,service" },
    );

  if (error) return { ok: false, error: `Supabase upsert failed: ${error.message}` };
  return { ok: true };
}

export async function getNotionToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );

  const { data: row, error } = await supabase
    .from("sapphire_credentials")
    .select("refresh_token")
    .eq("account_label", "notion")
    .eq("service", "notion")
    .maybeSingle();

  if (error) return { ok: false, error: `Supabase read failed: ${error.message}` };
  if (!row) return { ok: false, error: "No Notion token. Run /auth_notion." };
  return { ok: true, token: row.refresh_token };
}

// ── 5. Status check (Sapphire's /auth_status command uses this) ─────────────
export async function getSapphireAuthStatus(): Promise<{
  google: Record<SapphireAccountLabel, boolean>;
  notion: boolean;
}> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    config.memory.supabaseUrl!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || config.memory.supabaseKey)!,
  );

  const { data } = await supabase
    .from("sapphire_credentials")
    .select("account_label, service");

  const rows = data ?? [];
  const has = (label: string, service: string) =>
    rows.some((r: any) => r.account_label === label && r.service === service);

  return {
    google: {
      empoweredservices2013: has("empoweredservices2013", "google"),
      "7ace.rich1": has("7ace.rich1", "google"),
    },
    notion: has("notion", "notion"),
  };
}
