"""
pod/pipelines/compose.py — Video composition pipeline (Ken Burns + ffmpeg).

Takes per-scene audio WAVs + per-scene images and produces a single muxed
MP4 with Ken Burns pan/zoom on each scene image, audio underneath.

Composition stages:
    1. Per-scene: Ken Burns zoompan on image, duration matched to audio
    2. Concat all scene clips
    3. Mux concatenated video + concatenated audio
    4. Generate thumbnail from a clean scene image
    5. Return final video path + thumbnail path + total duration

Brand overlays (intro, terminal override, captions) are handled HERE so the
Railway orchestrator receives a fully-rendered artifact.
"""
from __future__ import annotations

import math
import os
import random
import subprocess
import time
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger("pipeline.compose")

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# Output specs — 16:9 horizontal for long-form YouTube
OUT_WIDTH = 1920
OUT_HEIGHT = 1080
OUT_FPS = 30
VIDEO_CODEC = "libx264"
VIDEO_PRESET = "medium"   # quality/speed balance — "slow" is better but 3x time
VIDEO_CRF = "20"          # near-lossless, ~5-8 MB/min
AUDIO_CODEC = "aac"
AUDIO_BITRATE = "192k"

# Ken Burns parameters
KB_ZOOM_MIN = 1.00  # start scale
KB_ZOOM_MAX = 1.12  # end scale — subtle, cinematic
KB_PAN_MAX_FRAC = 0.04  # max pan as fraction of dimension


