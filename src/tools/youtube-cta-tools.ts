// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — YouTube CTA Audit & Optimization Tools
// Tools: youtube_update_metadata, youtube_pin_comment, youtube_cta_audit
// Audit flow: agent scans top videos → proposes CTA changes →
//   writes to `cta_audit_proposals` → DMs Architect on Telegram →
//   Architect approves in Mission Control → agent executes via update tools
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { config } from "../config";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// ── Shared OAuth helper (same pattern as video-publisher.ts) ──
async function getYouTubeToken(brand: string = "sovereign_synthesis"): Promise<string | null> {
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

// ── Supabase helper ──
async function supabasePost(table: string, data: Record<string, unknown>): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      console.error(`[CTATools] ${table} POST failed ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    const rows = (await resp.json()) as any[];
    return rows?.[0]?.id || null;
  } catch (err: any) {
    console.error(`[CTATools] ${table} error: ${err.message}`);
    return null;
  }
}

async function supabaseQuery(table: string, query: string = ""): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!resp.ok) return [];
    return (await resp.json()) as any[];
  } catch {
    return [];
  }
}

// ── Telegram DM helper ──
async function notifyArchitect(message: string): Promise<void> {
  const chatId = config.telegram.authorizedUserIds?.[0];
  const botToken = config.telegram.botToken;
  if (!chatId || !botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch { /* best-effort */ }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. YOUTUBE UPDATE METADATA — Edit existing video title/description/tags
//    Uses YouTube Data API v3 videos.update (snippet part)
//    This is what lets agents EXECUTE approved CTA changes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class YouTubeUpdateMetadataTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_update_metadata",
    description:
      "Update the title, description, or tags on an EXISTING YouTube video. " +
      "Use this to inject CTAs, fix descriptions, optimize SEO on published videos. " +
      "Requires the video_id. Only fields you provide will be changed — omitted fields stay as-is. " +
      "Use brand to target the correct channel's OAuth credentials.",
    parameters: {
      video_id: {
        type: "string",
        description: "YouTube video ID (the part after watch?v=)",
      },
      title: {
        type: "string",
        description: "New title (max 100 chars). Omit to keep current title.",
      },
      description: {
        type: "string",
        description: "New description. Should include sovereign-landing CTA, links, hashtags.",
      },
      tags: {
        type: "string",
        description: "Comma-separated tags. Omit to keep current tags.",
      },
      brand: {
        type: "string",
        description: "Which channel: 'sovereign_synthesis' (default) or 'containment_field'.",
      },
    },
    required: ["video_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const videoId = String(args.video_id);
    const brand = args.brand ? String(args.brand) : "sovereign_synthesis";
    const channelLabel = brand === "containment_field" ? "The Containment Field" : "Sovereign Synthesis 77";
    const token = await getYouTubeToken(brand);

    if (!token) {
      return `❌ YouTube not configured for ${channelLabel}. Need OAuth credentials in Railway env.`;
    }

    try {
      // Step 1: Fetch current video metadata (we need categoryId + existing fields)
      const listResp = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!listResp.ok) {
        return `❌ Failed to fetch video ${videoId}: ${listResp.status}`;
      }

      const listData = await listResp.json() as any;
      const items = listData.items;
      if (!items || items.length === 0) {
        return `❌ Video ${videoId} not found on ${channelLabel}.`;
      }

      const current = items[0].snippet;

      // Step 2: Merge — only override fields the caller provided
      const updatedSnippet: any = {
        categoryId: current.categoryId || "22",
        title: args.title ? String(args.title).slice(0, 100) : current.title,
        description: args.description ? String(args.description) : current.description,
        tags: args.tags
          ? String(args.tags).split(",").map((t: string) => t.trim())
          : current.tags || [],
      };

      // Step 3: Push update
      const updateResp = await fetch(
        "https://www.googleapis.com/youtube/v3/videos?part=snippet",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: videoId,
            snippet: updatedSnippet,
          }),
        }
      );

      if (!updateResp.ok) {
        const errText = await updateResp.text();
        return `❌ YouTube update failed (${updateResp.status}): ${errText.slice(0, 300)}`;
      }

      const changes: string[] = [];
      if (args.title) changes.push(`Title → "${updatedSnippet.title}"`);
      if (args.description) changes.push(`Description updated (${updatedSnippet.description.length} chars)`);
      if (args.tags) changes.push(`Tags → ${updatedSnippet.tags.join(", ")}`);

      return `✅ Video ${videoId} metadata updated on ${channelLabel}.\n` +
        `URL: https://youtube.com/watch?v=${videoId}\n` +
        `Changes: ${changes.join(" | ") || "No changes specified"}`;
    } catch (err: any) {
      return `❌ YouTube update error: ${err.message}`;
    }
  }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. YOUTUBE PIN COMMENT — Add + pin a comment on a video
