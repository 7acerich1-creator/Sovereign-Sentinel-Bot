// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Social Scheduler (Buffer GraphQL API)
// Yuki is the SOLE Buffer posting authority. Deterministic Content Engine also posts via Buffer.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";

const BUFFER_GRAPHQL_ENDPOINT = "https://api.buffer.com";

// Organization ID — from Buffer account settings
const BUFFER_ORG_ID = process.env.BUFFER_ORG_ID || "69c613a244dbc563b3e05050";

function getBufferToken(): string {
  const token = process.env.BUFFER_API_KEY;
  if (!token) throw new Error("Buffer API key not configured. Set BUFFER_API_KEY in Railway.");
  return token;
}


// ── content_transmissions payload sanitizer ──
// Prevents Postgres CHECK constraint 23514 by validating all fields before insert.
// Exported so video-publisher + vidrush-orchestrator can reuse it.
const VALID_STATUSES = new Set(["draft", "scheduled", "published", "completed", "failed", "uncertain", "ready"]);

export function sanitizeTransmissionPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  // source: required string, max 100 chars, no control characters
  if (raw.source && typeof raw.source === "string") {
    clean.source = raw.source.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 100);
  } else {
    clean.source = "unknown";
  }

  // intent_tag: optional string, max 100 chars
  if (raw.intent_tag && typeof raw.intent_tag === "string") {
    clean.intent_tag = raw.intent_tag.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 100);
  }

  // status: must be one of the allowed enum values
  if (raw.status && typeof raw.status === "string" && VALID_STATUSES.has(raw.status)) {
    clean.status = raw.status;
  } else {
    clean.status = "draft"; // Safe default
  }

  // strategy_json: must be a valid object (Postgres JSONB column)
  if (raw.strategy_json !== undefined && raw.strategy_json !== null) {
    try {
      // Round-trip through JSON to ensure it's valid JSONB
      const jsonStr = JSON.stringify(raw.strategy_json);
      clean.strategy_json = JSON.parse(jsonStr);
    } catch {
      clean.strategy_json = { error: "payload_sanitized", original_type: typeof raw.strategy_json };
    }
  }

  // linkedin_post: text field, strip control chars, cap at 2000 chars
  if (raw.linkedin_post && typeof raw.linkedin_post === "string") {
    clean.linkedin_post = raw.linkedin_post.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, 2000);
  }

  // Pass through any other fields that aren't in the sanitized set (type, niche, etc.)
  for (const [key, val] of Object.entries(raw)) {
    if (!(key in clean) && val !== undefined && val !== null) {
      if (typeof val === "string") {
        clean[key] = val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, 2000);
      } else if (typeof val === "object") {
        try {
          clean[key] = JSON.parse(JSON.stringify(val));
        } catch {
          // Skip unparseable objects
        }
      } else {
        clean[key] = val;
      }
    }
  }

  return clean;
}

// ── Rate Limit Queue ──
// Buffer GraphQL enforces a 24h rolling window rate limit (RATE_LIMIT_EXCEEDED).
// This queue spaces requests and retries with exponential backoff on 429s.
const BUFFER_MIN_INTERVAL_MS = 2000; // Min 2s between requests
const BUFFER_MAX_RETRIES = 4;
let lastBufferRequestAt = 0;

async function bufferGraphQL(query: string, variables?: Record<string, unknown>): Promise<any> {
  const token = getBufferToken();

  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;

  let attempt = 0;
  let backoffMs = 3000; // Initial backoff: 3s

  while (attempt <= BUFFER_MAX_RETRIES) {
    // Enforce minimum interval between requests (rate limit evasion)
    const now = Date.now();
    const elapsed = now - lastBufferRequestAt;
    if (elapsed < BUFFER_MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, BUFFER_MIN_INTERVAL_MS - elapsed));
    }
    lastBufferRequestAt = Date.now();

    const resp = await fetch(BUFFER_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    // Rate limit hit — backoff and retry
    if (resp.status === 429) {
      attempt++;
      if (attempt > BUFFER_MAX_RETRIES) {
        throw new Error(`Buffer RATE_LIMIT_EXCEEDED after ${BUFFER_MAX_RETRIES} retries. 24h window exhausted — queue posts for later.`);
      }
      const retryAfter = resp.headers.get("retry-after");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoffMs;
      console.warn(`⚠️ [Buffer] 429 Rate Limited — retry ${attempt}/${BUFFER_MAX_RETRIES} in ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
      backoffMs = Math.min(backoffMs * 2, 60_000); // Cap at 60s
      continue;
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Buffer GraphQL ${resp.status}: ${errText.slice(0, 500)}`);
    }

    const result: any = await resp.json();

    // Check for GraphQL-level rate limit errors (not HTTP 429 but in error payload)
    if (result.errors && result.errors.length > 0) {
      const rateLimitError = result.errors.find((e: any) =>
        e.message?.includes("RATE_LIMIT") || e.extensions?.code === "RATE_LIMIT_EXCEEDED"
      );
      if (rateLimitError && attempt < BUFFER_MAX_RETRIES) {
        attempt++;
        console.warn(`⚠️ [Buffer] GraphQL RATE_LIMIT — retry ${attempt}/${BUFFER_MAX_RETRIES} in ${backoffMs / 1000}s`);
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 60_000);
        continue;
      }
      throw new Error(`Buffer GraphQL error: ${result.errors.map((e: any) => e.message).join("; ")}`);
    }

    return result.data;
  }

  throw new Error("Buffer GraphQL: exhausted retries");
}

