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
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import structlog
import tempfile

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
# SESSION 85: Intermediate audio stays lossless PCM to prevent generation loss.
# AAC encode happens ONCE at the final mux only.
INTERMEDIATE_AUDIO_CODEC = "pcm_s16le"

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



# --------------------------------------------------------------------------
# Kinetic Captions -- Phase 5 Task 5.10
# --------------------------------------------------------------------------
# GPU Whisper word-level transcription -> 2-4 word bursts -> .ass -> ffmpeg burn.
# Green opaque-box captions are DEAD. New style: premium editorial, no box plate.
#
# TCF:  Bebas Neue uppercase, thin dark outline only, crisp white/silver.
# Ace:  Montserrat SemiBold mixed-case, warm outline, soft shadow.

CAPTION_WORDS_PER_BURST = (2, 4)
CAPTION_MIN_DURATION_S = 0.25
CAPTION_GAP_S = 0.02

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3")

CAPTION_STYLES = {
    "containment_field": {
        "font": "Bebas Neue",
        "fontsize": 72,
        "primary_color": "&H00F0F0F0",
        "outline_color": "&H00101010",
        "outline_width": 2.0,
        "shadow_depth": 0,
        "bold": 0,
        "uppercase": True,
        "border_style": 1,
        "anim_in_ms": 120,
        "anim_scale_start": 95,
    },
    "ace_richie": {
        "font": "Montserrat SemiBold",
        "fontsize": 68,
        "primary_color": "&H0080CFFF",
        "outline_color": "&H00102040",
        "outline_width": 2.5,
        "shadow_depth": 2,
        "bold": 1,
        "uppercase": False,
        "border_style": 1,
        "anim_in_ms": 180,
        "anim_scale_start": 90,
    },
}


def _transcribe_word_timestamps(audio_path: str) -> list[dict]:
    """Run faster-whisper on GPU to get word-level timestamps."""
    from faster_whisper import WhisperModel

    log.info("whisper_start", model=WHISPER_MODEL, audio=audio_path)
    t0 = time.monotonic()

    model = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16")
    segments, info = model.transcribe(
        audio_path, beam_size=5, word_timestamps=True, language="en",
    )

    words: list[dict] = []
    for segment in segments:
        if segment.words:
            for w in segment.words:
                words.append({"word": w.word.strip(), "start": w.start, "end": w.end})

    elapsed = time.monotonic() - t0
    log.info("whisper_done", word_count=len(words),
             audio_duration_s=round(info.duration, 1), elapsed_s=round(elapsed, 1))
    return words


def _chunk_words_into_bursts(
    words: list[dict],
    min_words: int = CAPTION_WORDS_PER_BURST[0],
    max_words: int = CAPTION_WORDS_PER_BURST[1],
) -> list[dict]:
    """Group word-level timestamps into 2-4 word caption bursts."""
    bursts: list[dict] = []
    buf_words: list[dict] = []

    def _flush():
        if not buf_words:
            return
        text = " ".join(w["word"] for w in buf_words)
        start = buf_words[0]["start"]
        end = buf_words[-1]["end"]
        dur = max(CAPTION_MIN_DURATION_S, end - start)
        bursts.append({"text": text, "start": start, "end": start + dur})
        buf_words.clear()

    for w in words:
        buf_words.append(w)
        is_end = w["word"].rstrip().endswith((".", "?", "!"))
        if len(buf_words) >= max_words or (len(buf_words) >= min_words and is_end):
            _flush()

    _flush()
    return bursts


def _generate_caption_ass(
    bursts: list[dict], brand: str, skip_until_s: float, output_path: str,
    audio_end_s: Optional[float] = None,
) -> str:
    """Generate ASS subtitle file from caption bursts with brand-specific styling.

    Args:
        audio_end_s: Hard ceiling -- no subtitle event may extend past this
                     timestamp.  Prevents ghost captions in dead-air padding.
    """
    style = CAPTION_STYLES.get(brand, CAPTION_STYLES["ace_richie"])

    def _ts(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        cs = int((s - int(s)) * 100)
        return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"

    ass_lines = []
    ass_lines.append("[Script Info]")
    ass_lines.append("Title: Kinetic Captions")
    ass_lines.append("ScriptType: v4.00+")
    ass_lines.append("WrapStyle: 0")
    ass_lines.append("ScaledBorderAndShadow: yes")
    ass_lines.append("YCbCr Matrix: TV.709")
    ass_lines.append(f"PlayResX: {OUT_WIDTH}")
    ass_lines.append(f"PlayResY: {OUT_HEIGHT}")
    ass_lines.append("")
    ass_lines.append("[V4+ Styles]")
    ass_lines.append("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding")
    ass_lines.append(
        f"Style: Caption,{style['font']},{style['fontsize']},{style['primary_color']},"
        f"&HFF000000,{style['outline_color']},&H00000000,{style['bold']},"
        f"0,0,0,100,100,2.0,0,{style['border_style']},{style['outline_width']},"
        f"{style['shadow_depth']},2,80,80,100,1"
    )
    ass_lines.append("")
    ass_lines.append("[Events]")
    ass_lines.append("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")

    anim_ms = style.get("anim_in_ms", 150)
    scale_start = style.get("anim_scale_start", 90)

    dialogue_lines: list[str] = []
    for burst in bursts:
        if burst["end"] <= skip_until_s:
            continue
        # SESSION 83: Hard-cap to audio boundary -- zero ghost frames
        if audio_end_s is not None and burst["start"] >= audio_end_s:
            continue  # burst starts after audio ends -- Whisper hallucination
        start = max(burst["start"], skip_until_s)
        end = burst["end"] + CAPTION_GAP_S
        if audio_end_s is not None:
            end = min(end, audio_end_s)
        if end <= start:
            continue  # degenerate burst after capping
        text = burst["text"]
        if style.get("uppercase"):
            text = text.upper()
        text = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
        anim_tag = (
            "{\\" + f"fscx{scale_start}" + "\\" + f"fscy{scale_start}"
            + "\\" + f"t(0,{anim_ms}," + "\\" + "fscx100" + "\\" + "fscy100)}"
        )
        start_ts = _ts(start)
        end_ts = _ts(end)
        dialogue_lines.append(
            f"Dialogue: 0,{start_ts},{end_ts},Caption,,0,0,0,,{anim_tag}{text}"
        )

    with open(output_path, "w", encoding="utf-8") as f:
        for line in ass_lines:
            f.write(line + "\n")
        for line in dialogue_lines:
            f.write(line + "\n")

    log.info("caption_ass_generated", path=output_path, burst_count=len(dialogue_lines),
             brand=brand, skipped_before_s=skip_until_s)
    return output_path


def _burn_captions(video_path: str, ass_path: str, output_path: str) -> str:
    """Burn ASS captions onto a video using ffmpeg subtitles filter."""
    ass_escaped = ass_path.replace("\\", "/").replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"subtitles='{ass_escaped}'",
        "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
        "-c:a", "copy",
        "-movflags", "+faststart",
        output_path,
    ]
    log.info("caption_burn_start", video=video_path, ass=ass_path)
    t0 = time.monotonic()
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        log.error("caption_burn_failed", stderr=result.stderr[:500] if result.stderr else "")
        raise RuntimeError(
            f"Caption burn failed: {result.stderr[:300] if result.stderr else 'unknown'}"
        )
    elapsed = time.monotonic() - t0
    log.info("caption_burn_done", output=output_path, elapsed_s=round(elapsed, 1))
    return output_path


