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
import re
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

# ─────────────────────────────────────────────────────────────────────────────
# Opening Sequence (Brand Card + Typewriter) — Phase 5 Task 5.9
# ─────────────────────────────────────────────────────────────────────────────

# Timing (Dopamine Ladder: Stimulation → Captivation)
BRAND_CARD_ANIM_DUR = 1.3    # brand card animation duration (seconds)
TYPEWRITER_DUR = 3.7          # typewriter overlay on settled card (seconds)
OPENING_TOTAL_DUR = 5.0       # BRAND_CARD_ANIM_DUR + TYPEWRITER_DUR
TYPEWRITER_TAIL_FRAC = 0.08   # hold completed text for 8% of typewriter window

# Brand-assets directory (baked into Docker image)
BRAND_ASSETS_DIR = os.environ.get("BRAND_ASSETS_DIR", "/app/brand-assets")

# Font paths (baked into Docker)
FONT_JETBRAINS = os.path.join(BRAND_ASSETS_DIR, "JetBrainsMono-Regular.ttf")
FONT_BEBAS = os.path.join(BRAND_ASSETS_DIR, "BebasNeue-Regular.ttf")
FONT_MONTSERRAT = os.path.join(BRAND_ASSETS_DIR, "Montserrat-SemiBold.ttf")

# Brand card animation files (generated in S70, baked into Docker)
BRAND_CARD_FILES = {
    "ace_richie": os.path.join(BRAND_ASSETS_DIR, "brand_card_ace.mp4"),
    "containment_field": os.path.join(BRAND_ASSETS_DIR, "brand_card_tcf.mp4"),
}

# ASS color format: &HAABBGGRR (alpha, blue, green, red — NOT RGB)
# TCF: clean silver/white text, monospace terminal
# Ace: warm gold accent, premium sans-serif
TYPEWRITER_STYLES = {
    "containment_field": {
        "font": "JetBrains Mono",
        "fontsize": 52,
        "primary_color": "&H00E0E0E0",   # silver-white
        "outline_color": "&H00202020",    # dark outline
        "outline_width": 2.0,
        "shadow_depth": 0,
        "bold": 0,
    },
    "ace_richie": {
        "font": "Montserrat SemiBold",
        "fontsize": 54,
        "primary_color": "&H0080CFFF",   # warm amber-gold (BGR: FF CF 80)
        "outline_color": "&H00102040",    # deep warm outline
        "outline_width": 2.5,
        "shadow_depth": 1,
        "bold": 1,
    },
}


def _extract_hook_text(hook_text: Optional[str], script: str, max_words: int = 9) -> str:
    """
    Get the opening typewriter text. Prefer explicit hook_text from the job spec;
    fall back to the first ~9 words of the full script.
    """
    raw = (hook_text or "").strip()
    if not raw:
        # Fallback: first sentence or first max_words words of script
        raw = script.strip()
    # Take first max_words words
    words = raw.split()[:max_words]
    text = " ".join(words)
    # Strip trailing partial punctuation, ensure clean ending
    text = text.rstrip(",;:—-")
    if not text.endswith((".", "?", "!", "…")):
        text += "."
    return text


