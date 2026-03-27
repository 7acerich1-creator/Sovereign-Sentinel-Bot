// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Social Scheduler (Buffer API)
// Vector routes content to niche channels via Buffer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";

const BUFFER_API_BASE = "https://api.bufferapp.com/1";

// Niche channel mapping — Vector uses these to route content
// Profile IDs will be populated from Buffer API on first call
interface NicheChannel {
  niche: string;
  profileIds: string[]; // Buffer profile IDs for this niche
}

async function bufferRequest(endpoint: string, method: string = "GET", body?: Record<string, unknown>): Promise<any> {
  const token = process.env.BUFFER_API_KEY || process.env.SOCIAL_SCHEDULER_API_KEY;
  if (!token) throw new Error("Buffer API key not configured. Set BUFFER_API_KEY in Railway.");

  const url = `${BUFFER_API_BASE}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  };

  if (method === "POST" && body) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) {
        v.forEach((item) => params.append(`${k}[]`, String(item)));
      } else if (v !== undefined && v !== null) {
        params.append(k, String(v));
      }
    }
    params.append("access_token", token);
    options.body = params.toString();
  } else {
    const separator = endpoint.includes("?") ? "&" : "?";
    const fetchUrl = `${url}${separator}access_token=${token}`;
    const resp = await fetch(fetchUrl, options);
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Buffer API ${resp.status}: ${errText.slice(0, 300)}`);
    }
    return resp.json();
  }

  const resp = await fetch(url, options);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Buffer API ${resp.status}: ${errText.slice(0, 300)}`);
  }
  return resp.json();
}

// ── List Profiles Tool ──
export class SocialSchedulerListProfilesTool implements Tool {
  definition: ToolDefinition = {
    name: "social_scheduler_list_profiles",
    description: "[Buffer] List all connected social media profiles/channels. Use this to discover available posting destinations.",
    parameters: {},
    required: [],
  };

  async execute(): Promise<string> {
    try {
      const profiles = await bufferRequest("/profiles.json");
      if (!Array.isArray(profiles) || profiles.length === 0) {
        return "No Buffer profiles found. Connect social accounts at buffer.com/manage.";
      }
      const summary = profiles.map((p: any) => ({
        id: p.id,
        service: p.service,
        service_username: p.service_username,
        formatted_username: p.formatted_username,
      }));
      return JSON.stringify(summary, null, 2);
    } catch (err: any) {
      return `Error listing profiles: ${err.message}`;
    }
  }
}

// ── Schedule Post Tool ──
export class SocialSchedulerPostTool implements Tool {
  definition: ToolDefinition = {
    name: "social_scheduler_create_post",
    description: "[Buffer] Schedule or publish a post to a social media channel. Requires profile_id (from list_profiles), text content, and optional media/scheduling. Vector uses this to route niche content to correct channels with minimum 1 post/day/channel cadence.",
    parameters: {
      profile_ids: {
        type: "string",
        description: "Comma-separated Buffer profile IDs to post to. Get IDs from social_scheduler_list_profiles.",
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
        description: "Optional URL to an image or video to attach to the post.",
      },
      niche: {
        type: "string",
        description: "Content niche: dark_psychology, self_improvement, burnout, or quantum_physics. For logging purposes.",
      },
      now: {
        type: "string",
        description: "Set to 'true' to share immediately instead of adding to queue.",
      },
    },
    required: ["profile_ids", "text"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    try {
      const profileIds = String(args.profile_ids).split(",").map((s) => s.trim());
      const text = String(args.text);
      const scheduledAt = args.scheduled_at ? String(args.scheduled_at) : undefined;
      const mediaUrl = args.media_url ? String(args.media_url) : undefined;
      const now = args.now === "true" || args.now === true;
      const niche = args.niche ? String(args.niche) : "unknown";

      const body: Record<string, unknown> = {
        text,
        profile_ids: profileIds,
        now: now,
      };

      if (scheduledAt) {
        body.scheduled_at = scheduledAt;
      }

      if (mediaUrl) {
        body["media[link]"] = mediaUrl;
        body["media[photo]"] = mediaUrl;
      }

      const result = await bufferRequest("/updates/create.json", "POST", body);

      // Log to Supabase if available
      try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_ANON_KEY;
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
                profile_ids: profileIds,
                scheduled_at: scheduledAt || "queued",
                buffer_update_id: result?.updates?.[0]?.id || "unknown",
              },
              linkedin_post: text.slice(0, 500),
            }),
          });
        }
      } catch {
        // Non-critical — log failure doesn't block posting
      }

      const updateIds = result?.updates?.map((u: any) => u.id) || [];
      return `✅ Post ${now ? "published" : "scheduled"} to ${profileIds.length} profile(s).\n` +
        `Niche: ${niche}\n` +
        `Buffer update IDs: ${updateIds.join(", ")}\n` +
        `Text preview: ${text.slice(0, 100)}...`;
    } catch (err: any) {
      return `Error creating post: ${err.message}`;
    }
  }
}

// ── Get Pending Posts Tool ──
export class SocialSchedulerPendingTool implements Tool {
  definition: ToolDefinition = {
    name: "social_scheduler_pending_posts",
    description: "[Buffer] List pending/scheduled posts for a profile. Use to check queue status and posting cadence.",
    parameters: {
      profile_id: {
        type: "string",
        description: "Buffer profile ID to check pending posts for.",
      },
    },
    required: ["profile_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    try {
      const profileId = String(args.profile_id);
      const result = await bufferRequest(`/profiles/${profileId}/updates/pending.json`);
      const updates = result?.updates || [];

      if (updates.length === 0) {
        return `No pending posts for profile ${profileId}. Consider scheduling content.`;
      }

      const summary = updates.slice(0, 10).map((u: any) => ({
        id: u.id,
        text: (u.text || "").slice(0, 80),
        scheduled_at: u.scheduled_at,
        due_at: u.due_at,
      }));

      return `${updates.length} pending posts for profile ${profileId}:\n${JSON.stringify(summary, null, 2)}`;
    } catch (err: any) {
      return `Error getting pending posts: ${err.message}`;
    }
  }
}
