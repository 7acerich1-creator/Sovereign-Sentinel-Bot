"""
PROJECT_POD_MIGRATION — Phase 2 Task 2.2
Pod Orchestration Models — Pydantic mirror of src/pod/types.ts.

These are the SINGLE SOURCE OF TRUTH for the Railway ↔ Pod contract. When
pod/worker.py is rewritten in Phase 4 (real XTTS/FLUX/compose pipelines), it
will import from this module instead of redefining inline. For the Phase 1
skeleton it currently redefines — that drift is intentional and temporary;
the Phase 4 worker rewrite will collapse to `from .models import ...`.

If you change a shape here, you MUST update src/pod/types.ts in the same
commit or the /produce endpoint will 422 at runtime.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class Brand(str, Enum):
    """Brand routing — mirrors `Brand` union in src/pod/types.ts."""

    sovereign_synthesis = "sovereign_synthesis"
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
    script: str = Field(min_length=10)
    scenes: list[Scene] = Field(min_length=1)
    hook_text: Optional[str] = Field(
        default=None, max_length=500,
        description="Opening typewriter text (first 8-9 words of hook). Falls back to first ~9 words of script.",
    )
    thumbnail_text: Optional[str] = Field(
        default=None, max_length=150,
        description="DEPRECATED S117 — use thumbnail_headline + thumbnail_subhead. "
                    "Kept for backward compat with in-flight scripts.",
    )
    thumbnail_headline: Optional[str] = Field(
        default=None, max_length=40,
        description="S117: 4-6 word ALL CAPS pain-point headline. Upper text zone of "
                    "the brand-frame thumbnail layout. Complete standalone statement.",
    )
    thumbnail_subhead: Optional[str] = Field(
        default=None, max_length=80,
        description="S117: 4-8 word italic Title Case amplifier. Lower text zone, "
                    "smaller font. Names the WHY or consequence.",
    )
    client_job_id: Optional[str] = Field(default=None, max_length=200)

    @field_validator("scenes")
    @classmethod
    def _scene_indexes_contiguous(cls, v: list[Scene]) -> list[Scene]:
        indexes = [s.index for s in v]
        if sorted(indexes) != list(range(len(v))):
            raise ValueError("scene indexes must be contiguous 0..N-1")
        return v


class ProduceAccepted(BaseModel):
    """Immediate response to POST /produce — job enqueued, poll /jobs/{id}."""

    job_id: str
    status: str = "queued"
    queued_at: float


class ProduceResult(BaseModel):
    """Final artifact URLs (returned from GET /jobs/{job_id})."""

    job_id: str
    status: str  # queued | running | done | failed
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration_s: Optional[float] = None
    error: Optional[str] = None


class HealthReport(BaseModel):
    """Authenticated GET /health — GPU + model-load + R2-config snapshot."""

    ok: bool
    cuda_available: bool
    cuda_device_count: int
    cuda_device_name: Optional[str]
    models_loaded: dict[str, bool]
    uptime_s: float
    pod_worker_token_configured: bool
    r2_configured: bool


# ── SESSION 104: Image Batch Generation (Content Engine) ──

class ImageBatchItem(BaseModel):
    """One image request in a batch."""
    id: str = Field(min_length=1, max_length=200, description="Caller's row ID (e.g., content_engine_queue UUID)")
    prompt: str = Field(min_length=1, max_length=2000, description="FLUX image prompt")
    width: int = Field(default=1024, ge=256, le=2048)
    height: int = Field(default=1024, ge=256, le=2048)


class ImageBatchRequest(BaseModel):
    """POST /generate-images — batch FLUX image generation for Content Engine."""
    items: list[ImageBatchItem] = Field(min_length=1, max_length=50)
    brand: Brand = Brand.sovereign_synthesis


class ImageBatchResultItem(BaseModel):
    """One result from the batch."""
    id: str
    url: Optional[str] = None
    error: Optional[str] = None


class ImageBatchResult(BaseModel):
    """Response from POST /generate-images."""
    generated: int
    failed: int
    results: list[ImageBatchResultItem]