def _probe_duration(path: str) -> float:
    """Get media duration in seconds via ffprobe."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "csv=p=0",
                path,
            ],
            capture_output=True, text=True, timeout=15,
        )
        return float(result.stdout.strip()) if result.stdout.strip() else 0.0
    except Exception:
        return 0.0


def _ken_burns_filter(duration_s: float, scene_idx: int) -> str:
    """
    Build an ffmpeg zoompan filter string for one scene.

    Alternates between zoom-in and zoom-out, with slight random pan offset
    per scene for visual variety. Each scene fills OUT_WIDTH x OUT_HEIGHT.
    """
    total_frames = max(1, int(duration_s * OUT_FPS))

    # Alternate zoom direction per scene
    if scene_idx % 2 == 0:
        # Zoom in: start at KB_ZOOM_MIN, end at KB_ZOOM_MAX
        zoom_expr = f"min({KB_ZOOM_MIN}+(on/{total_frames})*{KB_ZOOM_MAX - KB_ZOOM_MIN},{KB_ZOOM_MAX})"
    else:
        # Zoom out: start at KB_ZOOM_MAX, end at KB_ZOOM_MIN
        zoom_expr = f"max({KB_ZOOM_MAX}-(on/{total_frames})*{KB_ZOOM_MAX - KB_ZOOM_MIN},{KB_ZOOM_MIN})"

    # Slight pan offset — deterministic per scene index for reproducibility
    rng = random.Random(scene_idx * 42)
    pan_x_frac = rng.uniform(-KB_PAN_MAX_FRAC, KB_PAN_MAX_FRAC)
    pan_y_frac = rng.uniform(-KB_PAN_MAX_FRAC, KB_PAN_MAX_FRAC)

    # Pan expressions: center + slight drift
    x_expr = f"iw/2-(iw/zoom/2)+({pan_x_frac}*iw*on/{total_frames})"
    y_expr = f"ih/2-(ih/zoom/2)+({pan_y_frac}*ih*on/{total_frames})"

    return (
        f"zoompan=z='{zoom_expr}':x='{x_expr}':y='{y_expr}'"
        f":d={total_frames}:s={OUT_WIDTH}x{OUT_HEIGHT}:fps={OUT_FPS}"
    )


def compose_video(
    scene_images: list[str],
    scene_wavs: list[str],
    durations_s: list[float],
    job_dir: str,
    brand: str,
    thumbnail_scene_idx: int = 1,
) -> dict:
    """
    Assemble a full long-form video from per-scene images + audio.

    Args:
        scene_images: Ordered list of image paths (one per scene).
        scene_wavs: Ordered list of WAV paths (one per scene).
        durations_s: Per-scene audio durations in seconds.
        job_dir: Working directory for intermediate files.
        brand: 'ace_richie' or 'containment_field'.
        thumbnail_scene_idx: Which scene image to use for the thumbnail.

    Returns:
        {
            "video_path": "/path/to/final.mp4",
            "thumbnail_path": "/path/to/thumb.jpg",
            "duration_s": 342.5,
        }
    """
    t0 = time.monotonic()
    n_scenes = min(len(scene_images), len(scene_wavs), len(durations_s))
    log.info("compose_start", scene_count=n_scenes, brand=brand)

    scene_clips: list[str] = []

    # ── Stage 1: Per-scene Ken Burns clips ────────────────────────────────
    for i in range(n_scenes):
        img = scene_images[i]
        wav = scene_wavs[i]
        dur = durations_s[i]
        clip_path = os.path.join(job_dir, f"clip_{i:03d}.mp4")

        if dur <= 0:
            log.warning("compose_skip_zero_dur", index=i)
            continue

        if not os.path.isfile(img):
            log.warning("compose_missing_image", index=i, path=img)
            continue

        kb_filter = _ken_burns_filter(dur, i)

        # Build the scene clip: Ken Burns on image, muxed with its audio
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-i", img,        # image input (looped)
            "-i", wav,                        # audio input
            "-filter_complex",
            # Scale image to 2x output res first (gives zoompan room to pan/zoom
            # without hitting edges), then apply Ken Burns, then ensure pixel format
            f"[0:v]scale={OUT_WIDTH * 2}:{OUT_HEIGHT * 2}:flags=lanczos,"
            f"{kb_filter},format=yuv420p[v]",
            "-map", "[v]", "-map", "1:a",
            "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
            "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE,
            "-t", f"{dur:.3f}",
            "-shortest",
            clip_path,
        ]

        log.info("compose_scene", index=i, duration_s=round(dur, 2))
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=max(120, int(dur * 10)),  # generous timeout
        )
        if result.returncode != 0:
            log.error(
                "compose_scene_failed",
                index=i,
                stderr=result.stderr[:500] if result.stderr else "",
            )
            # Try a simpler fallback: static image + audio, no Ken Burns
            fallback_cmd = [
                "ffmpeg", "-y",
                "-loop", "1", "-i", img,
                "-i", wav,
                "-filter_complex",
                f"[0:v]scale={OUT_WIDTH}:{OUT_HEIGHT}:flags=lanczos,format=yuv420p[v]",
                "-map", "[v]", "-map", "1:a",
                "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
                "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE,
                "-t", f"{dur:.3f}",
                "-shortest",
                clip_path,
            ]
            fallback_result = subprocess.run(
                fallback_cmd, capture_output=True, text=True,
                timeout=max(120, int(dur * 10)),
            )
            if fallback_result.returncode != 0:
                log.error("compose_fallback_failed", index=i)
                continue

        scene_clips.append(clip_path)

    if not scene_clips:
        raise RuntimeError("compose: zero scene clips produced — cannot assemble video")

    # ── Stage 2: Concat all scene clips ──────────────────────────────────
    concat_list_path = os.path.join(job_dir, "video_concat.txt")
    with open(concat_list_path, "w") as f:
        for clip in scene_clips:
            f.write(f"file '{clip}'\n")

    final_path = os.path.join(job_dir, "final.mp4")

    concat_cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_list_path,
        "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
        "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",  # web-optimized — allows streaming before full download
        final_path,
    ]

    log.info("compose_concat", clip_count=len(scene_clips))
    result = subprocess.run(
        concat_cmd, capture_output=True, text=True,
        timeout=600,  # up to 10 min for long videos
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"compose concat failed: {result.stderr[:500] if result.stderr else 'unknown error'}"
        )

    # ── Stage 3: Probe final duration ────────────────────────────────────
    total_duration = _probe_duration(final_path)
    log.info("compose_final_duration", duration_s=round(total_duration, 2))

    # ── Stage 4: Generate thumbnail ──────────────────────────────────────
    thumb_path = os.path.join(job_dir, "thumbnail.jpg")
    thumb_idx = min(thumbnail_scene_idx, n_scenes - 1)
    thumb_src = scene_images[thumb_idx] if thumb_idx < len(scene_images) else scene_images[0]

    try:
        # Scale to 1280x720 (YouTube recommended thumbnail size) + high quality JPEG
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", thumb_src,
                "-vf", f"scale=1280:720:flags=lanczos",
                "-q:v", "2",  # high quality JPEG
                thumb_path,
            ],
            capture_output=True, text=True, timeout=30,
            check=True,
        )
    except Exception as exc:
        log.warning("compose_thumbnail_failed", error=str(exc))
        # Fallback: copy the raw image as thumbnail
        import shutil
        shutil.copy2(thumb_src, thumb_path)

    elapsed = time.monotonic() - t0
    log.info(
        "compose_done",
        duration_s=round(total_duration, 2),
        elapsed_s=round(elapsed, 1),
        scene_count=len(scene_clips),
    )

    return {
        "video_path": final_path,
        "thumbnail_path": thumb_path,
        "duration_s": total_duration,
    }
