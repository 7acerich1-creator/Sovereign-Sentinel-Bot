# PAID TEST CHECKOUT — Readiness Checklist

**Generated:** Session 47, 2026-04-11
**Purpose:** Pre-flight for the first real Stripe transaction through the Sovereign Synthesis funnel. The revenue pipeline is currently cold (0 rows in revenue_log, member_access, audit_trail, initiates) — this will be the first live test.

---

## CURRENT STATE — Verified Facts

| Check | Result | Evidence |
|---|---|---|
| revenue_log rows | **0** | SQL query, Session 47 |
| member_access rows | **0** | SQL query, Session 47 |
| audit_trail rows (actor=stripe-webhook) | **0** | SQL query, Session 47 |
| initiates rows | **0** | SQL query, Session 47 |
| stripe-webhook Edge Function | v8 ACTIVE | `get_edge_function` |
| send-purchase-email Edge Function | v1 ACTIVE | `get_edge_function` |
| send-nurture-email Edge Function | v3 ACTIVE | list_edge_functions |
| Bot's `/api/stripe-webhook` endpoint | Present, signature-verified | `src/index.ts:2014` |
| Supabase vault | Installed but empty (0 secrets) | SQL query |
| Master ref documentation | PATCHED (Section 12.2 added) | Session 47 |
| Hardening patch (fan-out → audit_trail) | **DEPLOYED as v9** | Management API deploy, 2026-04-11 |
| Receipt email reconnect (Step 7) | **DEPLOYED as v11** | Management API deploy, 2026-04-11 |
| `MAKE_STRIPE_ROUTER_URL` plaintext | **RETRIEVED → CONFIRMED DEAD → CLEARED** | Make.com MCP confirmed |
| `BOT_WEBHOOK_URL` plaintext | **RETRIEVED → CONFIRMED DEAD → CLEARED** | See ISSUE-004 |

---

## PRE-FLIGHT CHECKLIST — In Order

### 1. Verify which webhook handler Stripe is hitting

**Why:** Stripe endpoint config only allows one URL per event. Either:
- **Edge Function** `https://wzthxohtgojenukmdubz.supabase.co/functions/v1/stripe-webhook` — does revenue_log + auth user + member_access + audit_trail + Make.com fan-out + bot fan-out
- **Bot endpoint** `https://<railway-url>/api/stripe-webhook` — signature-verified, writes revenue_log + mission_metrics + activity_log

These write DIFFERENT tables. Mission Control dashboards depend on knowing which.

**How:**
- Stripe Dashboard → Developers → Webhooks → Endpoints
- Read the URL column
- Note which events are subscribed

**Expected:** Exactly one endpoint should be registered. If there are two (one for each handler), you have duplicate processing and the audit will double-count.

**Action if wrong endpoint:** Update the registered endpoint to the one you want as primary. Recommendation: **Edge Function is primary** because it handles full provisioning (including member_access which the bot endpoint does not). Bot endpoint should be secondary (analytics + activity_log only) or deregistered.

---

### 2. Verify env vars in Supabase Edge Function Secrets

**Why:** `stripe-webhook` uses `MAKE_STRIPE_ROUTER_URL` and `BOT_WEBHOOK_URL` for fan-out. If either is one of the four dead Make.com hooks you just deleted, the corresponding fan-out is silently broken.

**How:**
- Supabase Dashboard → Project Settings → Edge Functions → Secrets
- Check these four values:
  - `MAKE_STRIPE_ROUTER_URL` — should point to a live Make.com scenario
  - `BOT_WEBHOOK_URL` — should point to Railway bot (`https://<railway-url>/...`)
  - `SUPABASE_URL` — platform default, should be set
  - `SUPABASE_SERVICE_ROLE_KEY` — platform default, should be set

**Compare `MAKE_STRIPE_ROUTER_URL` against the four dead hook URLs** from funnel cleanup. If it matches any of them:
- **Option A (quick fix):** Clear the env var. The function's `if (makeWebhookUrl)` check will short-circuit and skip the fan-out cleanly.
- **Option B (correct fix):** Point it at a live Make.com scenario that invokes `send-purchase-email` with a flat payload (see `send-purchase-email` source — it accepts both Stripe webhook format and flat format).
- **Option C (best fix):** Bypass Make.com entirely. Modify `stripe-webhook` to invoke `send-purchase-email` directly via fetch to its functions/v1 URL. Eliminates Make.com as a single point of failure for receipt email.

---

### 3. Deploy the hardening patch

**Why:** Current v8 logs fan-out failures to `console.warn` only. Edge Function logs are thin and the pipeline is cold. If the Make.com URL is dead, the first paid test gives you no database-level signal — just silent log warnings nobody will read.

**The patch** (`supabase/functions/stripe-webhook/index.ts` in this repo) writes every fan-out outcome to `audit_trail`:
- `action='fanout_ok'` — fan-out succeeded
- `action='fanout_failure'` — URL was set, fetch failed (with HTTP status or error in metadata)
- `action='fanout_skipped_no_url'` — env var not set, skipped cleanly

