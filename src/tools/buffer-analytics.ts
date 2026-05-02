// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Buffer Analytics Tool
// Session 36: Built around an assumed engagement-metrics schema.
// Session 122 (2026-04-26): REWRITE. Verified Buffer's actual GraphQL schema
//   from developers.buffer.com — Buffer's GraphQL API does NOT expose
//   engagement metrics on the Post type (likes/clicks/impressions/reach are
//   on their roadmap, not yet shipped). The S36 query asked for `statistics
//   { likes ... }` and `channel { id name service }` — both fabricated.
//   Buffer correctly rejected with "Cannot query field 'statistics' on type
//   'Post'" and "Field 'first' is not defined by type 'PostsInput'" (the
//   `first:` arg goes OUTSIDE the input block, not inside).
//
// Verified working schema (per Buffer docs Apr 2026):
//   query { posts(first: N, input: { organizationId, filter: { status, channelIds } })
//     { edges { node { id text dueAt channelId status } }
//       pageInfo { hasNextPage endCursor } } }
//
// What this tool now reports HONESTLY:
//   - Post counts per channel (real, queryable)
//   - Channel distribution / cadence (real)
//   - Recent sent posts with text + dueAt (real)
//   - Engagement metrics: explicitly marked as "not exposed by Buffer GraphQL —
//     pull from native APIs" so Vector knows where to look (YouTube Analytics,
//     Meta Graph API, etc.)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { bufferGraphQL, BUFFER_ORG_ID, getBufferChannels } from "../engine/buffer-graphql";

