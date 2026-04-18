// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Shared Buffer GraphQL Client
// SESSION 85: Single rate limiter for ALL Buffer API consumers.
// SESSION 87: Adaptive pacing via RateLimit-Remaining/Reset headers.
//             Quota-exhaustion is now a typed error so consumers can
//             degrade gracefully instead of crashing entire sweeps.
//
// Buffer GraphQL limits (third-party): 100 requests / 15 minutes.
// Base pace = 1 request every 10s (6/min, 90/15min with headroom).
// Adaptive: when RateLimit-Remaining < 15, pace widens to 15s.
//           when RateLimit-Remaining < 5, pace widens to 30s.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BUFFER_GRAPHQL_ENDPOINT = "https://api.buffer.com";

// ── Shared rate-limit state ──
const BASE_INTERVAL_MS = 10_000;      // 10s between requests (100/15min budget)
const MAX_RETRIES = 4;
const MAX_RETRY_AFTER_S = 900;        // 15min cap — anything higher = daily quota blown, fail fast
const INITIAL_BACKOFF_MS = 5_000;

let lastRequestAt = 0;
let adaptiveIntervalMs = BASE_INTERVAL_MS;

// ── Quota state (readable by consumers) ──
let quotaExhaustedUntil = 0;          // Unix ms — if Date.now() < this, quota is blown
let lastRateLimitRemaining = -1;      // -1 = unknown
let lastRateLimitReset = "";          // ISO 8601

/**
 * Typed error for quota exhaustion — consumers can catch this specifically
 * and fall back to cache instead of crashing.
 */
export class BufferQuotaExhaustedError extends Error {
  public readonly retryAfterS: number;
  constructor(retryAfterS: number) {
    super(
      `Buffer daily quota exhausted (retry-after: ${retryAfterS}s / ${(retryAfterS / 3600).toFixed(1)}h). ` +
      `Not retrying — next pipeline run will pick up.`
    );
    this.name = "BufferQuotaExhaustedError";
    this.retryAfterS = retryAfterS;
  }
}

/** Check if Buffer quota is currently known to be exhausted */
export function isBufferQuotaExhausted(): boolean {
  return Date.now() < quotaExhaustedUntil;
}

/** Get remaining Buffer API calls in current window (-1 = unknown) */
export function getBufferRateLimitRemaining(): number {
  return lastRateLimitRemaining;
}

function getBufferToken(): string {
  const token = process.env.BUFFER_API_KEY;
  if (!token) throw new Error("BUFFER_API_KEY not configured. Set it in Railway.");
  return token;
}

/**
 * Parse retry-after from either HTTP headers or GraphQL error extensions.
 * Returns seconds, or 0 if not found.
 */
