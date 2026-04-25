// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Bluesky AT Protocol Client
// Session 115 (2026-04-25) — Yuki Bluesky engagement.
//
// Thin wrapper over the AT Protocol REST endpoints exposed at
// https://bsky.social/xrpc/. Handles:
//   - createSession via app password (auth)
//   - refreshSession on 401 (jwt rotation)
//   - typed wrappers for the endpoints Yuki uses (notifications, follows,
//     author feed, createRecord for replies and posts)
//
// Scope: SS only for v1 (CF doesn't have a Bluesky account yet —
// confirmed 2026-04-25). Wiring is brand-keyed so adding CF later is
// just an env var pair.
//
// Cost: zero (Bluesky AT Protocol is open + free).
// Rate limits (per-session): 5,000 points / 5 min, 1,666 createRecord/day.
// We use <50 createRecord/day. Plenty of headroom.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BSKY_PDS = "https://bsky.social";

export type BskyBrand = "sovereign_synthesis" | "containment_field";

interface BskySession {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
  expiresAt: number; // ms epoch — refresh proactively before this
}

const sessionCache: Partial<Record<BskyBrand, BskySession>> = {};

function getCredentials(brand: BskyBrand): { identifier: string; password: string } | null {
  if (brand === "sovereign_synthesis") {
    const password = process.env.BLUESKY_APP_PASSWORD_SS;
    const identifier = process.env.BLUESKY_HANDLE_SS || "sovereign-synthesis.com";
    if (!password) return null;
    return { identifier, password };
  }
  // containment_field — no creds yet, will return null until env vars added
  const password = process.env.BLUESKY_APP_PASSWORD_CF;
  const identifier = process.env.BLUESKY_HANDLE_CF;
  if (!password || !identifier) return null;
  return { identifier, password };
}

async function createSession(brand: BskyBrand): Promise<BskySession | null> {
  const creds = getCredentials(brand);
  if (!creds) {
    console.log(`[Bluesky] ${brand}: no credentials configured`);
    return null;
  }

  try {
    const resp = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: creds.identifier, password: creds.password }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[Bluesky] ${brand}: createSession failed ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = (await resp.json()) as any;
    const session: BskySession = {
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
      did: data.did,
      handle: data.handle,
      // accessJwt typically expires in 2 hours — refresh after 90 min for safety
      expiresAt: Date.now() + 90 * 60 * 1000,
    };
    sessionCache[brand] = session;
    return session;
  } catch (err: any) {
    console.error(`[Bluesky] ${brand}: createSession exception: ${err.message}`);
    return null;
  }
}

async function refreshSession(brand: BskyBrand): Promise<BskySession | null> {
  const cached = sessionCache[brand];
  if (!cached) return createSession(brand);

  try {
    const resp = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.refreshSession`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cached.refreshJwt}`,
      },
    });
    if (!resp.ok) {
      // refresh token may have expired — full re-auth
      delete sessionCache[brand];
      return createSession(brand);
    }
    const data = (await resp.json()) as any;
    const refreshed: BskySession = {
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
      did: data.did,
      handle: data.handle,
      expiresAt: Date.now() + 90 * 60 * 1000,
    };
    sessionCache[brand] = refreshed;
    return refreshed;
  } catch {
    delete sessionCache[brand];
    return createSession(brand);
  }
}

export async function getSession(brand: BskyBrand): Promise<BskySession | null> {
  const cached = sessionCache[brand];
  if (cached && Date.now() < cached.expiresAt) return cached;
  if (cached) return refreshSession(brand);
  return createSession(brand);
}

/**
 * Authenticated fetch helper. Auto-refreshes on 401.
 * Returns parsed JSON or null on failure.
 */
export async function bskyFetch<T = any>(
  brand: BskyBrand,
  path: string,
  init: { method?: "GET" | "POST"; body?: any; query?: Record<string, string | number | undefined> } = {}
): Promise<T | null> {
  let session = await getSession(brand);
  if (!session) return null;

  const url = new URL(`${BSKY_PDS}/xrpc/${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const doFetch = async (s: BskySession) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${s.accessJwt}`,
    };
    if (init.body) headers["Content-Type"] = "application/json";
    return fetch(url.toString(), {
      method: init.method || "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  };

  try {
    let resp = await doFetch(session);
    if (resp.status === 401) {
      session = await refreshSession(brand);
      if (!session) return null;
      resp = await doFetch(session);
    }
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[Bluesky] ${brand}: ${path} ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }
    return (await resp.json()) as T;
  } catch (err: any) {
    console.error(`[Bluesky] ${brand}: ${path} exception: ${err.message}`);
    return null;
  }
}

/** Get the authenticated DID for a brand (for filtering own replies, etc.). */
export async function getOwnDid(brand: BskyBrand): Promise<string | null> {
  const session = await getSession(brand);
  return session?.did || null;
}
