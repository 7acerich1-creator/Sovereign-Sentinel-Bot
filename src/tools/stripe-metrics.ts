// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Stripe Metrics Tool
// Lightweight Stripe API reader for Vector's CRO sweeps.
// No full MCP bridge needed — direct API calls to Stripe.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

async function stripeGet(endpoint: string, params?: Record<string, string>): Promise<any> {
  if (!STRIPE_KEY) throw new Error("STRIPE_SECRET_KEY not configured in Railway env.");

  const url = new URL(`https://api.stripe.com/v1${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Stripe ${resp.status}: ${errText.slice(0, 300)}`);
  }

  return resp.json();
}

export class StripeMetricsTool implements Tool {
  definition: ToolDefinition = {
    name: "stripe_metrics",
    description:
      "Pull revenue metrics from Stripe for CRO analysis. Returns MRR, active subscriptions, " +
      "recent charges, failed payments, and new customers. Use this for daily metrics sweeps " +
      "and velocity calculations toward the $100K/month target.",
    parameters: {
      metric: {
        type: "string",
        description: "Which metric to pull: 'dashboard' (full overview), 'subscriptions' (active subs), " +
          "'charges' (recent charges), 'customers' (new customers), 'balance' (current balance)",
      },
      days: {
        type: "number",
        description: "Look-back period in days (default 30)",
      },
    },
    required: ["metric"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!STRIPE_KEY) {
      return "❌ STRIPE_SECRET_KEY not set in Railway environment. Vector cannot run metrics sweeps until this is configured.";
    }

    const metric = String(args.metric || "dashboard");
    const days = Number(args.days) || 30;
    const since = Math.floor(Date.now() / 1000) - (days * 86400);

    try {
      switch (metric) {
        case "dashboard": {
          // Full overview — subscriptions + recent charges + balance
          const [subs, charges, balance, customers] = await Promise.all([
            stripeGet("/subscriptions", { status: "active", limit: "100" }),
            stripeGet("/charges", { created: `${since}`, limit: "100" }),
            stripeGet("/balance"),
            stripeGet("/customers", { created: `${since}`, limit: "100" }),
          ]);

          const activeSubs = subs.data?.length || 0;
          const mrr = (subs.data || []).reduce((sum: number, s: any) => {
            const amount = s.items?.data?.[0]?.price?.unit_amount || 0;
            const interval = s.items?.data?.[0]?.price?.recurring?.interval;
            // Normalize to monthly
            if (interval === "year") return sum + (amount / 12);
            if (interval === "week") return sum + (amount * 4.33);
            return sum + amount;
          }, 0) / 100; // Convert cents to dollars

          const totalCharges = (charges.data || []).reduce((sum: number, c: any) =>
            c.status === "succeeded" ? sum + (c.amount / 100) : sum, 0);
          const failedCharges = (charges.data || []).filter((c: any) => c.status === "failed").length;
          const newCustomers = customers.data?.length || 0;

          const availableBalance = (balance.available || []).reduce((sum: number, b: any) => sum + b.amount, 0) / 100;
          const pendingBalance = (balance.pending || []).reduce((sum: number, b: any) => sum + b.amount, 0) / 100;

          const velocity = (mrr / 100000) * 100; // % of $100K/month target

          return `📊 STRIPE REVENUE DASHBOARD (${days}-day window)\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `MRR: $${mrr.toFixed(2)}\n` +
            `Target: $100,000/month\n` +
            `Velocity: ${velocity.toFixed(4)}%\n` +
            `Active Subscriptions: ${activeSubs}\n` +
            `Revenue (${days}d): $${totalCharges.toFixed(2)}\n` +
            `Failed Charges: ${failedCharges}\n` +
            `New Customers (${days}d): ${newCustomers}\n` +
            `Available Balance: $${availableBalance.toFixed(2)}\n` +
            `Pending Balance: $${pendingBalance.toFixed(2)}`;
        }

        case "subscriptions": {
          const subs = await stripeGet("/subscriptions", { status: "active", limit: "100" });
          const subList = (subs.data || []).map((s: any) => ({
            id: s.id,
            customer: s.customer,
            product: s.items?.data?.[0]?.price?.product,
            amount: `$${((s.items?.data?.[0]?.price?.unit_amount || 0) / 100).toFixed(2)}`,
            interval: s.items?.data?.[0]?.price?.recurring?.interval,
            status: s.status,
            created: new Date(s.created * 1000).toISOString().split("T")[0],
          }));
          return `Active Subscriptions: ${subList.length}\n${JSON.stringify(subList, null, 2)}`;
        }

        case "charges": {
          const charges = await stripeGet("/charges", { created: `${since}`, limit: "50" });
          const chargeList = (charges.data || []).map((c: any) => ({
            id: c.id,
            amount: `$${(c.amount / 100).toFixed(2)}`,
            status: c.status,
            customer: c.customer,
            description: c.description?.slice(0, 50),
            created: new Date(c.created * 1000).toISOString().split("T")[0],
          }));
          return `Charges (${days}d): ${chargeList.length}\n${JSON.stringify(chargeList, null, 2)}`;
        }

        case "customers": {
          const customers = await stripeGet("/customers", { created: `${since}`, limit: "50" });
          const custList = (customers.data || []).map((c: any) => ({
            id: c.id,
            email: c.email,
            name: c.name,
            created: new Date(c.created * 1000).toISOString().split("T")[0],
          }));
          return `New Customers (${days}d): ${custList.length}\n${JSON.stringify(custList, null, 2)}`;
        }

        case "balance": {
          const balance = await stripeGet("/balance");
          return `Stripe Balance:\n${JSON.stringify(balance, null, 2)}`;
        }

        default:
          return `Unknown metric: ${metric}. Use: dashboard, subscriptions, charges, customers, balance`;
      }
    } catch (err: any) {
      return `❌ Stripe API error: ${err.message}`;
    }
  }
}
