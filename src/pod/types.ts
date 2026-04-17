// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION — Phase 2 Task 2.2
// Pod Orchestration Types — single source of truth for the Railway ↔ Pod
// contract. Mirrored in pod/models.py (Pydantic) for the FastAPI worker.
//
// If you change a shape here, you MUST update pod/models.py in the same
// commit or the contract falls out of sync and /produce will 422 at runtime.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Brand routing — matches `Brand` enum in pod/models.py. */
export type Brand = "ace_richie" | "containment_field";

/** One scene of a long-form video: an image prompt paired with its TTS chunk. */
export interface Scene {
  /** 0-indexed, contiguous across the scenes[] array. */
  index: number;
  /** FLUX image prompt — 1..2000 chars. */
  image_prompt: string;
  /** TTS text for this scene — 1..4000 chars. */
  tts_text: string;
  /** Optional hint (seconds). Composition may override based on audio length. */
  duration_hint_s?: number;
}

/** POST /produce body — the job spec Railway sends to the pod. */
export interface JobSpec {
  brand: Brand;
  /** Niche tag — gates brand-routing at the render layer (S48 matrix). */
  niche: string;
  /** Alfred's daily seed for this brand. */
  seed: string;
  /** Full long-form script (for continuity / cross-scene cues). */
  script: string;
  /** Scene breakdown — long-form only; shorts come from Phase 5 curator. */
  scenes: Scene[];
  /** Hook text for the opening typewriter overlay (first 8-9 words of hook).
   *  Falls back to first ~9 words of the script if omitted. */
  hook_text?: string;
  /** Optional idempotency key (server accepts up to 64 chars). */
  client_job_id?: string;
}

/** Immediate response from POST /produce (HTTP 202). */
export interface ProduceAccepted {
  job_id: string;
  /** "queued" at creation time. */
  status: JobStatus;
  /** Unix seconds. */
  queued_at: number;
}

/** Lifecycle states emitted by the pod's in-memory job registry. */
export type JobStatus = "queued" | "running" | "done" | "failed";

/** GET /jobs/{job_id} response — polled until terminal. */
export interface JobResult {
  job_id: string;
  status: JobStatus;
  video_url?: string | null;
  thumbnail_url?: string | null;
  duration_s?: number | null;
  error?: string | null;
}

/**
 * Artifact URLs returned by produceVideo() after the job reaches `done`.
 * Null fields from JobResult are narrowed to undefined here — callers should
 * never see null (we only materialize this on terminal success).
 */
export interface ArtifactUrls {
  jobId: string;
  videoUrl: string;
  thumbnailUrl: string;
  durationS: number;
}

/** GET /health response — authenticated readiness probe. */
export interface HealthReport {
  ok: boolean;
  cuda_available: boolean;
  cuda_device_count: number;
  cuda_device_name: string | null;
  models_loaded: Record<string, boolean>;
  uptime_s: number;
  pod_worker_token_configured: boolean;
  r2_configured: boolean;
}

/** Handle returned from startPod() — everything produceVideo() needs. */
export interface PodHandle {
  /** RunPod pod id (use with stopPod). */
  podId: string;
  /** `https://<podId>-8000.proxy.runpod.net` — FastAPI worker base URL. */
  workerUrl: string;
  /** Bearer token for the worker (POD_WORKER_TOKEN). */
  workerToken: string;
  /** Unix seconds at pod creation (for cold-start accounting). */
  createdAt: number;
}

/** Thrown when the pod refuses a job spec at the contract layer. */
export class PodContractError extends Error {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "PodContractError";
  }
}

/** Thrown when the RunPod REST API returns a non-2xx for pod lifecycle ops. */
export class RunPodApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = "RunPodApiError";
  }
}

/** Thrown when a produce job transitions to `failed` or never completes. */
export class PodJobFailedError extends Error {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly lastStatus: JobStatus,
  ) {
    super(message);
    this.name = "PodJobFailedError";
  }
}
