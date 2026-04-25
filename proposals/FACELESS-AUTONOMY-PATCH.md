# Proposed patch — Faceless Factory daily autonomy

**Status:** DRAFT, NOT APPLIED. Ace approves before push.
**Goal:** Make the 30-video A/B/C performance test progress without manual webhook calls.
**Effect on revenue cycle:** unblocks NORTH_STAR's first business goal (lines 53-159 of `NORTH_STAR.md`).

---

## Cost & cadence design

**1 video per day, alternating brand by day-of-week.** Why one per day:
- One RunPod pod cycle ≈ $0.40-0.80 in compute. 30 videos = ~$15-25 total.
- Alternating brands keeps cost predictable and produces 15 SS + 15 TCF for the A/B/C grid.
- The aesthetic LRU rotation already in `pickNextAesthetic` automatically cycles A → B → C across the 30-day run.

**Fire window:** 16:00–17:00 UTC. Reasoning:
- Alfred's daily trend scan fires 15:05 UTC and produces the seed thesis we need as `source_intelligence`.
- Content engine produces text drafts at 18:30 UTC. Faceless production must finish before then so the day's video can be posted in the same sweep.
- One-hour window gives the pod time to wake (~3-5 min) + render (~10 min) + upload to R2 (~1 min).

**Brand rotation rule:**
- Even-numbered day-of-month → `sovereign_synthesis`
- Odd-numbered day-of-month → `containment_field`

---

## Exact diff

### File: `src/index.ts`

**Edit 1 — line 2098** (add new key to autonomousFiredDates):

```diff
-  const autonomousFiredDates = { ytStatsFetch: "", vectorSweep: "", alfredScan: "", veritasDirective: "", ctaAudit: "", landingAnalytics: "", yukiHookDrops14: "", yukiHookDrops22: "" };
+  const autonomousFiredDates = { ytStatsFetch: "", vectorSweep: "", alfredScan: "", veritasDirective: "", ctaAudit: "", landingAnalytics: "", yukiHookDrops14: "", yukiHookDrops22: "", facelessProduce: "" };
```

**Edit 2 — insert new scheduler block** immediately after the Veritas Weekly Directive block (after the closing brace of that `scheduler.add` near line 2300). Drop in:

```typescript
  // Faceless Factory — Daily Video Production (16:00-17:00 UTC, alternating brands)
  // Each fire pulls Alfred's most-recent daily_trend_scan result as source intelligence,
  // selects ONE brand based on day-of-month parity, and produces ONE faceless video.
  // The 30-video A/B/C performance test progresses autonomously after this.
  scheduler.add({
    name: "Faceless Factory Daily Production",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const dateKey = now.toDateString();
      const inWindow = hour === 16; // any minute in 16:00 UTC hour
      if (!inWindow || autonomousFiredDates.facelessProduce === dateKey) return;

      // Persistent dup-fire guard via niche_cooldown timestamps for today
      try {
        const todayStart = new Date(now);
        todayStart.setUTCHours(0, 0, 0, 0);
        const checkRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/niche_cooldown?created_at=gte.${todayStart.toISOString()}&select=id&limit=1`,
          { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
        );
        const existing = await checkRes.json() as any[];
        if (Array.isArray(existing) && existing.length > 0) {
          autonomousFiredDates.facelessProduce = dateKey;
          console.log(`🎬 [FacelessAutonomy] Already fired today (niche_cooldown row exists) — skipping`);
          return;
        }
      } catch (err: any) {
        console.warn(`[FacelessAutonomy] Dup-fire guard query failed (continuing): ${err.message}`);
      }

      autonomousFiredDates.facelessProduce = dateKey;

      // Brand selection: even day-of-month → SS, odd → TCF
      const dayOfMonth = now.getUTCDate();
      const brand: "sovereign_synthesis" | "containment_field" =
        dayOfMonth % 2 === 0 ? "sovereign_synthesis" : "containment_field";

      // Pull Alfred's latest daily_trend_scan result for source intelligence
      let sourceIntel = "";
      let niche = brand === "sovereign_synthesis" ? "sovereignty" : "dark-psychology";
      try {
        const alfredRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/crew_dispatch?to_agent=eq.alfred&task_type=eq.daily_trend_scan&status=eq.completed&order=completed_at.desc&limit=1&select=result,payload`,
          { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
        );
        const alfredRows = await alfredRes.json() as any[];
        if (alfredRows[0]?.result) {
          sourceIntel = alfredRows[0].result;
        }
      } catch (err: any) {
        console.warn(`[FacelessAutonomy] Could not fetch Alfred seed: ${err.message}`);
      }

      // Fallback: synthetic seed from brand + niche if Alfred unavailable
      if (!sourceIntel || sourceIntel.length < 200) {
        sourceIntel = `Generate a ${niche} thesis seed for ${brand}. Focus on the architecture of liberation from simulated systems. 90-second long-form. Single core insight, three reinforcing examples, one call to sovereignty.`;
      }

      console.log(`🎬 [FacelessAutonomy] Daily fire — brand=${brand} niche=${niche} (${dateKey})`);

      try {
        const { produceFacelessBatch } = await import("./engine/faceless-factory");
        const results = await produceFacelessBatch(pipelineLLM, sourceIntel.slice(0, 3000), niche, [brand]);
        console.log(`✅ [FacelessAutonomy] Produced ${results.length} videos for ${brand}`);
      } catch (err: any) {
        console.error(`❌ [FacelessAutonomy] Production failed: ${err.message}`);
      }
    },
  });
```

---

## Risk assessment

| Risk | Mitigation in patch |
|---|---|
| Container restart at 16:30 UTC re-fires the same day | `niche_cooldown` query checks for any row created today before firing |
| Alfred didn't run / has no result | Synthetic fallback seed — production never blocks on missing Alfred output |
| RunPod pod cold-start fails | Pipeline already handles this — error is logged, no retry, next day fires fresh |
| Both brands fire same day (race) | Day-of-month parity = single brand per day, deterministic |
| 30 videos exceed RunPod budget | Audit memory at video #15 — Ace can pause via `isAutonomousPaused()` global toggle |

---

## Verification plan after push

1. Watch Railway logs for `🎬 [FacelessAutonomy] Daily fire` line at next 16:00 UTC.
2. Query: `SELECT brand, niche, aesthetic_style, created_at FROM niche_cooldown WHERE created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC;` — expect 1 new row/day with `aesthetic_style` populated.
3. Mission Control's Aesthetic Performance tile starts showing real data after ~3 days (≥1 video per A/B/C cell).

---

## Rollback

If the autonomous loop misbehaves:
1. Comment out the entire `scheduler.add({ name: "Faceless Factory Daily Production", ... })` block.
2. Or set `enabled: false` on that block.
3. No data corruption risk — `niche_cooldown` and R2 video uploads are append-only.

---

## What this patch is NOT

- It does NOT fix the FB Code 100 error (separate root cause, see `AUDIT-2026-04-25.md` Watch item #1).
- It does NOT fix the YouTube Analytics retention/CTR zero-fill (needs OAuth re-consent — Watch item #3).
- It does NOT change the 30-video aesthetic rotation logic — `pickNextAesthetic` and `recordNicheRun` are already correct in `niche-cooldown.ts`. This patch just feeds them the trigger they need.