def _generate_typewriter_ass(
    text: str,
    brand: str,
    duration_s: float,
    output_path: str,
) -> str:
    """
    Generate an ASS subtitle file with character-by-character typewriter reveal.

    The text types in over (1 - TYPEWRITER_TAIL_FRAC) of duration_s, then holds
    fully revealed for the remaining tail fraction. Positioned center-bottom
    of the brand card still frame (below the logo area).

    Returns the path to the written .ass file.
    """
    style = TYPEWRITER_STYLES.get(brand, TYPEWRITER_STYLES["ace_richie"])

    # Timing: chars reveal over the active window, then hold for tail
    active_dur = duration_s * (1.0 - TYPEWRITER_TAIL_FRAC)
    n_chars = len(text)
    if n_chars == 0:
        n_chars = 1
    char_interval_ms = int((active_dur / n_chars) * 1000)
    # Minimum 30ms per char (prevents invisible speed), max 200ms
    char_interval_ms = max(30, min(char_interval_ms, 200))

    # ASS timestamp format: H:MM:SS.CC (centiseconds)
    def _ts(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        cs = int((s - int(s)) * 100)
        return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"

    # Build the ASS file
    header = f"""[Script Info]
Title: Typewriter Opening
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: {OUT_WIDTH}
PlayResY: {OUT_HEIGHT}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Typewriter,{style['font']},{style['fontsize']},{style['primary_color']},&H000000FF,{style['outline_color']},&H80000000,{style['bold']},0,0,0,100,100,1.5,0,1,{style['outline_width']},{style['shadow_depth']},2,80,80,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    # Build the typewriter line using ASS {\kf} karaoke fade tags
    # Each char gets a \kf duration (in centiseconds) so it "types in"
    karaoke_parts: list[str] = []
    for ch in text:
        # Convert char_interval_ms to centiseconds for ASS \kf tag
        cs_dur = max(1, char_interval_ms // 10)
        # Escape ASS special chars
        if ch == "\\":
            ch = "\\\\"
        elif ch == "{":
            ch = "\\{"
        elif ch == "}":
            ch = "\\}"
        karaoke_parts.append(f"{{\\kf{cs_dur}}}{ch}")

    karaoke_text = "".join(karaoke_parts)

    # Dialogue line: starts at t=0, ends at full typewriter duration
    start_ts = _ts(0.0)
    end_ts = _ts(duration_s)
    dialogue = f"Dialogue: 0,{start_ts},{end_ts},Typewriter,,0,0,0,,{karaoke_text}\n"

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(dialogue)

    log.info("typewriter_ass_generated", path=output_path, chars=n_chars, brand=brand)
    return output_path


def _render_opening_sequence(
    brand: str,
    hook_text: str,
    job_dir: str,
) -> Optional[str]:
    """
    Render the 5.0s opening sequence:
        1. Brand card animation (1.3s mp4) plays as-is
        2. Last frame of brand card extracted as still
        3. Still extended to 3.7s with typewriter .ass overlay burned in
        4. Both parts concatenated into one 5.0s clip

    Returns path to the opening clip, or None if brand card asset is missing.
    """
    brand_card_path = BRAND_CARD_FILES.get(brand)
    if not brand_card_path or not os.path.isfile(brand_card_path):
        log.warning("opening_no_brand_card", brand=brand, expected=brand_card_path)
        return None

    t0 = time.monotonic()

    # ── Step 1: Extract last frame of brand card animation as a still image ──
    last_frame_path = os.path.join(job_dir, "brand_card_last_frame.png")
    extract_cmd = [
        "ffmpeg", "-y",
        "-sseof", "-0.05",       # seek to 50ms before end
        "-i", brand_card_path,
        "-frames:v", "1",
        "-q:v", "1",
        last_frame_path,
    ]
    result = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0 or not os.path.isfile(last_frame_path):
        log.error("opening_frame_extract_failed", stderr=result.stderr[:300])
        return None

    # ── Step 2: Generate typewriter .ass subtitle ──
    ass_path = os.path.join(job_dir, "typewriter.ass")
    _generate_typewriter_ass(
        text=hook_text,
        brand=brand,
        duration_s=TYPEWRITER_DUR,
        output_path=ass_path,
    )

    # ── Step 3: Render the typewriter segment (still frame + .ass overlay) ──
    typewriter_clip = os.path.join(job_dir, "opening_typewriter.mp4")

    # Escape ASS path for ffmpeg subtitles filter (colons and backslashes)
    ass_escaped = ass_path.replace("\\", "/").replace(":", "\\:")

    tw_cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", last_frame_path,
        "-filter_complex",
        (
            f"[0:v]scale={OUT_WIDTH}:{OUT_HEIGHT}:flags=lanczos,"
            f"format=yuv420p,"
            f"subtitles='{ass_escaped}'[v]"
        ),
        "-map", "[v]",
        "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
        "-t", f"{TYPEWRITER_DUR:.3f}",
        "-r", str(OUT_FPS),
        "-an",  # no audio for this segment (audio mixed later in Task 5.11)
        typewriter_clip,
    ]
    result = subprocess.run(tw_cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        log.error("opening_typewriter_render_failed", stderr=result.stderr[:500])
        return None

    # ── Step 4: Re-encode brand card animation to match output specs ──
    card_clip = os.path.join(job_dir, "opening_card.mp4")
    card_cmd = [
        "ffmpeg", "-y",
        "-i", brand_card_path,
        "-vf", f"scale={OUT_WIDTH}:{OUT_HEIGHT}:flags=lanczos,format=yuv420p",
        "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
        "-r", str(OUT_FPS),
        "-t", f"{BRAND_CARD_ANIM_DUR:.3f}",
        "-an",
        card_clip,
    ]
    result = subprocess.run(card_cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        log.error("opening_card_reencode_failed", stderr=result.stderr[:300])
        return None

    # ── Step 5: Concat card animation + typewriter into one opening clip ──
    opening_path = os.path.join(job_dir, "opening_sequence.mp4")
    concat_list = os.path.join(job_dir, "opening_concat.txt")
    with open(concat_list, "w") as f:
        f.write(f"file '{card_clip}'\n")
        f.write(f"file '{typewriter_clip}'\n")

    concat_cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_list,
        "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
        "-movflags", "+faststart",
        "-an",
        opening_path,
    ]
    result = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        log.error("opening_concat_failed", stderr=result.stderr[:300])
        return None

    actual_dur = _probe_duration(opening_path)
    elapsed = time.monotonic() - t0
    log.info(
        "opening_sequence_done",
        brand=brand,
        duration_s=round(actual_dur, 2),
        target_s=OPENING_TOTAL_DUR,
        elapsed_s=round(elapsed, 1),
    )
    return opening_path


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
    hook_text: Optional[str] = None,
    script: str = "",
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
        hook_text: Opening typewriter text. Falls back to first ~9 words of script.
        script: Full script text (used as fallback for hook_text extraction).

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

    # ── Stage 0: Opening Sequence (Brand Card + Typewriter) ───────────────
    opening_clip: Optional[str] = None
    resolved_hook = _extract_hook_text(hook_text, script)
    if resolved_hook:
        opening_clip = _render_opening_sequence(
            brand=brand,
            hook_text=resolved_hook,
            job_dir=job_dir,
        )
        if opening_clip:
            scene_clips.append(opening_clip)
            log.info("compose_opening_prepended", duration_s=OPENING_TOTAL_DUR)
        else:
            log.warning("compose_opening_skipped", reason="render returned None")
    else:
        log.warning("compose_opening_skipped", reason="no hook text available")

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
