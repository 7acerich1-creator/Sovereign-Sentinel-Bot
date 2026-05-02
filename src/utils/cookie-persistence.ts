// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COOKIE PERSISTENCE LAYER (S128, 2026-05-02)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Problem solved: Railway service has no Volume mounted on /app/data,
// so /app/data/browser-cookies/<domain>_<account>.json files are wiped
// on every redeploy. Architect imports cookies via /api/browser/import-
// cookies, then the next deploy nukes them and Yuki's TT/IG workers
// silently fail. Until 2026-05-02 this kept happening invisibly.
//
// Fix: mirror cookies to Supabase table browser_cookies_persistent
// (created in migration 20260502_browser_cookies_persistent.sql) and
// restore them to disk at boot. The disk-based loadCookies() callers
// don't change — they keep reading from the same path.
//
// Pattern mirrors src/utils/ytdlp-download.ts:ensureCookiesFile() which
// reads YOUTUBE_COOKIES_BASE64 → /tmp/yt-cookies.txt at first use.
// Difference: we use Supabase (writable from /api/browser/import-cookies)
// instead of an env var (would require Architect to base64-encode and
// paste into Railway dashboard on every cookie refresh).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { writeFileSync, mkdirSync, existsSync } from "fs";
import type { Cookie } from "puppeteer-core";

const COOKIE_DIR = "/app/data/browser-cookies";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

function cookiePath(domain: string, account: string): string {
  const cleanDomain = domain.replace(/[^a-zA-Z0-9]/g, "_");
  const cleanAccount = account.replace(/[^a-zA-Z0-9]/g, "_");
  return `${COOKIE_DIR}/${cleanDomain}_${cleanAccount}.json`;
}

/**
 * Upsert cookies for a (domain, account) into Supabase.
 * Called from /api/browser/import-cookies right after saveCookies() writes
 * to disk. Best-effort: on failure, logs and returns false but does NOT throw,
 * because the disk write already succeeded and the immediate poll will work.
 * The next redeploy is when persistence matters.
 */
export async function persistCookiesToSupabase(
  domain: string,
  account: string,
  cookies: Cookie[] | any[],
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn(`[cookie-persist] Supabase not configured, skipping ${domain}/${account}`);
    return false;
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/browser_cookies_persistent`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        // Upsert via on_conflict on the primary key (domain, account)
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        domain,
        account,
        cookies,
        cookie_count: cookies.length,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[cookie-persist] upsert ${domain}/${account} HTTP ${resp.status}: ${body.slice(0, 200)}`);
      return false;
    }
    console.log(`💾 [cookie-persist] mirrored ${cookies.length} cookies for ${domain}/${account} to Supabase`);
    return true;
  } catch (err: any) {
    console.error(`[cookie-persist] upsert ${domain}/${account} threw: ${err.message}`);
    return false;
  }
}

/**
 * At boot: read every row from browser_cookies_persistent and write to disk.
 * Called once from main() before any worker that uses cookies starts polling.
 *
 * Returns a summary so boot-smoke-test can include it in the boot log.
 *
 * Skips writes if a fresher file already exists on disk (handles the rare case
 * where /app/data IS volumed — disk wins, Supabase is the cold-start source).
 */
export async function restoreAllCookiesFromSupabase(): Promise<{
  restored: number;
  skipped: number;
  errors: number;
  details: Array<{ domain: string; account: string; count: number; outcome: string }>;
}> {
  const summary = { restored: 0, skipped: 0, errors: 0, details: [] as Array<{ domain: string; account: string; count: number; outcome: string }> };

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[cookie-restore] Supabase not configured, skipping cookie restore");
    return summary;
  }

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/browser_cookies_persistent?select=domain,account,cookies,cookie_count,updated_at`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!resp.ok) {
      console.error(`[cookie-restore] fetch HTTP ${resp.status}`);
      summary.errors++;
      return summary;
    }
    const rows = (await resp.json()) as Array<{
      domain: string;
      account: string;
      cookies: Cookie[];
      cookie_count: number;
      updated_at: string;
    }>;

    if (rows.length === 0) {
      console.log("[cookie-restore] no rows in browser_cookies_persistent — nothing to restore");
      return summary;
    }

    if (!existsSync(COOKIE_DIR)) {
      mkdirSync(COOKIE_DIR, { recursive: true });
    }

    for (const row of rows) {
      const path = cookiePath(row.domain, row.account);
      try {
        // If a file already exists from a previous boot in the same container
        // (which shouldn't normally happen but might if /app/data IS volumed),
        // skip to preserve any in-session cookie rotation. This is a safety
        // belt — the common case is disk is empty after a redeploy.
        if (existsSync(path)) {
          summary.skipped++;
          summary.details.push({ domain: row.domain, account: row.account, count: row.cookie_count, outcome: "skipped (disk exists)" });
          continue;
        }
        writeFileSync(path, JSON.stringify(row.cookies, null, 2));
        summary.restored++;
        summary.details.push({ domain: row.domain, account: row.account, count: row.cookie_count, outcome: "restored" });
        console.log(`🍪 [cookie-restore] ${row.domain}/${row.account}: ${row.cookie_count} cookies → ${path}`);
      } catch (err: any) {
        summary.errors++;
        summary.details.push({ domain: row.domain, account: row.account, count: row.cookie_count, outcome: `error: ${err.message}` });
        console.error(`[cookie-restore] write ${path} failed: ${err.message}`);
      }
    }

    console.log(
      `🍪 [cookie-restore] complete: restored=${summary.restored} skipped=${summary.skipped} errors=${summary.errors}`,
    );
    return summary;
  } catch (err: any) {
    console.error(`[cookie-restore] threw: ${err.message}`);
    summary.errors++;
    return summary;
  }
}