export class BufferAnalyticsTool implements Tool {
  definition: ToolDefinition = {
    name: "buffer_analytics",
    description:
      "Pull content cadence and channel distribution from Buffer's GraphQL API. " +
      "Returns post counts, channel breakdown, and recent sent posts. " +
      "NOTE: Buffer's GraphQL API does NOT expose per-post engagement metrics " +
      "(likes, clicks, impressions, reach) — those are on Buffer's roadmap. " +
      "For engagement data, query native platform APIs: YouTube Analytics for YT, " +
      "Meta Graph API for Facebook/Instagram, etc. " +
      "Use this tool for: how much content was published, which channels are most active, " +
      "what was the most recent post on a given channel.",
    parameters: {
      report: {
        type: "string",
        description:
          "Report type: 'overview' (total post counts + channel distribution), " +
          "'channel_breakdown' (per-channel post counts and most-recent dates), " +
          "'recent' (latest sent posts with text and timestamps), " +
          "'top_posts' (deprecated alias — returns recent since engagement metrics aren't available). " +
          "Default: overview",
      },
      limit: {
        type: "number",
        description: "Number of posts to fetch (default 50, max 100). Buffer pagination is cursor-based; this fetches the most recent N sent posts.",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!process.env.BUFFER_API_KEY) {
      return "❌ BUFFER_API_KEY not set. Vector cannot pull content cadence until this is configured in Railway.";
    }

    const report = String(args.report || "overview");
    const limit = Math.min(Number(args.limit) || 50, 100);

    try {
      // VERIFIED Buffer GraphQL schema (per developers.buffer.com Apr 2026):
      //   - `first: N` is a sibling argument to `input:` — NOT inside it
      //   - Post fields: id, text, dueAt, channelId, status, assets { id mimeType }
      //   - NO `statistics`, NO `channel { ... }` sub-object — channels resolved
      //     separately via getBufferChannels() (already cached in buffer-graphql.ts)
      const query = `
        query GetSentPosts {
          posts(
            first: ${limit},
            input: {
              organizationId: "${BUFFER_ORG_ID}",
              filter: { status: [sent] }
            }
          ) {
            edges {
              node {
                id
                text
                dueAt
                channelId
                status
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const data = await bufferGraphQL(query);
      const edges = data?.posts?.edges || [];

      if (edges.length === 0) {
        return "📊 BUFFER CONTENT CADENCE\n" +
          "No sent posts found in Buffer for this organization.\n" +
          "If content was published outside Buffer (direct posting), it won't appear here.\n" +
          "ENGAGEMENT METRICS NOTE: Buffer GraphQL doesn't expose engagement metrics — " +
          "pull from YouTube Analytics / Meta Graph API for native platform stats.";
      }

      // Resolve channels via cached lookup (no extra API call in most cases — 4h TTL)
      const channels = await getBufferChannels();
      const channelById = new Map<string, { name: string; service: string; displayName?: string }>();
      for (const ch of channels) {
        channelById.set(ch.id, { name: ch.name, service: ch.service, displayName: ch.displayName });
      }

      const posts = edges.map((e: any) => {
        const ch = channelById.get(e.node.channelId);
        return {
          id: e.node.id,
          text: (e.node.text || "").slice(0, 140),
          channelId: e.node.channelId,
          channelName: ch?.displayName || ch?.name || "(unknown channel)",
          service: (ch?.service || "unknown").toLowerCase(),
          sentAt: e.node.dueAt,
          status: e.node.status,
        };
      });

      // Honest engagement-metrics footer — same on every report so Vector always
      // includes the caveat in his briefing instead of fabricating numbers.
      const ENGAGEMENT_FOOTER =
        "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "⚠️ ENGAGEMENT METRICS UNAVAILABLE FROM BUFFER GRAPHQL\n" +
        "Buffer's GraphQL API exposes post metadata (id, text, dueAt, channelId, status) " +
        "but NOT engagement (likes, clicks, impressions, reach, engagement rate). " +
        "Per Buffer's roadmap, those fields are not yet shipped.\n" +
        "For native engagement metrics:\n" +
        "  • YouTube → query the youtube_analytics Supabase table (already populated)\n" +
        "  • Facebook / Instagram → Meta Graph API insights endpoint\n" +
        "  • LinkedIn → LinkedIn Marketing API";

      switch (report) {
        case "overview": {
          // Channel distribution from sent posts
          const byChannel: Record<string, { posts: number; service: string; lastSentAt: string }> = {};
          for (const p of posts) {
            const key = `${p.service}/${p.channelName}`;
            if (!byChannel[key]) {
              byChannel[key] = { posts: 0, service: p.service, lastSentAt: p.sentAt };
            }
            byChannel[key].posts++;
            if (p.sentAt > byChannel[key].lastSentAt) byChannel[key].lastSentAt = p.sentAt;
          }

          const sorted = Object.entries(byChannel).sort(([, a], [, b]) => b.posts - a.posts);
          const channelLines = sorted.map(([key, c]) =>
            `  ${key}: ${c.posts} sent posts (most recent: ${c.lastSentAt?.slice(0, 10) || "unknown"})`
          );

          // Time window
          const sentDates: string[] = posts.map((p: any) => p.sentAt).filter(Boolean).sort();
          const earliest = sentDates[0]?.slice(0, 10) || "unknown";
          const latest = sentDates[sentDates.length - 1]?.slice(0, 10) || "unknown";

          return (
            `📊 BUFFER CONTENT CADENCE — ${posts.length} sent posts\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Window: ${earliest} → ${latest}\n` +
            `Total channels active: ${sorted.length}\n` +
            `\nPosts per channel (sorted by volume):\n` +
            channelLines.join("\n") +
            ENGAGEMENT_FOOTER
          );
        }

        case "channel_breakdown": {
          // Per-channel: count + cadence + most-recent-text snippet
          const byChannel: Record<string, {
            posts: number;
            service: string;
            lastSentAt: string;
            lastText: string;
          }> = {};
          for (const p of posts) {
            const key = `${p.service}/${p.channelName}`;
            if (!byChannel[key]) {
              byChannel[key] = {
                posts: 0,
                service: p.service,
                lastSentAt: p.sentAt,
                lastText: p.text,
              };
            }
            byChannel[key].posts++;
            if (p.sentAt > byChannel[key].lastSentAt) {
              byChannel[key].lastSentAt = p.sentAt;
              byChannel[key].lastText = p.text;
            }
          }

          const lines = Object.entries(byChannel)
            .sort(([, a], [, b]) => b.posts - a.posts)
            .map(([key, c]) =>
              `📌 ${key}\n` +
              `   Posts: ${c.posts} | Most recent: ${c.lastSentAt?.slice(0, 16) || "unknown"}\n` +
              `   Last post: "${c.lastText}"`
            );

          return (
            `📊 BUFFER CHANNEL BREAKDOWN (cadence + most-recent post per channel)\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            lines.join("\n\n") +
            ENGAGEMENT_FOOTER
          );
        }

        case "recent":
        case "top_posts": {
          // top_posts is deprecated — returns recent since engagement isn't available
          const recent = [...posts]
            .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""))
            .slice(0, 15);

          const note = report === "top_posts"
            ? `\n⚠️ NOTE: 'top_posts' returns RECENT posts since Buffer doesn't expose engagement metrics. Use a native platform API to rank by engagement.\n\n`
            : "\n\n";

          return (
            `📋 RECENT SENT POSTS (${recent.length})\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            note +
            recent
              .map(
                (p) =>
                  `[${p.service}/${p.channelName}] ${p.sentAt?.slice(0, 16) || "unknown"}\n` +
                  `  "${p.text}"`,
              )
              .join("\n\n") +
            ENGAGEMENT_FOOTER
          );
        }

        default:
          return `Unknown report type: ${report}. Use: overview, channel_breakdown, recent, top_posts`;
      }
    } catch (err: any) {
      return `❌ Buffer Analytics error: ${err.message}\n\nIf the error mentions a schema field, Buffer's GraphQL schema may have changed — re-verify against developers.buffer.com.`;
    }
  }
}
