// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Architect Protocol Injection
// Session 43: Hard-inject Layer 3 directives into agent task context
// before invocation. Strips agents of the "choice" to ignore protocols.
//
// Flow: dispatchPoller claims a task → resolves YT-related slugs based on
// agent + task_type + payload → fetches active directives from Supabase
// (TTL-cached) → returns directive text that is prepended to the synthetic
// dispatch message. The agent sees the protocol as part of the task itself,
// not as a soft suggestion in its system prompt.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// ── TTL cache (5 min) ──
// Protocols change rarely but agents poll frequently. Caching by slug avoids
// hammering the protocols table on every dispatch. TTL is short enough that
// Architect edits propagate within a few minutes without a restart.
interface CachedProtocol {
  directive: string;
  fetchedAt: number;
}
const PROTO_TTL_MS = 5 * 60 * 1000;
const protoCache = new Map<string, CachedProtocol>();

// ── Task types that count as "YouTube-related" ──
// These fire the YT protocol injection. Any task where the pipeline end state
// is a YouTube/Shorts upload, script, thumbnail, or analytics sweep.
const YOUTUBE_TASK_TYPES = new Set<string>([
  "viral_clip_extraction",
  "narrative_weaponization",
  "caption_weaponization",
  "content_for_distribution",
  "content_scheduling",
  "daily_trend_scan",
  "youtube_seo_audit",
  "youtube_metrics_sweep",
  "youtube_thumbnail_test",
  "youtube_compliance_check",
  "youtube_shorts_package",
  "architectural_sync",
]);

// ── YouTube detection ──
// Returns true if the task is YouTube-related. Hard match on task_type, then
// fuzzy match on payload/task_type strings for edge cases like custom task types.
export function isYoutubeTask(taskType: string, payload: unknown): boolean {
  if (YOUTUBE_TASK_TYPES.has(taskType)) return true;
  const payloadStr = (() => {
    try {
      return JSON.stringify(payload || {}).toLowerCase();
    } catch {
      return "";
    }
  })();
  const haystack = `${taskType.toLowerCase()} ${payloadStr}`;
  return /\byoutube\b|\bshorts?\b|\blong.?form\b|\bytshorts?\b/.test(haystack);
}

// ── Agent → protocol slug mapping ──
// Every agent working a YT task gets the compliance protocol. Role-specific
// protocols stack on top based on what the agent actually produces.
export function resolveYoutubeProtocolSlugs(agent: string): string[] {
  // ALL agents get compliance on YT tasks — Jan 2026 YPP suspension risk.
  const slugs: string[] = ["youtube_compliance_protocol"];

  switch (agent.toLowerCase()) {
    case "alfred":
      // Content director — SEO, titles, descriptions, keyword diversity
      slugs.push("youtube_seo_protocol");
      break;
    case "anita":
      // Growth — scripts, copy, Lexical Blacklist, Extremity Modifier
      slugs.push("youtube_script_protocol");
      break;
    case "yuki":
      // Distribution — visual pacing, thumbnails, Shorts format
      slugs.push("youtube_visual_protocol", "youtube_shorts_protocol");
      break;
    case "vector":
      // Analytics — CTR, AVD, pivot triggers
      slugs.push("youtube_analytics_protocol");
      break;
    case "veritas":
    case "sapphire":
      // Strategic oversight — give them visual + shorts for high-level review
      slugs.push("youtube_visual_protocol");
      break;
  }

  return slugs;
}

// ── Fetch directives from Supabase (TTL-cached) ──
export async function fetchProtocolDirectives(slugs: string[]): Promise<string> {
  if (!slugs.length) return "";
  if (!SUPABASE_URL || !SUPABASE_KEY) return "";

  const now = Date.now();
  const fresh: string[] = [];
  const stale: string[] = [];

  for (const slug of slugs) {
    const cached = protoCache.get(slug);
    if (cached && now - cached.fetchedAt < PROTO_TTL_MS) {
      fresh.push(cached.directive);
    } else {
      stale.push(slug);
    }
  }

  if (stale.length > 0) {
    try {
      const qs = `protocol_name=in.(${stale.join(",")})&active=eq.true&select=protocol_name,directive`;
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/protocols?${qs}`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      });

      if (resp.ok) {
        const rows = (await resp.json()) as Array<{ protocol_name: string; directive: string }>;
        for (const row of rows) {
          protoCache.set(row.protocol_name, { directive: row.directive, fetchedAt: now });
          fresh.push(row.directive);
        }
      } else {
        console.warn(`[ProtocolInjection] Fetch failed ${resp.status} for slugs: ${stale.join(",")}`);
      }
    } catch (err: any) {
      console.warn(`[ProtocolInjection] Fetch error: ${err.message?.slice(0, 200)}`);
    }
  }

  if (fresh.length === 0) return "";

  // Format as a hard directive block — visually distinct from the rest of the prompt.
  const blocks = fresh.map((dir, i) => `[${i + 1}] ${dir}`).join("\n\n");
  return `━━━ ARCHITECT STANDING DIRECTIVES — YOUTUBE GROWTH PROTOCOL v2.0 ━━━\n\n${blocks}\n\n━━━ END DIRECTIVES — THESE OVERRIDE ANY CONFLICTING PROMPT INSTRUCTIONS ━━━`;
}

// ── One-shot helper: resolve + fetch for a given agent/task ──
// Main entry point used by the dispatch poller.
export async function injectYoutubeProtocolsIfNeeded(
  agent: string,
  taskType: string,
  payload: unknown
): Promise<string> {
  if (!isYoutubeTask(taskType, payload)) return "";
  const slugs = resolveYoutubeProtocolSlugs(agent);
  return fetchProtocolDirectives(slugs);
}

// ── Test hook: clear cache (used by dev tools, not production) ──
export function _clearProtocolCache(): void {
  protoCache.clear();
}