def _extract_audio_from_video(video_path: str, output_wav: str) -> str:
    """Extract audio track from video as WAV for Whisper processing."""
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        output_wav,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(
            f"Audio extraction failed: {result.stderr[:300] if result.stderr else 'unknown'}"
        )
    return output_wav


def generate_and_burn_captions(
    video_path: str, brand: str, job_dir: str,
    skip_until_s: float = OPENING_TOTAL_DUR,
    audio_duration_s: Optional[float] = None,
) -> str:
    """
    Full kinetic caption pipeline:
        1. Extract audio from concatenated video
        2. Run GPU Whisper for word-level timestamps
        3. Chunk into 2-4 word kinetic bursts
        4. Generate brand-specific .ass file
        5. Burn captions onto video
    Returns path to the captioned video.

    Args:
        audio_duration_s: Total audio duration (opening + narration).
                          Passed to ASS generator to kill ghost captions.
    """
    t0 = time.monotonic()
    log.info("captions_pipeline_start", brand=brand, skip_until_s=skip_until_s,
             audio_ceiling_s=audio_duration_s)

    audio_wav = os.path.join(job_dir, "captions_audio.wav")
    _extract_audio_from_video(video_path, audio_wav)

    words = _transcribe_word_timestamps(audio_wav)
    if not words:
        log.warning("captions_no_words", reason="Whisper returned zero words")
        return video_path

    bursts = _chunk_words_into_bursts(words)
    if not bursts:
        log.warning("captions_no_bursts", reason="chunking produced zero bursts")
        return video_path

    ass_path = os.path.join(job_dir, "captions.ass")
    _generate_caption_ass(bursts, brand, skip_until_s, ass_path,
                          audio_end_s=audio_duration_s)

    captioned_path = os.path.join(job_dir, "final_captioned.mp4")
    _burn_captions(video_path, ass_path, captioned_path)

    elapsed = time.monotonic() - t0
    log.info("captions_pipeline_done", brand=brand,
             burst_count=len(bursts), elapsed_s=round(elapsed, 1))
    return captioned_path



# --------------------------------------------------------------------------
# Composite Audio Mixing -- Phase 5 Task 5.11
# --------------------------------------------------------------------------
# Music bed + TTS narration + brand stings mixed as ONE audio composite.
# Audio pipeline:
#   1. Extract narration from concatenated video
#   2. Loop music bed to video length, attenuate to -18dB
#   3. Layer typing.mp3 during typewriter window (0s - OPENING_TOTAL_DUR)
#   4. Layer brand intro sting at video start
#   5. Mix all layers into single track
#   6. Re-mux mixed audio onto video

# Brand-specific music beds (baked into Docker at BRAND_ASSETS_DIR)
MUSIC_BED_FILES = {
    "ace_richie": os.path.join(BRAND_ASSETS_DIR, "music_sovereign.mp3"),
    "containment_field": os.path.join(BRAND_ASSETS_DIR, "music_urgent.mp3"),
}
MUSIC_BED_DB = -8  # dB attenuation for music underneath narration (S86: was -12, barely audible. -8 = present but not competing)

# Brand stings
TYPING_SOUND = os.path.join(BRAND_ASSETS_DIR, "typing.mp3")
SIGNATURE_INTRO_FILES = {
    "ace_richie": os.path.join(BRAND_ASSETS_DIR, "signature_long.mp3"),
    "containment_field": os.path.join(BRAND_ASSETS_DIR, "signature_long_tcf.mp3"),
}
SIGNATURE_OUTRO_FILES = {
    "ace_richie": os.path.join(BRAND_ASSETS_DIR, "signature_outro.mp3"),
    "containment_field": os.path.join(BRAND_ASSETS_DIR, "signature_outro_tcf.mp3"),
}
STING_INTRO_DB = -8   # intro sting slightly louder than music bed
STING_TYPING_DB = -12  # typing sound: audible but not dominant
STING_OUTRO_DB = -6    # outro sting: prominent