function parseRetryAfter(resp: Response, graphqlErrors?: any[]): number {
  // 1. Check GraphQL error body first (Buffer's preferred location)
  if (graphqlErrors?.length) {
    for (const err of graphqlErrors) {
      const ra = err?.extensions?.retryAfter;
      if (typeof ra === "number" && ra > 0) return ra;
    }
  }
  // 2. Fall back to HTTP header
  const header = resp.headers.get("retry-after");
  if (header) {
    const parsed = parseInt(header, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

/**
 * Read RateLimit-Remaining and RateLimit-Reset headers from Buffer responses.
 * Adapts pacing dynamically: slow down as budget runs low, speed up when fresh.
 */
function updateRateLimitState(resp: Response): void {
  const remaining = resp.headers.get("ratelimit-remaining") || resp.headers.get("x-ratelimit-remaining");
  const reset = resp.headers.get("ratelimit-reset") || resp.headers.get("x-ratelimit-reset");

  if (remaining !== null) {
    lastRateLimitRemaining = parseInt(remaining, 10);
    if (!isNaN(lastRateLimitRemaining)) {
      // Adaptive pacing: widen gaps as budget drains
      if (lastRateLimitRemaining < 5) {
        adaptiveIntervalMs = 30_000;   // 30s — nearly exhausted, crawl
      } else if (lastRateLimitRemaining < 15) {
        adaptiveIntervalMs = 15_000;   // 15s — running low, slow down
      } else {
        adaptiveIntervalMs = BASE_INTERVAL_MS; // 10s — healthy
      }
    }
  }

  if (reset) {
    lastRateLimitReset = reset;
  }
}

/**
 * Shared Buffer GraphQL client with unified rate limiting.
 * All consumers (social-scheduler, content-engine, buffer-analytics)
 * MUST use this function to prevent competing rate-limit stampedes.
 *
 * SESSION 87: Throws BufferQuotaExhaustedError (typed) when daily/account
 * quota is blown. Consumers can catch this specifically for cache fallback.
 */
export async function bufferGraphQL(
  query: string,
  variables?: Record<string, unknown>
): Promise<any> {
  // SESSION 87: Pre-flight check — if we already know quota is blown, fail fast
  if (isBufferQuotaExhausted()) {
    throw new BufferQuotaExhaustedError(
      Math.ceil((quotaExhaustedUntil - Date.now()) / 1000)
    );
  }

  const token = getBufferToken();

  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;

  let backoffMs = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // ── Enforce adaptive interval between ALL Buffer requests ──
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    if (elapsed < adaptiveIntervalMs) {
      await new Promise((r) => setTimeout(r, adaptiveIntervalMs - elapsed));
    }
    lastRequestAt = Date.now();

    const resp = await fetch(BUFFER_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    // SESSION 87: Always read rate limit headers for adaptive pacing
    updateRateLimitState(resp);

    // ── HTTP 429 — rate limit hit ──
    if (resp.status === 429) {
      const retryAfterS = parseRetryAfter(resp);

      // If Buffer says wait >15min, daily quota is exhausted — fail fast
      if (retryAfterS > MAX_RETRY_AFTER_S) {
        quotaExhaustedUntil = Date.now() + retryAfterS * 1000;
        throw new BufferQuotaExhaustedError(retryAfterS);
      }

      attempt++;
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Buffer 429: Rate limited after ${MAX_RETRIES} attempts`);
      }

      const waitMs = retryAfterS > 0 ? retryAfterS * 1000 : backoffMs;
      console.warn(
        `⚠️ [BufferGQL] 429 rate-limited — retry ${attempt}/${MAX_RETRIES} in ${(waitMs / 1000).toFixed(0)}s` +
        (retryAfterS > 0 ? ` (server: ${retryAfterS}s)` : "") +
        ` [remaining: ${lastRateLimitRemaining}, pace: ${adaptiveIntervalMs / 1000}s]`
      );
      await new Promise((r) => setTimeout(r, waitMs));
      backoffMs = Math.min(backoffMs * 2, 60_000);
      continue;
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Buffer GraphQL ${resp.status}: ${errText.slice(0, 500)}`);
    }

    const result: any = await resp.json();

    // ── GraphQL-level rate limit (HTTP 200 but error in body) ──
    if (result.errors?.length) {
      const rateLimitError = result.errors.find(
        (e: any) =>
          e.message?.includes("RATE_LIMIT") ||
          e.extensions?.code === "RATE_LIMIT_EXCEEDED"
      );

      if (rateLimitError) {
        const retryAfterS = parseRetryAfter(resp, result.errors);

        if (retryAfterS > MAX_RETRY_AFTER_S) {
          quotaExhaustedUntil = Date.now() + retryAfterS * 1000;
          throw new BufferQuotaExhaustedError(retryAfterS);
        }

        attempt++;
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Buffer RATE_LIMIT_EXCEEDED after ${MAX_RETRIES} retries`);
        }

        const waitMs = retryAfterS > 0 ? retryAfterS * 1000 : backoffMs;
        console.warn(
          `⚠️ [BufferGQL] GraphQL RATE_LIMIT — retry ${attempt}/${MAX_RETRIES} in ${(waitMs / 1000).toFixed(0)}s`
        );
        await new Promise((r) => setTimeout(r, waitMs));
        backoffMs = Math.min(backoffMs * 2, 60_000);
        continue;
      }

      // Non-rate-limit GraphQL error — throw immediately
      throw new Error(
        `Buffer GraphQL error: ${result.errors.map((e: any) => e.message).join("; ")}`
      );
    }

    return result.data;
  }

  throw new Error("Buffer GraphQL: exhausted retries");
}

// Re-export constants for consumers that need org ID
export const BUFFER_ORG_ID = process.env.BUFFER_ORG_ID || "69c613a244dbc563b3e05050";
