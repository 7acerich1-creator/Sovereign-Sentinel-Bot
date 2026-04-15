"""
PROJECT_POD_MIGRATION — Phase 1 Task 1.3
Sovereign Pod Worker — FastAPI skeleton.

This is the SKELETON. Subsequent Phase 1 / Phase 2 / Phase 4 tasks fill in
the inference, composition, and R2-upload internals. The skeleton locks:

    * contract shape: GET /health/live, GET /health, POST /produce
    * auth: Bearer via env POD_WORKER_TOKEN on /health and /produce
      (liveness /health/live is open so Docker HEALTHCHECK + RunPod
      readiness probes don't need the secret)
    * job spec schema: {brand, niche, seed, script, scenes[]}
    * artifact URL shape: {video_url, thumbnail_url, duration_s, job_id}

Verification (Phase 1 Task 1.3 acceptance):
    uvicorn worker:app --port 8000
    curl http://localhost:8000/health/live                                   -> 200
    curl -H "Authorization: Bearer $POD_WORKER_TOKEN" \\
         http://localhost:8000/health                                         -> 200 + model status
    curl -H "Authorization: Bearer wrong" http://localhost:8000/health        -> 401

Per D1/D2/D5 (PROJECT_POD_MIGRATION.md Open Decisions) the real inference
and upload code lands in:
    pod/pipelines/xtts.py      — XTTSv2 per-chunk, speaker WAV from /runpod-volume/speakers/
    pod/pipelines/flux.py      — FLUX.1 [dev] bf16 1024x1024 @ 30 steps / 3.5 guidance
    pod/pipelines/compose.py   — Ken Burns + ffmpeg concat + mux, audio-validated
    pod/pipelines/r2.py        — Cloudflare R2 (boto3 S3 client, endpoint_url override)
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from enum import Enum
from typing import Optional

import structlog
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(format="%(message)s", level=logging.INFO)
structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
)
log = structlog.get_logger("sovereign-pod")


# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
POD_WORKER_TOKEN = os.environ.get("POD_WORKER_TOKEN", "").strip()
SPEAKERS_DIR = os.environ.get("SPEAKERS_DIR", "/runpod-volume/speakers")
MODEL_CACHE_DIR = os.environ.get("HF_HOME", "/runpod-volume/huggingface")

# Cloudflare R2 — validated at /produce time, not at boot (pod can boot for
# health checks before creds are wired)
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_BUCKET_VIDEOS = os.environ.get("R2_BUCKET_VIDEOS", "")
R2_BUCKET_THUMBS = os.environ.get("R2_BUCKET_THUMBS", "")


# ─────────────────────────────────────────────────────────────────────────────
# Auth (D4 — Bearer via POD_WORKER_TOKEN)
# ─────────────────────────────────────────────────────────────────────────────
def require_bearer(authorization: Optional[str] = Header(default=None)) -> None:
    """Dependency: enforce `Authorization: Bearer <POD_WORKER_TOKEN>`.

    Liveness (/health/live) does NOT use this dependency — it's an open
    probe so Docker HEALTHCHECK and RunPod's platform probes don't need
    to know the secret. All other endpoints do.
    """
    if not POD_WORKER_TOKEN:
        # Fail closed. Boot with POD_WORKER_TOKEN set.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="pod misconfigured: POD_WORKER_TOKEN unset",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    supplied = authorization.removeprefix("Bearer ").strip()
    # Constant-time compare
    if not _safe_eq(supplied, POD_WORKER_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _safe_eq(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    diff = 0
    for x, y in zip(a.encode("utf-8"), b.encode("utf-8")):
        diff |= x ^ y
    return diff == 0


# ─────────────────────────────────────────────────────────────────────────────
# Job spec schema — shared contract with Railway's runpod-client.ts (Task 2.1)
# ─────────────────────────────────────────────────────────────────────────────
class Brand(str, Enum):
    ace_richie = "ace_richie"
    containment_field = "containment_field"


class Scene(BaseModel):
    """One scene of the long-form: image prompt + its TTS chunk."""
    index: int = Field(ge=0)
    image_prompt: str = Field(min_length=1, max_length=2000)
    tts_text: str = Field(min_length=1, max_length=4000)
    duration_hint_s: Optional[float] = Field(default=None, gt=0, le=120)


class ProduceRequest(BaseModel):
    """Railway → pod job spec (POST /produce)."""
    brand: Brand
    niche: str = Field(min_length=1, max_length=120)
    seed: str = Field(min_length=1, max_length=240)
    # Full long-form script (for continuity / cross-scene narration cues)
    script: str = Field(min_length=10)
    # Scene-level breakdown. Long-form only — shorts come from Phase 5
    # curator, which receives the FINISHED long-form artifact, not a
    # separate /produce call.
    scenes: list[Scene] = Field(min_length=1)
    # Optional client-supplied job id for idempotency
    client_job_id: Optional[str] = Field(default=None, max_length=64)

    @field_validator("scenes")
    @classmethod
    def _scene_indexes_contiguous(cls, v: list[Scene]) -> list[Scene]:
        indexes = [s.index for s in v]
        if sorted(indexes) != list(range(len(v))):
            raise ValueError("scene indexes must be contiguous 0..N-1")
        return v


class ProduceAccepted(BaseModel):
    """Immediate response — job is enqueued, check /jobs/{job_id} to poll."""
    job_id: str
    status: str = "queued"
    queued_at: float


class ProduceResult(BaseModel):
    """Final artifact URLs (returned from /jobs/{job_id} when done)."""
    job_id: str
    status: str  # queued | running | done | failed
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration_s: Optional[float] = None
    error: Optional[str] = None


class HealthReport(BaseModel):
    ok: bool
    cuda_available: bool
    cuda_device_count: int
    cuda_device_name: Optional[str]
    models_loaded: dict[str, bool]
    uptime_s: float
    pod_worker_token_configured: bool
    r2_configured: bool


# ─────────────────────────────────────────────────────────────────────────────
# In-memory job registry — skeleton only. Phase 2 Task 2.3 swaps this for
# a proper queue or direct synchronous run depending on final contract.
# ─────────────────────────────────────────────────────────────────────────────
_JOBS: dict[str, ProduceResult] = {}


# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Sovereign Pod Worker",
    version="0.1.0-skeleton",
    description="Phase 1 Task 1.3 — FastAPI skeleton. "
                "Heavy pipelines land in Phase 4.",
)

_BOOT_TS = time.monotonic()


@app.get("/health/live", tags=["health"])
def liveness() -> dict[str, str]:
    """Unauthenticated liveness probe. Does NOT touch the GPU."""
    return {"status": "alive"}


@app.get("/health", response_model=HealthReport, tags=["health"])
def readiness(_: None = Depends(require_bearer)) -> HealthReport:
    """Authenticated readiness — returns GPU + model status."""
    cuda_available = False
    device_count = 0
    device_name: Optional[str] = None
    try:
        import torch  # local import: torch is heavy + only needed here

        cuda_available = bool(torch.cuda.is_available())
        device_count = torch.cuda.device_count() if cuda_available else 0
        if cuda_available and device_count > 0:
            device_name = torch.cuda.get_device_name(0)
    except Exception as exc:  # noqa: BLE001 — diagnostic only
        log.warning("torch_probe_failed", error=str(exc))

    # Phase 1 skeleton: real model load happens in Phase 4 Tasks 4.1 + 4.2.
    # Until then report False so Railway's orchestrator knows this pod is
    # not production-ready even if the process is up.
    return HealthReport(
        ok=True,
        cuda_available=cuda_available,
        cuda_device_count=device_count,
        cuda_device_name=device_name,
        models_loaded={"xtts_v2": False, "flux_1_dev": False},
        uptime_s=time.monotonic() - _BOOT_TS,
        pod_worker_token_configured=bool(POD_WORKER_TOKEN),
        r2_configured=bool(R2_ACCOUNT_ID and R2_BUCKET_VIDEOS and R2_BUCKET_THUMBS),
    )


@app.post(
    "/produce",
    response_model=ProduceAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["pipeline"],
)
def produce(
    req: ProduceRequest,
    background: BackgroundTasks,
    _: None = Depends(require_bearer),
) -> ProduceAccepted:
    """Accept a long-form job spec. Real pipelines attach in Phase 4."""
    job_id = req.client_job_id or f"job_{uuid.uuid4().hex[:16]}"
    now = time.time()
    _JOBS[job_id] = ProduceResult(job_id=job_id, status="queued")
    log.info(
        "produce_accepted",
        job_id=job_id,
        brand=req.brand.value,
        niche=req.niche,
        scene_count=len(req.scenes),
    )
    background.add_task(_run_job_stub, job_id, req)
    return ProduceAccepted(job_id=job_id, queued_at=now)


@app.get("/jobs/{job_id}", response_model=ProduceResult, tags=["pipeline"])
def job_status(job_id: str, _: None = Depends(require_bearer)) -> ProduceResult:
    if job_id not in _JOBS:
        raise HTTPException(status_code=404, detail="unknown job_id")
    return _JOBS[job_id]


# ─────────────────────────────────────────────────────────────────────────────
# Background — SKELETON. Phase 4 swaps in real pipelines (xtts, flux, compose,
# r2 upload). Right now it just transitions state after a short delay so the
# contract end-to-end can be exercised without GPU.
# ─────────────────────────────────────────────────────────────────────────────
def _run_job_stub(job_id: str, req: ProduceRequest) -> None:
    try:
        _JOBS[job_id] = ProduceResult(job_id=job_id, status="running")
        log.info("job_started", job_id=job_id)
        # Simulated work — replaced by real pipeline orchestration in Phase 4.
        time.sleep(1.0)
        _JOBS[job_id] = ProduceResult(
            job_id=job_id,
            status="done",
            video_url=None,  # Phase 4 Task 4.x — real R2 URL
            thumbnail_url=None,
            duration_s=None,
        )
        log.info("job_done_stub", job_id=job_id, brand=req.brand.value)
    except Exception as exc:  # noqa: BLE001
        log.exception("job_failed", job_id=job_id)
        _JOBS[job_id] = ProduceResult(job_id=job_id, status="failed", error=str(exc))