def _mix_audio(
    video_path: str,
    brand: str,
    job_dir: str,
    video_duration_s: float,
    opening_dur_s: float = OPENING_TOTAL_DUR,
) -> str:
    """
    Build a composite audio track and re-mux it onto the video.

    Layers (bottom to top):
        1. Narration (extracted from video) — full volume
        2. Music bed — looped to video length, attenuated to MUSIC_BED_DB
        3. Typing sound — positioned during typewriter window, STING_TYPING_DB
        4. Intro sting — positioned at start, STING_INTRO_DB
        5. Outro sting — positioned at end, STING_OUTRO_DB

    Returns path to the video with mixed audio (or original if mixing fails).
    """
    t0 = time.monotonic()
    log.info("audio_mix_start", brand=brand, video_duration_s=round(video_duration_s, 1))

    # ── Step 1: Extract narration audio ──
    # SESSION 85: Video now carries lossless PCM (not AAC), so extraction is
    # a format conversion only (24kHz mono → 48kHz stereo), no lossy decode.
    # 48kHz is optimal for the single AAC encode that happens at final mux.
    narration_wav = os.path.join(job_dir, "narration_raw.wav")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_path,
             "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2",
             narration_wav],
            capture_output=True, text=True, timeout=120, check=True,
        )
    except Exception as exc:
        log.error("audio_mix_extract_failed", error=str(exc)[:200])
        return video_path

    # ── Step 2: Build ffmpeg complex filter for mixing ──
    inputs = ["-i", narration_wav]  # input 0: narration
    filter_parts = []
    input_idx = 1
    mix_inputs = ["[narr]"]

    # Narration: pad with silence at the start to cover the opening sequence
    # (opening is video-only, no narration audio for first opening_dur_s)
    filter_parts.append(f"[0:a]apad=whole_dur={video_duration_s:.3f}[narr]")

    # Music bed: loop to video duration, attenuate
    music_path = MUSIC_BED_FILES.get(brand)
    if music_path and os.path.isfile(music_path):
        inputs.extend(["-stream_loop", "-1", "-i", music_path])
        filter_parts.append(
            f"[{input_idx}:a]atrim=0:{video_duration_s:.3f},"
            f"asetpts=PTS-STARTPTS,"
            f"volume={MUSIC_BED_DB}dB[music]"
        )
        mix_inputs.append("[music]")
        input_idx += 1
    else:
        log.warning("audio_mix_no_music_bed", brand=brand, path=music_path)

    # Typing sound: position during typewriter window (BRAND_CARD_ANIM_DUR to OPENING_TOTAL_DUR)
    if os.path.isfile(TYPING_SOUND):
        inputs.extend(["-i", TYPING_SOUND])
        typing_start_ms = int(BRAND_CARD_ANIM_DUR * 1000)
        filter_parts.append(
            f"[{input_idx}:a]volume={STING_TYPING_DB}dB,"
            f"adelay={typing_start_ms}|{typing_start_ms},"
            f"apad=whole_dur={video_duration_s:.3f}[typing]"
        )
        mix_inputs.append("[typing]")
        input_idx += 1
    else:
        log.warning("audio_mix_no_typing", path=TYPING_SOUND)

    # Intro sting: starts at t=0
    intro_path = SIGNATURE_INTRO_FILES.get(brand)
    if intro_path and os.path.isfile(intro_path):
        inputs.extend(["-i", intro_path])
        filter_parts.append(
            f"[{input_idx}:a]volume={STING_INTRO_DB}dB,"
            f"apad=whole_dur={video_duration_s:.3f}[intro]"
        )
        mix_inputs.append("[intro]")
        input_idx += 1
    else:
        log.warning("audio_mix_no_intro_sting", brand=brand)

    # Outro sting: positioned so it ends at video end
    outro_path = SIGNATURE_OUTRO_FILES.get(brand)
    if outro_path and os.path.isfile(outro_path):
        # Probe outro duration to calculate start delay
        outro_dur = _probe_duration(outro_path)
        if outro_dur > 0:
            outro_start_s = max(0, video_duration_s - outro_dur - 0.5)
            outro_start_ms = int(outro_start_s * 1000)
            inputs.extend(["-i", outro_path])
            filter_parts.append(
                f"[{input_idx}:a]volume={STING_OUTRO_DB}dB,"
                f"adelay={outro_start_ms}|{outro_start_ms},"
                f"apad=whole_dur={video_duration_s:.3f}[outro]"
            )
            mix_inputs.append("[outro]")
            input_idx += 1

    # If we only have narration (no music/stings found), skip mixing
    if len(mix_inputs) <= 1:
        log.warning("audio_mix_no_layers", reason="only narration available")
        return video_path

    # amix: combine all layers
    # SESSION 81 FIX: amix with default normalize divides each input by N,
    # burying music at -27dB (inaudible). normalize=0 disables this —
    # each layer keeps its intended volume (narration 0dB, music -18dB, etc.).
    n_layers = len(mix_inputs)
    mix_input_str = "".join(mix_inputs)
    # SESSION 84: duration=first forces the mix to terminate when the narration
    # (first input) ends. Was 'longest' — music/typing/outro layers could extend
    # past narration death, generating dead-air frames that ghost the final subtitle.
    filter_parts.append(
        f"{mix_input_str}amix=inputs={n_layers}:duration=first"
        f":dropout_transition=2:normalize=0[mixed]"
    )

    filter_graph = ";".join(filter_parts)

    # ── Step 3: Run the mix ──
    # SESSION 85: 48kHz throughout mixing — optimal for the single AAC encode at final mux.
    mixed_audio = os.path.join(job_dir, "audio_mixed.wav")
    mix_cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", filter_graph,
        "-map", "[mixed]",
        "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2",
        mixed_audio,
    ]

    log.info("audio_mix_ffmpeg", layers=n_layers, filter_len=len(filter_graph))
    result = subprocess.run(
        mix_cmd, capture_output=True, text=True,
        timeout=300,
    )
    if result.returncode != 0:
        log.error("audio_mix_failed", stderr=result.stderr[:500] if result.stderr else "")
        return video_path

    # ── Step 4: Re-mux mixed audio onto video ──
    # SESSION 85: This is the ONE AND ONLY lossy audio encode in the entire pipeline.
    # All upstream audio was lossless PCM. Final AAC at 48kHz/192k = broadcast quality.
    output_path = os.path.join(job_dir, "final_mixed.mp4")
    mux_cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", mixed_audio,
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "copy",
        "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, "-ar", "48000",
        "-movflags", "+faststart",
        "-shortest",
        output_path,
    ]

    result = subprocess.run(mux_cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        log.error("audio_mux_failed", stderr=result.stderr[:500] if result.stderr else "")
        return video_path

    elapsed = time.monotonic() - t0
    log.info("audio_mix_done", layers=n_layers, elapsed_s=round(elapsed, 1))
    return output_path

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
Style: Typewriter,{style['font']},{style['fontsize']},{style['primary_color']},&HFF000000,{style['outline_color']},&H80000000,{style['bold']},0,0,0,100,100,1.5,0,1,{style['outline_width']},{style['shadow_depth']},2,80,80,120,1

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
    t0 = time.monotonic()

    # ── Step 1: Play brand card animation (1.3s) ──
    # SESSION 83: Restored brand card animation (S82 over-killed it).
    # Brand card mp4s are baked into Docker at /app/brand-assets/.
    brand_card_path = BRAND_CARD_FILES.get(brand)
    if not brand_card_path or not os.path.isfile(brand_card_path):
        log.warning("opening_brand_card_missing", brand=brand, path=brand_card_path)
        # Fallback: generate dark background frame if brand card asset missing
        last_frame_path = os.path.join(job_dir, "brand_card_last_frame.png")
        bg_color = "0x0a0a0f" if brand == "containment_field" else "0x080810"
        gen_bg_cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c={bg_color}:s={OUT_WIDTH}x{OUT_HEIGHT}:d=1",
            "-frames:v", "1", "-q:v", "1",
            last_frame_path,
        ]
        result = subprocess.run(gen_bg_cmd, capture_output=True, text=True, timeout=15)
        if result.returncode != 0 or not os.path.isfile(last_frame_path):
            log.error("opening_bg_generate_failed", stderr=result.stderr[:300])
            return None
        brand_card_clip = None  # no brand card to concat
    else:
        # Extract last frame of brand card for typewriter background
        last_frame_path = os.path.join(job_dir, "brand_card_last_frame.png")
        extract_cmd = [
            "ffmpeg", "-y",
            "-sseof", "-0.05",  # seek to ~last frame
            "-i", brand_card_path,
            "-frames:v", "1",
            "-q:v", "1",
            last_frame_path,
        ]
        result = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=15)
        if result.returncode != 0 or not os.path.isfile(last_frame_path):
            log.error("opening_last_frame_extract_failed", stderr=result.stderr[:300])
            return None

        # Normalize brand card to output dimensions + codec for clean concat
        brand_card_clip = os.path.join(job_dir, "brand_card_normalized.mp4")
        norm_cmd = [
            "ffmpeg", "-y",
            "-i", brand_card_path,
            "-vf", f"scale={OUT_WIDTH}:{OUT_HEIGHT}:flags=lanczos,format=yuv420p",
            "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
            "-t", f"{BRAND_CARD_ANIM_DUR:.3f}",
            "-r", str(OUT_FPS),
            "-an",
            brand_card_clip,
        ]
        result = subprocess.run(norm_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            log.error("opening_brand_card_normalize_failed", stderr=result.stderr[:300])
            brand_card_clip = None

    # ── Step 2: Generate typewriter .ass subtitle ──
    ass_path = os.path.join(job_dir, "typewriter.ass")
    _generate_typewriter_ass(
        text=hook_text,
        brand=brand,
        duration_s=TYPEWRITER_DUR,
        output_path=ass_path,
    )

    # ── Step 3: Render the typewriter segment (last frame + .ass overlay) ──
    typewriter_clip = os.path.join(job_dir, "opening_typewriter.mp4")
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
        "-an",
        typewriter_clip,
    ]
    result = subprocess.run(tw_cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        log.error("opening_typewriter_render_failed", stderr=result.stderr[:500])
        return None

    # ── Step 4: Concat brand card + typewriter into one opening clip ──
    if brand_card_clip and os.path.isfile(brand_card_clip):
        opening_concat_list = os.path.join(job_dir, "opening_concat.txt")
        with open(opening_concat_list, "w") as f:
            f.write(f"file '{brand_card_clip}'\n")
            f.write(f"file '{typewriter_clip}'\n")
        opening_video_only = os.path.join(job_dir, "opening_video_only.mp4")
        concat_cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", opening_concat_list,
            "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
            "-an",
            opening_video_only,
        ]
        result = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            log.error("opening_concat_failed", stderr=result.stderr[:300])
            opening_video_only = typewriter_clip  # fallback to typewriter only
    else:
        # No brand card available -- typewriter is the full opening
        opening_video_only = typewriter_clip

    # Add silent audio track to opening clip (matches scene clip PCM format)
    # SESSION 85: MKV + PCM to match scene clips. Mono 24kHz matches XTTS output.
    opening_path = os.path.join(job_dir, "opening_sequence.mkv")
    silent_cmd = [
        "ffmpeg", "-y",
        "-i", opening_video_only,
        "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000",
        "-c:v", "copy",
        "-c:a", INTERMEDIATE_AUDIO_CODEC,
        "-shortest",
        opening_path,
    ]
    result = subprocess.run(silent_cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        log.error("opening_silent_audio_failed", stderr=result.stderr[:300])
        # Fall back to video-only — audio will still be lost but at least
        # the video won't crash
        opening_path = opening_video_only

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

    # ── Stage 1: Per-scene Ken Burns clips (PARALLEL — Task 7.5b) ───────
    # Each ffmpeg clip is CPU-bound (x264 + zoompan). Scenes are independent.
    # Parallel assembly cuts wall-clock by ~3-4x on multi-core pods (H100 has
    # many CPU cores alongside the GPU). Workers capped at 4 to avoid I/O
    # thrashing on pod's NVMe.
    CLIP_WORKERS = min(4, n_scenes)

    def _build_scene_clip(i: int) -> Optional[str]:
        """Build one Ken Burns scene clip. Returns clip path or None on failure."""
        img = scene_images[i]
        wav = scene_wavs[i]
        dur = durations_s[i]
        clip_path = os.path.join(job_dir, f"clip_{i:03d}.mkv")

        if dur <= 0:
            log.warning("compose_skip_zero_dur", index=i)
            return None
        if not os.path.isfile(img):
            log.warning("compose_missing_image", index=i, path=img)
            return None

        kb_filter = _ken_burns_filter(dur, i)

        cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-i", img,
            "-i", wav,
            "-filter_complex",
            f"[0:v]scale={OUT_WIDTH * 2}:{OUT_HEIGHT * 2}:flags=lanczos,"
            f"{kb_filter},format=yuv420p[v]",
            "-map", "[v]", "-map", "1:a",
            "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
            "-c:a", INTERMEDIATE_AUDIO_CODEC,
            "-t", f"{dur:.3f}",
            "-shortest",
            clip_path,
        ]

        log.info("compose_scene", index=i, duration_s=round(dur, 2))
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=max(120, int(dur * 10)),
        )
        if result.returncode != 0:
            log.error(
                "compose_scene_failed", index=i,
                stderr=result.stderr[:500] if result.stderr else "",
            )
            fallback_cmd = [
                "ffmpeg", "-y",
                "-loop", "1", "-i", img,
                "-i", wav,
                "-filter_complex",
                f"[0:v]scale={OUT_WIDTH}:{OUT_HEIGHT}:flags=lanczos,format=yuv420p[v]",
                "-map", "[v]", "-map", "1:a",
                "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
                "-c:a", INTERMEDIATE_AUDIO_CODEC,
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
                return None

        return clip_path

    t_clips = time.monotonic()
    parallel_results: list[tuple[int, str]] = []
    with ThreadPoolExecutor(max_workers=CLIP_WORKERS) as pool:
        futures = {pool.submit(_build_scene_clip, i): i for i in range(n_scenes)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                clip = future.result()
                if clip is not None:
                    parallel_results.append((idx, clip))
            except Exception as exc:
                log.error("compose_clip_thread_error", index=idx, error=str(exc)[:300])

    # Sort by index to restore scene order (as_completed returns in finish order)
    parallel_results.sort(key=lambda x: x[0])
    scene_clips.extend(clip for _, clip in parallel_results)

    clip_elapsed = time.monotonic() - t_clips
    log.info(
        "compose_clips_parallel_done",
        count=len(parallel_results),
        workers=CLIP_WORKERS,
        elapsed_s=round(clip_elapsed, 1),
    )

    if not scene_clips:
        raise RuntimeError("compose: zero scene clips produced — cannot assemble video")

    # ── Stage 2: Concat all scene clips ──────────────────────────────────
    concat_list_path = os.path.join(job_dir, "video_concat.txt")
    with open(concat_list_path, "w") as f:
        for clip in scene_clips:
            f.write(f"file '{clip}'\n")

    # SESSION 85: Concat stays MKV+PCM — no lossy audio encode yet.
    final_path = os.path.join(job_dir, "final.mkv")

    concat_cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_list_path,
        "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
        "-c:a", INTERMEDIATE_AUDIO_CODEC,
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

    # ── Stage 2.5: AUDIO MASTER DURATION ENFORCEMENT ────────────────
    # SESSION 83: The TTS audio is the absolute temporal authority. The visual
    # timeline must terminate the exact millisecond the primary audio ends.
    video_dur = _probe_duration(final_path)
    audio_master_dur = sum(durations_s) + (OPENING_TOTAL_DUR if opening_clip else 0.0)
    drift_s = abs(video_dur - audio_master_dur)
    if drift_s > 2.0:
        log.warning(
            "compose_duration_drift",
            video_dur_s=round(video_dur, 2),
            audio_master_s=round(audio_master_dur, 2),
            drift_s=round(drift_s, 2),
            msg="Video/audio duration mismatch -- trimming to audio master",
        )
        # SESSION 85: Trim stays MKV+PCM — no lossy audio encode yet.
        trimmed_path = os.path.join(job_dir, "final_trimmed.mkv")
        trim_cmd = [
            "ffmpeg", "-y",
            "-i", final_path,
            "-t", f"{audio_master_dur:.3f}",
            "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", VIDEO_CRF,
            "-c:a", INTERMEDIATE_AUDIO_CODEC,
            trimmed_path,
        ]
        trim_result = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=600)
        if trim_result.returncode == 0:
            final_path = trimmed_path
            video_dur = _probe_duration(final_path)
            log.info("compose_trimmed_to_audio_master", final_dur_s=round(video_dur, 2))
        else:
            log.error("compose_trim_failed", stderr=trim_result.stderr[:300] if trim_result.stderr else "")

    # ── Stage 2.5: Composite audio mixing ─────────────────────────────
    try:
        video_dur = _probe_duration(final_path)
        mixed = _mix_audio(
            video_path=final_path,
            brand=brand,
            job_dir=job_dir,
            video_duration_s=video_dur,
            opening_dur_s=OPENING_TOTAL_DUR if opening_clip else 0.0,
        )
        if mixed != final_path:
            final_path = mixed
    except Exception as exc:
        log.error("compose_audio_mix_failed", error=str(exc)[:300])

    # SESSION 85: If mix failed, final_path is still MKV+PCM. Downstream steps
    # (caption burn uses -c:a copy → MP4) would fail because MP4 can't hold PCM.
    # Transcode to MP4+AAC so the pipeline can continue.
    if final_path.endswith(".mkv"):
        log.warning("compose_mkv_fallback", msg="Mix skipped/failed — encoding MKV→MP4 with AAC")
        mp4_fallback = os.path.join(job_dir, "final_fallback.mp4")
        fb_cmd = [
            "ffmpeg", "-y", "-i", final_path,
            "-c:v", "copy",
            "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, "-ar", "48000",
            "-movflags", "+faststart",
            mp4_fallback,
        ]
        fb_result = subprocess.run(fb_cmd, capture_output=True, text=True, timeout=300)
        if fb_result.returncode == 0:
            final_path = mp4_fallback
        else:
            log.error("compose_mkv_fallback_failed", stderr=fb_result.stderr[:300] if fb_result.stderr else "")

    # ── Stage 3: Kinetic captions (GPU Whisper → ASS → burn) ────────────
    # Captions skip the opening sequence (brand card + typewriter) and start
    # at OPENING_TOTAL_DUR. If the opening was skipped, captions start at 0.
    caption_skip_s = OPENING_TOTAL_DUR if opening_clip else 0.0
    # SESSION 83: Pass the audio master duration as a hard ceiling so
    # captions never bleed into dead-air / visual padding.
    audio_ceiling_s = sum(durations_s) + (OPENING_TOTAL_DUR if opening_clip else 0.0)
    try:
        captioned = generate_and_burn_captions(
            video_path=final_path,
            brand=brand,
            job_dir=job_dir,
            skip_until_s=caption_skip_s,
            audio_duration_s=audio_ceiling_s,
        )
        if captioned != final_path:
            final_path = captioned
    except Exception as exc:
        log.error("compose_captions_failed", error=str(exc)[:300])

    # ── Stage 4: Probe final duration ─
    total_duration = _probe_duration(final_path)
    log.info("compose_final_duration", duration_s=round(total_duration, 2))

    # ── Stage 5: Generate thumbnail (aesthetic override) ─────────────────
    thumb_path = os.path.join(job_dir, "thumbnail.jpg")
    thumb_idx = min(thumbnail_scene_idx, n_scenes - 1)
    thumb_src = scene_images[thumb_idx] if thumb_idx < len(scene_images) else scene_images[0]

    # Extract 2-3 word uppercase hook for drawtext overlay
    _thumb_hook = ""
    if hook_text:
        _words = hook_text.upper().split()
        _thumb_hook = " ".join(_words[:3])
    elif script:
        _words = script.split("\n")[0].upper().split()
        _thumb_hook = " ".join(_words[:3])

    try:
        # Build vf chain: scale + vignette + optional drawtext
        _vf_parts = ["scale=1280:720:flags=lanczos", "vignette=PI/3"]
        if _thumb_hook:
            # Escape special chars for ffmpeg drawtext
            _safe_hook = _thumb_hook.replace("'", "’").replace(":", "\\:")
            _vf_parts.append(
                f"drawtext=fontfile='{FONT_BEBAS}'"
                f":text='{_safe_hook}'"
                f":fontsize=120"
                f":fontcolor=white"
                f":borderw=5"
                f":bordercolor=black"
                f":x=(w-text_w)/2"
                f":y=(h-text_h)/2"
            )
        _vf_chain = ",".join(_vf_parts)

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", thumb_src,
                "-vf", _vf_chain,
                "-q:v", "2",
                thumb_path,
            ],
            capture_output=True, text=True, timeout=30,
            check=True,
        )
        log.info("compose_thumbnail_ok", hook=_thumb_hook or "(none)")
    except Exception as exc:
        log.warning("compose_thumbnail_failed", error=str(exc)[:300])
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


