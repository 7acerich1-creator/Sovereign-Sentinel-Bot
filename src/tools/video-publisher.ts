// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Direct Video Publisher (Path A)
// Direct API/browser video uploads to platforms.
// This module handles VIDEO FILE uploads via:
//   - TikTok Content Posting API (+ browser fallback)
//   - Instagram Graph API / browser fallback (Reels)
//   - YouTube Data API (Shorts + Long-form)
// Buffer handles text+image posts across ALL channels.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { config } from "../config";
import { TikTokBrowserUploadTool } from "./tiktok-browser-upload";
import { InstagramBrowserUploadTool } from "./instagram-browser-upload";
import { sanitizeTransmissionPayload } from "./social-scheduler";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// ── Supabase logging helper ──
// SESSION 51: Sanitize payload before insert to prevent CHECK constraint 23514.
async function logVideoPost(data: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const sanitized = sanitizeTransmissionPayload(data);
    await fetch(`${SUPABASE_URL}/rest/v1/content_transmissions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(sanitized),
    });
  } catch (err: any) {
    console.warn(`[VideoPublisher] Supabase log failed: ${err.message?.slice(0, 200)}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. TIKTOK — Content Posting API
//    Flow: init upload → upload video → publish
//    Requires: TIKTOK_ACCESS_TOKEN (OAuth2 long-lived)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class TikTokPublishTool implements Tool {
  definition: ToolDefinition = {
    name: "tiktok_publish_video",
    description:
      "Publish a video directly to TikTok using the Content Posting API. " +
      "Requires a public video URL (Supabase storage). Direct API upload for video files. " +
      "Use for short-form clips (15-60s). Include caption with hooks and hashtags.",
    parameters: {
      video_url: {
        type: "string",
        description: "Public URL of the video file (MP4, from Supabase storage or any public URL)",
      },
      caption: {
        type: "string",
        description: "Video caption/description. Include hooks, hashtags, and Sovereign Synthesis sign-off.",
      },
      niche: {
        type: "string",
        description: "Content niche for logging: dark_psychology, self_improvement, burnout, quantum",
      },
    },
    required: ["video_url", "caption"],
  };

  async execute(args: Record<string, unknown>, _context?: any): Promise<string> {
    const token = process.env.TIKTOK_ACCESS_TOKEN;
    if (!token) {
      return "❌ TIKTOK_ACCESS_TOKEN not configured. Set it in Railway env to enable TikTok publishing.\n" +
        "To get a token: TikTok Developer Portal → Create App → Content Posting API → OAuth2 flow.";
    }

    const videoUrl = String(args.video_url);
    const caption = String(args.caption);
    const niche = args.niche ? String(args.niche) : "unknown";

    try {
      // Step 1: Initialize video upload via pull (TikTok pulls video from URL)
      const initResp = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: caption.slice(0, 150),
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: videoUrl,
          },
        }),
      });

      if (!initResp.ok) {
        const errText = await initResp.text();
        return `❌ TikTok upload init failed (${initResp.status}): ${errText.slice(0, 300)}`;
      }

      const initData = await initResp.json() as any;

      if (initData.error?.code !== "ok" && initData.error?.code) {
        return `❌ TikTok API error: ${initData.error.code} — ${initData.error.message || "unknown"}`;
      }

      const publishId = initData.data?.publish_id;

      // Log to Supabase
      await logVideoPost({
        source: "tiktok_direct",
        intent_tag: niche,
        status: "published",
        strategy_json: {
          publish_id: publishId,
          video_url: videoUrl,
          platform: "tiktok",
        },
        linkedin_post: caption.slice(0, 500),
      });

      return `✅ TikTok video submitted for publishing.\n` +
        `Publish ID: ${publishId || "pending"}\n` +
        `Caption: ${caption.slice(0, 100)}...\n` +
        `Niche: ${niche}\n` +
        `Note: TikTok processes videos asynchronously. It may take 1-5 minutes to appear on the profile.`;
    } catch (err: any) {
      return `❌ TikTok publish error: ${err.message}`;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. INSTAGRAM REELS — Graph API
//    Flow: create media container → wait → publish
//    Requires: INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ID
//    Token: Facebook Developer Portal → Instagram Graph API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class InstagramReelsPublishTool implements Tool {
  definition: ToolDefinition = {
    name: "instagram_publish_reel",
    description:
      "Publish a Reel to Instagram via the Graph API. " +
      "Requires a public video URL. Direct API upload for video files. " +
      "Use for vertical short-form content (up to 90s). Include caption with hooks and hashtags.",
    parameters: {
      video_url: {
        type: "string",
        description: "Public URL of the video file (MP4). Must be accessible without auth.",
      },
      caption: {
        type: "string",
        description: "Reel caption. Include hooks, hashtags, CTA. Max 2200 chars.",
      },
      niche: {
        type: "string",
        description: "Content niche for logging: dark_psychology, self_improvement, burnout, quantum",
      },
    },
    required: ["video_url", "caption"],
  };

  async execute(args: Record<string, unknown>, _context?: any): Promise<string> {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    const businessId = process.env.INSTAGRAM_BUSINESS_ID;

    if (!token || !businessId) {
      return "❌ Instagram not configured. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ID in Railway env.\n" +
        "To get these: Facebook Developer Portal → Instagram Graph API → generate long-lived token.";
    }

    const videoUrl = String(args.video_url);
    const caption = String(args.caption);
    const niche = args.niche ? String(args.niche) : "unknown";

    try {
      // Step 1: Create media container (Reel type)
      const containerResp = await fetch(
        `https://graph.facebook.com/v19.0/${businessId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            media_type: "REELS",
            video_url: videoUrl,
            caption: caption,
            access_token: token,
          }),
        }
      );

      if (!containerResp.ok) {
        const errText = await containerResp.text();
        return `❌ Instagram container creation failed (${containerResp.status}): ${errText.slice(0, 300)}`;
      }

      const containerData = await containerResp.json() as any;
      const containerId = containerData.id;

      if (!containerId) {
        return `❌ Instagram returned no container ID: ${JSON.stringify(containerData).slice(0, 300)}`;
      }

      // Step 2: Poll for container readiness (Instagram processes video async)
      // Wait up to 60s with 5s intervals
      let ready = false;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));

        const statusResp = await fetch(
          `https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${token}`
        );
        const statusData = await statusResp.json() as any;

        if (statusData.status_code === "FINISHED") {
          ready = true;
          break;
        } else if (statusData.status_code === "ERROR") {
          return `❌ Instagram video processing failed: ${JSON.stringify(statusData).slice(0, 300)}`;
        }
        // PUBLISHED or IN_PROGRESS — keep waiting
      }

      if (!ready) {
        return `⏳ Instagram container ${containerId} still processing after 60s. ` +
          `It may publish automatically when ready. Check IG manually in a few minutes.`;
      }

      // Step 3: Publish the container
      const publishResp = await fetch(
        `https://graph.facebook.com/v19.0/${businessId}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: containerId,
            access_token: token,
          }),
        }
      );

      if (!publishResp.ok) {
        const errText = await publishResp.text();
        return `❌ Instagram publish failed (${publishResp.status}): ${errText.slice(0, 300)}`;
      }

      const publishData = await publishResp.json() as any;
      const mediaId = publishData.id;

      // Log to Supabase
      await logVideoPost({
        source: "instagram_direct",
        intent_tag: niche,
        status: "published",
        strategy_json: {
          media_id: mediaId,
          container_id: containerId,
          video_url: videoUrl,
          platform: "instagram",
        },
        linkedin_post: caption.slice(0, 500),
      });

      return `✅ Instagram Reel published.\n` +
        `Media ID: ${mediaId}\n` +
        `Caption: ${caption.slice(0, 100)}...\n` +
        `Niche: ${niche}`;
    } catch (err: any) {
      return `❌ Instagram publish error: ${err.message}`;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. YOUTUBE SHORTS — Data API v3
//    Flow: resumable upload → set metadata
//    Requires: YOUTUBE_REFRESH_TOKEN + YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET
//    Dual-channel: YOUTUBE_REFRESH_TOKEN = Sovereign Synthesis, YOUTUBE_REFRESH_TOKEN_TCF = The Containment Field
//    Shorts = any vertical video ≤60s uploaded normally
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class YouTubeShortsPublishTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_publish_short",
    description:
      "Upload a Short to YouTube via the Data API v3. " +
      "Requires a public video URL. Shorts are vertical videos ≤60 seconds. " +
      "Include #Shorts in the title or description for YouTube to classify it as a Short. " +
      "Use brand parameter to choose channel: 'sovereign_synthesis' (default) or 'containment_field'.",
    parameters: {
      video_url: {
        type: "string",
        description: "Public URL of the video file (MP4). Will be downloaded and uploaded to YouTube.",
      },
      title: {
        type: "string",
        description: "Video title (max 100 chars). Include #Shorts for Short classification.",
      },
      description: {
        type: "string",
        description: "Video description. Include hooks, links, hashtags, and CTA.",
      },
      tags: {
        type: "string",
        description: "Comma-separated tags for discoverability (e.g., 'dark psychology,mindset,self improvement')",
      },
      niche: {
        type: "string",
        description: "Content niche for logging: dark_psychology, self_improvement, burnout, quantum",
      },
      brand: {
        type: "string",
        description: "Which brand/channel to publish to: 'sovereign_synthesis' (Sovereign Synthesis channel) or 'containment_field' (The Containment Field channel). Defaults to 'sovereign_synthesis'.",
      },
    },
    required: ["video_url", "title", "description"],
  };

  private async getAccessToken(brand: string = "sovereign_synthesis"): Promise<string | null> {
    // Try direct access token first (legacy fallback)
    const directToken = process.env.YOUTUBE_ACCESS_TOKEN;
    if (directToken) return directToken;

    // Select refresh token based on brand
    // YOUTUBE_REFRESH_TOKEN = Sovereign Synthesis (empoweredservices2013@gmail.com)
    // YOUTUBE_REFRESH_TOKEN_TCF = The Containment Field (7ace.rich1@gmail.com)
    const refreshToken = brand === "containment_field"
      ? process.env.YOUTUBE_REFRESH_TOKEN_TCF
      : process.env.YOUTUBE_REFRESH_TOKEN;
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

    if (!refreshToken || !clientId || !clientSecret) return null;

    try {
      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }).toString(),
      });

      if (!resp.ok) return null;
      const data = await resp.json() as any;
      return data.access_token || null;
    } catch {
      return null;
    }
  }

  async execute(args: Record<string, unknown>, _context?: any): Promise<string> {
    const brand = args.brand ? String(args.brand) : "sovereign_synthesis";
    const channelLabel = brand === "containment_field" ? "The Containment Field" : "Sovereign Synthesis";
    const token = await this.getAccessToken(brand);
    if (!token) {
      const envHint = brand === "containment_field"
        ? "YOUTUBE_REFRESH_TOKEN_TCF"
        : "YOUTUBE_REFRESH_TOKEN";
      return `❌ YouTube not configured for ${channelLabel}. Set ${envHint} + YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET in Railway env.\n` +
        "To get these: Google Cloud Console → YouTube Data API v3 → OAuth2 credentials.";
    }

    const videoUrl = String(args.video_url);
    const title = String(args.title).slice(0, 100);
    const description = String(args.description);
    const tags = args.tags ? String(args.tags).split(",").map((t) => t.trim()) : [];
    const niche = args.niche ? String(args.niche) : "unknown";

    try {
      // Step 1: Download video from URL into memory
      const videoResp = await fetch(videoUrl);
      if (!videoResp.ok) {
        return `❌ Failed to download video from ${videoUrl}: ${videoResp.status}`;
      }
      const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
      const videoSize = videoBuffer.length;

      if (videoSize > 256 * 1024 * 1024) {
        return `❌ Video too large (${Math.round(videoSize / 1024 / 1024)}MB). YouTube Shorts must be under 256MB.`;
      }

      // Step 2: Initialize resumable upload
      const metadata = {
        snippet: {
          title: title.includes("#Shorts") ? title : `${title} #Shorts`,
          description,
          tags,
          categoryId: "22", // People & Blogs
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      };

      const initResp = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(videoSize),
            "X-Upload-Content-Type": "video/mp4",
          },
          body: JSON.stringify(metadata),
        }
      );

      if (!initResp.ok) {
        const errText = await initResp.text();
        return `❌ YouTube upload init failed (${initResp.status}): ${errText.slice(0, 300)}`;
      }

      const uploadUrl = initResp.headers.get("location");
      if (!uploadUrl) {
        return "❌ YouTube did not return a resumable upload URL.";
      }

      // Step 3: Upload video data
      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(videoSize),
          "Content-Type": "video/mp4",
        },
        body: videoBuffer,
      });

      if (!uploadResp.ok) {
        const errText = await uploadResp.text();
        return `❌ YouTube video upload failed (${uploadResp.status}): ${errText.slice(0, 300)}`;
      }

      const uploadData = await uploadResp.json() as any;
      const videoId = uploadData.id;

      // Log to Supabase
      await logVideoPost({
        source: "youtube_direct",
        intent_tag: niche,
        status: "published",
        strategy_json: {
          video_id: videoId,
          video_url: videoUrl,
          youtube_url: `https://youtube.com/shorts/${videoId}`,
          platform: "youtube",
          brand,
          channel: channelLabel,
        },
        linkedin_post: description.slice(0, 500),
      });

      return `✅ YouTube Short uploaded to ${channelLabel}.\n` +
        `Video ID: ${videoId}\n` +
        `URL: https://youtube.com/shorts/${videoId}\n` +
        `Title: ${title}\n` +
        `Brand: ${channelLabel}\n` +
        `Niche: ${niche}\n` +
        `Note: YouTube may take a few minutes to process the video before it's fully visible.`;
    } catch (err: any) {
      return `❌ YouTube publish error: ${err.message}`;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3B. YOUTUBE LONG-FORM — Data API v3
//     Same OAuth flow as Shorts but WITHOUT #Shorts, proper long-form metadata.
//     For the VidRush pipeline: Faceless Factory (long) → YouTube long-form upload.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class YouTubeLongFormPublishTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_publish_long",
    description:
      "Upload a LONG-FORM video to YouTube via the Data API v3. " +
      "For full-length content (5-20 minutes). Does NOT add #Shorts. " +
      "Use brand parameter to choose channel: 'sovereign_synthesis' (default) or 'containment_field'.",
    parameters: {
      video_url: {
        type: "string",
        description: "Public URL of the video file (MP4). Used as fallback if local_path not provided.",
      },
      local_path: {
        type: "string",
        description: "Local filesystem path to the video file (MP4). Preferred over video_url — skips download.",
      },
      title: {
        type: "string",
        description: "Video title (max 100 chars). Do NOT include #Shorts.",
      },
      description: {
        type: "string",
        description: "Full video description. Include hooks, timestamps, links, CTAs, hashtags.",
      },
      tags: {
        type: "string",
        description: "Comma-separated tags for discoverability.",
      },
      niche: {
        type: "string",
        description: "Content niche for logging: dark_psychology, self_improvement, burnout, quantum",
      },
      brand: {
        type: "string",
        description: "Which brand/channel: 'sovereign_synthesis' (default) or 'containment_field'.",
      },
      thumbnail_path: {
        type: "string",
        description: "Optional local path to a custom JPG/PNG thumbnail. Uploaded via YouTube thumbnails.set after the video upload succeeds. Skipping this lets YouTube auto-pick a frame (CTR killer).",
      },
      scheduled_publish_at: {
        type: "string",
        description: "Optional ISO 8601 timestamp for scheduled publishing. When set, video uploads as PRIVATE and auto-publishes at this time. Format: 2026-04-19T15:00:00Z",
      },
    },
    required: ["title", "description"],
  };

  private async getAccessToken(brand: string = "sovereign_synthesis"): Promise<string | null> {
    const directToken = process.env.YOUTUBE_ACCESS_TOKEN;
    if (directToken) return directToken;

    const refreshToken = brand === "containment_field"
      ? process.env.YOUTUBE_REFRESH_TOKEN_TCF
      : process.env.YOUTUBE_REFRESH_TOKEN;
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

    if (!refreshToken || !clientId || !clientSecret) return null;

    try {
      const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }).toString(),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as any;
      return data.access_token || null;
    } catch {
      return null;
    }
  }

  async execute(args: Record<string, unknown>, _context?: any): Promise<string> {
    const brand = args.brand ? String(args.brand) : "sovereign_synthesis";
    const channelLabel = brand === "containment_field" ? "The Containment Field" : "Sovereign Synthesis";
    const token = await this.getAccessToken(brand);
    if (!token) {
      const envHint = brand === "containment_field"
        ? "YOUTUBE_REFRESH_TOKEN_TCF"
        : "YOUTUBE_REFRESH_TOKEN";
      return `❌ YouTube not configured for ${channelLabel}. Set ${envHint} + YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET in Railway env.`;
    }

    const localPath = args.local_path ? String(args.local_path) : null;
    const videoUrl = args.video_url ? String(args.video_url) : null;
    const title = String(args.title).slice(0, 100);
    const description = String(args.description);
    const tags = args.tags ? String(args.tags).split(",").map((t) => t.trim()) : [];
    const niche = args.niche ? String(args.niche) : "unknown";
    const thumbnailPath = args.thumbnail_path ? String(args.thumbnail_path) : null;
    const scheduledPublishAt = args.scheduled_publish_at ? String(args.scheduled_publish_at) : null;

    if (!localPath && !videoUrl) {
      return "❌ Either local_path or video_url is required.";
    }

    try {
      let videoBuffer: Buffer;

      // Prefer local file path — no download, no Supabase Storage dependency
      if (localPath) {
        const { existsSync, readFileSync } = await import("fs");
        if (!existsSync(localPath)) {
          return `❌ Local video file not found: ${localPath}`;
        }
        console.log(`📂 [YouTubeLongForm] Reading local file: ${localPath}`);
        videoBuffer = readFileSync(localPath) as Buffer;
      } else {
        // Fallback: download from URL
        console.log(`⬇️ [YouTubeLongForm] Downloading from URL: ${videoUrl}`);
        const videoResp = await fetch(videoUrl!);
        if (!videoResp.ok) {
          return `❌ Failed to download video from ${videoUrl}: ${videoResp.status}`;
        }
        videoBuffer = Buffer.from(await videoResp.arrayBuffer());
      }

      const videoSize = videoBuffer.length;

      // Long-form allows up to 128GB but practical limit ~2GB for API upload
      if (videoSize > 2 * 1024 * 1024 * 1024) {
        return `❌ Video too large (${Math.round(videoSize / 1024 / 1024)}MB). API upload limit ~2GB.`;
      }

      // Initialize resumable upload — NO #Shorts, category 27 (Education) for long-form
      // SESSION 86: publishAt support for batch scheduling. When set, video uploads as
      // PRIVATE and YouTube auto-publishes at the specified time. Standard YouTube API
      // feature used by every creator tool — no AI flags, no ban risk.
      const statusBlock: Record<string, unknown> = {
        privacyStatus: scheduledPublishAt ? "private" : "public",
        selfDeclaredMadeForKids: false,
      };
      if (scheduledPublishAt) {
        statusBlock.publishAt = scheduledPublishAt;
        console.log(`📅 [YouTubeLongForm] Scheduled publish: ${scheduledPublishAt} (uploading as private)`);
      }

      const metadata = {
        snippet: {
          title,  // Clean title, no #Shorts injected
          description,
          tags,
          categoryId: "27", // Education — better for long-form sovereign content
        },
        status: statusBlock,
      };

      const initResp = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(videoSize),
            "X-Upload-Content-Type": "video/mp4",
          },
          body: JSON.stringify(metadata),
        }
      );

      if (!initResp.ok) {
        const errText = await initResp.text();
        return `❌ YouTube upload init failed (${initResp.status}): ${errText.slice(0, 300)}`;
      }

      const uploadUrl = initResp.headers.get("location");
      if (!uploadUrl) return "❌ YouTube did not return a resumable upload URL.";

      // Upload video data
      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(videoSize),
          "Content-Type": "video/mp4",
        },
        body: videoBuffer,
      });

      if (!uploadResp.ok) {
        const errText = await uploadResp.text();
        return `❌ YouTube video upload failed (${uploadResp.status}): ${errText.slice(0, 300)}`;
      }

      const uploadData = await uploadResp.json() as any;
      const videoId = uploadData.id;

      // ── Deployment 3: Custom thumbnail via YouTube thumbnails.set ──
      // YouTube auto-picks a generic frame if we skip this. Custom thumbs drive CTR,
      // CTR drives top-of-funnel attention (NORTH_STAR metric #1). Non-fatal — a
      // thumbnail upload failure must never roll back a successful video upload.
      let thumbnailNote = "";
      if (thumbnailPath && videoId) {
        try {
          const { existsSync, readFileSync } = await import("fs");
          if (!existsSync(thumbnailPath)) {
            thumbnailNote = `\n⚠️ Thumbnail skipped — file not found: ${thumbnailPath}`;
            console.warn(`[YouTubeLongForm] Thumbnail file missing: ${thumbnailPath}`);
          } else {
            const thumbBuffer = readFileSync(thumbnailPath) as Buffer;
            const thumbSize = thumbBuffer.length;
            // YouTube hard-caps custom thumbnails at 2 MiB
            if (thumbSize > 2 * 1024 * 1024) {
              thumbnailNote = `\n⚠️ Thumbnail skipped — too large (${Math.round(thumbSize / 1024)}KB > 2MB cap)`;
              console.warn(`[YouTubeLongForm] Thumbnail too large: ${thumbSize} bytes`);
            } else {
              // Infer content-type from extension (jpg/jpeg/png); default to jpeg
              const lower = thumbnailPath.toLowerCase();
              const contentType = lower.endsWith(".png")
                ? "image/png"
                : "image/jpeg";

              console.log(
                `🖼️ [YouTubeLongForm] Uploading custom thumbnail (${(thumbSize / 1024).toFixed(0)}KB, ${contentType}) → video ${videoId}`
              );
              const thumbResp = await fetch(
                `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": contentType,
                    "Content-Length": String(thumbSize),
                  },
                  body: thumbBuffer,
                }
              );

              if (thumbResp.ok) {
                thumbnailNote = `\n🖼️ Custom thumbnail uploaded (${(thumbSize / 1024).toFixed(0)}KB)`;
                console.log(`✅ [YouTubeLongForm] Custom thumbnail set for ${videoId}`);
              } else {
                const errText = await thumbResp.text();
                thumbnailNote = `\n⚠️ Thumbnail upload failed (${thumbResp.status}) — video still published`;
                console.warn(
                  `[YouTubeLongForm] Thumbnail set failed (${thumbResp.status}): ${errText.slice(0, 300)}`
                );
              }
            }
          }
        } catch (err: any) {
          thumbnailNote = `\n⚠️ Thumbnail upload error (non-fatal): ${err.message?.slice(0, 150)}`;
          console.warn(`[YouTubeLongForm] Thumbnail error: ${err.message?.slice(0, 200)}`);
        }
      }

      // Log to Supabase
      await logVideoPost({
        source: "youtube_longform",
        intent_tag: niche,
        status: "published",
        strategy_json: {
          video_id: videoId,
          video_url: videoUrl,
          youtube_url: `https://youtube.com/watch?v=${videoId}`,
          platform: "youtube",
          format: "long_form",
          brand,
          channel: channelLabel,
          custom_thumbnail: thumbnailPath ? true : false,
        },
        linkedin_post: description.slice(0, 500),
      });

      return `✅ YouTube LONG-FORM uploaded to ${channelLabel}.\n` +
        `Video ID: ${videoId}\n` +
        `URL: https://youtube.com/watch?v=${videoId}\n` +
        `Title: ${title}\n` +
        `Brand: ${channelLabel}\n` +
        `Niche: ${niche}` +
        thumbnailNote;
    } catch (err: any) {
      return `❌ YouTube long-form publish error: ${err.message}`;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. UNIFIED VIDEO PUBLISHER — Smart router
//    Agents call this single tool. It routes to the right platform.
//    If platform tokens aren't set, it gracefully reports which are available.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class VideoPublisherTool implements Tool {
  private tiktok = new TikTokPublishTool();
  private instagram = new InstagramReelsPublishTool();
  private youtube = new YouTubeShortsPublishTool();
  private tiktokBrowser = new TikTokBrowserUploadTool();
  private instagramBrowser = new InstagramBrowserUploadTool();

  definition: ToolDefinition = {
    name: "publish_video",
    description:
      "Publish a video file to one or more platforms (TikTok, Instagram Reels, YouTube Shorts). " +
      "This is for VIDEO FILE uploads via direct API/browser. " +
      "Buffer handles text+image posts across all channels separately. " +
      "Specify target platforms as comma-separated list. If a platform isn't configured, you'll be told which ones are available.",
    parameters: {
      video_url: {
        type: "string",
        description: "Public URL of the video file (MP4, from Supabase storage bucket)",
      },
      platforms: {
        type: "string",
        description: "Target platforms, comma-separated: tiktok, instagram, youtube (or 'all' for all configured platforms)",
      },
      caption: {
        type: "string",
        description: "Video caption/description (used across all platforms). Include hooks, hashtags, CTA.",
      },
      title: {
        type: "string",
        description: "Video title (used for YouTube). If omitted, first line of caption is used.",
      },
      tags: {
        type: "string",
        description: "Comma-separated tags for discoverability (used for YouTube).",
      },
      niche: {
        type: "string",
        description: "Content niche: dark_psychology, self_improvement, burnout, quantum",
      },
      brand: {
        type: "string",
        description: "Which brand to publish as: 'sovereign_synthesis' (default) or 'containment_field'. Routes to the correct channel/account per platform.",
      },
    },
    required: ["video_url", "platforms", "caption"],
  };

  async execute(args: Record<string, unknown>, _context?: any): Promise<string> {
    const videoUrl = String(args.video_url);
    const caption = String(args.caption);
    const title = args.title ? String(args.title) : caption.split("\n")[0].slice(0, 100);
    const tags = args.tags ? String(args.tags) : "";
    const niche = args.niche ? String(args.niche) : "unknown";
    const brand = args.brand ? String(args.brand) : "sovereign_synthesis";

    // Determine which platforms to target
    const platformInput = String(args.platforms).toLowerCase();
    let targetPlatforms: string[];

    if (platformInput === "all") {
      targetPlatforms = ["tiktok", "instagram", "youtube"];
    } else {
      targetPlatforms = platformInput.split(",").map((p) => p.trim());
    }

    // Check which platforms are configured (API tokens)
    const configured: Record<string, boolean> = {
      tiktok: !!process.env.TIKTOK_ACCESS_TOKEN,
      instagram: !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ID),
      youtube: !!(process.env.YOUTUBE_ACCESS_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN),
    };

    // Browser fallback available when API tokens are missing
    const browserEnabled = config.tools.browserEnabled;

    const results: string[] = [];
    let successCount = 0;

    for (const platform of targetPlatforms) {
      try {
        let result: string;
        switch (platform) {
          case "tiktok":
            if (configured.tiktok) {
              result = await this.tiktok.execute({ video_url: videoUrl, caption, niche });
            } else if (browserEnabled) {
              result = await this.tiktokBrowser.execute({ video_url: videoUrl, caption, niche, brand });
              result = `[BROWSER FALLBACK]\n${result}`;
            } else {
              result = "⬚ Not configured (API token missing, browser disabled)";
            }
            break;
          case "instagram":
            if (configured.instagram) {
              result = await this.instagram.execute({ video_url: videoUrl, caption, niche });
            } else if (browserEnabled) {
              result = await this.instagramBrowser.execute({ video_url: videoUrl, caption, niche, brand });
              result = `[BROWSER FALLBACK]\n${result}`;
            } else {
              result = "⬚ Not configured (API token missing, browser disabled)";
            }
            break;
          case "youtube":
            if (configured.youtube) {
              result = await this.youtube.execute({ video_url: videoUrl, title, description: caption, tags, niche, brand });
            } else {
              result = "⬚ Not configured (YouTube OAuth tokens missing)";
            }
            break;
          default:
            result = `❌ Unknown platform: ${platform}`;
        }

        results.push(`${platform.toUpperCase()}:\n${result}`);
        if (result.includes("✅")) successCount++;
      } catch (err: any) {
        results.push(`❌ ${platform.toUpperCase()}: ${err.message}`);
      }
    }

    // Summary
    const configuredList = Object.entries(configured)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(", ");
    const unconfiguredList = Object.entries(configured)
      .filter(([, v]) => !v)
      .map(([k]) => k)
      .join(", ");
    const browserFallbackPlatforms = ["tiktok", "instagram"]
      .filter((p) => !configured[p] && browserEnabled)
      .join(", ");

    return `📹 VIDEO PUBLISH RESULTS (${successCount}/${targetPlatforms.length} succeeded)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      results.join("\n\n") +
      `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `API configured: ${configuredList || "none"}\n` +
      `Not configured: ${unconfiguredList || "none"}\n` +
      (browserFallbackPlatforms ? `Browser fallback active: ${browserFallbackPlatforms}\n` : "") +
      `Video: ${videoUrl}`;
  }
}