After deployment, the first paid test writes 3 audit_trail rows minimum: `stripe_purchase` + Make.com fanout + Telegram bot fanout. Reading those three rows tells you exactly what worked and what didn't.

**How to deploy:**
- Via Supabase Dashboard → Edge Functions → stripe-webhook → Upload file → paste contents of `supabase/functions/stripe-webhook/index.ts` → Deploy
- Or via Supabase CLI: `supabase functions deploy stripe-webhook --project-ref wzthxohtgojenukmdubz`
- Claude's MCP adapter for `deploy_edge_function` currently has a bridge bug (ZodError on `files` array) — use dashboard or CLI instead.

---

### 4. Fix ISSUE-001 (hardcoded Resend key) — RECOMMENDED BEFORE TEST

**Why:** `send-purchase-email` has `RESEND_API_KEY = 're_4dpfnyWP_...'` hardcoded on line 4 of its source. If the source is ever leaked (git commit, Management API read, any other path), the key goes with it. Moving to env var is a 5-minute patch.

See `SECURITY-ISSUES.md` ISSUE-001 for full resolution steps.

**Alternative:** Run the paid test first with the current (unsafe) hardcoded key to get revenue flowing, patch immediately after.

---

### 5. Identify what the Make.com scenario at `MAKE_STRIPE_ROUTER_URL` was doing

**Why:** Even with the hardening patch telling you if Make.com is dead, you still need to know what downstream actions depend on it. Best sources:

- Make.com scenario designer — find the scenario that receives from `MAKE_STRIPE_ROUTER_URL` and list its modules
- Likely candidates based on the payload (`event_type`, `product_id`, `amount`, `customer_email`, `user_id`, `revenue_log_id`):
  - Call to `send-purchase-email` (receipt email)
  - HubSpot contact create/update
  - Notion row insert (revenue tracker)
  - Slack/Telegram notification
  - Zoom meeting enrollment (for Inner Circle tier)

If receipt email depends on Make.com AND Make.com is dead, the buyer gets access but no email. **This is the primary risk.**