# ═══════════════════════════════════════════════════════════════════════════════
# Native Vertical Short Composition — Session 90
# ═══════════════════════════════════════════════════════════════════════════════
# Renders a native 9:16 vertical short from pre-extracted audio + scene images.
# No opening sequence, no brand card. Clean Ken Burns + kinetic captions sized
# for vertical viewing. Audio comes pre-extracted from the long-form with
# sentence-boundary fades already applied.
#
# Pipeline: FLUX images (9:16) → Ken Burns (1080x1920) → concat → audio mix
#           → Whisper captions → vertical thumbnail → R2 upload
# ═══════════════════════════════════════════════════════════════════════════════

# Vertical output specs — 9:16 portrait for Shorts/Reels/TikTok
SHORT_WIDTH = 1080
SHORT_HEIGHT = 1920
SHORT_FPS = 30
SHORT_CRF = "20"

# Vertical caption styles — larger font, centered for thumb-scrolling viewers
SHORT_CAPTION_STYLES = {
    "containment_field": {
        "font": "Bebas Neue",
        "fontsize": 96,
        "primary_color": "&H00F0F0F0",
        "outline_color": "&H00101010",
        "outline_width": 3.0,
        "shadow_depth": 0,
        "bold": 0,
        "uppercase": True,
        "border_style": 1,
        "anim_in_ms": 100,
        "anim_scale_start": 92,
    },
    "ace_richie": {
        "font": "Montserrat SemiBold",
        "fontsize": 88,
        "primary_color": "&H0080CFFF",
        "outline_color": "&H00102040",
        "outline_width": 3.5,
        "shadow_depth": 3,
        "bold": 1,
        "uppercase": False,
        "border_style": 1,
        "anim_in_ms": 150,
        "anim_scale_start": 88,
    },
}

