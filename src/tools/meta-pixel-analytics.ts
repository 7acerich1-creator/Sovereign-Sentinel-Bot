// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW — Meta Pixel & Marketing API Analytics Tool
// Read-only Meta Marketing API reader for Vector's CRO sweeps.
// Surfaces:
//   - Custom Audience (retargeting pool) sizes
//   - Pixel event volume (last 7d, by event name)
//   - Ad insights (spend / impressions / clicks / reach)
//
// Pixel was wired on /p77 sales page in Session 119 (2026-04-25).
// Pixel ID: 1513312646866512 ("protocol 77" dataset).
// Ad Account: act_1494610215354033.
//
// Env vars required (Railway):
//   META_SYSTEM_USER_TOKEN  — System User access token from Meta Business Suite
//                              (never-expiring; scopes: ads_read, ads_management,
//                               business_management, read_insights)
//   META_AD_ACCOUNT_ID      — e.g. "act_1494610215354033"
//   META_PIXEL_ID           — e.g. "1513312646866512"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";

const META_API = "https://graph.facebook.com/v19.0";

const TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const AD_ACCOUNT = process.env.META_AD_ACCOUNT_ID;
const PIXEL_ID = process.env.META_PIXEL_ID;

interface MetaError {
  message: string;
  type?: string;
  code?: number;
  fbtrace_id?: string;
}

async function metaGet(path: string, params: Record<string, string> = {}): Promise<any> {
  if (!TOKEN) throw new Error("META_SYSTEM_USER_TOKEN not configured in Railway env.");

  const url = new URL(`${META_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set("access_token", TOKEN);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Meta ${resp.status}: ${errText.slice(0, 400)}`);
  }
  return resp.json();
}

function fmt(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString();
}

