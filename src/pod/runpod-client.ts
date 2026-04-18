// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION — Phase 2 Task 2.1
// Railway ↔ RunPod orchestration client.
//
// Exposes:
//   startPod()          — create a fresh GPU pod (D1: H100 80GB → A100 fallback),
//                          pull the worker image, attach the network volume.
//   waitUntilReady()    — poll GET /health/live until 200 OR timeout.
//   produceVideo(spec)  — POST /produce, poll GET /jobs/{id} until terminal.
//   stopPod(podId)      — terminate (DELETE /pods/{podId}).
//   fetchHealth()       — authenticated GET /health (returns GPU + model status).
//
// The pod lifecycle is CREATE-PER-JOB by default (see PROJECT_POD_MIGRATION.md
// STATUS block, S62). Long-lived RUNPOD_POD_ID is NOT honored as "the pod";
// each `startPod()` mints a new one. Batching and idle-sleep (D6 = 10 min) are
// implemented ONE LEVEL UP in `src/pod/session.ts` (Phase 2 Task 2.4).
//
// Env vars (Railway side):
//   RUNPOD_API_KEY              — Bearer for https://rest.runpod.io/v1
//   POD_WORKER_TOKEN            — Bearer for the FastAPI worker (set on pod env)
//   RUNPOD_POD_IMAGE            — optional override of worker image tag
//   RUNPOD_NETWORK_VOLUME_ID    — optional override of speaker/model volume
//   RUNPOD_GPU_TYPE_IDS         — optional CSV override of GPU allowlist
//   RUNPOD_CONTAINER_DISK_GB    — optional override of container disk GB
//   RUNPOD_DATACENTER_ID        — optional region pin (e.g. "US-KS-2")
//   XTTS_SPEAKER_WAV_ACE/TCF    — forwarded into pod env so worker can find WAVs
//   R2_*                        — forwarded into pod env so worker can upload
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import {
  type ArtifactUrls,
  type HealthReport,
  type JobResult,
  type JobSpec,
  type JobStatus,
  type PodHandle,
  type ProduceAccepted,
  type ShortJobSpec,
  PodContractError,
  PodJobFailedError,
  RunPodApiError,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const RUNPOD_API_BASE = "https://rest.runpod.io/v1";
const DEFAULT_IMAGE = "ghcr.io/7acerich1-creator/sovereign-sentinel-pod:latest";
// S76: Volume dependency removed — speaker WAVs baked into Docker image,
// model weights download to container disk on cold start. Pod can now
// schedule in ANY datacenter worldwide instead of being pinned to US-KS-2.
const DEFAULT_NETWORK_VOLUME_ID = "gai851lcfw"; // Legacy — only used if explicitly requested
const DEFAULT_VOLUME_MOUNT_PATH = "/runpod-volume";
const DEFAULT_CONTAINER_DISK_GB = 75; // Bumped from 50 — models cache on container disk now
const DEFAULT_WORKER_PORT = 8000;

// S90 cost optimization: 48GB cards are sufficient for FLUX bf16 (~24GB) + XTTS (~4GB)
// + Whisper (~3GB) loaded concurrently. All five 48GB options on RunPod listed here.
// IDs verified against RunPod POST /pods gpuTypeIds enum (docs.runpod.io/references/gpu-types).
// Order = cheapest first so the pipeline grabs the best deal available.
// NO 80GB fallbacks — fail and retry later rather than burn 3x the budget silently.
const DEFAULT_GPU_TYPE_IDS: readonly string[] = [
  "NVIDIA RTX A6000",              // 48GB, ~$0.33/hr — cheapest, high availability
  "NVIDIA A40",                    // 48GB, ~$0.35/hr — older but plentiful
  "NVIDIA L40",                    // 48GB, ~$0.69/hr
  "NVIDIA RTX 6000 Ada Generation", // 48GB, ~$0.74/hr — exact RunPod enum string
  "NVIDIA L40S",                   // 48GB, ~$0.79/hr — fastest but priciest of the tier
] as const;

// Pod env vars forwarded from Railway — these are the keys the worker reads.
// If a Railway env is missing we simply don't forward that key; the worker's
// /health will report `r2_configured: false` etc. and the caller can decide.
const POD_ENV_FORWARD_KEYS: readonly string[] = [
  "POD_WORKER_TOKEN",
  "XTTS_SPEAKER_WAV_ACE",
  "XTTS_SPEAKER_WAV_TCF",
  "XTTS_SPEAKER_ID",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_VIDEOS",
  "R2_BUCKET_THUMBS",
  "R2_PUBLIC_URL_BASE",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HF_HOME",
  "HF_TOKEN",
  "SPEAKERS_DIR",
] as const;

// Timing defaults (ms). Overridable per-call.
const DEFAULT_READY_TIMEOUT_MS = 10 * 60_000;   // 10 min for cold FLUX + XTTS pull
const DEFAULT_READY_POLL_MS = 5_000;            // 5s between /health/live probes
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60_000;     // 30 min for a long-form job
const DEFAULT_JOB_POLL_MS = 3_000;              // 3s between /jobs/{id} probes
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;        // 30s per HTTP call
const DEFAULT_API_RETRIES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Public options surface
// ─────────────────────────────────────────────────────────────────────────────
export interface StartPodOptions {
  /** Override the worker image tag. */
  image?: string;
  /** Override the attached network volume id. */
  networkVolumeId?: string;
  /**
   * If true, do NOT attach any network volume. Used by the Phase 2 contract
   * test to isolate transport validation from the speaker/model volume region
   * constraint (the volume is pinned to one datacenter; skipping it widens
   * the pool of schedulable machines).
   * Production pipelines leave this false — they need the speaker WAVs.
   */
  noVolume?: boolean;
  /** Override the GPU allowlist (first match wins). */
  gpuTypeIds?: readonly string[];
  /** Override container disk in GB. */
  containerDiskInGb?: number;
  /** Optional datacenter pin (matches the volume region). */
  dataCenterId?: string;
  /**
   * Override pod cloud class. SECURE = RunPod's vetted hosts (default, higher
   * SLA). COMMUNITY = third-party hosts (wider capacity, cheaper, used by the
   * contract test when SECURE is congested).
   */
  cloudType?: "SECURE" | "COMMUNITY";
  /** Pod name prefix for RunPod UI. Default: "sovereign-worker". */
  namePrefix?: string;
  /** Extra env vars to forward into the pod (overrides Railway env on conflict). */
  extraEnv?: Record<string, string>;
  /** Abort signal for the whole startup sequence. */
  signal?: AbortSignal;
}

export interface WaitUntilReadyOptions {
  /** Max ms to wait for /health/live → 200. Default 10 min. */
  timeoutMs?: number;
  /** Poll cadence in ms. Default 5000. */
  pollMs?: number;
  signal?: AbortSignal;
}

export interface ProduceVideoOptions {
  /** Max ms to wait for job terminal state. Default 30 min. */
  timeoutMs?: number;
  /** Poll cadence on /jobs/{id} in ms. Default 3000. */
  pollMs?: number;
  signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a fresh GPU pod with the worker image attached to the speaker/model
 * network volume. Returns the pod handle as soon as RunPod acknowledges the
 * create; callers MUST then `waitUntilReady(handle)` before hitting /produce.
 *
 * Note: RunPod bills from the moment the create returns. If this function
 * throws AFTER a successful create (e.g., handle post-processing fails), we
 * attempt best-effort cleanup via stopPod to avoid orphan charges.
 */
export async function startPod(options: StartPodOptions = {}): Promise<PodHandle> {
  const apiKey = requireEnv("RUNPOD_API_KEY");
  const workerToken = requireEnv("POD_WORKER_TOKEN");

  const image = options.image ?? process.env.RUNPOD_POD_IMAGE ?? DEFAULT_IMAGE;
  const gpuTypeIds = options.gpuTypeIds ?? parseCsvEnv("RUNPOD_GPU_TYPE_IDS") ?? DEFAULT_GPU_TYPE_IDS;
  const containerDiskInGb =
    options.containerDiskInGb ??
    parseIntEnv("RUNPOD_CONTAINER_DISK_GB") ??
    DEFAULT_CONTAINER_DISK_GB;
  const dataCenterId = options.dataCenterId ?? process.env.RUNPOD_DATACENTER_ID;
  const namePrefix = options.namePrefix ?? "sovereign-worker";

  // S80: Volume RE-ENABLED for model caching (FLUX ~12GB + XTTS ~2GB).
  // Without the volume, every pod create redownloads all models from HuggingFace
  // at full GPU billing rates (~$0.25-0.40 per cold start). With the volume,
  // models persist across pod creates and cold start drops from ~8min to ~1-2min.
  //
  // Trade-off: volume pins scheduling to its datacenter (US-KS-2). Accepted
  // because (a) the volume is already paid for, (b) COMMUNITY cloud has good
  // availability in US-KS-2, (c) testing burns multiple pod creates and the
  // savings are significant.
  //
  // Speaker WAVs are STILL baked into the Docker image (S76 change preserved).
  // The volume is used ONLY as a model weight cache via HF_HOME.
  //
  // This is TEMPORARY through testing and initial production batches. Evaluate
  // monthly: if batches are stable and infrequent (1-2x/week), volume-free
  // may be cheaper ($0.25/batch download vs $3.50/mo volume). If batches are
  // frequent or testing continues, volume saves money.
  const noVolume = options.noVolume ?? false;
  const networkVolumeId =
    options.networkVolumeId ??
    process.env.RUNPOD_NETWORK_VOLUME_ID ??
    DEFAULT_NETWORK_VOLUME_ID;

  const forwardedEnv = collectPodEnv(options.extraEnv ?? {});
  forwardedEnv["POD_WORKER_TOKEN"] = workerToken;

  // Speaker WAVs are ALWAYS from the Docker image (S76 bake-in preserved).
  // Override speaker path env vars regardless of volume status — Railway still
  // has the old /runpod-volume/speakers paths from the pre-S76 setup.
  forwardedEnv["SPEAKERS_DIR"] = "/app/brand-assets";
  forwardedEnv["XTTS_SPEAKER_WAV_ACE"] = "/app/brand-assets/ace_ref.wav";
  forwardedEnv["XTTS_SPEAKER_WAV_TCF"] = "/app/brand-assets/tcf_ref.wav";

  // S80: When volume is attached, point model caches to the persistent volume
  // so FLUX + XTTS weights survive across pod creates. When volume-free,
  // models cache to container disk (lost on pod termination).
  if (!noVolume) {
    forwardedEnv["HF_HOME"] = "/runpod-volume/cache/huggingface";
    forwardedEnv["TORCH_HOME"] = "/runpod-volume/cache/torch";
    forwardedEnv["XDG_CACHE_HOME"] = "/runpod-volume/cache";
  }

  // S76: Retry protocol — try SECURE first, fall back to COMMUNITY, wait, retry.
  // Prevents single-attempt failures from killing the whole pipeline when a
  // datacenter is temporarily at capacity.
  const cloudTypeOrder: Array<"SECURE" | "COMMUNITY"> =
    options.cloudType
      ? [options.cloudType] // Caller pinned a specific cloud type — respect it
      : ["SECURE", "COMMUNITY"]; // Default: SECURE first, COMMUNITY fallback

  const MAX_SUPPLY_RETRIES = 3;
  const SUPPLY_RETRY_DELAY_MS = 120_000; // 2 min between retry rounds
  let lastErr: unknown;

  for (let round = 0; round < MAX_SUPPLY_RETRIES; round++) {
    for (const cloudType of cloudTypeOrder) {
      const createBody: Record<string, unknown> = {
        name: `${namePrefix}-${shortTimestamp()}`,
        imageName: image,
        cloudType,
        gpuTypeIds: Array.from(gpuTypeIds),
        gpuCount: 1,
        containerDiskInGb,
        volumeInGb: 0,
        ports: [`${DEFAULT_WORKER_PORT}/http`],
        env: forwardedEnv,
        supportPublicIp: false,
      };

      if (!noVolume) {
        createBody["networkVolumeId"] = networkVolumeId;
        createBody["volumeMountPath"] = DEFAULT_VOLUME_MOUNT_PATH;
        // S80: Volume is in US-KS-2 — pin datacenter so RunPod doesn't try to
        // schedule in a region where the volume doesn't exist.
        if (!dataCenterId) {
          createBody["dataCenterIds"] = ["US-KS-2"];
        }
      }
      if (dataCenterId) createBody["dataCenterIds"] = [dataCenterId];

      try {
        const created = await runpodApi<RunPodPod>("POST", "/pods", apiKey, {
          body: createBody,
          signal: options.signal,
        });

        const podId = created.id ?? created.podId;
        if (!podId) {
          throw new RunPodApiError(
            "RunPod create returned no pod id",
            500,
            JSON.stringify(created).slice(0, 400),
          );
        }

        const handle: PodHandle = {
          podId,
          workerUrl: `https://${podId}-${DEFAULT_WORKER_PORT}.proxy.runpod.net`,
          workerToken,
          createdAt: Math.floor(Date.now() / 1000),
        };

        console.log(
          `\u{1F680} [RunPod] pod ${podId} created — image=${image} gpu=${gpuTypeIds[0]} cloud=${cloudType} volume=${noVolume ? "<none>" : networkVolumeId}`,
        );
        return handle;
      } catch (err) {
        lastErr = err;
        // Supply constraint (500) or rate limit (429) — try next cloud type
        if (err instanceof RunPodApiError && (err.httpStatus === 500 || err.httpStatus === 429)) {
          console.log(
            `⚠️ [RunPod] ${cloudType} failed (HTTP ${err.httpStatus}) — ${
              cloudTypeOrder.indexOf(cloudType) < cloudTypeOrder.length - 1
                ? "trying next cloud type..."
                : `round ${round + 1}/${MAX_SUPPLY_RETRIES} exhausted`
            }`,
          );
          continue;
        }
        // Non-retryable error — bail immediately
        throw err;
      }
    }
    // All cloud types exhausted for this round — wait before next round
    if (round < MAX_SUPPLY_RETRIES - 1) {
      console.log(
        `⏳ [RunPod] All cloud types exhausted. Waiting ${SUPPLY_RETRY_DELAY_MS / 1000}s before retry round ${round + 2}/${MAX_SUPPLY_RETRIES}...`,
      );
      await sleep(SUPPLY_RETRY_DELAY_MS);
    }
  }
  // All retries exhausted
  throw lastErr instanceof Error
    ? lastErr
    : new RunPodApiError(
        `RunPod pod creation failed after ${MAX_SUPPLY_RETRIES} retry rounds across ${cloudTypeOrder.join("+")} cloud types`,
        0,
      );
}

/**
 * Poll GET /health/live (unauthenticated) until it returns 200. Respects
 * AbortSignal + timeout. Throws on timeout — caller should then stopPod.
 */
export async function waitUntilReady(
  handle: PodHandle,
  options: WaitUntilReadyOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_READY_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const liveUrl = `${handle.workerUrl}/health/live`;

  // Phase 1: Wait for /health/live (unauthenticated liveness probe)
  let attempt = 0;
  let lastError: string = "never attempted";
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new Error("waitUntilReady aborted");
    }
    attempt++;
    try {
      const resp = await fetch(liveUrl, {
        method: "GET",
        signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      });
      if (resp.ok) {
        console.log(
          `\u{2705} [RunPod] pod ${handle.podId} ready after ${attempt} probe(s) (${Math.floor((Date.now() - handle.createdAt * 1000) / 1000)}s cold-start)`,
        );
        break;
      }
      lastError = `HTTP ${resp.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(pollMs);
  }
  if (Date.now() >= deadline) {
    throw new Error(
      `waitUntilReady timeout after ${timeoutMs}ms (pod=${handle.podId}, attempts=${attempt}, last=${lastError})`,
    );
  }

  // Phase 2: Verify the RunPod proxy is fully routing by hitting the
  // authenticated /health endpoint. The proxy sometimes returns 200 on
  // /health/live before all paths are wired — a POST /produce fired at
  // that moment gets a proxy-level 404 with an empty body.
  const maxReadinessAttempts = 5;
  for (let i = 1; i <= maxReadinessAttempts; i++) {
    if (options.signal?.aborted) throw new Error("waitUntilReady aborted");
    try {
      const health = await podFetchJson<HealthReport>(handle, "GET", "/health", {
        signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      });
      if (health.ok) {
        console.log(
          `🩺 [RunPod] pod ${handle.podId} proxy verified via /health (attempt ${i})`,
        );
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `⏳ [RunPod] /health probe ${i}/${maxReadinessAttempts}: ${msg}`,
      );
    }
    await sleep(pollMs);
  }
  // If authenticated /health never passed but /health/live did, proceed
  // anyway — the worker is alive, auth might just need a moment.
  console.log(
    `⚠️ [RunPod] pod ${handle.podId} /health never confirmed but /health/live passed — proceeding`,
  );
}

/**
 * Submit a JobSpec and await the terminal JobResult. Returns the ArtifactUrls
 * on success, throws PodJobFailedError on `failed` / timeout / abort.
 *
 * This function does NOT start or stop the pod — use `withPodSession` (Task
 * 2.4) for a full-lifecycle wrapper.
 */
export async function produceVideo(
  handle: PodHandle,
  spec: JobSpec,
  options: ProduceVideoOptions = {},
): Promise<ArtifactUrls> {
  validateJobSpec(spec);

  const timeoutMs = options.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_JOB_POLL_MS;

  // SESSION 81 FIX: Wrap POST /produce in a retry loop.
  // RunPod's NGINX proxy frequently returns empty 404s or 502s for the first
  // few seconds after a cold boot, even after GET /health returns 200.
  let accepted: ProduceAccepted | undefined;
  let lastPostErr: unknown;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      accepted = await podFetchJson<ProduceAccepted>(
        handle,
        "POST",
        "/produce",
        {
          body: spec,
          signal: options.signal,
        },
      );
      break; // Success, exit retry loop
    } catch (err) {
      lastPostErr = err;
      if (err instanceof PodContractError && (err.httpStatus === 404 || err.httpStatus === 502)) {
        console.warn(`⚠️ [RunPod] POST /produce returned ${err.httpStatus} (proxy stabilization). Retrying in 2s (attempt ${attempt}/5)...`);
        await sleep(2000);
        continue;
      }
      throw err; // Non-transient error, fail immediately
    }
  }

  if (!accepted) {
    throw lastPostErr; // All attempts exhausted
  }

  if (!accepted.job_id) {
    throw new PodContractError("pod /produce returned no job_id");
  }
  const jobId = accepted.job_id;
  console.log(
    `🎬 [RunPod] job ${jobId} queued (brand=${spec.brand}, scenes=${spec.scenes.length})`,
  );

  // Poll /jobs/{jobId} until terminal.
  const MAX_404_RETRIES = 8;
  const BACKOFF_404_MS = 5_000;
  let consecutive404s = 0;

  const deadline = Date.now() + timeoutMs;
  let lastStatus: JobStatus = "queued";
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new PodJobFailedError("produceVideo aborted", jobId, lastStatus);
    }

    let result: JobResult;
    try {
      result = await podFetchJson<JobResult>(
        handle,
        "GET",
        `/jobs/${encodeURIComponent(jobId)}`,
        { signal: options.signal },
      );
      consecutive404s = 0;
    } catch (err) {
      if (err instanceof PodContractError && err.httpStatus === 404) {
        consecutive404s++;
        if (consecutive404s <= MAX_404_RETRIES) {
          console.warn(
            `⚠️ [RunPod] job ${jobId} poll got 404 (${consecutive404s}/${MAX_404_RETRIES}) — worker may have restarted, retrying in ${BACKOFF_404_MS / 1000}s...`,
          );
          await sleep(BACKOFF_404_MS);
          continue;
        }
        throw new PodJobFailedError(
          `Worker lost job ${jobId} after ${MAX_404_RETRIES} consecutive 404s. ` +
          `The pod worker likely crashed (OOM during model loading?) and restarted ` +
          `with empty state. Check RunPod pod logs for SIGKILL / OOM events. ` +
          `Original error: ${err.message}`,
          jobId,
          lastStatus,
        );
      }
      if (err instanceof PodContractError && err.httpStatus !== undefined && err.httpStatus >= 500) {
        console.warn(
          `⚠️ [RunPod] job ${jobId} poll got ${err.httpStatus} — retrying...`,
        );
        await sleep(pollMs);
        continue;
      }
      throw err;
    }

    lastStatus = result.status;
    if (result.status === "done") {
      if (!result.video_url || !result.thumbnail_url || result.duration_s == null) {
        throw new PodJobFailedError(
          `pod reported done but artifact fields missing (video_url=${!!result.video_url}, thumb=${!!result.thumbnail_url}, duration=${result.duration_s})`,
          jobId,
          "done",
        );
      }
      console.log(
        `✅ [RunPod] job ${jobId} done — ${result.duration_s.toFixed(1)}s video`,
      );
      return {
        jobId,
        videoUrl: result.video_url,
        thumbnailUrl: result.thumbnail_url,
        durationS: result.duration_s,
      };
    }
    if (result.status === "failed") {
      throw new PodJobFailedError(
        `pod job failed: ${result.error ?? "no error detail"}`,
        jobId,
        "failed",
      );
    }
    await sleep(pollMs);
  }
  throw new PodJobFailedError(
    `produceVideo timeout after ${timeoutMs}ms (lastStatus=${lastStatus})`,
    jobId,
    lastStatus,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// produceShort — Session 90: Native vertical short production
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a native vertical short job to the pod and poll until complete.
 *
 * Mirrors produceVideo() but POSTs to /produce-short with a ShortJobSpec
 * (pre-extracted audio URL + vertical scene prompts, no TTS needed).
 */
export async function produceShort(
  handle: PodHandle,
  spec: ShortJobSpec,
  options: ProduceVideoOptions = {},
): Promise<ArtifactUrls> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_JOB_POLL_MS;

  // Retry loop for proxy stabilization (same pattern as produceVideo)
  let accepted: ProduceAccepted | undefined;
  let lastPostErr: unknown;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      accepted = await podFetchJson<ProduceAccepted>(
        handle,
        "POST",
        "/produce-short",
        { body: spec, signal: options.signal },
      );
      break;
    } catch (err) {
      lastPostErr = err;
      if (err instanceof PodContractError && (err.httpStatus === 404 || err.httpStatus === 502)) {
        console.warn(`⚠️ [RunPod] POST /produce-short returned ${err.httpStatus}. Retrying (${attempt}/5)...`);
        await sleep(2000);
        continue;
      }
      throw err;
    }
  }

  if (!accepted) throw lastPostErr;
  if (!accepted.job_id) throw new PodContractError("pod /produce-short returned no job_id");

  const jobId = accepted.job_id;
  console.log(
    `🎬 [RunPod] short job ${jobId} queued (brand=${spec.brand}, scenes=${spec.scenes.length}, audio=${spec.audio_duration_s.toFixed(1)}s)`,
  );

  // Poll /jobs/{jobId} until terminal (reuses same endpoint as long-form)
  const MAX_404_RETRIES = 8;
  const BACKOFF_404_MS = 5_000;
  let consecutive404s = 0;

  const deadline = Date.now() + timeoutMs;
  let lastStatus: JobStatus = "queued";
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new PodJobFailedError("produceShort aborted", jobId, lastStatus);
    }

    let result: JobResult;
    try {
      result = await podFetchJson<JobResult>(
        handle,
        "GET",
        `/jobs/${encodeURIComponent(jobId)}`,
        { signal: options.signal },
      );
      consecutive404s = 0;
    } catch (err) {
      if (err instanceof PodContractError && err.httpStatus === 404) {
        consecutive404s++;
        if (consecutive404s <= MAX_404_RETRIES) {
          console.warn(`⚠️ [RunPod] short job ${jobId} poll 404 (${consecutive404s}/${MAX_404_RETRIES})...`);
          await sleep(BACKOFF_404_MS);
          continue;
        }
        throw new PodJobFailedError(
          `Worker lost short job ${jobId} after ${MAX_404_RETRIES} 404s`,
          jobId, lastStatus,
        );
      }
      if (err instanceof PodContractError && err.httpStatus !== undefined && err.httpStatus >= 500) {
        await sleep(pollMs);
        continue;
      }
      throw err;
    }

    lastStatus = result.status;
    if (result.status === "done") {
      if (!result.video_url || !result.thumbnail_url || result.duration_s == null) {
        throw new PodJobFailedError(
          `pod short job done but artifacts missing`,
          jobId, "done",
        );
      }
      console.log(`✅ [RunPod] short ${jobId} done — ${result.duration_s.toFixed(1)}s`);
      return {
        jobId,
        videoUrl: result.video_url,
        thumbnailUrl: result.thumbnail_url,
        durationS: result.duration_s,
      };
    }
    if (result.status === "failed") {
      throw new PodJobFailedError(
        `pod short job failed: ${result.error ?? "no detail"}`,
        jobId, "failed",
      );
    }
    await sleep(pollMs);
  }
  throw new PodJobFailedError(
    `produceShort timeout after ${timeoutMs}ms`,
    jobId, lastStatus,
  );
}


/**
 * Terminate a pod. Safe to call with an unknown pod id (RunPod 404 is
 * swallowed). Best-effort — logs and returns, never throws to the caller.
 */
export async function stopPod(podId: string): Promise<void> {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    console.warn(`[RunPod] stopPod(${podId}) skipped — RUNPOD_API_KEY unset`);
    return;
  }
  try {
    await runpodApi<unknown>("DELETE", `/pods/${encodeURIComponent(podId)}`, apiKey);
    console.log(`\u{1F9F9} [RunPod] pod ${podId} terminated`);
  } catch (err) {
    if (err instanceof RunPodApiError && err.httpStatus === 404) {
      console.warn(`[RunPod] stopPod(${podId}) — pod already gone (404)`);
      return;
    }
    console.error(
      `[RunPod] stopPod(${podId}) failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Authenticated GET /health — GPU + model-load + R2-config snapshot. */
export async function fetchHealth(handle: PodHandle): Promise<HealthReport> {
  return podFetchJson<HealthReport>(handle, "GET", "/health", {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Pod safety net — list + sweep orphans
// ─────────────────────────────────────────────────────────────────────────────

const RUNPOD_GQL_URL = "https://api.runpod.io/graphql";
const SOVEREIGN_POD_PREFIX = "sovereign-worker-";
/** Default max pod age before the sweeper kills it (30 min). */
const DEFAULT_MAX_POD_AGE_S = 30 * 60;

export interface SovereignPodInfo {
  id: string;
  name: string;
  desiredStatus: string;
  uptimeSeconds: number;
}

/**
 * List all sovereign-worker pods on the account via GraphQL.
 * Returns only pods whose name starts with SOVEREIGN_POD_PREFIX.
 */
export async function listSovereignPods(): Promise<SovereignPodInfo[]> {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) return [];

  const query = `{ myself { pods { id name desiredStatus runtime { uptimeInSeconds } } } }`;
  const resp = await fetch(RUNPOD_GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    console.warn(`[RunPod] listSovereignPods HTTP ${resp.status}`);
    return [];
  }
  const body = await resp.json() as {
    data?: { myself?: { pods?: Array<{
      id: string; name: string; desiredStatus: string;
      runtime?: { uptimeInSeconds?: number };
    }> } };
  };
  const allPods = body.data?.myself?.pods ?? [];
  return allPods
    .filter((p) => p.name.startsWith(SOVEREIGN_POD_PREFIX))
    .map((p) => ({
      id: p.id,
      name: p.name,
      desiredStatus: p.desiredStatus,
      uptimeSeconds: p.runtime?.uptimeInSeconds ?? 0,
    }));
}

/**
 * Kill any sovereign-worker pod older than `maxAgeS` seconds.
 * Returns the list of pod IDs terminated.
 *
 * Safe to call from SIGTERM handlers, scheduled sweeps, or ad-hoc cleanup.
 * Skips pods that match `excludePodId` (the currently active session pod).
 */
export async function sweepStalePods(options: {
  maxAgeS?: number;
  excludePodId?: string;
} = {}): Promise<string[]> {
  const maxAge = options.maxAgeS ?? DEFAULT_MAX_POD_AGE_S;
  const pods = await listSovereignPods();
  const stale = pods.filter(
    (p) => p.uptimeSeconds > maxAge && p.id !== options.excludePodId,
  );
  if (stale.length === 0) return [];

  console.log(
    `\u{1F9F9} [RunPod] sweeping ${stale.length} stale pod(s): ${stale.map((p) => `${p.id} (${Math.round(p.uptimeSeconds / 60)}min)`).join(", ")}`,
  );
  const killed: string[] = [];
  for (const pod of stale) {
    await stopPod(pod.id);
    killed.push(pod.id);
  }
  return killed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: pod HTTP (worker Bearer auth)
// ─────────────────────────────────────────────────────────────────────────────

interface PodFetchOptions {
  body?: unknown;
  signal?: AbortSignal;
}

async function podFetchJson<T>(
  handle: PodHandle,
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: PodFetchOptions,
): Promise<T> {
  const url = `${handle.workerUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${handle.workerToken}`,
    Accept: "application/json",
  };
  const init: RequestInit = {
    method,
    headers,
    signal: options.signal ?? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new PodContractError(
      `pod ${method} ${path} → HTTP ${resp.status}: ${text.slice(0, 400)}`,
      resp.status,
    );
  }
  if (!text) {
    // Some endpoints (health/live) can return empty bodies — shouldn't happen
    // on the JSON endpoints but we guard.
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new PodContractError(
      `pod ${method} ${path} returned non-JSON (${err instanceof Error ? err.message : "parse error"}): ${text.slice(0, 200)}`,
      resp.status,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: RunPod REST API (RUNPOD_API_KEY Bearer)
// ─────────────────────────────────────────────────────────────────────────────

interface RunPodPod {
  id?: string;
  podId?: string;
  desiredStatus?: string;
  [extra: string]: unknown;
}

interface RunPodApiOptions {
  body?: unknown;
  signal?: AbortSignal;
}

async function runpodApi<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  apiKey: string,
  options: RunPodApiOptions = {},
): Promise<T> {
  const url = `${RUNPOD_API_BASE}${path}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= DEFAULT_API_RETRIES; attempt++) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      };
      const init: RequestInit = {
        method,
        headers,
        signal: options.signal ?? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      };
      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }

      const resp = await fetch(url, init);
      const text = await resp.text();
      if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
        // Retryable — transient RunPod side.
        lastErr = new RunPodApiError(
          `RunPod ${method} ${path} transient HTTP ${resp.status}`,
          resp.status,
          text.slice(0, 400),
        );
        await sleep(backoffMs(attempt));
        continue;
      }
      if (!resp.ok) {
        throw new RunPodApiError(
          `RunPod ${method} ${path} → HTTP ${resp.status}: ${text.slice(0, 400)}`,
          resp.status,
          text,
        );
      }
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        throw new RunPodApiError(
          `RunPod ${method} ${path} returned non-JSON (${err instanceof Error ? err.message : "parse error"}): ${text.slice(0, 200)}`,
          resp.status,
          text,
        );
      }
    } catch (err) {
      lastErr = err;
      // Abort / user cancellation should not be retried.
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Non-retryable API errors bubble immediately.
      if (err instanceof RunPodApiError && err.httpStatus !== 429 && err.httpStatus < 500) {
        throw err;
      }
      if (attempt >= DEFAULT_API_RETRIES) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new RunPodApiError(`RunPod ${method} ${path} failed after ${DEFAULT_API_RETRIES} attempts`, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: helpers
// ─────────────────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim().length === 0) {
    throw new Error(`runpod-client: required env var ${key} is not set`);
  }
  return v;
}

function parseCsvEnv(key: string): readonly string[] | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parseIntEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function collectPodEnv(extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of POD_ENV_FORWARD_KEYS) {
    const v = process.env[key];
    if (v !== undefined && v.length > 0) out[key] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v;
  }
  return out;
}

function shortTimestamp(): string {
  const d = new Date();
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  // Exponential with jitter — 1s, 2s, 4s, 8s …
  const base = 1_000 * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

function validateJobSpec(spec: JobSpec): void {
  if (!spec || typeof spec !== "object") {
    throw new PodContractError("JobSpec must be an object");
  }
  if (spec.brand !== "ace_richie" && spec.brand !== "containment_field") {
    throw new PodContractError(`JobSpec.brand invalid: ${String(spec.brand)}`);
  }
  if (!spec.niche || spec.niche.length < 1 || spec.niche.length > 120) {
    throw new PodContractError("JobSpec.niche must be 1..120 chars");
  }
  if (!spec.seed || spec.seed.length < 1 || spec.seed.length > 240) {
    throw new PodContractError("JobSpec.seed must be 1..240 chars");
  }
  if (!spec.script || spec.script.length < 10) {
    throw new PodContractError("JobSpec.script must be at least 10 chars");
  }
  if (!Array.isArray(spec.scenes) || spec.scenes.length < 1) {
    throw new PodContractError("JobSpec.scenes must be a non-empty array");
  }
  const indexes = spec.scenes.map((s) => s.index).slice().sort((a, b) => a - b);
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i) {
      throw new PodContractError(
        `JobSpec.scenes indexes must be contiguous 0..${indexes.length - 1} (got ${indexes.join(",")})`,
      );
    }
  }
  for (const s of spec.scenes) {
    if (!s.image_prompt || s.image_prompt.length < 1 || s.image_prompt.length > 2000) {
      throw new PodContractError(`Scene[${s.index}].image_prompt must be 1..2000 chars`);
    }
    if (!s.tts_text || s.tts_text.length < 1 || s.tts_text.length > 4000) {
      throw new PodContractError(`Scene[${s.index}].tts_text must be 1..4000 chars`);
    }
    if (
      s.duration_hint_s !== undefined &&
      s.duration_hint_s !== null &&
      (s.duration_hint_s <= 0 || s.duration_hint_s > 120)
    ) {
      throw new PodContractError(
        `Scene[${s.index}].duration_hint_s must be in (0, 120]`,
      );
    }
  }
  if (spec.client_job_id !== undefined && spec.client_job_id.length > 64) {
    throw new PodContractError("JobSpec.client_job_id must be ≤64 chars");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for Phase 2.4 consumers (withPodSession wrapper)
// ─────────────────────────────────────────────────────────────────────────────
export type {
  ArtifactUrls,
  HealthReport,
  JobResult,
  JobSpec,
  JobStatus,
  PodHandle,
  ProduceAccepted,
  Scene,
  Brand,
} from "./types";
