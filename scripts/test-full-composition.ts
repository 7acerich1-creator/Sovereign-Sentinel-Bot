// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION — Phase 5 Task 5.12
// Full composition integration test.
//
// Unlike the Phase 2 contract test (test-pod-contract.ts) which uses noVolume
// and a 1-scene skeleton, this test runs a REAL 3-scene composition through
// FLUX + XTTS + Whisper captions + audio mixing on a production-grade GPU
// with the speaker volume attached.
//
// What it exercises end-to-end:
//   Stage 0: Brand card animation + typewriter overlay
//   Stage 1: Ken Burns zoompan per scene (FLUX images + XTTS audio)
//   Stage 2: Concat all scene clips
//   Stage 2.5: Composite audio mixing (music bed + stings + typing)
//   Stage 3: Kinetic captions (GPU Whisper → ASS → burn)
//   Stage 4: Probe final duration
//   Stage 5: Thumbnail generation
//
// Budget guard:
//   Must set POD_FULL_TEST_CONFIRM=1. Expected cost: ~$0.50-1.00 on H100.
//   Typical run time: 3-8 min depending on cold start + FLUX generation.
//
// Usage:
//   POD_FULL_TEST_CONFIRM=1 npm run test:full-composition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "dotenv/config";

import { fetchHealth, produceVideo, sweepStalePods } from "../src/pod/runpod-client";
import { shutdownPodSession, withPodSession } from "../src/pod/session";
import type { ArtifactUrls, Brand, JobSpec, PodHandle } from "../src/pod/types";

// SESSION 75: Kill pod on Ctrl-C / terminal close so we never leak GPU charges.
const emergencyShutdown = async () => {
  console.log("\n[full-composition] SIGTERM/SIGINT — killing pod...");
  await shutdownPodSession().catch(() => {});
  await sweepStalePods().catch(() => {});
  process.exit(1);
};
process.on("SIGINT", emergencyShutdown);
process.on("SIGTERM", emergencyShutdown);

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const BRANDS_TO_TEST: Brand[] = ["ace_richie"];
// Test both brands if explicitly requested
if (process.env.TEST_BOTH_BRANDS === "1") {
  BRANDS_TO_TEST.push("containment_field");
}

