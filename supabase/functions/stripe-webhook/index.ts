// ============================================================
// STRIPE WEBHOOK - SOVEREIGN DELIVERY PIPELINE (HARDENED)
// Session 47 - 2026-04-11 - v10
// CHANGELOG vs v9: STEP 7 added - direct invocation of
// send-purchase-email Edge Function. Replaces dead Make.com
// receipt email path. send-purchase-email is on the same
// Supabase project (verify_jwt=false), so we call it with
// no auth header and forward the raw Stripe event.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const PRODUCT_MAP: Record<string, { name: string; tier: string }> = {
  price_1TCZeKRNyK9VQwlaDHGp8bte: { name: "The Shield: Protocol 77", tier: "p77" },
  price_1TCZeLRNyK9VQwlafaWd7jdz: { name: "The Map: Navigation Override", tier: "manifesto" },
  price_1TCZeMRNyK9VQwlaaoM2wCh8: { name: "The Architect: Foundation Protocol", tier: "dp1" },
  price_1TCZeMRNyK9VQwla7Dfdi82u: { name: "The Architect: Adversarial Systems", tier: "dp2" },
  price_1TCZeNRNyK9VQwlajUabNIlm: { name: "The Architect: Sovereign Integration", tier: "dp3" },
  price_1TCZeNRNyK9VQwla5s3LyOgG: { name: "Inner Circle: Sovereign Licensing", tier: "inner_circle" },
};

async function auditFanout(
  supabase: SupabaseClient,
  target: "make_com" | "telegram_bot" | "receipt_email",
  url: string | undefined,
  payload: Record<string, unknown>,
  outcome: "success" | "failure" | "skipped_no_url",
  error?: string
) {
  try {
    await supabase.from("audit_trail").insert({
      action:
        outcome === "success"
          ? "fanout_ok"
          : outcome === "skipped_no_url"
          ? "fanout_skipped_no_url"
          : "fanout_failure",
      actor: "stripe-webhook",
      metadata: {
        target,
        url_host: url ? new URL(url).host : null,
        url_set: !!url,
        payload_keys: Object.keys(payload),
        error: error || null,
      },
    });
  } catch (auditErr) {
    console.error("audit_trail insert failed:", auditErr);
  }
}

function fanout(
  supabase: SupabaseClient,
  target: "make_com" | "telegram_bot" | "receipt_email",
  url: string | undefined,
  body: Record<string, unknown>
): void {
  if (!url) {
    auditFanout(supabase, target, url, body, "skipped_no_url");
    return;
  }
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        await auditFanout(
          supabase,
          target,
          url,
          body,
          "failure",
          `HTTP ${res.status}: ${text.slice(0, 200)}`
        );
      } else {
        await auditFanout(supabase, target, url, body, "success");
      }
    })
    .catch(async (e) => {
      await auditFanout(supabase, target, url, body, "failure", String(e).slice(0, 200));
    });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const event = await req.json();

    if (event.type !== "checkout.session.completed") {
      return new Response(JSON.stringify({ received: true, skipped: event.type }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const session = event.data.object;
    const customerEmail = session.customer_email || session.customer_details?.email || null;
    const amountTotal = session.amount_total;
    const currency = session.currency || "usd";
    const stripeSessionId = session.id;
    const stripeCustomerId = session.customer || null;
    const priceId =
      session.line_items?.data?.[0]?.price?.id || session.metadata?.price_id || "unknown";

    const product = PRODUCT_MAP[priceId] || {
      name: "Unknown Product",
      tier: session.metadata?.product_id || "unknown",
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // STEP 1: LOG REVENUE
    const { data: revenueEntry, error: revenueError } = await supabase
      .from("revenue_log")
      .insert({
        amount: amountTotal / 100,
        source: "stripe",
        product_id: product.tier,
        customer_email: customerEmail,
        metadata: {
          product_name: product.name,
          currency,
          stripe_session_id: stripeSessionId,
          stripe_price_id: priceId,
          stripe_event_type: event.type,
          stripe_event_id: event.id,
          raw_amount_cents: amountTotal,
        },
      })
      .select()
      .single();

    if (revenueError) console.error("Revenue log insert error:", revenueError);

    // STEP 2: CREATE OR FIND USER
    let userId: string | null = null;
    if (customerEmail) {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(
        (u: any) => u.email?.toLowerCase() === customerEmail.toLowerCase()
      );
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: customerEmail,
          email_confirm: true,
          user_metadata: {
            source: "stripe_purchase",
            first_tier: product.tier,
            stripe_customer_id: stripeCustomerId,
          },
        });
        if (createError) console.error("User creation error:", createError);
        else userId = newUser.user.id;
      }

      // STEP 3: GRANT TIER ACCESS
      const { data: existingAccess } = await supabase
        .from("member_access")
        .select("id")
        .eq("email", customerEmail.toLowerCase())
        .eq("tier_slug", product.tier)
        .eq("status", "active")
        .maybeSingle();

      if (!existingAccess) {
        const { error: accessError } = await supabase.from("member_access").insert({
          user_id: userId,
          email: customerEmail.toLowerCase(),
          tier_slug: product.tier,
          granted_at: new Date().toISOString(),
          stripe_session_id: stripeSessionId,
          stripe_customer_id: stripeCustomerId,
          status: "active",
          granted_by: "stripe-webhook",
        });
        if (accessError) console.error("Member access grant error:", accessError);
      }
    }

    // STEP 4: AUDIT TRAIL
    await supabase.from("audit_trail").insert({
      action: "stripe_purchase",
      actor: "stripe-webhook",
      metadata: {
        product: product.name,
        tier: product.tier,
        amount: amountTotal / 100,
        customer: customerEmail,
        user_id: userId,
        access_granted: !!customerEmail,
        revenue_log_id: revenueEntry?.id,
      },
    });

    // STEP 5: FAN-OUT TO MAKE.COM (observable)
    const makePayload = {
      event_type: event.type,
      product_id: product.tier,
      product_name: product.name,
      amount: amountTotal / 100,
      customer_email: customerEmail,
      user_id: userId,
      stripe_session_id: stripeSessionId,
      revenue_log_id: revenueEntry?.id,
    };
    fanout(supabase, "make_com", Deno.env.get("MAKE_STRIPE_ROUTER_URL"), makePayload);

    // STEP 6: FAN-OUT TO TELEGRAM BOT (observable)
    const botPayload = {
      type: "revenue_signal",
      product_id: product.tier,
      product_name: product.name,
      amount: amountTotal / 100,
      customer_email: customerEmail,
      user_id: userId,
      revenue_log_id: revenueEntry?.id,
    };
    fanout(supabase, "telegram_bot", Deno.env.get("BOT_WEBHOOK_URL"), botPayload);

    // STEP 7: TRIGGER RECEIPT EMAIL (observable)
    if (customerEmail) {
      const emailUrl = `${supabaseUrl}/functions/v1/send-purchase-email`;
      fanout(supabase, "receipt_email", emailUrl, event as Record<string, unknown>);
    } else {
      auditFanout(
        supabase,
        "receipt_email",
        undefined,
        { reason: "no_customer_email" },
        "skipped_no_url",
        "customer_email is null"
      );
    }

    return new Response(
      JSON.stringify({
        received: true,
        revenue_log_id: revenueEntry?.id,
        product: product.name,
        tier: product.tier,
        amount: amountTotal / 100,
        user_id: userId,
        access_granted: !!customerEmail,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