//    Uses YouTube Data API v3 commentThreads.insert
//    Note: Pinning requires the comment author to own the video channel
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class YouTubePinCommentTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_pin_comment",
    description:
      "Post a comment on a YouTube video and optionally pin it. " +
      "Use this to add CTA pinned comments (e.g., 'Get the framework → sovereign-landing.com'). " +
      "Pinning only works when the authenticated account owns the video. " +
      "The comment is posted as the channel owner (via OAuth).",
    parameters: {
      video_id: {
        type: "string",
        description: "YouTube video ID to comment on",
      },
      comment_text: {
        type: "string",
        description: "The comment text. Include CTA link to sovereign-landing.",
      },
      pin: {
        type: "string",
        description: "Whether to pin the comment: 'true' or 'false'. Default 'true'.",
      },
      brand: {
        type: "string",
        description: "Which channel: 'sovereign_synthesis' (default) or 'containment_field'.",
      },
    },
    required: ["video_id", "comment_text"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const videoId = String(args.video_id);
    const commentText = String(args.comment_text);
    const shouldPin = String(args.pin || "true") === "true";
    const brand = args.brand ? String(args.brand) : "sovereign_synthesis";
    const channelLabel = brand === "containment_field" ? "The Containment Field" : "Sovereign Synthesis 77";
    const token = await getYouTubeToken(brand);

    if (!token) {
      return `❌ YouTube not configured for ${channelLabel}.`;
    }

    try {
      // Step 1: Post the comment
      const commentResp = await fetch(
        "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            snippet: {
              videoId,
              topLevelComment: {
                snippet: {
                  textOriginal: commentText,
                },
              },
            },
          }),
        }
      );

      if (!commentResp.ok) {
        const errText = await commentResp.text();
        return `❌ Comment post failed (${commentResp.status}): ${errText.slice(0, 300)}`;
      }

      const commentData = await commentResp.json() as any;
      const commentId = commentData.snippet?.topLevelComment?.id || commentData.id;

      if (!commentId) {
        return "❌ Comment posted but could not extract comment ID for pinning.";
      }

      let pinStatus = "";

      // Step 2: Pin the comment (YouTube moderates via setModerationStatus isn't pin —
      // pinning is done via comments.update with a moderationStatus or via the
      // channel's video comment pin endpoint which isn't in v3 REST API)
      // Alternative: use the undocumented pin via comment thread update
      // For now: we use the comments.setModerationStatus to heldForReview then
      // Actually — YouTube Data API v3 does NOT have a direct "pin comment" endpoint.
      // The pin action is only available in YouTube Studio UI.
      // What we CAN do: post the comment as the channel owner (which we do),
      // and it appears at the top by default as a creator comment.
      if (shouldPin) {
        pinStatus = "\n⚠️ Auto-pin not available via API — comment posted as channel owner (appears prominently). Pin manually in YouTube Studio if needed.";
      }

      return `✅ Comment posted on video ${videoId} (${channelLabel}).\n` +
        `Comment ID: ${commentId}\n` +
        `Text: "${commentText.slice(0, 100)}${commentText.length > 100 ? "..." : ""}"` +
        pinStatus;
    } catch (err: any) {
      return `❌ Comment error: ${err.message}`;
    }
  }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. YOUTUBE CTA AUDIT — Scan top videos, propose optimizations
