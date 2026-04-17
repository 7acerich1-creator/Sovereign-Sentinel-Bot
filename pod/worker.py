"""
PROJECT_POD_MIGRATION — Phase 4 Task 4.1
Sovereign Pod Worker — Real inference + composition.

Contract shape (unchanged from Phase 1 skeleton):
    GET  /health/live  — unauthenticated liveness probe
    GET  /health       — authenticated readiness (GPU + model status)
    POST /produce      — accept a job spec, return 202 with job_id
    GET  /jobs/{id}    — poll for artifact URLs

Phase 4 replaces the stub background task with the real pipeline:
    1. XTTS: synthesize per-scene audio from speaker reference WAV
    2. FLUX.1 [dev]: generate per-scene images at bf16 1024x1024
    3. Compose: Ken Burns + ffmpeg concat + mux -> final MP4
    4. R2: upload video + thumbnail to Cloudflare R2
    5. Return artifact URLs to Railway

Railway's runpod-client.ts polls /jobs/{id} until status=done, then
downloads the artifacts for distribution (YouTube, Buffer, TikTok, IG).
"""
from __future__ import annotations

import logging
import os
import shutil
import time
import uuid
from enum import Enum
from typing import Optional

import structlog
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(format="%(message)s", level=logging.INFO)
structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
)
log = structlog.get_logger("sovereign-pod")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
POD_WORKER_TOKEN = os.environ.get("POD_WORKER_TOKEN", "").strip()
SPEAKERS_DIR = os.environ.get("SPEAKERS_DIR", "/app/brand-assets")
MODEL_CACHE_DIR = os.environ.get("HF_HOME", "/app/cache/huggingface")
JOB_WORK_DIR = os.environ.get("JOB_WORK_DIR", "/tmp/sovereign-jobs")

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_BUCKET_VIDEOS = os.environ.get("R2_BUCKET_VIDEOS", "")
R2_BUCKET_THUMBS = os.environ.get("R2_BUCKET_THUMBS", "")


# ---------------------------------------------------------------------------
# Auth (D4 — Bearer via POD_WORKER_TOKEN)
# ---------------------------------------------------------------------------
def require_bearer(authorization: Optional[str] = Header(default=None)) -> None:
    """Dependency: enforce Authorization: Bearer <POD_WORKER_TOKEN>."""
    if not POD_WORKER_TOKEN:
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


# ---------------------------------------------------------------------------
# Job spec schema — shared contract with Railway runpod-client.ts
# ---------------------------------------------------------------------------
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
    """Railway -> pod job spec (POST /produce)."""
    brand: Brand
    niche: str = Field(min_length=1, max_length=120)
    seed: str = Field(min_length=1, max_length=240)
    script: str = Field(min_length=10)
    scenes: list[Scene] = Field(min_length=1)
    hook_text: Optional[str] = Field(
        default=None, max_length=500,
        description="Opening typewriter text. Falls back to first ~9 words of script.",
    )
    client_job_id: Optional[str] = Field(default=None, max_length=64)

    @field_validator("scenes")
    @classmethod
    def _scene_indexes_contiguous(cls, v: list[Scene]) -> list[Scene]:
        indexes = [s.index for s in v]
        if sorted(indexes) != list(range(len(v))):
            raise ValueError("scene indexes must be contiguous 0..N-1")
        return v


class ProduceAccepted(BaseModel):
    job_id: str
    status: str = "queued"
    queued_at: float


class ProduceResult(BaseModel):
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


# ---------------------------------------------------------------------------
# In-memory job registry
# ---------------------------------------------------------------------------
_JOBS: dict[str, ProduceResult] = {}


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Sovereign Pod Worker",
    version="1.0.0",
    description="Phase 4 real inference + composition pipeline.",
)

_BOOT_TS = time.monotonic()


@app.get("/health/live", tags=["health"])
def liveness() -> dict[str, str]:
    """Unauthenticated liveness probe."""
    return {"status": "alive"}


