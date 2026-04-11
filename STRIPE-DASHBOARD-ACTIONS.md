# STRIPE DASHBOARD — Required Manual Actions Before First Paid Test

**Generated:** Session 47 continuation, 2026-04-11
**Purpose:** Complete the Option B dual-register setup for the Stripe webhook pipeline. Everything that can be done via API has already been done. These remaining steps require the Architect to be signed into the Stripe dashboard because there is no MCP adapter for Stripe at the moment.

---

## Background — what already happened

- `stripe-webhook` Edge Function deployed as **v9** with fan-out observability (writes `fanout_ok` / `fanout_failure` / `fanout_skipped_no_url` to `audit_trail`).
- Dead env vars `MAKE_STRIPE_ROUTER_URL` and `BOT_WEBHOOK_URL` deleted from Supabase Edge Function Secrets. Verified via Make.com MCP: `leksfv66mebrys6lz9kklpgos7sp3lii` is not an active hook, only `snoqd8i7rcrbfmkvmpgx83toploxea3w` exists.
- Result: v9 will now log `fanout_skipped_no_url` cleanly on every purchase instead of `fanout_failure`. No more silent dead fan-outs.
- Master ref Section 12.2 and `PAID-TEST-CHECKOUT-READINESS.md` describe the full architecture.

---

## What's still needed — two clicks in Stripe

Per Option B: both the Supabase Edge Function AND the bot's own `/api/stripe-webhook` handler should be registered in Stripe as webhook destinations, so both write to their respective tables from signed events directly.

### Action 1 — Verify / register Edge Function endpoint

1. Open Stripe Dashboard → **Developers → Webhooks → Endpoints**
2. Look for an endpoint with URL: `https://wzthxohtgojenukmdubz.supabase.co/functions/v1/stripe-webhook`
3. If it exists: confirm it is subscribed to **`checkout.session.completed`** at minimum.
4. If it does NOT exist: click **Add endpoint**
   - URL: `https://wzthxohtgojenukmdubz.supabase.co/functions/v1/stripe-webhook`
   - Events to send: `checkout.session.completed`
   - Save

This endpoint handles: `revenue_log`, `auth.users` find-or-create, `member_access` grant, `audit_trail` row, and (now observably) the fan-out skips.

### Action 2 — Add bot endpoint

1. Same dashboard location, **Add endpoint**
   - URL: `https://gravity-claw-production-d849.up.railway.app/api/stripe-webhook`
   - Note the path is `/api/stripe-webhook`, NOT `/webhook/stripe` (that was the dead URL in the old BOT_WEBHOOK_URL secret)
   - Events to send: `checkout.session.completed`, `invoice.payment_succeeded`, `payment_intent.succeeded`
   - Save
2. **IMPORTANT:** When Stripe creates the endpoint, it shows a **Signing secret** on the endpoint detail page (starts with `whsec_`). Copy it.
3. Compare this new signing secret against the one currently stored in Railway env as `STRIPE_WEBHOOK_SECRET`.
   - If they match (same account, same webhook), no action needed.
   - If they differ (Stripe issues a unique secret per endpoint), update Railway env `STRIPE_WEBHOOK_SECRET` to the new bot-endpoint-specific value, or use Stripe's newer multi-secret support to accept multiple.
4. Alternative simpler path: use the SAME signing secret by editing the existing Edge Function endpoint to use the same secret as the bot, or use Stripe's "reuse existing secret" option if available.

This endpoint handles: `revenue_log` (duplicate with Edge Function — dedupe plan below), `mission_metrics`, `activity_log`. Mission Control dashboards depend on `mission_metrics` and `activity_log`.

### Action 3 — Handle the duplicate `revenue_log` write

Both endpoints write to `revenue_log`. That means every Stripe event creates TWO rows: one from the Edge Function, one from the bot. For the first paid test this is fine — it's easy to spot duplicates and analyze. For ongoing production:

**Option A (easiest — do this post-test):** Remove `revenue_log` write from the bot's `src/index.ts:2014` handler. Keep `mission_metrics` + `activity_log` only. The Edge Function is the sole `revenue_log` writer. Architect must patch and redeploy Railway.

**Option B (schema-level):** Add a unique constraint on `revenue_log(metadata->>'stripe_event_id')`. Whichever handler writes first wins; the second handler's insert is rejected. Both handlers already set `stripe_event_id` in metadata.

