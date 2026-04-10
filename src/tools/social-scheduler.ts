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

async function bufferGraphQL(query: string, variables?: Record<string, unknown>): Promise<any> {
  const token = getBufferToken();

  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;

  const resp = await fetch(BUFFER_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Buffer GraphQL ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const result: any = await resp.json();

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Buffer GraphQL error: ${result.errors.map((e: any) => e.message).join("; ")}`);
  }

  return result.data;
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

      // Buffer GraphQL createPost works per-channel, so loop
      for (const channelId of channelIds) {
        try {
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
      try {
        const supabaseUrl = process.env.SUPABASE_URL;
        // Session 42: Use SERVICE_ROLE_KEY to bypass RLS (Session 31 directive)
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (supabaseUrl && supabaseKey) {
          await fetch(`${supabaseUrl}/rest/v1/content_transmissions`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              source: "buffer_scheduler",
              intent_tag: niche,
              status: now ? "published" : "scheduled",
              strategy_json: {
                channel_ids: channelIds,
                scheduled_at: scheduledAt || (now ? "immediate" : "queued"),
                shareMode,
              },
              linkedin_post: text.slice(0, 500),
            }),
          });
        }
      } catch {
        // Non-critical — log failure doesn't block posting
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
