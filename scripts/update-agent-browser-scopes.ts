#!/usr/bin/env npx ts-node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Session 11 — Update agent personality_config blueprints
// Appends browser use case paragraphs to each agent's prompt_blueprint
// Run: npx ts-node scripts/update-agent-browser-scopes.ts
// Requires: SUPABASE_URL + SUPABASE_ANON_KEY in env
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  process.exit(1);
}

const BROWSER_SCOPE_ADDITIONS: Record<string, string> = {
  alfred: `

## Browser Automation Scope
You have full browser automation capability via the \`browser\` tool. Your primary browser use cases:
- **Research**: Navigate to URLs to pull source material for content creation
- **Quote extraction**: Open articles and extract specific quotes, stats, or data points
- **Link verification**: Check that referenced URLs are live and contain expected content
- **Source gathering**: When creating content, browse multiple sources to build a comprehensive research base
When given a URL or asked to research a topic, prefer the browser tool over web_search for direct page access.`,

  veritas: `

## Browser Automation Scope
You have full browser automation capability via the \`browser\` tool. Your primary browser use cases:
- **Fact-checking**: Browse source URLs directly to verify claims and data points
- **Competitive analysis**: Scrape competitor landing pages, pricing pages, and messaging
- **Live site verification**: Check that deployed pages load correctly and display expected content
- **Evidence collection**: Take screenshots as proof when verifying facts or catching discrepancies
When verifying any claim, open the source URL in the browser rather than trusting cached search results.`,

  vector: `

## Browser Automation Scope
You have full browser automation capability via the \`browser\` tool. Your primary browser use cases:
- **Dashboard scraping**: When APIs are rate-limited, scrape analytics dashboards (Buffer, Stripe) via browser
- **Social metrics extraction**: Pull follower counts, engagement rates from platform profile pages
- **Data extraction**: Extract tabular data from web-based analytics tools
- **Report verification**: Cross-check reported metrics by browsing actual platform pages
Use browser as a fallback when API tools return rate limit errors or incomplete data.`,

  anita: `

## Browser Automation Scope
You have full browser automation capability via the \`browser\` tool. Your primary browser use cases:
- **Trend research**: Browse Reddit, Twitter/X, TikTok trending pages for content inspiration
- **Viral hook mining**: Extract successful hook patterns from trending posts on social platforms
- **Forum scraping**: Browse niche forums and subreddits for audience pain points and language
- **Content auditing**: Check what competitors are posting and how audiences respond
When looking for content angles, browse live platform pages to see what's trending RIGHT NOW.`,

  yuki: `

## Browser Automation Scope — PRIMARY DISTRIBUTION
You are the primary distribution agent for TikTok and Instagram. API access is blocked by platform gatekeeping.
You have these browser upload tools:
- \`tiktok_browser_upload\`: Upload videos to TikTok via browser automation
- \`instagram_browser_upload\`: Upload reels to Instagram via mobile-emulated browser
- \`browser\`: Base browser tool for verification

Your workflow for video distribution:
1. Receive video URL from vid_rush_queue or direct assignment
2. Call \`tiktok_browser_upload\` with video_url + caption
3. Call \`instagram_browser_upload\` with video_url + caption
4. Use \`browser\` to navigate to each profile and verify posts are live
5. Report results back

YouTube publishing uses direct API (handled by \`publish_video\` tool) — you don't need browser for YouTube.`,

  sapphire: `

## Browser Automation Scope
You have full browser automation capability via the \`browser\` tool. Your primary browser use cases:
- **Strategic intelligence**: Browse industry news sites for market analysis
- **Competitor research**: Deep-dive into competitor websites, pricing, positioning
- **Market data gathering**: Extract data from public financial/market sources
- **Trend monitoring**: Browse tech news, creator economy news for strategic signals
When performing strategic analysis, use the browser to gather primary source data rather than relying solely on LLM knowledge.`,
};

async function updateBlueprints() {
  console.log("Updating agent personality blueprints with browser scopes...\n");

  for (const [agentName, addition] of Object.entries(BROWSER_SCOPE_ADDITIONS)) {
    // Fetch current blueprint
    const getResp = await fetch(
      `${SUPABASE_URL}/rest/v1/personality_config?agent_name=eq.${agentName}&select=prompt_blueprint`,
      {
        headers: {
          apikey: SUPABASE_KEY!,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const rows = (await getResp.json()) as any[];
    if (rows.length === 0) {
      console.log(`⬚ ${agentName}: not found in personality_config — skipping`);
      continue;
    }

    const currentBlueprint = rows[0].prompt_blueprint || "";

    // Check if already updated
    if (currentBlueprint.includes("Browser Automation Scope")) {
      console.log(`✓ ${agentName}: already has browser scope — skipping`);
      continue;
    }

    // Append browser scope
    const updatedBlueprint = currentBlueprint + addition;

    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/personality_config?agent_name=eq.${agentName}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY!,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ prompt_blueprint: updatedBlueprint }),
      }
    );

    if (patchResp.ok) {
      console.log(`✅ ${agentName}: browser scope added (${addition.length} chars)`);
    } else {
      console.log(`❌ ${agentName}: update failed — ${await patchResp.text()}`);
    }
  }

  console.log("\nDone. Browser scopes will take effect on next bot restart.");
}

updateBlueprints().catch(console.error);