# Vertical Ken Burns — same zoom range, tuned pan for portrait framing
SHORT_KB_ZOOM_MIN = 1.00
SHORT_KB_ZOOM_MAX = 1.10  # slightly less zoom than horizontal — portrait is tighter
SHORT_KB_PAN_MAX_FRAC = 0.03  # less horizontal drift — narrow frame


def _ken_burns_filter_vertical(duration_s: float, scene_idx: int) -> str:
    """Ken Burns zoompan for 9:16 vertical output."""
    total_frames = max(1, int(duration_s * SHORT_FPS))
    zoom_range = SHORT_KB_ZOOM_MAX - SHORT_KB_ZOOM_MIN

    if scene_idx % 2 == 0:
        zoom_expr = f"min({SHORT_KB_ZOOM_MIN}+(on/{total_frames})*{zoom_range},{SHORT_KB_ZOOM_MAX})"
    else:
        zoom_expr = f"max({SHORT_KB_ZOOM_MAX}-(on/{total_frames})*{zoom_range},{SHORT_KB_ZOOM_MIN})"

    rng = random.Random(scene_idx * 77)  # different seed than horizontal
    pan_x_frac = rng.uniform(-SHORT_KB_PAN_MAX_FRAC, SHORT_KB_PAN_MAX_FRAC)
    pan_y_frac = rng.uniform(-SHORT_KB_PAN_MAX_FRAC, SHORT_KB_PAN_MAX_FRAC)

    x_expr = f"iw/2-(iw/zoom/2)+({pan_x_frac}*iw*on/{total_frames})"
    y_expr = f"ih/2-(ih/zoom/2)+({pan_y_frac}*ih*on/{total_frames})"

    return (
        f"zoompan=z='{zoom_expr}':x='{x_expr}':y='{y_expr}'"
        f":d={total_frames}:s={SHORT_WIDTH}x{SHORT_HEIGHT}:fps={SHORT_FPS}"
    )