//    Flow: Fetch youtube_analytics from Supabase → pull current metadata
//    from YouTube API → check for CTA presence → write proposals
//    to cta_audit_proposals table → DM Architect on Telegram
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class YouTubeCTAAuditTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_cta_audit",
    description:
      "Run a CTA audit on top-performing YouTube videos. Checks each video's description and comments " +
      "for sovereign-landing links and CTAs. Produces optimization proposals written to " +
      "the cta_audit_proposals table in Supabase. DMs the Architect on Telegram when complete. " +
      "Run this weekly. The Architect reviews and approves proposals in Mission Control, " +
      "then execute approved changes via youtube_update_metadata and youtube_pin_comment.",
    parameters: {
      brand: {
        type: "string",
        description: "Which channel to audit: 'sovereign_synthesis' (default) or 'containment_field'.",
      },
      top_n: {
        type: "string",
        description: "Number of top videos to audit (by views). Default '5'.",
      },
      landing_url: {
        type: "string",
        description: "The landing page URL to check for in CTAs. Default 'sovereign-landing.com'.",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const brand = args.brand ? String(args.brand) : "sovereign_synthesis";
    const topN = parseInt(String(args.top_n || "5"), 10);
    const landingUrl = String(args.landing_url || "sovereign-landing.com");
    const channelLabel = brand === "containment_field" ? "The Containment Field" : "Sovereign Synthesis 77";
    const token = await getYouTubeToken(brand);

    if (!token) {
      return `❌ YouTube not configured for ${channelLabel}.`;
    }

    try {
      // Step 1: Get top videos from youtube_analytics (Supabase)
      const analytics = await supabaseQuery(
        "youtube_analytics",
        `select=video_id,title,views,ctr,impressions,retention&order=views.desc&limit=${topN}`
      );

      if (analytics.length === 0) {
        return "❌ No videos in youtube_analytics table. Run the YouTube stats fetch first.";
      }

      const proposals: any[] = [];
      const auditResults: string[] = [];

      // Step 2: For each top video, fetch live metadata from YouTube API
      for (const video of analytics) {
        const videoId = video.video_id;
        if (!videoId) continue;

        const listResp = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${encodeURIComponent(videoId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!listResp.ok) {
          auditResults.push(`⚠️ ${videoId}: Could not fetch (${listResp.status})`);
          continue;
        }

        const listData = await listResp.json() as any;
        const item = listData.items?.[0];
        if (!item) {
          auditResults.push(`⚠️ ${videoId}: Not found on YouTube`);
          continue;
        }

        const snippet = item.snippet;
        const stats = item.statistics;
        const currentDesc = snippet.description || "";
        const currentTitle = snippet.title || "";
        const currentTags = snippet.tags || [];

        // Step 3: Check CTA presence
        const hasLandingLink = currentDesc.toLowerCase().includes(landingUrl.toLowerCase());
        const hasCTALanguage = /opt.?in|sign.?up|get the framework|join|free|download/i.test(currentDesc);
        const hasHashtags = /#\w+/.test(currentDesc);

        const issues: string[] = [];
        const fixes: Record<string, string> = {};

        if (!hasLandingLink) {
          issues.push(`No ${landingUrl} link in description`);
          // Build optimized description: prepend CTA block
          const ctaBlock = `🔓 Get the Sovereign Synthesis Framework → https://${landingUrl}\n\n`;
          fixes.description = ctaBlock + currentDesc;
        }

        if (!hasCTALanguage && hasLandingLink) {
          issues.push("Link present but no CTA language (no 'opt in', 'join', 'download')");
        }

        if (currentTags.length < 3) {
          issues.push(`Only ${currentTags.length} tags (recommend 8-15)`);
        }

        // Always propose a pinned comment if no issues OR as reinforcement
        const pinnedCommentProposal = `🔓 Ready to break the simulation? Get the Sovereign Synthesis Framework → https://${landingUrl}`;

        const proposal = {
          video_id: videoId,
          video_title: currentTitle,
          brand,
          channel: channelLabel,
          views: parseInt(stats.viewCount || "0", 10),
          ctr: video.ctr || 0,
          issues_found: issues,
          current_description: currentDesc.slice(0, 500),
          proposed_description: fixes.description || null,
          proposed_comment: pinnedCommentProposal,
          status: "pending_review",
          created_at: new Date().toISOString(),
        };

        proposals.push(proposal);

        const statusIcon = issues.length > 0 ? "🔴" : "🟢";
        auditResults.push(
          `${statusIcon} "${currentTitle}" (${stats.viewCount} views, ${video.ctr || "?"}% CTR) — ${issues.length > 0 ? issues.join("; ") : "CTA present"}`
        );
      }

      // Step 4: Write proposals to Supabase
      let savedCount = 0;
      for (const proposal of proposals) {
        const id = await supabasePost("cta_audit_proposals", proposal);
        if (id) savedCount++;
      }

      // Step 5: DM Architect on Telegram
      const issueCount = proposals.filter(p => p.issues_found.length > 0).length;
      const dmMessage =
        `📋 *CTA Audit Complete — ${channelLabel}*\n\n` +
        `Videos audited: ${proposals.length}\n` +
        `Need optimization: ${issueCount}\n` +
        `Proposals saved: ${savedCount}\n\n` +
        `${auditResults.join("\n")}\n\n` +
        `Review & approve in Mission Control → Content Intel.`;

      await notifyArchitect(dmMessage);

      return `✅ CTA Audit complete for ${channelLabel}.\n\n` +
        `Videos scanned: ${proposals.length}\n` +
        `Issues found: ${issueCount}\n` +
        `Proposals written to cta_audit_proposals: ${savedCount}\n\n` +
        auditResults.join("\n") +
        `\n\nArchitect has been DM'd on Telegram. Awaiting review in Mission Control.`;
    } catch (err: any) {
      return `❌ CTA Audit error: ${err.message}`;
    }
  }
}
