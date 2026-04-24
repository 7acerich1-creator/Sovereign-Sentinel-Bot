// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — YouTube Comment Poster
// Session 109 (2026-04-24) — Yuki engagement automation.
//
// Posts channel-owner comments on YouTube videos via Data API v3.
// Primary use: auto-post diagnostic link comment on every new video.
// NOTE: YouTube API does NOT support pinning comments — that requires
// YouTube Studio. Channel-owner comments appear prominently regardless.
//
// Uses existing OAuth refresh tokens (same as youtube-comment-watcher.ts).
// Requires youtube.force-ssl scope on the token — if the original OAuth
// grant only had youtube.readonly, posting will return 403.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition, ToolContext } from "../types";

type Brand = "sovereign_synthesis" | "containment_field";

const BRAND_CHANNEL_IDS: Record<Brand, string> = {
  sovereign_synthesis: "UCbj9a6brDL9hNIY1BpxOJfQ",
  containment_field: "UCLHJIIEjavmrS3R70xnCD1Q",
};

const DIAGNOSTIC_COMMENT = `🔓 Free diagnostic — discover which invisible pattern is running your decisions:\nhttps://sovereign-synthesis.com/diagnostic\n\nTakes 2 minutes. No email required to see your result.`;

async function getYouTubeToken(brand: Brand): Promise<string | null> {
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
    const data = (await resp.json()) as any;
    return data.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Post a comment on a YouTube video as the channel owner.
 * Returns the comment ID on success, or an error string.
 */
export async function postYouTubeComment(
  videoId: string,
  text: string,
  brand: Brand = "sovereign_synthesis"
): Promise<{ success: boolean; commentId?: string; error?: string }> {
  const token = await getYouTubeToken(brand);
  if (!token) {
    return { success: false, error: `No OAuth token available for ${brand}` };
  }

  const channelId = BRAND_CHANNEL_IDS[brand];

  try {
    const resp = await fetch(
      "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snippet: {
            channelId,
            videoId,
            topLevelComment: {
              snippet: {
                textOriginal: text,
              },
            },
          },
        }),
      }
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(`[YTComment] POST failed ${resp.status}: ${errBody.slice(0, 500)}`);
      // Surface scope error clearly
      if (resp.status === 403) {
        return {
          success: false,
          error: `403 Forbidden — OAuth token likely missing youtube.force-ssl scope. Re-authorize at: https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.YOUTUBE_CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=https://www.googleapis.com/auth/youtube.force-ssl&access_type=offline&prompt=consent`,
        };
      }
      return { success: false, error: `YouTube API ${resp.status}: ${errBody.slice(0, 300)}` };
    }

    const data = (await resp.json()) as any;
    const commentId = data.id || data.snippet?.topLevelComment?.id;
    console.log(`[YTComment] Posted comment ${commentId} on video ${videoId} (${brand})`);
    return { success: true, commentId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Post the standard diagnostic link comment on a video.
 * Called by VidRush after successful upload and by /comment command.
 */
export async function postDiagnosticComment(
  videoId: string,
  brand: Brand = "sovereign_synthesis"
): Promise<{ success: boolean; commentId?: string; error?: string }> {
  return postYouTubeComment(videoId, DIAGNOSTIC_COMMENT, brand);
}

/**
 * Agent tool class for Yuki (and other agents if needed).
 */
export class YouTubeCommentTool implements Tool {
  definition: ToolDefinition = {
    name: "post_youtube_comment",
    description:
      "Post a comment on a YouTube video as the channel owner. " +
      "Use this to post diagnostic link comments, engagement replies, or community messages. " +
      "Note: YouTube API cannot PIN comments — that requires YouTube Studio. " +
      "Channel-owner comments appear prominently regardless.",
    parameters: {
      video_id: {
        type: "string",
        description: "The YouTube video ID (the part after v= in the URL)",
      },
      text: {
        type: "string",
        description: "The comment text to post. If omitted, posts the standard diagnostic link comment.",
      },
      brand: {
        type: "string",
        description: "Which channel to post as: sovereign_synthesis or containment_field. Default: sovereign_synthesis.",
        enum: ["sovereign_synthesis", "containment_field"],
      },
    },
    required: ["video_id"],
  };

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const videoId = String(args.video_id || "");
    if (!videoId) return "❌ video_id is required.";

    const brand = (args.brand as Brand) || "sovereign_synthesis";
    const text = args.text ? String(args.text) : DIAGNOSTIC_COMMENT;

    const result = await postYouTubeComment(videoId, text, brand);
    if (result.success) {
      return `✅ Comment posted on video ${videoId} (${brand}). Comment ID: ${result.commentId}\nDirect link: https://www.youtube.com/watch?v=${videoId}&lc=${result.commentId}`;
    }
    return `❌ Failed to post comment: ${result.error}`;
  }
}
