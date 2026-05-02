// Debug why findOrCreateTodayPage is failing
const NOTION_TOKEN = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
const DAILY_TASKS_HUB_ID = "3507db89ef7381b6a21beb07f930a882";

(async () => {
  if (!NOTION_TOKEN) { console.log("NO TOKEN"); return; }
  console.log(`Token set, length=${NOTION_TOKEN.length}, prefix=${NOTION_TOKEN.slice(0, 6)}`);

  // Test 1: can we read the hub page directly?
  console.log("\n=== Test 1: GET /v1/pages/<hub_id> ===");
  const r1 = await fetch(`https://api.notion.com/v1/pages/${DAILY_TASKS_HUB_ID}`, {
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28" },
  });
  console.log("status:", r1.status);
  if (!r1.ok) console.log("body:", (await r1.text()).slice(0, 300));
  else { const d: any = await r1.json(); console.log("title:", d.properties?.title?.title?.[0]?.plain_text || "(none)"); }

  // Test 2: list children
  console.log("\n=== Test 2: GET /v1/blocks/<hub_id>/children ===");
  const r2 = await fetch(`https://api.notion.com/v1/blocks/${DAILY_TASKS_HUB_ID}/children?page_size=20`, {
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28" },
  });
  console.log("status:", r2.status);
  if (!r2.ok) console.log("body:", (await r2.text()).slice(0, 300));
  else {
    const d: any = await r2.json();
    const children = (d.results || []).filter((b: any) => b.type === "child_page");
    console.log(`found ${children.length} child pages:`);
    for (const c of children) console.log("  -", c.child_page?.title);
  }

  // Test 3: today's title format
  const cdtNow = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const monthName = ["January","February","March","April","May","June","July","August","September","October","November","December"][cdtNow.getUTCMonth()];
  const dayNum = cdtNow.getUTCDate();
  const target = `${monthName} ${dayNum} - Tasks & Goals`;
  console.log("\n=== Today's target title ===");
  console.log(`  expected: "${target}"`);
})().catch((e) => { console.error(e); process.exit(1); });