**Recommendation:** Do the first paid test with both endpoints writing. Analyze the duplicate. Then patch the bot handler to drop `revenue_log` write in a follow-up (low-risk edit, single insert block removal).

---

## After actions 1 + 2 are done, run the test

Test card: `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.

Go to the Tier 2 checkout ($77 Protocol 77) from Mission Control. Complete the purchase. Wait 15 seconds. Then run this SQL in Supabase:

```sql
SELECT 'revenue_log' AS tbl, COUNT(*) AS n FROM revenue_log
UNION ALL SELECT 'member_access', COUNT(*) FROM member_access
UNION ALL SELECT 'audit_trail_stripe', COUNT(*) FROM audit_trail WHERE actor='stripe-webhook'
UNION ALL SELECT 'mission_metrics', COUNT(*) FROM mission_metrics
UNION ALL SELECT 'activity_log_stripe', COUNT(*) FROM activity_log WHERE type='stripe_payment';
```

**Expected if both endpoints work (v11 with Step 7):**
- `revenue_log` = 2 (one from each handler — dedupe in follow-up)
- `member_access` = 1
- `audit_trail_stripe` = 4 (1× `stripe_purchase` + 2× `fanout_skipped_no_url` for make_com + telegram_bot + 1× `fanout_ok` for receipt_email)
- `mission_metrics` >= 1
- `activity_log_stripe` = 1
- AND a real receipt email lands in the test inbox

**Expected if only the Edge Function fires (Stripe only has one endpoint registered):**
- `revenue_log` = 1
- `member_access` = 1
- `audit_trail_stripe` = 3
- `mission_metrics` = 0
- `activity_log_stripe` = 0

**Expected if only the bot endpoint fires:**
- `revenue_log` = 1
- `member_access` = 0 (bot handler doesn't write it)
- `audit_trail_stripe` = 0
- `mission_metrics` >= 1
- `activity_log_stripe` = 1

Any row count outside these matrices = something else wrong; look at Supabase Edge Function logs and Railway container logs.

---

## Receipt email — RESOLVED in v11

`stripe-webhook` was patched and redeployed as **v11** with **STEP 7** added: a direct fan-out to `https://wzthxohtgojenukmdubz.supabase.co/functions/v1/send-purchase-email` immediately after the audit_trail row is written.

- `send-purchase-email` is on the same Supabase project with `verify_jwt: false`, so the call needs no auth header.
- The webhook forwards the **raw Stripe event** as the body. `send-purchase-email` already handles both raw Stripe and flat-payload shapes (it reads `amount_total` from cents and resolves the tier).
- The fan-out is fire-and-forget and writes its outcome to `audit_trail` under `target='receipt_email'` — same observability pattern as the Make.com / bot fan-outs.
- If `customerEmail` is null (anonymous purchase, defensive branch), Step 7 records `fanout_skipped_no_url` with reason `no_customer_email` instead of trying to call the email function.

**Smoke test result (2026-04-11):** v11 was invoked with a non-checkout event. Returned `{"received":true,"skipped":"ping.test"}` HTTP 200. Function parses and the dispatcher works. Full Step 7 path will exercise on the first real `checkout.session.completed`.

**Still pending in send-purchase-email itself:** ISSUE-001 (hardcoded `RESEND_API_KEY` in source) is unaffected by this patch — that's a separate hardening task. The email WILL send on the first paid test as long as the hardcoded Resend key is still valid.

---

## Checklist summary

- [x] Hardened v9 deployed (fan-out observability)
- [x] Dead env vars cleared (`MAKE_STRIPE_ROUTER_URL`, `BOT_WEBHOOK_URL`)
- [x] Make.com hook confirmed dead via MCP
- [x] **v11 deployed with STEP 7 receipt email reconnect**
- [x] v11 smoke-tested (parses, returns 200 on non-checkout events)
- [x] Documentation updated
- [ ] **Architect:** verify/register Edge Function endpoint in Stripe
- [ ] **Architect:** register bot endpoint in Stripe, reconcile signing secret
- [ ] **Architect:** run test-mode purchase and query the SQL above
- [ ] **Architect:** confirm receipt email arrives in test inbox
- [ ] **Post-test follow-up:** dedupe `revenue_log` writes, patch ISSUE-001 Resend key