export class MetaPixelAnalyticsTool implements Tool {
  definition: ToolDefinition = {
    name: "meta_pixel_analytics",
    description:
      "Pull Meta (Facebook/Instagram) Marketing API metrics for the protocol 77 ad account and pixel. " +
      "Surfaces retargeting pool sizes (Custom Audiences), pixel event volume, and ad spend/clicks. " +
      "Use this for daily CRO sweeps to monitor whether the retargeting pool is growing fast enough " +
      "to seed Lookalike Audiences (typical seed threshold: 1000+ events). Read-only.",
    parameters: {
      report: {
        type: "string",
        description:
          "Which report to pull: 'dashboard' (one-shot summary of all 3 areas), " +
          "'audiences' (Custom Audiences / retargeting pool sizes), " +
          "'pixel_events' (recent pixel event volume by event name), " +
          "'ad_insights' (spend/impressions/clicks/reach over date_preset). " +
          "Default 'dashboard'.",
      },
      date_preset: {
        type: "string",
        description:
          "For ad_insights: time window. Options: 'today', 'yesterday', 'last_7d', " +
          "'last_14d', 'last_30d', 'this_month', 'last_month'. Default 'last_7d'.",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!TOKEN) {
      return "❌ META_SYSTEM_USER_TOKEN not set in Railway environment. Vector cannot read Meta metrics until this is configured. Add 3 env vars to Railway: META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID, META_PIXEL_ID.";
    }
    if (!AD_ACCOUNT || !PIXEL_ID) {
      return "❌ META_AD_ACCOUNT_ID or META_PIXEL_ID missing. Both required.";
    }

    const report = (args.report as string) || "dashboard";
    const datePreset = (args.date_preset as string) || "last_7d";

    try {
      switch (report) {
        case "audiences":
          return await this.getAudiences();
        case "pixel_events":
          return await this.getPixelEvents();
        case "ad_insights":
          return await this.getAdInsights(datePreset);
        case "dashboard":
        default:
          return await this.getDashboard(datePreset);
      }
    } catch (e: any) {
      return `❌ Meta API error: ${e?.message || String(e)}`;
    }
  }

  private async getAudiences(): Promise<string> {
    const data = await metaGet(`/${AD_ACCOUNT}/customaudiences`, {
      fields:
        "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,time_created,description",
      limit: "50",
    });
    const audiences = data.data || [];
    if (audiences.length === 0) {
      return `📊 *Meta Custom Audiences (retargeting pool)*\nAccount: ${AD_ACCOUNT}\n\nNo Custom Audiences exist yet. Pixel is firing — once you create a "Website visitors — last 30d" audience, it will populate as traffic flows. Suggested seed threshold for Lookalike: 1,000 users.`;
    }
    const lines = audiences.map((a: any) => {
      const lo = a.approximate_count_lower_bound;
      const hi = a.approximate_count_upper_bound;
      const sz = lo !== undefined && hi !== undefined ? `${fmt(lo)}–${fmt(hi)}` : "sizing…";
      const status = a.delivery_status?.code === 200 ? "READY" : a.delivery_status?.description || "—";
      return `• ${a.name} [${a.subtype || "WEBSITE"}] — size: ${sz} — ${status}`;
    });
    return `📊 *Meta Custom Audiences (retargeting pool)*\nAccount: ${AD_ACCOUNT}\n${lines.join("\n")}\n\nSource: GET /${AD_ACCOUNT}/customaudiences`;
  }

  private async getPixelEvents(): Promise<string> {
    const data = await metaGet(`/${PIXEL_ID}/stats`, {
      aggregation: "event",
    });
    const events = data.data || [];
    if (events.length === 0) {
      return `📊 *Meta Pixel events* (${PIXEL_ID})\n\nNo event data yet (Pixel was wired 2026-04-25). Once /p77 receives traffic, PageView and ViewContent events will appear here. InitiateCheckout fires on Stripe button click.`;
    }
    const lines = events.slice(0, 15).map((e: any) => {
      const evt = e.event || e.value || "unknown";
      const cnt = e.count !== undefined ? fmt(e.count) : "—";
      return `• ${evt}: ${cnt}`;
    });
    return `📊 *Meta Pixel events (last available window)*\nPixel: ${PIXEL_ID}\n${lines.join("\n")}\n\nSource: GET /${PIXEL_ID}/stats?aggregation=event`;
  }

  private async getAdInsights(datePreset: string): Promise<string> {
    const data = await metaGet(`/${AD_ACCOUNT}/insights`, {
      fields: "spend,impressions,clicks,reach,cpc,cpm,ctr,actions",
      date_preset: datePreset,
    });
    const ins = data.data?.[0];
    if (!ins) {
      return `📊 *Meta Ad Insights* (${datePreset})\nAccount: ${AD_ACCOUNT}\n\nNo ad activity in window — no campaigns running yet, or zero spend. When campaigns turn on, this surfaces spend/impressions/clicks/CPC/CTR.`;
    }
    const actions = (ins.actions || []).map((a: any) => `${a.action_type}: ${fmt(Number(a.value))}`).join(", ");
    return `📊 *Meta Ad Insights — ${datePreset}*\nAccount: ${AD_ACCOUNT}\n• Spend: $${ins.spend || 0}\n• Impressions: ${fmt(Number(ins.impressions))}\n• Clicks: ${fmt(Number(ins.clicks))}\n• Reach: ${fmt(Number(ins.reach))}\n• CPC: $${ins.cpc || 0} | CPM: $${ins.cpm || 0} | CTR: ${ins.ctr || 0}%\n${actions ? `• Actions: ${actions}` : ""}\n\nSource: GET /${AD_ACCOUNT}/insights?date_preset=${datePreset}`;
  }

  private async getDashboard(datePreset: string): Promise<string> {
    const [aud, evt, ins] = await Promise.allSettled([
      this.getAudiences(),
      this.getPixelEvents(),
      this.getAdInsights(datePreset),
    ]);
    const block = (r: PromiseSettledResult<string>) =>
      r.status === "fulfilled" ? r.value : `❌ ${r.reason?.message || r.reason}`;
    return [
      `📊 *META MARKETING DASHBOARD — ${datePreset}*`,
      "",
      block(aud),
      "",
      block(evt),
      "",
      block(ins),
    ].join("\n");
  }
}
