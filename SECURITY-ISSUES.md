# SECURITY ISSUES — Open Log

This is an append-only log of security issues discovered during audits. Each entry gets a status tag and a resolution note.

---

## ISSUE-001 — Hardcoded secrets in `send-purchase-email` Edge Function source

**Discovered:** Session 47, 2026-04-11
**Severity:** Medium
**Status:** OPEN
**Discovered by:** Session 47 stripe-webhook audit

### What

The Supabase Edge Function `send-purchase-email` (version 1, active) has two credentials hardcoded directly in its source file at lines 4–6:

```typescript
const RESEND_API_KEY = 're_4dpfnyWP_9agSDAAdhCNVUx6qTSTxubC9';
const SUPABASE_URL = 'https://wzthxohtgojenukmdubz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

The Resend API key (`re_4dpfnyWP_...`) can send email from any sending domain you've verified in Resend — most notably `ace@sovereign-synthesis.com`. The anon key is public-by-design (used in browser contexts) so its exposure here is less severe but still bad hygiene.

### Why it matters

- **Anyone with `get_edge_function` Supabase Management API access can read the function source** and extract the Resend key. The MCP tool surface exposes this via `get_edge_function` — Session 47 pulled the full source with a single call.
- **Git history:** if this source is ever committed to a public repo, the key leaks forever. Rotation required.
- **Principle:** secrets should live in Edge Function Secrets (env vars), never in source. The function already uses `Deno.env.get()` for `SUPABASE_SERVICE_ROLE_KEY` in `stripe-webhook` — same pattern should apply here.

### What to do

1. **Create Supabase Edge Function secrets** for:
   - `RESEND_API_KEY`
   - `SUPABASE_URL` (already exists at platform level, can reuse)
   - `SUPABASE_ANON_KEY` (already exists at platform level, can reuse)
2. **Patch `send-purchase-email` source** to replace the hardcoded constants with `Deno.env.get('RESEND_API_KEY')` etc.
3. **Rotate the leaked Resend key** — Resend dashboard → API Keys → revoke `re_4dpfnyWP_...` → create new key → update env var.
4. **Redeploy** `send-purchase-email`.
5. Verify by sending a test payload and checking the function logs.

### Related

- `stripe-webhook` Edge Function uses `Deno.env.get()` correctly — reference implementation.
- Master ref Section 12.2 now documents the Edge Function env var layer.

---

## ISSUE-002 — `SUPABASE_SERVICE_ROLE_KEY` pasted into Claude chat context

**Discovered:** Session 47, 2026-04-11
**Severity:** Low (situational)
**Status:** FLAGGED FOR USER DECISION

### What

During Session 47's stripe-webhook audit, the Architect pasted the `SUPABASE_SERVICE_ROLE_KEY` into chat in an attempt to give Claude secrets-read access. The key (`eyJhbGciOi...0-I3JpTNntoMlZF2O-0PiLYPJbXaJxNj_dqQe7OzvmKg`) was briefly in the session's context window.

### Why it matters

- Service role key bypasses RLS on the Supabase database.
- It already lives in Railway env vars, local `.env`, and was previously hardcoded in `send-purchase-email` (different key variant). Its exposure surface already exists.
- Claude did NOT save it to memory per the "no credentials in memory" rule.
- The key has NOT been committed to git.

### What to do

**Architect's choice:**
- Option A: Rotate the key now. Supabase Dashboard → Project Settings → API → Reset `service_role` key. Then update Railway + any hardcoded references.
- Option B: Accept risk. Key was not committed anywhere new; the exposure surface is unchanged from pre-session.

**Recommendation:** Option A if the chat transcript is ever going to be shared or logged externally. Option B if the session stays private to the Architect's account.

### Resolution

PENDING Architect decision.

---

## ISSUE-003 — Supabase Personal Access Token pasted into Claude chat context

**Discovered:** Session 47, 2026-04-11
**Severity:** Medium
**Status:** FLAGGED FOR USER DECISION

### What

During Session 47, the Architect pasted a Supabase Personal Access Token (`sbp_281c402ab75f3836270d6232d7a0fda312e602c8`) into chat to unblock the Edge Function deploy after Claude's MCP `deploy_edge_function` adapter hit a ZodError. The PAT was used to:

1. Deploy a temporary diagnostic Edge Function (`diag-env-temp`) to read Edge Function Secrets via `Deno.env.get()`
2. Delete the diagnostic function after use
3. Deploy the hardened `stripe-webhook` v9 (replacing v8)

### Why it matters

- A `sbp_` PAT grants **full Management API access** to every Supabase project the issuing user can see — projects, functions, secrets, database, billing.
- It is far more powerful than the service role key. Service role bypasses RLS on ONE database. A PAT can create/delete entire projects and modify Edge Functions across the org.
- It is in the Claude chat transcript and any session log/export.
- Claude did NOT save it to memory.

### What to do

**Option A (recommended):** Rotate immediately. Supabase Dashboard → Account → Tokens → revoke `sbp_281c402a...` → create a new one if needed for future Management API work.
- Time cost: 30 seconds.
- Result: any leak from this transcript is neutralized.

**Option B:** Accept risk if the chat transcript stays private to the Architect's account.

### Resolution

PENDING Architect decision.

---

## ISSUE-004 — `BOT_WEBHOOK_URL` Edge Function fan-out is a dead path (404 + signature fail)

**Discovered:** Session 47, 2026-04-11
**Severity:** Low (silent failure, but pipeline-correct)
**Status:** RESOLVED via Option B, 2026-04-11. Both dead env vars (`MAKE_STRIPE_ROUTER_URL`, `BOT_WEBHOOK_URL`) deleted from Edge Function Secrets via Management API. Architect must manually dual-register Stripe endpoints in Stripe dashboard.

### What

During Session 47 the actual plaintext value of the Supabase Edge Function secret `BOT_WEBHOOK_URL` was retrieved:

```
BOT_WEBHOOK_URL = https://gravity-claw-production-d849.up.railway.app/webhook/stripe
```

Two problems with this URL:

1. **Path doesn't exist on the bot.** The bot's `WebhookServer` (`src/tools/webhooks.ts`) does **exact-match** routing. The only stripe-related route registered in `src/index.ts` is `/api/stripe-webhook` (line 2014). There is no `/webhook/stripe` route. Any POST to `BOT_WEBHOOK_URL` will return `{"error":"Not found"}` with HTTP 404.
2. **Even if the path were corrected**, the bot endpoint at `/api/stripe-webhook` performs **HMAC-SHA256 signature verification** against `STRIPE_WEBHOOK_SECRET`. The fan-out from the Edge Function (step 6) sends a flat custom payload (`{type: "revenue_signal", product_id, amount, customer_email, user_id, revenue_log_id}`), NOT a real Stripe event with a valid `stripe-signature` header. Verification would fail.

So **the BOT_WEBHOOK_URL fan-out has been architecturally dead since it was wired up.** It is fire-and-forget, so it has not surfaced as an error — it just throws on `.catch()` and the webhook returns 200.

### Why it matters

- Mission Control's `mission_metrics` and `activity_log` writes (which the bot's `/api/stripe-webhook` handler performs on a signed Stripe event) **do not happen via this fan-out**. They only happen if Stripe itself is also configured to call the bot endpoint directly.
- If Stripe is configured to call ONLY the Edge Function, then `mission_metrics` and `activity_log` are never written for purchases. Mission Control dashboards depending on them will be blank.
- The hardened v9 stripe-webhook now writes `fanout_failure` to `audit_trail` for both targets, so this dead path will become **observable** on the first paid test instead of staying silent.

### What to do — three options

**Option A (cleanest):** Add a new bot endpoint `/api/revenue-signal` that accepts the flat payload (no Stripe signature, but require a shared-secret header), then update `BOT_WEBHOOK_URL` in Supabase Edge Function Secrets to point at it. The bot endpoint would write to `mission_metrics` and `activity_log` from the flat payload.

**Option B:** Configure Stripe to send `checkout.session.completed` events to **both** the Edge Function AND the bot endpoint (`/api/stripe-webhook`). Two endpoints in Stripe → two writes. Eliminate the fan-out from the Edge Function entirely (clear `BOT_WEBHOOK_URL`). Risk: duplicate revenue_log rows unless one handler dedupes.

**Option C:** Move `mission_metrics` and `activity_log` writes into the Edge Function itself. Single source of truth. Eliminate the bot fan-out and the bot's own `/api/stripe-webhook` handler. Risk: Edge Function gets larger and harder to test locally.

**Recommendation:** Option B for the first paid test (fastest path to dual-write), then refactor to Option A in a follow-up session. Option C is the long-term right answer but it's a bigger move.

### Resolution

**2026-04-11 RESOLVED via Option B.** Verified via Make.com MCP (team `2016213`) that the only live hook is `snoqd8i7rcrbfmkvmpgx83toploxea3w` (Content Factory) — the `leksfv66mebrys6lz9kklpgos7sp3lii` target was one of the four deleted. Both dead env vars (`MAKE_STRIPE_ROUTER_URL`, `BOT_WEBHOOK_URL`) deleted from Edge Function Secrets via Management API. Hardened v9 `stripe-webhook` now logs `fanout_skipped_no_url` cleanly instead of `fanout_failure`. Architect must dual-register Stripe webhook endpoints — see `STRIPE-DASHBOARD-ACTIONS.md`.
