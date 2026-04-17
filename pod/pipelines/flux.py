"""
pod/pipelines/flux.py — FLUX.1 [dev] image generation pipeline.

Per D2 (PROJECT_POD_MIGRATION.md):
    FLUX.1 [dev] at bf16 full precision, native 1024x1024, 30 steps, guidance 3.5

Loads the model once (lazy singleton), generates images for each scene's
image_prompt. Returns paths to the generated PNGs.

GPU requirement: 80GB VRAM (H100/A100 SXM) for FLUX.1 [dev] bf16 + XTTS
loaded concurrently. On smaller GPUs the model will OOM — that's expected
and by design (D1 locked on 80GB).
"""
from __future__ import annotations

import os
import time
from typing import Optional

import structlog
import torch

log = structlog.get_logger("pipeline.flux")

# ─────────────────────────────────────────────────────────────────────────────
# Lazy model singleton
# ─────────────────────────────────────────────────────────────────────────────
_pipe = None

# D2 locked parameters
FLUX_MODEL_ID = "black-forest-labs/FLUX.1-dev"
FLUX_WIDTH = 1024
FLUX_HEIGHT = 1024
FLUX_STEPS = 30
FLUX_GUIDANCE = 3.5
FLUX_DTYPE = torch.bfloat16


def load_model() -> None:
    """Load FLUX.1 [dev] into GPU memory. Idempotent."""
    global _pipe
    if _pipe is not None:
        return

    t0 = time.monotonic()
    cache_dir = os.environ.get("HF_HOME", "/app/cache/huggingface")
    hf_token = os.environ.get("HF_TOKEN", "").strip() or None

    # SESSION 80: FLUX.1 [dev] is a GATED model on HuggingFace. Without a
    # valid HF_TOKEN + accepted license, from_pretrained will fail with a
    # cryptic 403. Surface this explicitly BEFORE the slow download starts.
    if not hf_token:
        log.error(
            "flux_hf_token_missing",
            msg="HF_TOKEN env var not set. FLUX.1 [dev] is a gated model — "
            "download WILL fail with 403. Set HF_TOKEN and accept the license "
            "at https://huggingface.co/black-forest-labs/FLUX.1-dev",
        )
        raise RuntimeError(
            "HF_TOKEN not set — cannot download gated model FLUX.1 [dev]. "
            "Set HF_TOKEN env var and accept license at "
            "https://huggingface.co/black-forest-labs/FLUX.1-dev"
        )

    log.info("flux_loading", model=FLUX_MODEL_ID, dtype="bf16", cache_dir=cache_dir, hf_token_set=True)

    from diffusers import FluxPipeline

    _pipe = FluxPipeline.from_pretrained(
        FLUX_MODEL_ID,
        torch_dtype=FLUX_DTYPE,
        cache_dir=cache_dir,
        token=hf_token,  # Explicit token pass — don't rely on env auto-detection
    )

    if torch.cuda.is_available():
        _pipe = _pipe.to("cuda")
    else:
        log.warning("flux_no_cuda", msg="Running on CPU — expect slow generation")

    # Enable memory-efficient attention if available
    try:
        _pipe.enable_xformers_memory_efficient_attention()
        log.info("flux_xformers_enabled")
    except Exception:
        # xformers not installed or not compatible — FLUX works fine without it
        # on 80GB VRAM, just slightly less memory-efficient
        pass

    elapsed = time.monotonic() - t0
    log.info("flux_loaded", elapsed_s=round(elapsed, 1))


def is_loaded() -> bool:
    return _pipe is not None


def generate_scene_images(
    scenes: list[dict],
    job_dir: str,
    width: int = FLUX_WIDTH,
    height: int = FLUX_HEIGHT,
    num_steps: int = FLUX_STEPS,
    guidance_scale: float = FLUX_GUIDANCE,
    seed: Optional[int] = None,
) -> dict:
    """
    Generate images for each scene's image_prompt.

    Args:
        scenes: List of scene dicts with 'index' and 'image_prompt'.
        job_dir: Directory to write output PNGs.
        width/height: Output dimensions (D2: 1024x1024).
        num_steps: Denoising steps (D2: 30).
        guidance_scale: CFG scale (D2: 3.5).
        seed: Optional reproducibility seed.

    Returns:
        {
            "scene_images": ["/path/to/scene_000.png", ...],
            "count": 12,
        }
    """
    load_model()
    assert _pipe is not None, "FLUX model failed to load"

    log.info(
        "flux_generate_start",
        scene_count=len(scenes),
        resolution=f"{width}x{height}",
        steps=num_steps,
        guidance=guidance_scale,
    )

    sorted_scenes = sorted(scenes, key=lambda s: s["index"])
    scene_images: list[str] = []

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu")
        generator.manual_seed(seed)

    for scene in sorted_scenes:
        idx = scene["index"]
        prompt = scene["image_prompt"]
        out_path = os.path.join(job_dir, f"scene_{idx:03d}.png")

        t1 = time.monotonic()
        log.info("flux_scene_start", index=idx, prompt_len=len(prompt))

        # Generate with FLUX.1 [dev]
        result = _pipe(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=num_steps,
            guidance_scale=guidance_scale,
            generator=generator,
            num_images_per_prompt=1,
        )

        image = result.images[0]
        image.save(out_path, format="PNG")

        elapsed = time.monotonic() - t1
        log.info("flux_scene_done", index=idx, elapsed_s=round(elapsed, 2))
        scene_images.append(out_path)

    log.info("flux_generate_done", count=len(scene_images))

    return {
        "scene_images": scene_images,
        "count": len(scene_images),
    }