def _generate_caption_ass_vertical(
    bursts: list[dict], brand: str, output_path: str,
    audio_end_s: Optional[float] = None,
) -> str:
    """Generate ASS subtitle file for vertical shorts — larger text, no skip offset."""
    style = SHORT_CAPTION_STYLES.get(brand, SHORT_CAPTION_STYLES["ace_richie"])

    def _ts(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        cs = int((s - int(s)) * 100)
        return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"

    ass_lines = [
        "[Script Info]",
        "Title: Vertical Short Captions",
        "ScriptType: v4.00+",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        f"PlayResX: {SHORT_WIDTH}",
        f"PlayResY: {SHORT_HEIGHT}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding",
        f"Style: Caption,{style['font']},{style['fontsize']},{style['primary_color']},"
        f"&HFF000000,{style['outline_color']},&H00000000,{style['bold']},"
        f"0,0,0,100,100,2.0,0,{style['border_style']},{style['outline_width']},"
        f"{style['shadow_depth']},2,60,60,200,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    anim_ms = style.get("anim_in_ms", 120)
    scale_start = style.get("anim_scale_start", 90)

    for burst in bursts:
        if audio_end_s is not None and burst["start"] >= audio_end_s:
            continue
        start = burst["start"]
        end = burst["end"] + CAPTION_GAP_S
        if audio_end_s is not None:
            end = min(end, audio_end_s)
        if end <= start:
            continue
        text = burst["text"]
        if style.get("uppercase"):
            text = text.upper()
        text = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
        anim_tag = (
            "{\\" + f"fscx{scale_start}" + "\\" + f"fscy{scale_start}"
            + "\\" + f"t(0,{anim_ms}," + "\\" + "fscx100" + "\\" + "fscy100)}"
        )
        start_ts = _ts(start)
        end_ts = _ts(end)
        ass_lines.append(
            f"Dialogue: 0,{start_ts},{end_ts},Caption,,0,0,0,,{anim_tag}{text}"
        )

    with open(output_path, "w", encoding="utf-8") as f:
        for line in ass_lines:
            f.write(line + "\n")

    log.info("caption_ass_vertical_generated", path=output_path,
             burst_count=len([b for b in bursts if not (audio_end_s and b["start"] >= audio_end_s)]),
             brand=brand)
    return output_path


def compose_short(
    scene_images: list[str],
    audio_path: str,
    audio_duration_s: float,
    scene_durations_s: list[float],
    job_dir: str,
    brand: str,
    hook_text: Optional[str] = None,
) -> dict:
    """
    Assemble a native 9:16 vertical short from scene images + pre-extracted audio.

    Unlike compose_video(), this function:
      - Renders at 1080x1920 (9:16 vertical)
      - Takes a SINGLE audio file (pre-extracted from long-form with fades)
      - Has NO opening sequence (no brand card, no typewriter)
      - Burns kinetic captions sized for vertical viewing
      - Generates a vertical thumbnail (1080x1920)

    Args:
        scene_images: FLUX-generated images at 9:16 aspect ratio.
        audio_path: Pre-extracted audio WAV for this short.
        audio_duration_s: Total audio duration in seconds.
        scene_durations_s: How long each scene should last (matches audio pacing).
        job_dir: Working directory for intermediate files.
        brand: 'ace_richie' or 'containment_field'.
        hook_text: Short hook for thumbnail overlay.

    Returns:
        {
            "video_path": "/path/to/short.mp4",
            "thumbnail_path": "/path/to/thumb_short.jpg",
            "duration_s": 42.5,
        }
    """
    t0 = time.monotonic()
    n_scenes = min(len(scene_images), len(scene_durations_s))
    log.info("compose_short_start", scene_count=n_scenes, brand=brand,
             audio_duration_s=round(audio_duration_s, 2))

    # ── Stage 1: Per-scene Ken Burns clips (vertical) ──────────────────────
    CLIP_WORKERS = min(4, n_scenes)
    scene_clips: list[str] = []

    def _build_vertical_clip(i: int) -> Optional[str]:
        """Build one vertical Ken Burns scene clip."""
        img = scene_images[i]
        dur = scene_durations_s[i]
        clip_path = os.path.join(job_dir, f"short_clip_{i:03d}.mkv")

        if dur <= 0:
            log.warning("compose_short_skip_zero_dur", index=i)
            return None
        if not os.path.isfile(img):
            log.warning("compose_short_missing_image", index=i, path=img)
            return None

        kb_filter = _ken_burns_filter_vertical(dur, i)

        # 2x upscale for zoompan headroom (same trick as horizontal)
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-i", img,
            "-f", "lavfi", "-i", f"anullsrc=channel_layout=mono:sample_rate=24000",
            "-filter_complex",
            f"[0:v]scale={SHORT_WIDTH * 2}:{SHORT_HEIGHT * 2}:flags=lanczos,"
            f"{kb_filter},format=yuv420p[v]",
            "-map", "[v]", "-map", "1:a",
            "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", SHORT_CRF,
            "-c:a", INTERMEDIATE_AUDIO_CODEC,
            "-t", f"{dur:.3f}",
            "-shortest",
            clip_path,
        ]

        log.info("compose_short_scene", index=i, duration_s=round(dur, 2))
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=max(120, int(dur * 10)),
        )
        if result.returncode != 0:
            log.error("compose_short_scene_failed", index=i,
                      stderr=result.stderr[:500] if result.stderr else "")
            # Fallback: 1x scale without Ken Burns
            fallback_cmd = [
                "ffmpeg", "-y",
                "-loop", "1", "-i", img,
                "-f", "lavfi", "-i", f"anullsrc=channel_layout=mono:sample_rate=24000",
                "-filter_complex",
                f"[0:v]scale={SHORT_WIDTH}:{SHORT_HEIGHT}:flags=lanczos,format=yuv420p[v]",
                "-map", "[v]", "-map", "1:a",
                "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", SHORT_CRF,
                "-c:a", INTERMEDIATE_AUDIO_CODEC,
                "-t", f"{dur:.3f}",
                "-shortest",
                clip_path,
            ]
            fb_result = subprocess.run(
                fallback_cmd, capture_output=True, text=True,
                timeout=max(120, int(dur * 10)),
            )
            if fb_result.returncode != 0:
                log.error("compose_short_fallback_failed", index=i)
                return None

        return clip_path

    t_clips = time.monotonic()
    parallel_results: list[tuple[int, str]] = []
    with ThreadPoolExecutor(max_workers=CLIP_WORKERS) as pool:
        futures = {pool.submit(_build_vertical_clip, i): i for i in range(n_scenes)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                clip = future.result()
                if clip is not None:
                    parallel_results.append((idx, clip))
            except Exception as exc:
                log.error("compose_short_clip_error", index=idx, error=str(exc)[:300])

    parallel_results.sort(key=lambda x: x[0])
    scene_clips = [clip for _, clip in parallel_results]

    clip_elapsed = time.monotonic() - t_clips
    log.info("compose_short_clips_done", count=len(scene_clips),
             elapsed_s=round(clip_elapsed, 1))

    if not scene_clips:
        raise RuntimeError("compose_short: zero scene clips — cannot assemble")

    # ── Stage 2: Concat scene clips ────────────────────────────────────────
    concat_list = os.path.join(job_dir, "short_concat.txt")
    with open(concat_list, "w") as f:
        for clip in scene_clips:
            f.write(f"file '{clip}'\n")

    concat_path = os.path.join(job_dir, "short_concat.mkv")
    concat_cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_list,
        "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", SHORT_CRF,
        "-c:a", INTERMEDIATE_AUDIO_CODEC,
        concat_path,
    ]
    result = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"compose_short concat failed: {result.stderr[:500] if result.stderr else ''}")

    # ── Stage 2.5: Re-mux with real audio ──────────────────────────────────
    # Scene clips have silent placeholder audio. Now swap in the real extracted audio.
    muxed_path = os.path.join(job_dir, "short_muxed.mp4")

    # Shorts get a lighter audio mix: narration + music bed only (no stings/typing)
    music_path = MUSIC_BED_FILES.get(brand)
    if music_path and os.path.isfile(music_path):
        # Mix narration + attenuated music bed
        mix_filter = (
            f"[0:a]apad=whole_dur={audio_duration_s:.3f}[narr];"
            f"[1:a]atrim=0:{audio_duration_s:.3f},asetpts=PTS-STARTPTS,"
            f"volume={MUSIC_BED_DB}dB[music];"
            f"[narr][music]amix=inputs=2:duration=first:normalize=0[mixed]"
        )
        mix_cmd = [
            "ffmpeg", "-y",
            "-i", audio_path,
            "-stream_loop", "-1", "-i", music_path,
            "-i", concat_path,
            "-filter_complex", mix_filter,
            "-map", "2:v",
            "-map", "[mixed]",
            "-c:v", "copy",
            "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, "-ar", "48000",
            "-movflags", "+faststart",
            "-t", f"{audio_duration_s:.3f}",
            "-shortest",
            muxed_path,
        ]
    else:
        # No music bed — just mux narration directly
        mix_cmd = [
            "ffmpeg", "-y",
            "-i", concat_path,
            "-i", audio_path,
            "-map", "0:v",
            "-map", "1:a",
            "-c:v", "copy",
            "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, "-ar", "48000",
            "-movflags", "+faststart",
            "-t", f"{audio_duration_s:.3f}",
            "-shortest",
            muxed_path,
        ]

    result = subprocess.run(mix_cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        log.error("compose_short_mux_failed", stderr=result.stderr[:500] if result.stderr else "")
        # Fallback: simple audio mux without music
        fb_mux_cmd = [
            "ffmpeg", "-y",
            "-i", concat_path, "-i", audio_path,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "copy",
            "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, "-ar", "48000",
            "-movflags", "+faststart",
            "-t", f"{audio_duration_s:.3f}",
            "-shortest",
            muxed_path,
        ]
        result = subprocess.run(fb_mux_cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"compose_short mux failed: {result.stderr[:300] if result.stderr else ''}")

    final_path = muxed_path

    # ── Stage 3: Kinetic captions (GPU Whisper → vertical ASS → burn) ──────
    try:
        cap_wav = os.path.join(job_dir, "short_captions_audio.wav")
        _extract_audio_from_video(final_path, cap_wav)
        words = _transcribe_word_timestamps(cap_wav)

        if words:
            bursts = _chunk_words_into_bursts(words)
            if bursts:
                ass_path = os.path.join(job_dir, "short_captions.ass")
                _generate_caption_ass_vertical(
                    bursts, brand, ass_path,
                    audio_end_s=audio_duration_s,
                )
                captioned = os.path.join(job_dir, "short_captioned.mp4")
                _burn_captions(final_path, ass_path, captioned)
                if os.path.isfile(captioned):
                    final_path = captioned
    except Exception as exc:
        log.error("compose_short_captions_failed", error=str(exc)[:300])

    # ── Stage 4: Probe final duration ──────────────────────────────────────
    total_duration = _probe_duration(final_path)

    # ── Stage 5: Vertical thumbnail ────────────────────────────────────────
    thumb_path = os.path.join(job_dir, "thumbnail_short.jpg")
    # Use the first scene image (most visually impactful for shorts)
    thumb_src = scene_images[0] if scene_images else ""

    _thumb_hook = ""
    if hook_text:
        _words = hook_text.upper().split()
        _thumb_hook = " ".join(_words[:3])

    try:
        _vf_parts = [f"scale={SHORT_WIDTH}:{SHORT_HEIGHT}:flags=lanczos", "vignette=PI/3"]
        if _thumb_hook:
            _safe_hook = _thumb_hook.replace("'", "'").replace(":", "\\:")
            _vf_parts.append(
                f"drawtext=fontfile='{FONT_BEBAS}'"
                f":text='{_safe_hook}'"
                f":fontsize=140"
                f":fontcolor=white"
                f":borderw=6"
                f":bordercolor=black"
                f":x=(w-text_w)/2"
                f":y=(h-text_h)/2"
            )
        _vf_chain = ",".join(_vf_parts)
        subprocess.run(
            ["ffmpeg", "-y", "-i", thumb_src, "-vf", _vf_chain, "-q:v", "2", thumb_path],
            capture_output=True, text=True, timeout=30, check=True,
        )
    except Exception as exc:
        log.warning("compose_short_thumbnail_failed", error=str(exc)[:300])
        if thumb_src and os.path.isfile(thumb_src):
            import shutil
            shutil.copy2(thumb_src, thumb_path)

    elapsed = time.monotonic() - t0
    log.info("compose_short_done",
             duration_s=round(total_duration, 2),
             elapsed_s=round(elapsed, 1),
             scene_count=n_scenes, brand=brand)

    return {
        "video_path": final_path,
        "thumbnail_path": thumb_path,
        "duration_s": total_duration,
    }
