// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Buffer Analytics Tool
// Session 36: Gives Vector real engagement data from Buffer.
// Uses Buffer GraphQL API to pull sent post stats.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";
import { bufferGraphQL, BUFFER_ORG_ID } from "../engine/buffer-graphql";

// SESSION 85: bufferGraphQL + BUFFER_ORG_ID imported from shared engine/buffer-graphql.ts
// Single rate limiter across all Buffer consumers.

export class BufferAnalyticsTool implements Tool {
  definition: ToolDefinition = {
    name: "buffer_analytics",
    description:
      "Pull content performance analytics from Buffer. Returns sent posts with engagement " +
      "metrics (likes, comments, shares, clicks, reach, impressions) across all channels. " +
      "Use for daily content performance sweeps, channel comparison, top-post analysis, " +
      "and engagement rate calculations. Complements stripe_metrics for full funnel visibility.",
    parameters: {
      report: {
        type: "string",
        description:
          "Report type: 'overview' (aggregate stats across all channels), " +
          "'top_posts' (best-performing recent posts by engagement), " +
          "'channel_breakdown' (per-channel performance comparison), " +
          "'recent' (latest sent posts with stats). Default: overview",
      },
      limit: {
        type: "number",
        description: "Number of posts to analyze (default 50, max 100)",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!process.env.BUFFER_API_KEY) {
      return "❌ BUFFER_API_KEY not set. Vector cannot pull content analytics until this is configured.";
    }

    const report = String(args.report || "overview");
    const limit = Math.min(Number(args.limit) || 50, 100);

    try {
      // Fetch sent posts with engagement statistics
      const query = `
        query GetSentPosts {
          posts(
            input: {
              organizationId: "${BUFFER_ORG_ID}",
              sort: [{ field: dueAt, direction: desc }],
              filter: { status: [sent] },
              first: ${limit}
            }
          ) {
            edges {
              node {
                id
                text
                createdAt
                dueAt
                channel {
                  id
                  name
                  service
                }
                statistics {
                  likes
                  comments
                  shares
                  clicks
                  reach
                  impressions
                  engagementRate
                }
              }
            }
            totalCount
          }
        }
      `;

      const data = await bufferGraphQL(query);
      const edges = data?.posts?.edges || [];
      const totalCount = data?.posts?.totalCount || 0;

      if (edges.length === 0) {
        return "📊 No sent posts found in Buffer. Content Engine may not have published yet, or posts are still in queue.";
      }

      const posts = edges.map((e: any) => ({
        id: e.node.id,
        text: (e.node.text || "").slice(0, 120),
        channel: e.node.channel?.name || "unknown",
        service: e.node.channel?.service || "unknown",
        sentAt: e.node.dueAt || e.node.createdAt,
        stats: {
          likes: e.node.statistics?.likes || 0,
          comments: e.node.statistics?.comments || 0,
          shares: e.node.statistics?.shares || 0,
          clicks: e.node.statistics?.clicks || 0,
          reach: e.node.statistics?.reach || 0,
          impressions: e.node.statistics?.impressions || 0,
          engagementRate: e.node.statistics?.engagementRate || 0,
        },
      }));

      switch (report) {
        case "overview": {
          // Aggregate across all posts
          const totals = posts.reduce(
            (acc: any, p: any) => {
              acc.likes += p.stats.likes;
              acc.comments += p.stats.comments;
              acc.shares += p.stats.shares;
              acc.clicks += p.stats.clicks;
              acc.reach += p.stats.reach;
              acc.impressions += p.stats.impressions;
              return acc;
            },
            { likes: 0, comments: 0, shares: 0, clicks: 0, reach: 0, impressions: 0 },
          );

          const avgEngagement =
            posts.length > 0
              ? posts.reduce((sum: number, p: any) => sum + p.stats.engagementRate, 0) / posts.length
              : 0;

          // Channel distribution
          const channelCounts: Record<string, number> = {};
          posts.forEach((p: any) => {
            channelCounts[`${p.service}/${p.channel}`] = (channelCounts[`${p.service}/${p.channel}`] || 0) + 1;
          });

          return (
            `📊 BUFFER CONTENT PERFORMANCE (${posts.length} of ${totalCount} sent posts)\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Total Reach: ${totals.reach.toLocaleString()}\n` +
            `Total Impressions: ${totals.impressions.toLocaleString()}\n` +
            `Total Clicks: ${totals.clicks.toLocaleString()}\n` +
            `Total Likes: ${totals.likes.toLocaleString()}\n` +
            `Total Comments: ${totals.comments.toLocaleString()}\n` +
            `Total Shares: ${totals.shares.toLocaleString()}\n` +
            `Avg Engagement Rate: ${avgEngagement.toFixed(2)}%\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Channel Distribution:\n${Object.entries(channelCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([ch, n]) => `  ${ch}: ${n} posts`)
              .join("\n")}`
          );
        }

        case "top_posts": {
          // Sort by total engagement (likes + comments + shares + clicks)
          const ranked = [...posts]
            .map((p: any) => ({
              ...p,
              totalEngagement: p.stats.likes + p.stats.comments + p.stats.shares + p.stats.clicks,
            }))
            .sort((a: any, b: any) => b.totalEngagement - a.totalEngagement)
            .slice(0, 10);

          return (
            `🏆 TOP ${ranked.length} POSTS BY ENGAGEMENT\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            ranked
              .map(
                (p: any, i: number) =>
                  `${i + 1}. [${p.service}/${p.channel}] ${p.totalEngagement} eng | ` +
                  `👍${p.stats.likes} 💬${p.stats.comments} 🔄${p.stats.shares} 🔗${p.stats.clicks}\n` +
                  `   "${p.text}"`,
              )
              .join("\n\n")
          );
        }

        case "channel_breakdown": {
          // Group by channel
          const channels: Record<string, any> = {};
          posts.forEach((p: any) => {
            const key = `${p.service}/${p.channel}`;
            if (!channels[key]) {
              channels[key] = {
                service: p.service,
                channel: p.channel,
                posts: 0,
                likes: 0,
                comments: 0,
                shares: 0,
                clicks: 0,
                reach: 0,
                impressions: 0,
                engagementRates: [] as number[],
              };
            }
            channels[key].posts++;
            channels[key].likes += p.stats.likes;
            channels[key].comments += p.stats.comments;
            channels[key].shares += p.stats.shares;
            channels[key].clicks += p.stats.clicks;
            channels[key].reach += p.stats.reach;
            channels[key].impressions += p.stats.impressions;
            channels[key].engagementRates.push(p.stats.engagementRate);
          });

          const breakdown = Object.entries(channels)
            .sort(([, a]: any, [, b]: any) => b.reach - a.reach)
            .map(([key, c]: any) => {
              const avgEng =
                c.engagementRates.length > 0
                  ? c.engagementRates.reduce((s: number, r: number) => s + r, 0) / c.engagementRates.length
                  : 0;
              return (
                `📌 ${key} (${c.posts} posts)\n` +
                `   Reach: ${c.reach.toLocaleString()} | Impressions: ${c.impressions.toLocaleString()}\n` +
                `   Clicks: ${c.clicks} | Likes: ${c.likes} | Comments: ${c.comments} | Shares: ${c.shares}\n` +
                `   Avg Engagement Rate: ${avgEng.toFixed(2)}%`
              );
            });

          return `📊 CHANNEL PERFORMANCE BREAKDOWN\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${breakdown.join("\n\n")}`;
        }

        case "recent": {
          const recent = posts.slice(0, 15);
          return (
            `📋 RECENT SENT POSTS (${recent.length} of ${totalCount})\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            recent
              .map(
                (p: any) =>
                  `[${p.service}/${p.channel}] ${p.sentAt}\n` +
                  `  👍${p.stats.likes} 💬${p.stats.comments} 🔄${p.stats.shares} 🔗${p.stats.clicks} | reach: ${p.stats.reach}\n` +
                  `  "${p.text}"`,
              )
              .join("\n\n")
          );
        }

        default:
          return `Unknown report type: ${report}. Use: overview, top_posts, channel_breakdown, recent`;
      }
    } catch (err: any) {
      return `❌ Buffer Analytics error: ${err.message}`;
    }
  }
}