// ── List Channels Tool ──
export class SocialSchedulerListProfilesTool implements Tool {
  definition: ToolDefinition = {
    name: "social_scheduler_list_profiles",
    description: "[Buffer] List all connected social media channels. Use this to discover available posting destinations and their channel IDs.",
    parameters: {},
    required: [],
  };

  async execute(): Promise<string> {
    try {
      const query = `
        query GetChannels {
          channels(input: { organizationId: "${BUFFER_ORG_ID}" }) {
            id
            name
            displayName
            service
            avatar
            isQueuePaused
          }
        }
      `;

      const data = await bufferGraphQL(query);
      const channels = data?.channels;

      if (!Array.isArray(channels) || channels.length === 0) {
        return "No Buffer channels found. Connect social accounts at buffer.com/manage.";
      }

      const summary = channels.map((c: any) => ({
        id: c.id,
        service: c.service,
        name: c.name,
        displayName: c.displayName,
        queuePaused: c.isQueuePaused,
      }));

      return JSON.stringify(summary, null, 2);
    } catch (err: any) {
      return `Error listing channels: ${err.message}`;
    }
  }
}

// ── Schedule/Publish Post Tool ──
export class SocialSchedulerPostTool implements Tool {
  definition: ToolDefinition = {
    name: "social_scheduler_create_post",
    description: "[Buffer] Schedule or publish a post to a social media channel via Buffer GraphQL API. Requires channel_id (from list_profiles), text content, and optional media/scheduling. Yuki is the SOLE posting authority — only Yuki and the Deterministic Content Engine should call this tool.",
    parameters: {
      channel_ids: {
        type: "string",
        description: "Comma-separated Buffer channel IDs to post to. Get IDs from social_scheduler_list_profiles.",
      },
      text: {
        type: "string",
        description: "The post content text. Must include Sovereign Synthesis sign-off.",
      },
      scheduled_at: {
        type: "string",
        description: "ISO 8601 datetime to schedule the post (e.g. 2026-03-28T14:00:00Z). Omit to add to Buffer queue.",
      },
      media_url: {
        type: "string",
        description: "Optional URL to an image or video to attach to the post. Buffer GraphQL supports both image and video assets.",
      },
      niche: {
        type: "string",
        description: "Content niche: dark_psychology, self_improvement, burnout, or quantum_physics. For logging purposes.",
      },
      now: {
        type: "string",
        description: "Set to 'true' to share immediately instead of adding to queue.",
      },
      metadata_json: {
        type: "string",
        description: "JSON string of platform-specific metadata. Structure: { youtube: { title, categoryId, privacy?, ... }, instagram: { type, shouldShareToFeed, firstComment? }, tiktok: { title? } }. Only include the relevant platform key for the target channel.",
      },
    },
    required: ["channel_ids", "text"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    try {
      const channelIds = String(args.channel_ids).split(",").map((s) => s.trim());
      const text = String(args.text);
      const scheduledAt = args.scheduled_at ? String(args.scheduled_at) : undefined;
      let mediaUrl = args.media_url ? String(args.media_url) : undefined;
      const now = args.now === "true" || args.now === true;
      const niche = args.niche ? String(args.niche) : "unknown";

      // Platform-specific metadata (YouTube, Instagram, TikTok, etc.)
      let metadataObj: Record<string, unknown> | undefined;
      if (args.metadata_json) {
        try {
          metadataObj = JSON.parse(String(args.metadata_json));
        } catch {
          console.warn("[SocialScheduler] Failed to parse metadata_json — posting without metadata");
        }
      }

      // ── MEDIA TYPE DETECTION ──
      // Buffer GraphQL assets supports both images AND videos.
      // TikTok, Instagram, YouTube channels REQUIRE media — never strip it.
      let isVideo = false;
      if (mediaUrl) {
        isVideo = /\.(mp4|mov|avi|webm|mkv|mpeg|mpg)(\?|$)/i.test(mediaUrl) ||
          mediaUrl.includes("/video/");
      }

      // Buffer GraphQL ShareMode enum: addToQueue | shareNext | shareNow | customScheduled
      // schedulingType enum: automatic | notification
      // Both mode and schedulingType are REQUIRED fields.
      let shareMode = "addToQueue";
      if (now) {
        shareMode = "shareNow";
      } else if (scheduledAt) {
        shareMode = "customScheduled";
      }

      const results: string[] = [];

      // ── PRE-FLIGHT: Resolve channel service types for smart routing ──
      // YouTube rejects image-only payloads (requires video). Facebook requires type: "post".
      let channelServiceMap: Map<string, string> = new Map();
      try {
        const chanQuery = `
          query GetChannels {
            channels(input: { organizationId: "${BUFFER_ORG_ID}" }) {
              id
              service
            }
          }
        `;
        const chanData = await bufferGraphQL(chanQuery);
        if (Array.isArray(chanData?.channels)) {
          for (const ch of chanData.channels) {
            channelServiceMap.set(ch.id, (ch.service || "").toLowerCase());
          }
        }
      } catch (chanErr: any) {
        console.warn(`[SocialScheduler] Channel lookup failed — posting blind: ${chanErr.message}`);
      }

      // ── YOUTUBE IMAGE FILTER ──
      // YouTube via Buffer inherently demands video. If the asset is static (image),
      // splice YouTube channels OUT of the destination array before transmission.
      let filteredChannelIds = channelIds;
      if (mediaUrl && !isVideo) {
        const youtubeIds = channelIds.filter((id) => channelServiceMap.get(id) === "youtube");
        if (youtubeIds.length > 0) {
          filteredChannelIds = channelIds.filter((id) => channelServiceMap.get(id) !== "youtube");
          results.push(`⚠️ YouTube channels skipped (image-only asset — YouTube requires video): ${youtubeIds.join(", ")}`);
          console.warn(`[SocialScheduler] YouTube filtered out — image asset incompatible with ${youtubeIds.length} YT channel(s)`);
        }
      }

      if (filteredChannelIds.length === 0) {
        return "⚠️ All target channels filtered out (YouTube-only + image asset). Use publish_video for video content.";
      }

      // Buffer GraphQL createPost works per-channel, so loop
      for (const channelId of filteredChannelIds) {
        try {
          // Detect channel service for platform-specific payload adjustments
          const channelService = channelServiceMap.get(channelId) || "unknown";

          // Build the input dynamically
          // Buffer assets support both images and videos
          let assetsBlock = "";
          if (mediaUrl) {
            const escapedUrl = mediaUrl.replace(/"/g, '\\"');
            if (isVideo) {
              assetsBlock = `assets: { videos: [{ url: "${escapedUrl}" }] }`;
            } else {
              assetsBlock = `assets: { images: [{ url: "${escapedUrl}" }] }`;
            }
          }

          let dueAtBlock = "";
          if (scheduledAt) {
            dueAtBlock = `dueAt: "${scheduledAt}"`;
          }

          // Build platform-specific metadata block
          // Structure: metadata: { youtube: { title: "...", categoryId: "..." }, ... }
          let metadataBlock = "";
          if (metadataObj && Object.keys(metadataObj).length > 0) {
            // GraphQL enum convention: strings prefixed with "ENUM:" are rendered
            // unquoted (as GraphQL enum values). All other strings are quoted.
            // Example: "ENUM:public" → public  |  "Hello" → "Hello"
            // This survives JSON.stringify/parse round-trip from the orchestrator.
            const buildGqlObj = (obj: unknown): string => {
              if (obj === null || obj === undefined) return "null";
              if (typeof obj === "string") {
                if (obj.startsWith("ENUM:")) return obj.slice(5); // Unquoted enum
                return JSON.stringify(obj); // Quoted string
              }
              if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
              if (Array.isArray(obj)) return `[${obj.map(buildGqlObj).join(", ")}]`;
              if (typeof obj === "object") {
                const entries = Object.entries(obj as Record<string, unknown>)
                  .filter(([, v]) => v !== undefined && v !== null)
                  .map(([k, v]) => `${k}: ${buildGqlObj(v)}`);
                return `{ ${entries.join(", ")} }`;
              }
              return String(obj);
            };
            metadataBlock = `metadata: ${buildGqlObj(metadataObj)}`;
          }

          // ── FACEBOOK TYPE INJECTION ──
          // Facebook posts require an explicit `type: "post"` field or the API rejects with
          // "Invalid post: Facebook posts require a type". Inject it for Facebook channels.
          let facebookTypeBlock = "";
          if (channelService === "facebook") {
            facebookTypeBlock = `, type: post`;
          }

          const query = `
            mutation CreatePost {
              createPost(input: {
                text: ${JSON.stringify(text)},
                channelId: "${channelId}",
                schedulingType: automatic,
                mode: ${shareMode}
                ${dueAtBlock ? `, ${dueAtBlock}` : ""}
                ${assetsBlock ? `, ${assetsBlock}` : ""}
                ${metadataBlock ? `, ${metadataBlock}` : ""}
                ${facebookTypeBlock}
              }) {
                ... on PostActionSuccess {
                  post {
                    id
                    text
                  }
                }
                ... on MutationError {
                  message
                }
              }
            }
          `;

          const data = await bufferGraphQL(query);
          const result = data?.createPost;

          if (result?.post) {
            results.push(`✅ ${channelId}: Post created (ID: ${result.post.id})`);
          } else if (result?.message) {
            results.push(`❌ ${channelId}: ${result.message}`);
          } else {
            results.push(`⚠️ ${channelId}: Unknown response — ${JSON.stringify(result)}`);
          }
        } catch (err: any) {
          results.push(`❌ ${channelId}: ${err.message}`);
        }
      }

      // Log to Supabase if available
      // SESSION 51: Sanitize payload to prevent CHECK constraint 23514 violations.
      try {
        const supabaseUrl = process.env.SUPABASE_URL;
        // Session 42: Use SERVICE_ROLE_KEY to bypass RLS (Session 31 directive)
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (supabaseUrl && supabaseKey) {
          const payload = sanitizeTransmissionPayload({
            source: "buffer_scheduler",
            intent_tag: niche,
            status: now ? "published" : "scheduled",
            strategy_json: {
              channel_ids: filteredChannelIds,
              scheduled_at: scheduledAt || (now ? "immediate" : "queued"),
              shareMode,
            },
            linkedin_post: text.slice(0, 500),
          });
          await fetch(`${supabaseUrl}/rest/v1/content_transmissions`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify(payload),
          });
        }
      } catch (logErr: any) {
        // Non-critical — log failure doesn't block posting
        console.warn(`[SocialScheduler] Supabase log failed: ${logErr.message?.slice(0, 200)}`);
      }

      return `Buffer GraphQL Post Results (${shareMode}):\n` +
        `Niche: ${niche}\n` +
        results.join("\n") +
        `\nText preview: ${text.slice(0, 100)}...`;
    } catch (err: any) {
      return `Error creating post: ${err.message}`;
    }
  }
}

// ── Get Scheduled Posts Tool ──
export class SocialSchedulerPendingTool implements Tool {
  definition: ToolDefinition = {
    name: "social_scheduler_pending_posts",
    description: "[Buffer] List scheduled/pending posts. Use to check queue status and posting cadence.",
    parameters: {
      channel_id: {
        type: "string",
        description: "Optional Buffer channel ID to filter. If omitted, shows all scheduled posts for the organization.",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    try {
      // Buffer GraphQL uses organization-level post queries with optional channel filter
      let filterBlock = `filter: { status: [scheduled] }`;
      if (args.channel_id) {
        filterBlock = `filter: { status: [scheduled], channelIds: ["${String(args.channel_id)}"] }`;
      }

      const query = `
        query GetScheduledPosts {
          posts(
            input: {
              organizationId: "${BUFFER_ORG_ID}",
              sort: [{ field: dueAt, direction: asc }],
              ${filterBlock}
            }
          ) {
            edges {
              node {
                id
                text
                createdAt
              }
            }
          }
        }
      `;

      const data = await bufferGraphQL(query);
      const edges = data?.posts?.edges || [];

      if (edges.length === 0) {
        return `No scheduled posts found. Consider scheduling content to maintain cadence.`;
      }

      const summary = edges.slice(0, 15).map((e: any) => ({
        id: e.node.id,
        text: (e.node.text || "").slice(0, 80),
        createdAt: e.node.createdAt,
      }));

      return `${edges.length} scheduled post(s):\n${JSON.stringify(summary, null, 2)}`;
    } catch (err: any) {
      return `Error fetching scheduled posts: ${err.message}`;
    }
  }
}
