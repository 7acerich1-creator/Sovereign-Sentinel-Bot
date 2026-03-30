// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Direct Video Publisher (Path A)
// Bypasses Buffer entirely for video content.
// Buffer v1 API has NO video upload capability (media[photo] only).
// This module posts video directly to platform APIs:
//   - TikTok Content Posting API
//   - Instagram Graph API (Reels)
//   - YouTube Data API (Shorts)
// Buffer remains in use for text-only posts (X, Threads).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// ── Supabase logging helper ──
async function logVideoPost(data: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/content_transmissions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(data),
    });
  } catch {
    // Non-critical
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
      "Requires a public video URL (Supabase storage). This bypasses Buffer which cannot handle video. " +
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

  async execute(args: Record<string, unknown>): Promise<string> {
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
      "Requires a public video URL. This bypasses Buffer which cannot handle video uploads. " +
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

  async execute(args: Record<string, unknown>): Promise<string> {
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
//    Requires: YOUTUBE_ACCESS_TOKEN + YOUTUBE_REFRESH_TOKEN + YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET
//    Shorts = any vertical video ≤60s uploaded normally
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class YouTubeShortsPublishTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_publish_short",
    description:
      "Upload a Short to YouTube via the Data API v3. " +
      "Requires a public video URL. Shorts are vertical videos ≤60 seconds. " +
      "Include #Shorts in the title or description for YouTube to classify it as a Short.",
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
    },
    required: ["video_url", "title", "description"],
  };

  private async getAccessToken(): Promise<string | null> {
    // Try direct access token first
    const directToken = process.env.YOUTUBE_ACCESS_TOKEN;
    if (directToken) return directToken;

    // Try refresh token flow
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
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

  async execute(args: Record<string, unknown>): Promise<string> {
    const token = await this.getAccessToken();
    if (!token) {
      return "❌ YouTube not configured. Set YOUTUBE_ACCESS_TOKEN (or YOUTUBE_REFRESH_TOKEN + YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET) in Railway env.\n" +
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
        },
        linkedin_post: description.slice(0, 500),
      });

      return `✅ YouTube Short uploaded and published.\n` +
        `Video ID: ${videoId}\n` +
        `URL: https://youtube.com/shorts/${videoId}\n` +
        `Title: ${title}\n` +
        `Niche: ${niche}\n` +
        `Note: YouTube may take a few minutes to process the video before it's fully visible.`;
    } catch (err: any) {
      return `❌ YouTube publish error: ${err.message}`;
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

  definition: ToolDefinition = {
    name: "publish_video",
    description:
      "Publish a video to one or more platforms (TikTok, Instagram Reels, YouTube Shorts). " +
      "This is the primary video distribution tool — use this instead of Buffer's social_scheduler_create_post for video content. " +
      "Buffer can only handle images and text. Videos must go through this tool. " +
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
    },
    required: ["video_url", "platforms", "caption"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const videoUrl = String(args.video_url);
    const caption = String(args.caption);
    const title = args.title ? String(args.title) : caption.split("\n")[0].slice(0, 100);
    const tags = args.tags ? String(args.tags) : "";
    const niche = args.niche ? String(args.niche) : "unknown";

    // Determine which platforms to target
    const platformInput = String(args.platforms).toLowerCase();
    let targetPlatforms: string[];

    if (platformInput === "all") {
      targetPlatforms = ["tiktok", "instagram", "youtube"];
    } else {
      targetPlatforms = platformInput.split(",").map((p) => p.trim());
    }

    // Check which platforms are configured
    const configured: Record<string, boolean> = {
      tiktok: !!process.env.TIKTOK_ACCESS_TOKEN,
      instagram: !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ID),
      youtube: !!(process.env.YOUTUBE_ACCESS_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN),
    };

    const results: string[] = [];
    let successCount = 0;

    for (const platform of targetPlatforms) {
      if (!configured[platform]) {
        results.push(`⬚ ${platform.toUpperCase()}: Not configured (token missing)`);
        continue;
      }

      try {
        let result: string;
        switch (platform) {
          case "tiktok":
            result = await this.tiktok.execute({ video_url: videoUrl, caption, niche });
            break;
          case "instagram":
            result = await this.instagram.execute({ video_url: videoUrl, caption, niche });
            break;
          case "youtube":
            result = await this.youtube.execute({ video_url: videoUrl, title, description: caption, tags, niche });
            break;
          default:
            result = `❌ Unknown platform: ${platform}`;
        }

        results.push(`${platform.toUpperCase()}:\n${result}`);
        if (result.startsWith("✅")) successCount++;
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

    return `📹 VIDEO PUBLISH RESULTS (${successCount}/${targetPlatforms.length} succeeded)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      results.join("\n\n") +
      `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Configured: ${configuredList || "none"}\n` +
      `Not configured: ${unconfiguredList || "none"}\n` +
      `Video: ${videoUrl}`;
  }
}