@app.get("/health", response_model=HealthReport, tags=["health"])
def readiness(_: None = Depends(require_bearer)) -> HealthReport:
    """Authenticated readiness with GPU + model status."""
    cuda_available = False
    device_count = 0
    device_name: Optional[str] = None
    try:
        import torch
        cuda_available = bool(torch.cuda.is_available())
        device_count = torch.cuda.device_count() if cuda_available else 0
        if cuda_available and device_count > 0:
            device_name = torch.cuda.get_device_name(0)
    except Exception as exc:
        log.warning("torch_probe_failed", error=str(exc))

    xtts_ready = False
    flux_ready = False
    try:
        from pipelines.xtts import is_loaded as xtts_check
        xtts_ready = xtts_check()
    except Exception:
        pass
    try:
        from pipelines.flux import is_loaded as flux_check
        flux_ready = flux_check()
    except Exception:
        pass

    r2_ok = False
    try:
        from pipelines.r2 import is_configured as r2_check
        r2_ok = r2_check()
    except Exception:
        pass

    return HealthReport(
        ok=True,
        cuda_available=cuda_available,
        cuda_device_count=device_count,
        cuda_device_name=device_name,
        models_loaded={"xtts_v2": xtts_ready, "flux_1_dev": flux_ready},
        uptime_s=time.monotonic() - _BOOT_TS,
        pod_worker_token_configured=bool(POD_WORKER_TOKEN),
        r2_configured=r2_ok,
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
    """Accept a long-form video production job."""
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
    background.add_task(_run_pipeline, job_id, req)
    return ProduceAccepted(job_id=job_id, queued_at=now)


@app.get("/jobs/{job_id}", response_model=ProduceResult, tags=["pipeline"])
def job_status(job_id: str, _: None = Depends(require_bearer)) -> ProduceResult:
    if job_id not in _JOBS:
        raise HTTPException(status_code=404, detail="unknown job_id")
    return _JOBS[job_id]


# ---------------------------------------------------------------------------
# Real pipeline orchestration — Phase 4 Task 4.1
# ---------------------------------------------------------------------------
def _run_pipeline(job_id: str, req: ProduceRequest) -> None:
    """Full video production: XTTS -> FLUX -> compose -> R2 upload."""
    t0 = time.monotonic()
    job_dir = os.path.join(JOB_WORK_DIR, job_id)

    try:
        _JOBS[job_id] = ProduceResult(job_id=job_id, status="running")
        log.info("pipeline_start", job_id=job_id, brand=req.brand.value)

        os.makedirs(job_dir, exist_ok=True)

        brand = req.brand.value
        scenes_data = [
            {
                "index": s.index,
                "image_prompt": s.image_prompt,
                "tts_text": s.tts_text,
            }
            for s in sorted(req.scenes, key=lambda s: s.index)
        ]

        # Stage 1: XTTS — synthesize all scene audio
        log.info("pipeline_xtts_start", job_id=job_id, scene_count=len(scenes_data))
        from pipelines.xtts import synthesize_scenes
        tts_result = synthesize_scenes(
            scenes=scenes_data,
            brand=brand,
            job_dir=job_dir,
        )
        scene_wavs = tts_result["scene_wavs"]
        durations = tts_result["durations_s"]
        log.info(
            "pipeline_xtts_done",
            job_id=job_id,
            total_s=round(tts_result["total_duration_s"], 2),
        )

        # Stage 2: FLUX — generate all scene images
        log.info("pipeline_flux_start", job_id=job_id, scene_count=len(scenes_data))
        from pipelines.flux import generate_scene_images
        img_result = generate_scene_images(
            scenes=scenes_data,
            job_dir=job_dir,
        )
        scene_images = img_result["scene_images"]
        log.info("pipeline_flux_done", job_id=job_id, count=img_result["count"])

        # Stage 3: Compose — Opening Sequence + Ken Burns + concat -> final MP4
        log.info("pipeline_compose_start", job_id=job_id)
        from pipelines.compose import compose_video
        compose_result = compose_video(
            scene_images=scene_images,
            scene_wavs=scene_wavs,
            durations_s=durations,
            job_dir=job_dir,
            brand=brand,
            hook_text=req.hook_text,
            script=req.script,
        )
        video_path = compose_result["video_path"]
        thumb_path = compose_result["thumbnail_path"]
        duration_s = compose_result["duration_s"]
        log.info("pipeline_compose_done", job_id=job_id, dur_s=round(duration_s, 2))

        # Stage 4: R2 — upload artifacts to Cloudflare R2
        log.info("pipeline_r2_start", job_id=job_id)
        from pipelines.r2 import upload_artifacts, is_configured

        if is_configured():
            r2_result = upload_artifacts(
                video_path=video_path,
                thumbnail_path=thumb_path,
                job_id=job_id,
                brand=brand,
            )
            video_url = r2_result["video_url"]
            thumbnail_url = r2_result["thumbnail_url"]
        else:
            log.warning("pipeline_r2_not_configured", job_id=job_id)
            video_url = f"file://{video_path}"
            thumbnail_url = f"file://{thumb_path}"

        # Done — update job result
        elapsed = time.monotonic() - t0
        _JOBS[job_id] = ProduceResult(
            job_id=job_id,
            status="done",
            video_url=video_url,
            thumbnail_url=thumbnail_url,
            duration_s=duration_s,
        )
        log.info(
            "pipeline_done",
            job_id=job_id,
            video_url=video_url,
            duration_s=round(duration_s, 2),
            elapsed_s=round(elapsed, 1),
        )

    except Exception as exc:
        elapsed = time.monotonic() - t0
        error_msg = f"{type(exc).__name__}: {str(exc)[:500]}"
        log.exception("pipeline_failed", job_id=job_id, elapsed_s=round(elapsed, 1))
        _JOBS[job_id] = ProduceResult(
            job_id=job_id,
            status="failed",
            error=error_msg,
        )

    finally:
        # Cleanup job directory — artifacts are on R2 now
        try:
            if os.path.isdir(job_dir):
                shutil.rmtree(job_dir, ignore_errors=True)
                log.info("pipeline_cleanup", job_id=job_id)
        except Exception:
            pass
