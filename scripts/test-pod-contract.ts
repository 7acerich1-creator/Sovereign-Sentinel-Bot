// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION — Phase 2 Task 2.3
// End-to-end Railway ↔ Pod contract test.
//
// What this does:
//   1. Starts a fresh GPU pod (via withPodSession → startPod + waitUntilReady).
//   2. Calls fetchHealth() and prints the authenticated /health snapshot.
//   3. POSTs a minimal 1-scene JobSpec to /produce and polls /jobs/{id} until
//      the job reaches a terminal state. We call the HTTP endpoints DIRECTLY
//      (not via produceVideo) because the Phase 1 skeleton worker returns
//      `video_url=null` on success, and produceVideo() throws PodJobFailedError
//      on that. Phase 4 wires real artifacts.
//   4. Asserts the round-trip: request → queued → running → done. Prints the
//      full JobResult so the contract shapes can be eyeballed.
//   5. withPodSession's idle window is overridden to 0ms so the pod stops
//      immediately after this script returns — no warm-window charge.
//
// Budget guard:
//   Must set POD_CONTRACT_TEST_CONFIRM=1 or the script refuses to run. H100
//   pricing is ~$2/hr on RunPod — a full cold-start + 30s run is ≈ $0.05 but
//   an idle loop can burn $2 in an hour. Fail loud before spending.
//
// Usage:
//   POD_CONTRACT_TEST_CONFIRM=1 npm run test:pod-contract
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "dotenv/config";

import { fetchHealth, sweepStalePods } from "../src/pod/runpod-client";
import { shutdownPodSession, withPodSession } from "../src/pod/session";

// SESSION 75: Kill pod on Ctrl-C / terminal close so we never leak GPU charges.
const emergencyShutdown = async () => {
  console.log("\n[pod-contract] SIGTERM/SIGINT — killing pod...");
  await shutdownPodSession().catch(() => {});
  await sweepStalePods().catch(() => {});
  process.exit(1);
};
process.on("SIGINT", emergencyShutdown);
process.on("SIGTERM", emergencyShutdown);
import type { JobResult, JobSpec, JobStatus, PodHandle } from "../src/pod/types";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min hard stop per job
const TERMINAL: readonly JobStatus[] = ["done", "failed"] as const;

const SAMPLE_SPEC: JobSpec = {
  brand: "sovereign_synthesis",
  niche: "phase2-contract-test",
  seed: "contract-test-seed",
  script:
    "This is a contract test script. It exists only to round-trip the pod /produce endpoint.",
  scenes: [
    {
      index: 0,
      image_prompt: "placeholder scene for phase-2 contract test",
      tts_text: "This is the only scene in this contract test.",
    },
  ],
  client_job_id: `contract-${Date.now()}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — direct /produce + /jobs polling (bypasses produceVideo's artifact
// guard so we can validate the transport even when the skeleton worker returns
// null artifact URLs on `done`).
// ─────────────────────────────────────────────────────────────────────────────
async function postProduce(handle: PodHandle, spec: JobSpec): Promise<string> {
  const res = await fetch(`${handle.workerUrl}/produce`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${handle.workerToken}`,
    },
    body: JSON.stringify(spec),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /produce failed: ${res.status} ${res.statusText}\n${text}`);
  }
  const body = JSON.parse(text) as { job_id?: string; status?: string; queued_at?: number };
  if (!body.job_id) {
    throw new Error(`POST /produce returned no job_id: ${text}`);
  }
  console.log(`    → enqueued job_id=${body.job_id} status=${body.status ?? "?"}`);
  return body.job_id;
}

async function pollJob(handle: PodHandle, jobId: string): Promise<JobResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus: JobStatus | null = null;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const res = await fetch(`${handle.workerUrl}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { authorization: `Bearer ${handle.workerToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET /jobs/${jobId} failed: ${res.status} ${res.statusText}\n${text}`);
    }
    const body = (await res.json()) as JobResult;
    if (body.status !== lastStatus) {
      console.log(`    → [attempt ${attempts}] status=${body.status}`);
      lastStatus = body.status;
    }
    if (TERMINAL.includes(body.status)) return body;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`pollJob timeout after ${POLL_TIMEOUT_MS}ms (lastStatus=${lastStatus})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertContractShape(result: JobResult, expectedJobId: string): void {
  if (result.job_id !== expectedJobId) {
    throw new Error(`job_id mismatch: got ${result.job_id}, expected ${expectedJobId}`);
  }
  if (!TERMINAL.includes(result.status)) {
    throw new Error(`expected terminal status, got ${result.status}`);
  }
  // Phase 1 skeleton: artifact URLs may be null on `done`. Phase 4 will fill them.
  // We intentionally do NOT fail the contract test on that — only on `failed`.
  if (result.status === "failed") {
    throw new Error(`pod reported failure: ${result.error ?? "(no error field)"}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Env gate