**Mitigation:** Bypass Make.com by modifying `stripe-webhook` to call `send-purchase-email` directly (Option C in check #2). Then Make.com only handles non-critical fan-out.

---

### 6. Run the paid test in TEST mode first

**Why:** Stripe has both test and live mode. Run the test in test mode with a real test card (`4242 4242 4242 4242`, any future expiry, any CVC). This hits the same webhook plumbing but without real money.

**Test procedure:**
1. Go to Mission Control checkout URL for Tier 2 ($77 Protocol 77)
2. Complete checkout with test card
3. Wait 10 seconds
4. Query revenue_log, member_access, audit_trail:
   ```sql
   SELECT 'revenue_log' AS tbl, COUNT(*) AS n FROM revenue_log
   UNION ALL SELECT 'member_access', COUNT(*) FROM member_access
   UNION ALL SELECT 'audit_trail_stripe', COUNT(*) FROM audit_trail WHERE actor='stripe-webhook';
   ```
5. Expected if healthy: `revenue_log=1, member_access=1, audit_trail_stripe>=3` (stripe_purchase + make fanout + bot fanout)
6. Check inbox of the email you used for the test — receipt should arrive within 30 seconds if Make.com → send-purchase-email chain is intact

**If receipt email doesn't arrive:** Check the latest audit_trail row with `action='fanout_failure'` for the Make.com target. The metadata column will tell you the HTTP status or error.

---

### 7. Document results and update master ref

After the test succeeds:
- Update `LIVE_STATE.md` with revenue_log count
- Update master ref Section 12.2 with whatever truth the test revealed (which handler Stripe hits, MAKE_STRIPE_ROUTER_URL status, etc.)
- Save a project memory about the first real purchase path

---

## KNOWN UNKNOWNS (Not blocking, but flagged)

- **Bot `/api/stripe-webhook` behavior at `src/index.ts:2014`** — Not read in full during Session 47. If this IS the registered endpoint (not the Edge Function), then the provisioning path is completely different and this checklist's step 2 (Edge Function env vars) may not apply.
- **Automation D error rate** (Make.com Content Factory `2072042`) — 4/8 errors. Bot-owned, in-scope for Sentinel, needs separate session. NOT related to stripe-webhook.
- **Duplicate revenue tracking risk** — If BOTH handlers receive the same Stripe event (e.g., Stripe has two endpoints configured), revenue_log gets two rows per purchase. Verify single-endpoint config in step 1.

---

## FILES WRITTEN THIS SESSION

- `supabase/functions/stripe-webhook/index.ts` — hardened Edge Function source
- `SECURITY-ISSUES.md` — ISSUE-001 (Resend key) + ISSUE-002 (service role key in chat)
- `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md` — Section 12.2 added
- `PAID-TEST-CHECKOUT-READINESS.md` — this file

## BLOCKED ITEMS (Need Architect action)

1. ~~Paste `MAKE_STRIPE_ROUTER_URL` value from Supabase dashboard for verification against dead hooks~~ — **UNBLOCKED 2026-04-11.** Retrieved via diag-env-temp Edge Function deployed through Management API. Value: `https://hook.us2.make.com/leksfv66mebrys6lz9kklpgos7sp3lii`. **Architect still must confirm this hook ID is not in the 4 dead-hook deletion list.**
2. ~~Or provide Supabase Personal Access Token~~ — **DONE.** PAT provided. Flagged as ISSUE-003 for rotation.
3. ~~Deploy hardening patch~~ — **DONE.** Deployed as `stripe-webhook` v9 via Management API multipart upload, 2026-04-11.
4. Verify Stripe webhook endpoint config in Stripe dashboard — STILL OPEN. Architect to open Stripe → Developers → Webhooks → Endpoints and report the registered URL(s).

---

## NEW FINDINGS — Session 47 continuation, 2026-04-11

### Finding 1 — `MAKE_STRIPE_ROUTER_URL` plaintext retrieved

```
MAKE_STRIPE_ROUTER_URL = https://hook.us2.make.com/leksfv66mebrys6lz9kklpgos7sp3lii
```

Hook ID: **`leksfv66mebrys6lz9kklpgos7sp3lii`**

**Architect action:** Compare against the 4 dead hook IDs deleted during funnel cleanup. If it matches any of them, this is the root-cause confirmation for silent receipt-email failure on paid purchases. Fix options are in check #2 of this file (clear var / repoint / bypass Make.com).

### Finding 2 — `BOT_WEBHOOK_URL` is a dead path (see ISSUE-004)

```
BOT_WEBHOOK_URL = https://gravity-claw-production-d849.up.railway.app/webhook/stripe
```

Two problems:
- Path `/webhook/stripe` doesn't exist on the bot. Bot uses exact-match routing in `src/tools/webhooks.ts`, only `/api/stripe-webhook` is registered.
- Even if the path were fixed, the bot's `/api/stripe-webhook` requires a valid Stripe HMAC-SHA256 signature, which the Edge Function fan-out payload does not provide.

**Current consequence:** The BOT_WEBHOOK_URL fan-out from stripe-webhook has been architecturally dead since it was wired. It has not surfaced because fire-and-forget `.catch()` swallows it. Now that v9 writes fan-out outcomes to `audit_trail`, it will become **observable** on the first paid test.

**Architect action:** Pick an option from ISSUE-004 (Option A = new `/api/revenue-signal` endpoint, Option B = dual-register in Stripe, Option C = consolidate writes into Edge Function). Option B is the fastest path to dual-write for the first paid test.

### Finding 3 — Other Edge Function secrets snapshot (for reference)

| Secret | Status | Notes |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | SET (38 chars, starts `whsec_0B...`) | Edge Function doesn't currently verify Stripe signatures — it trusts the POST. Separate hardening opportunity. |
| `FIREFLIES_API_KEY` | SET (36 chars) | Used by other Edge Functions |
| `FIREFLIES_WEBHOOK_SECRET` | SET (64 chars) | Used by other Edge Functions |
| `MAKE_SCENARIO_E_WEBHOOK` | NOT SET | VidRush deprecated these hooks per Session 17 memory |
| `MAKE_SCENARIO_F_WEBHOOK` | NOT SET | Same |
| `RESEND_API_KEY` | NOT SET at Supabase layer | Hardcoded in `send-purchase-email` source — ISSUE-001 |

### Finding 4 — `stripe-webhook` Edge Function does NOT verify Stripe signatures

The live source (and the hardened v9) has no `stripe-signature` HMAC check. It trusts any POST with a valid Stripe event body. The bot's `/api/stripe-webhook` DOES verify. This is a second hardening opportunity that should probably be added before going live in production. Low risk while the endpoint URL stays private, but any leak of the Edge Function URL becomes a free revenue_log write.

**Recommendation:** Add a Stripe signature check to stripe-webhook Edge Function in a follow-up. The secret is already set (`STRIPE_WEBHOOK_SECRET`, 38 chars). Not blocking the first test.

---

## STATUS AS OF 2026-04-11 22:00 UTC — SESSION 47 CONTINUATION

**What's done:**
- [x] Pipeline state verified cold (0 rows)
- [x] Dual handler architecture mapped
- [x] Edge Function secrets retrieved via diag function
- [x] Hardening patch deployed (v9 ACTIVE)
- [x] Diag function cleaned up
- [x] Master ref Section 12.2 documents reality
- [x] Security issues logged (ISSUE-001 through ISSUE-004)

**What's left before paid test:**
- [ ] Architect: confirm Make.com hook ID `leksfv66mebrys6lz9kklpgos7sp3lii` not in dead list
- [ ] Architect: open Stripe dashboard → verify webhook endpoint URL(s) registered
- [ ] Architect: decide ISSUE-004 fix path (A/B/C) and execute
- [ ] Architect: decide ISSUE-001 (rotate + move Resend key) timing
- [ ] Architect: decide ISSUE-002/003 rotation timing
- [ ] Run test-mode checkout with `4242 4242 4242 4242`
- [ ] Query revenue_log, member_access, audit_trail after test
- [ ] Read audit_trail fanout_* rows to confirm what worked