function makeSpec(brand: Brand): JobSpec {
  return {
    brand,
    niche: "phase5-full-test",
    seed: `full-test-${brand}-${Date.now()}`,
    hook_text: "The system was never designed to set you free",
    script:
      "The system was never designed to set you free. Every structure around you was " +
      "built to keep you producing, consuming, and never questioning. But there is a " +
      "glitch in the code. And once you see it, you cannot unsee it. This is your " +
      "firmware update.",
    scenes: [
      {
        index: 0,
        image_prompt:
          "cinematic macro shot of a cracked digital screen with golden light bleeding through the fractures, " +
          "dramatic chiaroscuro lighting, film grain, 35mm lens, shallow depth of field",
        tts_text:
          "The system was never designed to set you free. Every structure around you was built " +
          "to keep you producing, consuming, and never questioning.",
      },
      {
        index: 1,
        image_prompt:
          "extreme close-up of a human eye reflecting lines of scrolling code, " +
          "neon cyan reflections on iris, dark moody studio lighting, Hasselblad medium format",
        tts_text:
          "But there is a glitch in the code. A frequency most people never tune into. " +
          "And once you see it, you cannot unsee it.",
      },
      {
        index: 2,
        image_prompt:
          "silhouette of a figure standing at the edge of a vast digital landscape dissolving into particles of light, " +
          "epic wide shot, volumetric fog, golden hour backlighting, anamorphic lens flare",
        tts_text:
          "This is your firmware update. The moment you stop being a passenger in someone else's " +
          "simulation and start architecting your own reality.",
      },
    ],
    client_job_id: `full-test-${brand}-${Date.now()}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Env gate
// ─────────────────────────────────────────────────────────────────────────────
function requireEnv(): void {
  if (process.env.POD_FULL_TEST_CONFIRM !== "1") {
    console.error(
      "REFUSED: set POD_FULL_TEST_CONFIRM=1 to acknowledge GPU spend.\n" +
        "Expected cost: ~$0.50-1.00 per brand on H100. Run time: 3-8 min.",
    );
    process.exit(2);
  }
  const missing = ["RUNPOD_API_KEY", "POD_WORKER_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    console.error(`REFUSED: missing required env: ${missing.join(", ")}`);
    process.exit(2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  requireEnv();
  const t0 = Date.now();
  console.log(`[full-composition] START @ ${new Date(t0).toISOString()}`);
  console.log(`[full-composition] brands to test: ${BRANDS_TO_TEST.join(", ")}`);

  const results: Array<{ brand: Brand; artifacts: ArtifactUrls; elapsedS: number }> = [];

  // Run all brand tests on the SAME pod (one cold start, multiple jobs)
  await withPodSession(
    async (handle: PodHandle) => {
      console.log(`[full-composition] pod live: ${handle.workerUrl} (pod=${handle.podId})`);

      // Health check — retry generously. The /health/live liveness probe passes
      // before models load, but /health (readiness) needs FLUX + XTTS loaded.
      // On cold start that can take 2-5 min after the pod reports "ready".
      const HEALTH_MAX_ATTEMPTS = 20;
      const HEALTH_RETRY_DELAY_MS = 15_000; // 15s between attempts = up to 5 min total
      console.log(`[full-composition] /health (up to ${HEALTH_MAX_ATTEMPTS} attempts, ${HEALTH_RETRY_DELAY_MS / 1000}s apart):`);
      let health: Awaited<ReturnType<typeof fetchHealth>> | null = null;
      for (let attempt = 1; attempt <= HEALTH_MAX_ATTEMPTS; attempt++) {
        try {
          health = await fetchHealth(handle);
          break;
        } catch (err) {
          console.warn(`[full-composition] /health attempt ${attempt}/${HEALTH_MAX_ATTEMPTS} failed: ${err instanceof Error ? err.message : err}`);
          if (attempt === HEALTH_MAX_ATTEMPTS) throw err;
          await new Promise((r) => setTimeout(r, HEALTH_RETRY_DELAY_MS));
        }
      }
      console.log(JSON.stringify(health, null, 2));

      if (!health!.cuda_available) {
        throw new Error("CUDA not available — cannot run full composition test");
      }

      // RunPod proxy needs a brief settle period after cold start — the 404s
      // on /health and /produce are transient proxy routing delays.
      console.log("[full-composition] waiting 10s for RunPod proxy to stabilize...");
      await new Promise((r) => setTimeout(r, 10_000));

      for (const brand of BRANDS_TO_TEST) {
        const jobT0 = Date.now();
        console.log(`\n[full-composition] ─── ${brand} ───`);

        const spec = makeSpec(brand);
        console.log(`[full-composition] POST /produce (${spec.scenes.length} scenes, hook="${spec.hook_text}")`);

        const artifacts = await produceVideo(handle, spec, {
          timeoutMs: 20 * 60_000, // 20 min — FLUX generation can be slow on first run
        });

        const jobElapsed = (Date.now() - jobT0) / 1000;
        console.log(`[full-composition] ✅ ${brand} DONE in ${jobElapsed.toFixed(1)}s`);
        console.log(`    video_url:     ${artifacts.videoUrl}`);
        console.log(`    thumbnail_url: ${artifacts.thumbnailUrl}`);
        console.log(`    duration_s:    ${artifacts.durationS}`);

        results.push({ brand, artifacts, elapsedS: jobElapsed });

        // Sanity checks
        if (!artifacts.videoUrl) {
          throw new Error(`${brand}: no video_url in result`);
        }
        if (!artifacts.thumbnailUrl) {
          throw new Error(`${brand}: no thumbnail_url in result`);
        }
        if (artifacts.durationS < 10) {
          console.warn(`⚠️ ${brand}: video only ${artifacts.durationS}s — suspiciously short for 3 scenes`);
        }
      }
    },
    {
      idleWindowMs: 0, // stop pod immediately after tests
      readinessTimeoutMs: 12 * 60_000, // 12 min for cold start with FLUX model pull
      startPodOptions: {
        // Override cloud type via env if SECURE is saturated:
        //   POD_CLOUD_TYPE=COMMUNITY npm run test:full-composition
        cloudType: (process.env.POD_CLOUD_TYPE as "SECURE" | "COMMUNITY") || "SECURE",
      },
    },
  );

  await shutdownPodSession();

  // Summary
  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[full-composition] ═══════════════════════════════════════`);
  console.log(`[full-composition] ALL BRANDS PASSED (total ${totalElapsed}s)`);
  for (const r of results) {
    console.log(`  ${r.brand}: ${r.elapsedS.toFixed(1)}s, ${r.artifacts.durationS}s video`);
  }
  console.log(`[full-composition] ═══════════════════════════════════════`);
}

main().catch(async (err) => {
  console.error("[full-composition] ❌ FAIL:", err instanceof Error ? err.stack ?? err.message : err);
  await shutdownPodSession().catch(() => {});
  process.exit(1);
});