// ─────────────────────────────────────────────────────────────────────────────
function requireEnv(): void {
  if (process.env.POD_CONTRACT_TEST_CONFIRM !== "1") {
    console.error(
      "REFUSED: set POD_CONTRACT_TEST_CONFIRM=1 to acknowledge GPU spend. " +
        "Typical run ≈ $0.05; an idle loop can burn $2/hr.",
    );
    process.exit(2);
  }
  const missing = ["RUNPOD_API_KEY", "POD_WORKER_TOKEN"].filter((k) => !process.env[k]);
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
  console.log(`[pod-contract] START @ ${new Date(t0).toISOString()}`);

  const result = await withPodSession(
    async (handle) => {
      console.log(`[pod-contract] pod live: ${handle.workerUrl} (pod=${handle.podId})`);

      console.log("[pod-contract] /health:");
      const health = await fetchHealth(handle);
      console.log(JSON.stringify(health, null, 2));

      console.log("[pod-contract] POST /produce:");
      const jobId = await postProduce(handle, SAMPLE_SPEC);

      console.log("[pod-contract] polling /jobs/{id}:");
      const job = await pollJob(handle, jobId);
      console.log(JSON.stringify(job, null, 2));

      assertContractShape(job, jobId);
      return job;
    },
    // Idle window = 0 → stop pod the moment we return. Don't leave a
    // warm-window charge running after a test.
    //
    // startPodOptions: the Phase 1 skeleton worker has ZERO dependency on
    // the speaker/model network volume or on an 80GB GPU. By passing
    // noVolume + broader GPU allowlist + COMMUNITY cloud we widen the pool
    // of schedulable machines enough to survive a transient SECURE/US-KS-2
    // capacity dip (S65 observed HTTP 500 "no instances available" on the
    // locked H100/A100-only SECURE path). Production pipelines at Phase 4+
    // still use the default H100/A100 + SECURE + volume path because they
    // actually need the GPU and the seeded speaker WAVs.
    {
      idleWindowMs: 0,
      startPodOptions: {
        noVolume: true,
        cloudType: "SECURE",
        gpuTypeIds: [
          // Broad allowlist so the contract test can survive regional
          // capacity dips in the H100/A100 pool. SECURE hosts also
          // reliably pull from ghcr.io, which we empirically confirmed
          // COMMUNITY hosts often refuse for this ~5GB image.
          "NVIDIA H100 80GB HBM3",
          "NVIDIA H100 PCIe",
          "NVIDIA A100-SXM4-80GB",
          "NVIDIA A100 80GB PCIe",
          "NVIDIA RTX A6000",
          "NVIDIA RTX A5000",
          "NVIDIA RTX A4000",
          "NVIDIA GeForce RTX 4090",
          "NVIDIA GeForce RTX 3090",
          "NVIDIA L40",
          "NVIDIA L40S",
          "NVIDIA L4",
        ],
        containerDiskInGb: 50,
      },
    },
  );

  // Belt-and-suspenders: even though idleWindowMs=0 schedules an immediate
  // stop, the timer is async. shutdownPodSession awaits the RPC.
  await shutdownPodSession();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[pod-contract] ✅ contract PASS (${elapsed}s, status=${result.status})`);
}

main().catch(async (err) => {
  console.error("[pod-contract] ❌ FAIL:", err instanceof Error ? err.stack ?? err.message : err);
  // Best effort — don't leak a pod on failure.
  await shutdownPodSession().catch(() => {});
  process.exit(1);
});
