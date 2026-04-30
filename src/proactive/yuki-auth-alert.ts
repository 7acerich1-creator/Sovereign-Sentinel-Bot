// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Yuki Auth Failure Alert (S126b)
// Shared helper for IG/FB/TT repliers. Per Architect feedback 2026-04-30:
// "if these ever stop working will yuki just stop working and i'll never know,
// or can we set her up to dm saying heads up cookies went bad im locked out"
//
// Per memory/feedback_no_silent_fallbacks.md: silent fallbacks are a
// convergence gravity well. Workers must alert, retry, or halt — never
// silently no-op forever.
//
// Cooldown is 6h per (platform, brand) so a permanently-broken auth doesn't
// produce 96 DMs/day.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const lastAlerted = new Map<string, number>();
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

export type AlertPlatform = "instagram" | "facebook" | "tiktok";
export type AlertBrand = "sovereign_synthesis" | "containment_field";

/**
 * Returns true if an alert SHOULD be sent for this (platform, brand) pair —
 * meaning we haven't alerted in the last 6h. Also stamps the timestamp so
 * the next call within 6h returns false. Caller is responsible for actually
 * sending the alert.
 */
export function shouldAlertOnce(platform: AlertPlatform, brand: AlertBrand): boolean {
  const key = `${platform}:${brand}`;
  const now = Date.now();
  const last = lastAlerted.get(key) || 0;
  if (now - last < COOLDOWN_MS) return false;
  lastAlerted.set(key, now);
  return true;
}

/**
 * Format a human-readable alert message. The scheduler closure in src/index.ts
 * passes this string to the Yuki Telegram channel.
 */
export function formatAuthAlert(platform: AlertPlatform, brand: AlertBrand, reason: string): string {
  const platformIcon = platform === "instagram" ? "📷" : platform === "facebook" ? "📘" : "🎵";
  const brandLabel = brand === "sovereign_synthesis" ? "Sovereign Synthesis" : "Containment Field";
  // Pick fix hint based on platform AND inferred failure type (proxy/cookie/token)
  const isProxyIssue = /YTDLP_PROXY|datacenter IP|residential proxy/i.test(reason);
  const isBrowserIssue = /Browser launch|chromium|puppeteer/i.test(reason);

  let fixHint: string;
  if (platform === "tiktok") {
    if (isProxyIssue) {
      fixHint = `Set YTDLP_PROXY in Railway env to a residential proxy URL (e.g. socks5://user:pass@host:port). TT polling is HALTED until this is fixed — running without it would flag the account.`;
    } else if (isBrowserIssue) {
      fixHint = `Chromium binary missing or broken in container. Check Dockerfile.bot installs chromium via apt + verify PUPPETEER_EXECUTABLE_PATH.`;
    } else {
      fixHint = `Re-export Cookie-Editor JSON from your ${brand === "sovereign_synthesis" ? "7ace.rich1" : "empoweredservices2013"} TikTok session, POST to /api/browser/import-cookies with account=${brand === "sovereign_synthesis" ? "acerichie" : "tcf"}.`;
    }
  } else if (platform === "instagram") {
    fixHint = `IG token may have expired. Refresh FACEBOOK_PAGE_ACCESS_TOKEN${brand === "containment_field" ? "_CF" : ""} or set INSTAGRAM_ACCESS_TOKEN${brand === "containment_field" ? "_CF" : ""} explicitly.`;
  } else {
    fixHint = `FB Page Access Token expired or revoked. Refresh FACEBOOK${brand === "containment_field" ? "_CF" : ""}_PAGE_ACCESS_TOKEN on Railway.`;
  }

  return (
    `${platformIcon} *Yuki ${platform.toUpperCase()} Auth Failure*\n` +
    `Brand: ${brandLabel}\n` +
    `Reason: ${reason}\n\n` +
    `Fix: ${fixHint}\n\n` +
    `(This alert is rate-limited to once per 6h per platform+brand.)`
  );
}
