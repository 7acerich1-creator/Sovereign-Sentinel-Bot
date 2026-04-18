// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Shared Buffer GraphQL Client
// SESSION 85: Single rate limiter for ALL Buffer API consumers.
// Three files previously had independent bufferGraphQL() with separate
// rate state — social-scheduler, content-engine, buffer-analytics.
// Now they all import from here, sharing one request pacer.
//
// Buffer GraphQL limits (third-party): 100 requests / 15 minutes.
// Safe pace = 1 request every 10s (6/min, 90/15min with headroom).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BUFFER_GRAPHQL_ENDPOINT = "https://api.buffer.com";

// ── Shared rate-limit state ──
const MIN_INTERVAL_MS = 10_000;       // 10s between requests (100/15min budget)
const MAX_RETRIES = 4;
const MAX_RETRY_AFTER_S = 900;        // 15min cap — anything higher = daily quota blown, fail fast
const INITIAL_BACKOFF_MS = 5_000;

let lastRequestAt = 0;

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
 * Shared Buffer GraphQL client with unified rate limiting.
 * All consumers (social-scheduler, content-engine, buffer-analytics)
 * MUST use this function to prevent competing rate-limit stampedes.
 */
export async function bufferGraphQL(
  query: string,
  variables?: Record<string, unknown>
): Promise<any> {
  const token = getBufferToken();

  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;

  let backoffMs = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // ── Enforce minimum interval between ALL Buffer requests ──
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
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

    // ── HTTP 429 — rate limit hit ──
    if (resp.status === 429) {
      const retryAfterS = parseRetryAfter(resp);

      // If Buffer says wait >15min, daily quota is exhausted — fail fast
      if (retryAfterS > MAX_RETRY_AFTER_S) {
        throw new Error(
          `Buffer daily quota exhausted (retry-after: ${retryAfterS}s / ${(retryAfterS / 3600).toFixed(1)}h). ` +
          `Not retrying — next pipeline run will pick up.`
        );
      }

      attempt++;
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Buffer 429: Rate limited after ${MAX_RETRIES} attempts`);
      }

      const waitMs = retryAfterS > 0 ? retryAfterS * 1000 : backoffMs;
      console.warn(
        `⚠️ [BufferGQL] 429 rate-limited — retry ${attempt}/${MAX_RETRIES} in ${(waitMs / 1000).toFixed(0)}s` +
        (retryAfterS > 0 ? ` (server: ${retryAfterS}s)` : "")
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
          throw new Error(
            `Buffer daily quota exhausted (GraphQL retryAfter: ${retryAfterS}s). Not retrying.`
          );
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
