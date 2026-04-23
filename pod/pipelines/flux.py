"""
pod/pipelines/flux.py — FLUX.1 [dev] image generation pipeline.

Per D2 (PROJECT_POD_MIGRATION.md):
    FLUX.1 [dev] at bf16 full precision, native 1024x1024, 30 steps, guidance 3.5

Loads the model once (lazy singleton), generates images for each scene's
image_prompt. Returns paths to the generated PNGs.

GPU requirement: 48GB VRAM (L40S/A6000) for FLUX.1 [dev] bf16 + XTTS + Whisper
loaded concurrently (~31GB peak). S90 cost optimization downgraded from 80GB
cards — same output quality at ~60% lower cost.
"""
from __future__ import annotations

import os
import time
from typing import Optional

import structlog
import torch

log = structlog.get_logger("pipeline.flux")

# ─────────────────────────────────────────────────────────────────────────────
# NSFW Safety Gate — NudeNet v3 post-generation classifier (S107)
# Catches nudity/near-nudity BEFORE images enter the video pipeline.
# Threshold: 0.65 = flag for regeneration. YouTube channel ban prevention.
# ─────────────────────────────────────────────────────────────────────────────
NSFW_THRESHOLD = 0.65
NSFW_MAX_RETRIES = 1  # One retry with safety-appended prompt, then fallback
_nsfw_detector = None


def _load_nsfw_detector():
    """Lazy-load NudeNet classifier. ~200ms per image inference."""
    global _nsfw_detector
    if _nsfw_detector is not None:
        return _nsfw_detector
    try:
        from nudenet import NudeDetector
        _nsfw_detector = NudeDetector()
        log.info("nudenet_loaded")
    except ImportError:
        log.warning("nudenet_not_installed", msg="pip install nudenet>=3.4.2 — NSFW gate disabled")
        _nsfw_detector = False  # Sentinel: tried and failed
    except Exception as e:
        log.error("nudenet_load_failed", error=str(e))
        _nsfw_detector = False
    return _nsfw_detector


def _check_nsfw(image_path: str) -> tuple[bool, float]:
    """
    Check an image for NSFW content using NudeNet.
    Returns (is_nsfw: bool, max_score: float).
    """
    detector = _load_nsfw_detector()
    if detector is False:
        return False, 0.0  # Detector unavailable — pass through

    try:
        detections = detector.detect(image_path)
        # NudeNet returns list of dicts with 'class' and 'score'
        # Unsafe classes: anything involving exposed body parts
        unsafe_classes = {
            "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED",
            "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED",
            "ANUS_EXPOSED", "BELLY_EXPOSED",
        }
        max_score = 0.0
        for det in detections:
            cls = det.get("class", "")
            score = det.get("score", 0.0)
            if cls in unsafe_classes and score > max_score:
                max_score = score

        is_nsfw = max_score >= NSFW_THRESHOLD
        if is_nsfw:
            log.warning("nsfw_detected", path=image_path, max_score=round(max_score, 3),
                        detections=[d for d in detections if d.get("class") in unsafe_classes])
        return is_nsfw, max_score
    except Exception as e:
        log.error("nsfw_check_failed", path=image_path, error=str(e))
        return False, 0.0  # Fail open — don't block pipeline on classifier errors

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

        # SESSION 88: FLUX.1 [dev] uses T5-XXL (512 tokens), NOT CLIP (77 tokens).
        # S84 truncated to 70 words citing CLIP — incorrect for FLUX architecture.
        # T5-XXL comfortably handles ~400 words. Raised cap to preserve cinematography
        # tokens (kodak, f/2.8, chiaroscuro, etc.) that were being cut at 70 words.
        prompt = " ".join(prompt.split()[:400])

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

        # ── NSFW Safety Gate (S107) ──
        is_nsfw, nsfw_score = _check_nsfw(out_path)
        if is_nsfw:
            log.warning("nsfw_retry", index=idx, score=round(nsfw_score, 3))
            # Retry with clothing/safety suffix appended
            safe_prompt = prompt + ", fully clothed professional setting, no exposed skin, safe for all audiences"
            safe_prompt = " ".join(safe_prompt.split()[:400])
            retry_result = _pipe(
                prompt=safe_prompt,
                width=width,
                height=height,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
                generator=generator,
                num_images_per_prompt=1,
            )
            retry_image = retry_result.images[0]
            retry_image.save(out_path, format="PNG")

            is_nsfw_2, nsfw_score_2 = _check_nsfw(out_path)
            if is_nsfw_2:
                log.error("nsfw_hard_fail", index=idx, score=round(nsfw_score_2, 3),
                          msg="2nd attempt still NSFW — generating environment-only fallback")
                # Generate a safe environment-only image as fallback
                fallback_prompt = (
                    "Cinematic wide shot of an empty room with warm tungsten lighting, "
                    "architectural interior, no people, no figures, no faces, no skin, "
                    "dark void background, photorealistic, ARRI Alexa 65, shallow depth of field"
                )
                fb_result = _pipe(
                    prompt=fallback_prompt,
                    width=width,
                    height=height,
                    num_inference_steps=num_steps,
                    guidance_scale=guidance_scale,
                    generator=generator,
                    num_images_per_prompt=1,
                )
                fb_result.images[0].save(out_path, format="PNG")
                log.info("nsfw_fallback_used", index=idx)
            else:
                log.info("nsfw_retry_passed", index=idx, score=round(nsfw_score_2, 3))

        elapsed = time.monotonic() - t1
        log.info("flux_scene_done", index=idx, elapsed_s=round(elapsed, 2))
        scene_images.append(out_path)

    log.info("flux_generate_done", count=len(scene_images))

    return {
        "scene_images": scene_images,
        "count": len(scene_images),
    }
