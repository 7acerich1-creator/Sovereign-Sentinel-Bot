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
from PIL import Image, ImageDraw, ImageFont


class _SilentAudioError(Exception):
    """Raised when muxed audio is silent — signals to skip Whisper captions."""
    pass

log = structlog.get_logger("pipeline.compose")

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# Output specs — 16:9 horizontal for long-form YouTube
OUT_WIDTH = 1920
OUT_HEIGHT = 1080
OUT_FPS = 30
VIDEO_CODEC = "libx264"
VIDEO_PRESET = "fast"     # SESSION 95: intermediate clips — caption burn re-encodes anyway
VIDEO_PRESET_FINAL = "medium"  # used ONLY by caption burn (sets final quality)
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
    "sovereign_synthesis": os.path.join(BRAND_ASSETS_DIR, "brand_card_ace.mp4"),
    "containment_field": os.path.join(BRAND_ASSETS_DIR, "brand_card_tcf.mp4"),
}

# ASS color format: &HAABBGGRR (alpha, blue, green, red — NOT RGB)
# TCF: clean silver/white text, monospace terminal
# SS: warm gold accent, premium sans-serif
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
    "sovereign_synthesis": {
        "font": "Montserrat SemiBold",
        "fontsize": 54,
        "primary_color": "&H0080CFFF",   # warm amber-gold (BGR: FF CF 80)
        "outline_color": "&H00102040",    # deep warm outline
        "outline_width": 2.5,
        "shadow_depth": 1,
        "bold": 1,
    },
}



# ─────────────────────────────────────────────────────────────────────────────
# Thumbnail text renderer — Session 113+ rebuild
# ─────────────────────────────────────────────────────────────────────────────
# Replaces the old ffmpeg drawtext chain. That approach used fixed char-count
# limits which lied because Bebas Neue is variable-width: "WWWWWW" renders
# much wider than "iiiiii" at the same size. 15 sessions of thumbnail bugs
# traced back to that single flaw.
#
# This renderer:
#   - Measures real pixel widths via Pillow's font.getbbox()
#   - Wraps at word boundaries only — NEVER mid-word
#   - Binary-searches the largest fontsize that fits all lines within safe area
#   - Scales font inversely with word count: 3 words -> ~180px, 7 words -> ~85px
#   - Sentence-boundary truncation fallback if text somehow won't fit even at
#     min font (still never mid-word truncation)
#   - Handles both horizontal (1280x720) and vertical (1080x1920) thumbnails

_THUMB_MARGIN = 40
_THUMB_FONT_MAX = 200
_THUMB_FONT_MIN = 52
_THUMB_LINE_SPACING_FACTOR = 1.05  # 5% gap between stacked lines
_THUMB_STROKE_WIDTH = 6
_THUMB_MAX_LINES = 3


def _wrap_into_n_lines(words, n_lines):
    """Wrap words into exactly n_lines balanced segments at word boundaries.
    Returns None if impossible. Picks the split that minimizes the longest
    line's char count — keeps the rendered block visually centered.
    """
    if n_lines <= 0 or not words:
        return None
    n_words = len(words)
    if n_lines >= n_words:
        return list(words)

    def _split_positions(remaining, start_idx):
        if remaining == 0:
            return [[]]
        out = []
        for end in range(start_idx + 1, n_words - remaining + 1):
            for rest in _split_positions(remaining - 1, end):
                out.append([end] + rest)
        return out

    best = None
    best_max = 10 ** 9
    for splits in _split_positions(n_lines - 1, 0):
        segments = []
        prev = 0
        for s in splits:
            segments.append(" ".join(words[prev:s]))
            prev = s
        segments.append(" ".join(words[prev:]))
        max_chars = max(len(seg) for seg in segments)
        if max_chars < best_max:
            best_max = max_chars
            best = segments
    return best


def _measure_line_width(line, font_path, size):
    font = ImageFont.truetype(font_path, size)
    bbox = font.getbbox(line)
    return bbox[2] - bbox[0]


def _find_best_fit(text, font_path, canvas_w, canvas_h):
    """Return (lines, fontsize) — the wrap + size combination that gives the
    largest readable fontsize while every line fits within the safe area.
    Word-boundary only. Never mid-word.
    """
    safe_w = canvas_w - 2 * _THUMB_MARGIN
    safe_h = canvas_h - 2 * _THUMB_MARGIN
    words = text.split()
    if not words:
        return [], _THUMB_FONT_MIN

    best = None
    for target_lines in range(1, min(_THUMB_MAX_LINES, len(words)) + 1):
        lines = _wrap_into_n_lines(words, target_lines)
        if not lines:
            continue
        lo, hi = _THUMB_FONT_MIN, _THUMB_FONT_MAX
        best_size_for_wrap = 0
        while lo <= hi:
            mid = (lo + hi) // 2
            max_line_w = max(_measure_line_width(ln, font_path, mid) for ln in lines)
            extra_gap = int(mid * (_THUMB_LINE_SPACING_FACTOR - 1))
            block_h = len(lines) * mid + max(0, len(lines) - 1) * extra_gap
            if max_line_w <= safe_w and block_h <= safe_h:
                best_size_for_wrap = mid
                lo = mid + 1
            else:
                hi = mid - 1
        if best_size_for_wrap == 0:
            continue
        if best is None or best_size_for_wrap > best[1]:
            best = (lines, best_size_for_wrap)

    if best is not None:
        return best

    # Fallback: text doesn't fit at MIN font in any wrap. Truncate at the
    # first sentence-ending punctuation, NEVER mid-word.
    sentence_end = re.compile(r"[.!?]")
    m = sentence_end.search(text)
    if m and m.end() < len(text):
        truncated = text[: m.end()].strip()
        log.warning(
            "compose_thumbnail_truncated_at_sentence",
            original_len=len(text),
            truncated_len=len(truncated),
        )
        return _find_best_fit(truncated, font_path, canvas_w, canvas_h)

    # Last resort: trim trailing words one at a time until it fits at min font.
    trimmed = list(words)
    while len(trimmed) > 1:
        trimmed.pop()
        lines = _wrap_into_n_lines(trimmed, min(_THUMB_MAX_LINES, len(trimmed)))
        if not lines:
            continue
        max_line_w = max(_measure_line_width(ln, font_path, _THUMB_FONT_MIN) for ln in lines)
        extra_gap = int(_THUMB_FONT_MIN * (_THUMB_LINE_SPACING_FACTOR - 1))
        block_h = len(lines) * _THUMB_FONT_MIN + max(0, len(lines) - 1) * extra_gap
        if max_line_w <= canvas_w - 2 * _THUMB_MARGIN and block_h <= canvas_h - 2 * _THUMB_MARGIN:
            log.warning(
                "compose_thumbnail_truncated_by_words",
                original_word_count=len(words),
                kept_word_count=len(trimmed),
            )
            return (lines, _THUMB_FONT_MIN)

    return ([words[0]], _THUMB_FONT_MIN)


def _render_text_block(
    img,
    text: str,
    font_path: str,
    zone_x: int,
    zone_y: int,
    zone_w: int,
    zone_h: int,
    font_min: int = _THUMB_FONT_MIN,
    font_max: int = _THUMB_FONT_MAX,
    stroke_width: int = _THUMB_STROKE_WIDTH,
    stroke_fill: str = "black",
    text_fill: str = "white",
    upper: bool = False,
    italic_skew: float = 0.0,
    quote_wrap: bool = False,
    add_shadow: bool = False,
):
    """Render a single text block within a defined zone with binary-search
    fontsize fitting and word-boundary wrap.

    S117: replaces the silent-truncation path in `_find_best_fit`. If the
    text physically does not fit at `font_min`, we RAISE rather than truncate.
    Callers (LLM-prompt + palette layers) deliver text that fits; the
    compositor never mangles a fragment. Breaks the 10+ session loop where
    mid-clause truncation was silently shipped.
    """
    clean_text = (text or "").strip()
    if not clean_text:
        return [], 0
    if upper:
        clean_text = clean_text.upper()
    if quote_wrap and clean_text:
        # Smart curly quotes — feel editorial, render cleanly in Bebas Neue.
        clean_text = f"“{clean_text}”"

    words = clean_text.split()
    if not words:
        return [], 0

    safe_w = zone_w
    safe_h = zone_h

    best = None
    for target_lines in range(1, min(_THUMB_MAX_LINES, len(words)) + 1):
        lines = _wrap_into_n_lines(words, target_lines)
        if not lines:
            continue
        lo, hi = font_min, font_max
        best_size_for_wrap = 0
        while lo <= hi:
            mid = (lo + hi) // 2
            max_line_w = max(_measure_line_width(ln, font_path, mid) for ln in lines)
            extra_gap = int(mid * (_THUMB_LINE_SPACING_FACTOR - 1))
            block_h = len(lines) * mid + max(0, len(lines) - 1) * extra_gap
            if max_line_w <= safe_w and block_h <= safe_h:
                best_size_for_wrap = mid
                lo = mid + 1
            else:
                hi = mid - 1
        if best_size_for_wrap == 0:
            continue
        if best is None or best_size_for_wrap > best[1]:
            best = (lines, best_size_for_wrap)

    if best is None:
        raise ValueError(
            f"text {clean_text!r} does not fit {zone_w}x{zone_h} at fontsize {font_min}-{font_max}"
        )

    lines, fontsize = best
    font = ImageFont.truetype(font_path, fontsize)
    line_spacing = int(fontsize * _THUMB_LINE_SPACING_FACTOR)
    extra_gap = line_spacing - fontsize
    block_h = len(lines) * fontsize + max(0, len(lines) - 1) * extra_gap
    start_y = zone_y + (zone_h - block_h) // 2

    if italic_skew and abs(italic_skew) > 1e-3:
        # S117c: Solid-fill subhead. PIL's stroke_width on Bebas Neue at small
        # fontsize eats the white fill (the stroke covers from both sides
        # leaving only the outline). Instead we render TWO PASSES on a
        # transparent layer: (1) blurred black drop shadow for legibility on
        # any background, (2) solid white glyph on top — both with the italic
        # skew applied so they remain aligned.
        from PIL import ImageFilter
        for i, line in enumerate(lines):
            bbox = font.getbbox(line)
            line_w = bbox[2] - bbox[0]
            line_h = bbox[3] - bbox[1]
            shadow_offset = max(2, line_h // 30)
            pad = max(int(line_h * abs(italic_skew)) + shadow_offset * 4, 12)
            layer_w = line_w + pad * 2
            layer_h = line_h + shadow_offset * 6 + 16

            # Pass 1 — soft drop shadow (blurred black)
            shadow_layer = Image.new("RGBA", (layer_w, layer_h), (0, 0, 0, 0))
            sd = ImageDraw.Draw(shadow_layer)
            sd.text(
                (pad + shadow_offset, shadow_offset + 4 - bbox[1]),
                line, fill=(0, 0, 0, 235), font=font,
            )
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=max(2, shadow_offset)))

            # Pass 2 — solid white glyph
            text_layer = Image.new("RGBA", (layer_w, layer_h), (0, 0, 0, 0))
            td = ImageDraw.Draw(text_layer)
            td.text(
                (pad, 4 - bbox[1]),
                line, fill=text_fill, font=font,
            )

            # Composite shadow then text, then skew the result.
            combined = Image.alpha_composite(shadow_layer, text_layer)
            sheared = combined.transform(
                (layer_w, layer_h),
                Image.AFFINE,
                (1, -italic_skew, italic_skew * layer_h, 0, 1, 0),
                resample=Image.BICUBIC,
            )
            x = zone_x + (zone_w - layer_w) // 2
            y = start_y + i * line_spacing - (4 - bbox[1])
            img.paste(sheared, (x, y), sheared)
    else:
        # S127 (2026-05-02): Optional Gaussian-blur drop shadow for the non-skew
        # path. Subhead's stroke_width=2 wasn't carrying enough contrast on
        # vignetted FLUX backdrops (compare to headline's stroke_width=6). The
        # italic-skew path at lines 326-370 already does this technique for
        # subheads when italic was on; S117c dropped italic but didn't carry
        # the shadow over to the solid-render path. This restores the shadow
        # under the subhead's solid-fill rendering — same legibility tech as
        # before, just decoupled from the italic-skew transform.
        if add_shadow:
            from PIL import ImageFilter
            shadow_offset = max(3, fontsize // 25)
            shadow_blur = max(3, fontsize // 18)
            shadow_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
            sd = ImageDraw.Draw(shadow_layer)
            for i, line in enumerate(lines):
                bbox = font.getbbox(line)
                line_w = bbox[2] - bbox[0]
                x = zone_x + (zone_w - line_w) // 2
                y = start_y + i * line_spacing
                sd.text(
                    (x + shadow_offset, y + shadow_offset),
                    line, fill=(0, 0, 0, 235), font=font,
                )
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
            # Composite blurred shadow onto img using shadow's alpha as the mask.
            # Only the dark text area touches img; the rest of the layer is
            # fully transparent and contributes nothing.
            img.paste(shadow_layer, (0, 0), shadow_layer)

        draw = ImageDraw.Draw(img)
        for i, line in enumerate(lines):
            bbox = font.getbbox(line)
            line_w = bbox[2] - bbox[0]
            x = zone_x + (zone_w - line_w) // 2
            y = start_y + i * line_spacing
            draw.text(
                (x, y),
                line,
                fill=text_fill,
                font=font,
                stroke_width=stroke_width,
                stroke_fill=stroke_fill,
            )

    return lines, fontsize


def render_thumbnail_with_text(
    src_image_path,
    text,
    output_path,
    canvas_w,
    canvas_h,
    font_path=None,
    subhead=None,
    subhead_font_path=None,
):
    """Render a thumbnail: scale + vignette the source image, then overlay
    `text` (headline) and optional `subhead` centered with dynamic fontsize.

    S117 (2026-04-25): Two-tier text on full-bleed image. The image is the
    backdrop; the TEXT does the work (Rev. Ike sermon-poster pattern). When
    `subhead` is provided, headline takes upper 62% of the safe area, gap 5%,
    subhead takes lower 33%, each independently auto-fit.

    HARD RULE: if either text doesn't fit at min font, RAISE instead of
    truncating. Caller picks a brand-palette fallback rather than ship a
    fragment. Breaks the 10+ session "DO YOU SENSE A DEEP," loop.
    """
    if font_path is None:
        font_path = FONT_BEBAS
    if subhead_font_path is None:
        # S117c: Bebas Neue — same display weight as headline. With the wider
        # subhead zone (46% safe-h), the binary-search fits ~140-180px font,
        # at which Bebas Neue glyph thickness is plenty solid against the
        # vignetted backdrop. Italic skew is dropped — quotes alone carry the
        # "subhead vs headline" visual hierarchy, and pure rendering reads
        # at a glance which is what matters most.
        subhead_font_path = FONT_BEBAS

    # S117: vignette tightened from PI/3 to PI/2.5 — slightly stronger
    # corner darkening so two-tier text reads at any image content.
    vignette_path = output_path + ".bg.jpg"
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", src_image_path,
                "-vf", f"scale={canvas_w}:{canvas_h}:flags=lanczos,vignette=PI/2.5",
                "-q:v", "2",
                vignette_path,
            ],
            capture_output=True, text=True, timeout=30, check=True,
        )
    except Exception as exc:
        log.warning("compose_thumbnail_vignette_failed", error=str(exc)[:300])
        img = Image.open(src_image_path).convert("RGB")
        img = img.resize((canvas_w, canvas_h), Image.LANCZOS)
        img.save(vignette_path, "JPEG", quality=92)

    img = Image.open(vignette_path).convert("RGB")

    clean_headline = (text or "").strip().upper()
    clean_subhead = (subhead or "").strip()

    if not clean_headline and not clean_subhead:
        img.save(output_path, "JPEG", quality=95)
        try:
            os.remove(vignette_path)
        except OSError:
            pass
        return {
            "lines": [], "fontsize": 0,
            "subhead_lines": [], "subhead_fontsize": 0,
        }

    margin = _THUMB_MARGIN
    safe_w = canvas_w - 2 * margin
    safe_h = canvas_h - 2 * margin

    lines: list = []
    fontsize = 0
    subhead_lines: list = []
    subhead_fontsize = 0

    if clean_subhead and clean_headline:
        # S117c: more vertical room for subhead so it can render at fs ~140-180
        # for max legibility. Headline 50%, gap 4%, subhead 46% of safe height.
        gap = int(safe_h * 0.04)
        headline_zone_h = int(safe_h * 0.50)
        subhead_zone_h = safe_h - headline_zone_h - gap

        try:
            lines, fontsize = _render_text_block(
                img, clean_headline, font_path,
                zone_x=margin, zone_y=margin,
                zone_w=safe_w, zone_h=headline_zone_h,
                font_min=_THUMB_FONT_MIN, font_max=_THUMB_FONT_MAX,
                stroke_width=_THUMB_STROKE_WIDTH,
                upper=False,
            )
        except ValueError as exc:
            log.warning("compose_thumbnail_headline_no_fit", error=str(exc)[:200])
            raise

        try:
            subhead_lines, subhead_fontsize = _render_text_block(
                img, clean_subhead, subhead_font_path,
                zone_x=margin, zone_y=margin + headline_zone_h + gap,
                zone_w=safe_w, zone_h=subhead_zone_h,
                font_min=72,
                # Up to 80% of headline cap — visual hierarchy preserved by
                # quote-wrap + position, not by being tiny.
                font_max=int(_THUMB_FONT_MAX * 0.80),
                # Stroke=2 (down from headline's 6). At subhead fontsize ~130,
                # a 6px stroke from BOTH sides eats Bebas Neue's ~12px glyph
                # thickness, leaving nearly-hollow text. Stroke=2 keeps the
                # legibility outline while the white fill renders solid.
                stroke_width=2,
                upper=True,        # Bebas Neue has no lowercase glyphs anyway
                italic_skew=0.0,   # solid render for readability
                quote_wrap=True,   # curly-quote-wrap the subhead
                add_shadow=True,   # S127 — Gaussian-blur drop shadow for
                                   # readability on busy/vignetted backdrops.
                                   # Compensates for the thinner stroke.
            )
        except ValueError as exc:
            log.warning(
                "compose_thumbnail_subhead_no_fit_dropped",
                error=str(exc)[:200],
                headline=clean_headline[:60],
            )
            subhead_lines = []
            subhead_fontsize = 0

    else:
        only_text = clean_headline or clean_subhead.upper()
        only_font = font_path if clean_headline else subhead_font_path
        try:
            lines, fontsize = _render_text_block(
                img, only_text, only_font,
                zone_x=margin, zone_y=margin,
                zone_w=safe_w, zone_h=safe_h,
                font_min=_THUMB_FONT_MIN, font_max=_THUMB_FONT_MAX,
                stroke_width=_THUMB_STROKE_WIDTH,
                upper=False,
            )
        except ValueError as exc:
            log.warning("compose_thumbnail_single_no_fit", error=str(exc)[:200])
            raise

    img.save(output_path, "JPEG", quality=95)
    try:
        os.remove(vignette_path)
    except OSError:
        pass

    return {
        "lines": lines,
        "fontsize": fontsize,
        "subhead_lines": subhead_lines,
        "subhead_fontsize": subhead_fontsize,
    }




# --------------------------------------------------------------------------
# Kinetic Captions -- Phase 5 Task 5.10
# --------------------------------------------------------------------------
# GPU Whisper word-level transcription -> 2-4 word bursts -> .ass -> ffmpeg burn.
# Green opaque-box captions are DEAD. New style: premium editorial, no box plate.
#
# TCF:  Bebas Neue uppercase, thin dark outline only, crisp white/silver.
# SS:   Montserrat SemiBold mixed-case, warm outline, soft shadow.

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
    "sovereign_synthesis": {
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
    style = CAPTION_STYLES.get(brand, CAPTION_STYLES["sovereign_synthesis"])

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
        "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET_FINAL, "-crf", VIDEO_CRF,
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
    "sovereign_synthesis": os.path.join(BRAND_ASSETS_DIR, "music_sovereign.mp3"),
    "containment_field": os.path.join(BRAND_ASSETS_DIR, "music_urgent.mp3"),
}
MUSIC_BED_DB = -8  # dB attenuation for music underneath narration (S86: was -12, barely audible. -8 = present but not competing)

# Brand stings
TYPING_SOUND = os.path.join(BRAND_ASSETS_DIR, "typing.mp3")
SIGNATURE_INTRO_FILES = {
    "sovereign_synthesis": os.path.join(BRAND_ASSETS_DIR, "signature_long.mp3"),
    "containment_field": os.path.join(BRAND_ASSETS_DIR, "signature_long_tcf.mp3"),
}
SIGNATURE_OUTRO_FILES = {
    "sovereign_synthesis": os.path.join(BRAND_ASSETS_DIR, "signature_outro.mp3"),
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

def _extract_hook_text(hook_text: Optional[str], script: str, max_words: int = 80) -> str:
    """
    Get the opening typewriter text. Prefer explicit hook_text from the job spec;
    fall back to the first ~80 words of the full script.
    S125+ — raised cap from 18 to 80 because content-engine videos now use
    dynamic font sizing in _image_to_branded_video; full paragraph fits the
    frame regardless of length. The 18-word cap was cutting sentences
    mid-thought ("...of unmet" with no period).
    """
    raw = (hook_text or "").strip()
    if not raw:
        raw = script.strip()
    words = raw.split()[:max_words]
    text = " ".join(words)
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
    style = TYPEWRITER_STYLES.get(brand, TYPEWRITER_STYLES["sovereign_synthesis"])

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
    thumbnail_text: Optional[str] = None,
    thumbnail_headline: Optional[str] = None,
    thumbnail_subhead: Optional[str] = None,
) -> dict:
    """
    Assemble a full long-form video from per-scene images + audio.

    Args:
        scene_images: Ordered list of image paths (one per scene).
        scene_wavs: Ordered list of WAV paths (one per scene).
        durations_s: Per-scene audio durations in seconds.
        job_dir: Working directory for intermediate files.
        brand: 'sovereign_synthesis' or 'containment_field'.
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

    # SESSION 95: Stream-copy concat — all clips share identical codec/res/crf.
    # Re-encoding was redundant and caused 600s timeout on 16-scene videos.
    final_path = os.path.join(job_dir, "final.mkv")

    concat_cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_list_path,
        "-c", "copy",
        final_path,
    ]

    log.info("compose_concat", clip_count=len(scene_clips))
    result = subprocess.run(
        concat_cmd, capture_output=True, text=True,
        timeout=120,  # stream-copy is near-instant, 120s generous safety net
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
        # SESSION 95: Stream-copy trim — just cuts at keyframe, no re-encode.
        trimmed_path = os.path.join(job_dir, "final_trimmed.mkv")
        trim_cmd = [
            "ffmpeg", "-y",
            "-i", final_path,
            "-t", f"{audio_master_dur:.3f}",
            "-c", "copy",
            trimmed_path,
        ]
        trim_result = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=120)
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
    # S117b: the LONG-FORM thumbnail backdrop is a HARDCODED BRAND IMAGE — same
    # silhouette across every video so it becomes the brand recognition anchor
    # (Rev. Ike pattern). Only the text varies. FLUX scene images still drive
    # the video body, just not the thumbnail. Falls back to scene_images if
    # the brand asset is missing (e.g. local dev without brand-assets/).
    thumb_path = os.path.join(job_dir, "thumbnail.jpg")
    _brand_long_bg = os.path.join(BRAND_ASSETS_DIR, f"bg_long_{('ss' if brand == 'sovereign_synthesis' else 'tcf')}.png")
    if os.path.isfile(_brand_long_bg):
        thumb_src = _brand_long_bg
        log.info("compose_thumbnail_brand_backdrop", path=_brand_long_bg)
    else:
        thumb_idx = min(thumbnail_scene_idx, n_scenes - 1)
        thumb_src = scene_images[thumb_idx] if thumb_idx < len(scene_images) else scene_images[0]
        log.warning("compose_thumbnail_brand_backdrop_missing_fallback_scene",
                    expected=_brand_long_bg, used=thumb_src)

    # S117: dual-tier thumbnail — headline (ALL CAPS) + subhead (Title Case).
    # Falls back to legacy thumbnail_text -> hook_text -> script slice when
    # the LLM did not deliver the new fields.
    _thumb_headline = ""
    _thumb_subhead = ""
    if thumbnail_headline and thumbnail_headline.strip():
        _thumb_headline = thumbnail_headline.strip().upper()
        if thumbnail_subhead and thumbnail_subhead.strip():
            _thumb_subhead = thumbnail_subhead.strip()
    elif thumbnail_text and thumbnail_text.strip():
        _thumb_headline = thumbnail_text.strip().upper()
    elif hook_text:
        _words = hook_text.upper().split()
        _thumb_headline = " ".join(_words[:5])
    elif script:
        _words = script.split("\n")[0].upper().split()
        _thumb_headline = " ".join(_words[:5])

    try:
        # S117: Pillow renderer with two-tier text on full-bleed vignetted image.
        # Hard-rejects on no-fit instead of silent-truncating.
        render_info = render_thumbnail_with_text(
            src_image_path=thumb_src,
            text=_thumb_headline,
            output_path=thumb_path,
            canvas_w=1280,
            canvas_h=720,
            font_path=FONT_BEBAS,
            subhead=_thumb_subhead or None,
            subhead_font_path=FONT_MONTSERRAT,
        )
        log.info(
            "compose_thumbnail_ok",
            headline=_thumb_headline or "(none)",
            subhead=_thumb_subhead or "(none)",
            lines=len(render_info.get("lines", [])),
            fontsize=render_info.get("fontsize", 0),
            sub_lines=len(render_info.get("subhead_lines", [])),
            sub_fontsize=render_info.get("subhead_fontsize", 0),
        )
    except Exception as exc:
        log.warning("compose_thumbnail_failed", error=str(exc)[:300])
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
    "sovereign_synthesis": {
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
    style = SHORT_CAPTION_STYLES.get(brand, SHORT_CAPTION_STYLES["sovereign_synthesis"])

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
    cta_text: Optional[str] = None,
    audio_is_raw_tts: bool = False,
    thumbnail_text: Optional[str] = None,
    thumbnail_headline: Optional[str] = None,
    thumbnail_subhead: Optional[str] = None,
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
        brand: 'sovereign_synthesis' or 'containment_field'.
        hook_text: Short hook for thumbnail overlay.
        cta_text: Call-to-action overlay for the last 3 seconds (e.g.,
                  "Full video on the channel — @TheContainmentField").

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
        "-c", "copy",
        concat_path,
    ]
    # SESSION 95: stream-copy — clips already share identical codec params
    result = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"compose_short concat failed: {result.stderr[:500] if result.stderr else ''}")

    # ── Stage 2.5: Re-mux with real audio ──────────────────────────────────
    # Scene clips have silent placeholder audio. Now swap in the real extracted audio.
    #
    # SESSION 92 FIX: NO MUSIC BED MIX HERE.
    # When audio_source == "rendered" (default), the extracted audio already has
    # the music bed baked in from the long-form compose. Mixing it again causes
    # double-music phasing artifacts. Only mix a fresh music bed when the audio
    # comes from raw TTS WAVs (audio_source == "raw_tts").
    muxed_path = os.path.join(job_dir, "short_muxed.mp4")

    use_raw_tts = audio_is_raw_tts

    if use_raw_tts:
        # Raw TTS audio has NO music — mix in a fresh bed
        music_path = MUSIC_BED_FILES.get(brand)
        if music_path and os.path.isfile(music_path):
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
            mix_cmd = [
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
    else:
        # Rendered audio already has music bed — just mux directly (no double-mix)
        log.info("compose_short_skip_music_mix",
                 reason="audio extracted from rendered long-form already contains music bed")
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

    # SESSION 100: Post-mux audio sanity gate — catch silent audio before
    # Whisper hallucinates "you you you you" on silence.
    try:
        _vol_check = subprocess.run(
            ["ffmpeg", "-i", muxed_path, "-af", "volumedetect", "-f", "null", "/dev/null"],
            capture_output=True, text=True, timeout=60,
        )
        for _vl in (_vol_check.stderr or "").splitlines():
            if "mean_volume" in _vl:
                log.info("compose_short_muxed_audio_level", level=_vl.strip())
                import re as _re
                _mv = _re.search(r"mean_volume:\s*(-?\d+\.?\d*)", _vl)
                if _mv and float(_mv.group(1)) < -80:
                    log.error("compose_short_audio_silent_after_mux",
                              mean_db=float(_mv.group(1)),
                              msg="Audio is silent after mux — real audio was not mapped correctly. "
                                  "Skipping Whisper captions to avoid hallucination.")
                    # Skip captions entirely — burned garbage is worse than no captions
                    raise _SilentAudioError("muxed audio is silent")
                break
    except _SilentAudioError:
        _skip_captions = True
        log.warning("compose_short_skipping_captions", reason="audio silent after mux")
    except Exception as _e:
        _skip_captions = False
        log.warning("compose_short_vol_check_failed", error=str(_e)[:200])
    else:
        _skip_captions = False

    # ── Stage 3: Kinetic captions (GPU Whisper → vertical ASS → burn) ──────
    if not _skip_captions:
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
    else:
        log.info("compose_short_captions_skipped_silent_audio")

    # ── Stage 3.4: Persistent bottom-third CTA handle ──────────────────
    # SESSION 115 (2026-04-24): The Stage 3.5 end-card is appended as a
    # SEPARATE 2.5s card after the short — invisible to viewers who swipe
    # in the median ~25s scroll window. This stage burns the @handle
    # portion of the CTA persistently into the bottom-third of every
    # frame of the main short, with a semi-transparent dark band behind
    # for legibility. End-card stays (belt + suspenders).
    if cta_text and cta_text.strip():
        try:
            # Pull just the @handle from the CTA. BRAND_CTA format is
            # "The protocol is live — @sovereign_synthesis" — the part
            # AFTER the em-dash is the handle. If no em-dash, use whole.
            _persist_raw = cta_text.strip()
            if "\u2014" in _persist_raw:
                _persist_handle = _persist_raw.split("\u2014", 1)[1].strip()
            else:
                _persist_handle = _persist_raw
            # Cap at 32 chars — anything longer won't fit at fontsize 52
            if len(_persist_handle) > 32:
                _persist_handle = _persist_handle[:32]
            # Escape for drawtext
            _persist_safe = _persist_handle.replace("'", "\u2019").replace(":", "\\:").replace("\\", "\\\\")

            persist_out = os.path.join(job_dir, "short_persistent_cta.mp4")
            persist_filter = (
                f"drawtext=fontfile='{FONT_BEBAS}'"
                f":text='{_persist_safe}'"
                f":fontsize=52"
                f":fontcolor=white"
                f":box=1:boxcolor=black@0.55:boxborderw=18"
                f":x=(w-text_w)/2"
                f":y=h-200"
            )
            persist_cmd = [
                "ffmpeg", "-y",
                "-i", final_path,
                "-vf", persist_filter,
                "-c:v", VIDEO_CODEC, "-preset", "fast", "-crf", VIDEO_CRF,
                "-c:a", "copy",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                persist_out,
            ]
            log.info("compose_short_persistent_cta_burn", handle=_persist_handle)
            persist_result = subprocess.run(persist_cmd, capture_output=True, text=True, timeout=180)
            if persist_result.returncode == 0 and os.path.isfile(persist_out):
                final_path = persist_out
                log.info("compose_short_persistent_cta_burned", handle=_persist_handle)
            else:
                log.warning("compose_short_persistent_cta_failed",
                            stderr=persist_result.stderr[:300] if persist_result.stderr else "")
        except Exception as exc:
            log.warning("compose_short_persistent_cta_error", error=str(exc)[:300])

    # ── Stage 3.5: Full-screen CTA card — appended as last 2.5s ────────
    # SESSION 98: Replaced small drawtext with a full-screen branded card
    # appended to the Short, matching the style seen on high-performing
    # Shorts (big centered text on dark background = visible in shelf).
    # SESSION 116 FIX (2026-04-25): Five prior sessions tried to fix
    # "blank navy card at end of short". Root cause: ffmpeg 4.4.2 logs
    # `[Parsed_drawtext_1] %{eol} is not known` once per frame and emits
    # NO text — only the navy background remains. `%{eol}` is not a valid
    # drawtext expansion on the pod's ffmpeg version. Fix: write the CTA
    # text to a temp file with real newlines and use textfile=. Verified
    # against ffmpeg 4.4.2 + DejaVuSans (will work identically with
    # FONT_BEBAS — drawtext font loading is independent of textfile=).
    if cta_text and cta_text.strip():
        try:
            CTA_CARD_DUR = 2.5  # seconds
            # NOTE: textfile= reads bytes literally — no escape needed for
            # quotes/colons/etc. We only use the unescaped (but smart-quoted)
            # version when writing to disk.
            _raw_cta = cta_text.strip().replace("'", "\u2019")
            # SESSION 100: Split on em-dash (natural break) or midpoint.
            # Old naive midpoint smashed "ON" + "THE" together as "ONNTHE".
            if "\u2014" in _raw_cta:
                _parts = _raw_cta.split("\u2014", 1)
                _line1 = _parts[0].strip()
                _line2 = _parts[1].strip() if len(_parts) > 1 else ""
            elif len(_raw_cta) > 28:
                _cta_words = _raw_cta.split()
                _mid = len(_cta_words) // 2
                _line1 = " ".join(_cta_words[:_mid])
                _line2 = " ".join(_cta_words[_mid:])
            else:
                _line1 = _raw_cta
                _line2 = ""

            # Write the CTA text to a sidecar file with REAL newlines.
            cta_textfile = os.path.join(job_dir, "cta_card_text.txt")
            with open(cta_textfile, "w", encoding="utf-8") as _fh:
                if _line2:
                    _fh.write(f"{_line1}\n{_line2}")
                else:
                    _fh.write(_line1)

            # Brand-specific card background colors (dark, premium feel)
            _bg_color = "0x0A1628" if brand == "sovereign_synthesis" else "0x0D0D1A"
            _accent = "0xFFCF80" if brand == "sovereign_synthesis" else "0xF0F0F0"

            # Generate a solid-color card with centered CTA text
            cta_card = os.path.join(job_dir, "cta_card.mp4")
            card_filter = (
                f"color=c={_bg_color}:s={SHORT_WIDTH}x{SHORT_HEIGHT}:d={CTA_CARD_DUR}:r={SHORT_FPS},"
                f"drawtext=fontfile='{FONT_BEBAS}'"
                f":textfile={cta_textfile}"
                f":fontsize=72"
                f":fontcolor={_accent}"
                f":borderw=4"
                f":bordercolor=black"
                f":x=(w-text_w)/2"
                f":y=(h-text_h)/2-40"
                f":line_spacing=20"
            )
            # SESSION 105: Match CTA card encoding to caption burn output exactly
            # (same preset, CRF, audio codec+bitrate+sample_rate) so -c copy concat
            # never fails on profile/level mismatch.
            card_cmd = [
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", card_filter,
                "-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate=48000",
                "-t", str(CTA_CARD_DUR),
                "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET_FINAL, "-crf", VIDEO_CRF,
                "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, "-ar", "48000",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                cta_card,
            ]
            log.info("compose_short_cta_card_gen", cta_text=cta_text[:60])
            card_result = subprocess.run(card_cmd, capture_output=True, text=True, timeout=30)

            if card_result.returncode == 0 and os.path.isfile(cta_card):
                # Concat main video + CTA card via stream copy
                cta_concat_list = os.path.join(job_dir, "cta_concat.txt")
                with open(cta_concat_list, "w") as f:
                    f.write(f"file '{final_path}'\nfile '{cta_card}'\n")
                cta_out = os.path.join(job_dir, "short_cta.mp4")
                concat_cmd = [
                    "ffmpeg", "-y",
                    "-f", "concat", "-safe", "0", "-i", cta_concat_list,
                    "-c", "copy",
                    "-movflags", "+faststart",
                    cta_out,
                ]
                cta_result = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=120)
                if cta_result.returncode == 0 and os.path.isfile(cta_out):
                    final_path = cta_out
                    log.info("compose_short_cta_card_appended", cta_text=cta_text[:60],
                             card_dur_s=CTA_CARD_DUR)
                else:
                    # SESSION 105: Fallback — re-encode concat if stream copy fails
                    log.warning("compose_short_cta_copy_failed_trying_reencode",
                                stderr=cta_result.stderr[:200] if cta_result.stderr else "")
                    reencode_cmd = [
                        "ffmpeg", "-y",
                        "-f", "concat", "-safe", "0", "-i", cta_concat_list,
                        "-c:v", VIDEO_CODEC, "-preset", "fast", "-crf", VIDEO_CRF,
                        "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, "-ar", "48000",
                        "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart",
                        cta_out,
                    ]
                    re_result = subprocess.run(reencode_cmd, capture_output=True, text=True, timeout=180)
                    if re_result.returncode == 0 and os.path.isfile(cta_out):
                        final_path = cta_out
                        log.info("compose_short_cta_card_appended_reencode", cta_text=cta_text[:60])
                    else:
                        log.warning("compose_short_cta_reencode_also_failed",
                                    stderr=re_result.stderr[:300] if re_result.stderr else "")
            else:
                log.warning("compose_short_cta_card_gen_failed",
                            stderr=card_result.stderr[:300] if card_result.stderr else "")
        except Exception as exc:
            log.warning("compose_short_cta_error", error=str(exc)[:300])

    # ── Stage 4: Probe final duration ──────────────────────────────────────
    total_duration = _probe_duration(final_path)

    # ── Stage 5: Vertical thumbnail ────────────────────────────────────────
    # S117b: HARDCODED BRAND IMAGE backdrop on shorts thumbnails too — same
    # silhouette across every short. Only the text varies. Falls back to
    # scene_images[0] if the brand asset is missing.
    thumb_path = os.path.join(job_dir, "thumbnail_short.jpg")
    _brand_short_bg = os.path.join(BRAND_ASSETS_DIR, f"bg_shorts_{('ss' if brand == 'sovereign_synthesis' else 'tcf')}.png")
    if os.path.isfile(_brand_short_bg):
        thumb_src = _brand_short_bg
        log.info("compose_short_thumbnail_brand_backdrop", path=_brand_short_bg)
    else:
        thumb_src = scene_images[0] if scene_images else ""
        log.warning("compose_short_thumbnail_brand_backdrop_missing_fallback_scene",
                    expected=_brand_short_bg, used=thumb_src)

    # S117: dual-tier thumbnail (headline + subhead) with backward-compat fallback.
    _thumb_headline = ""
    _thumb_subhead = ""
    if thumbnail_headline and thumbnail_headline.strip():
        _thumb_headline = thumbnail_headline.strip().upper()
        if thumbnail_subhead and thumbnail_subhead.strip():
            _thumb_subhead = thumbnail_subhead.strip()
    elif thumbnail_text and thumbnail_text.strip():
        _thumb_headline = thumbnail_text.strip().upper()
    elif hook_text:
        _words = hook_text.upper().split()
        _thumb_headline = " ".join(_words[:5])

    try:
        # S117: Pillow two-tier renderer. Vertical canvas gives more headroom
        # than long-form so both tiers can run larger fontsize.
        render_info = render_thumbnail_with_text(
            src_image_path=thumb_src,
            text=_thumb_headline,
            output_path=thumb_path,
            canvas_w=SHORT_WIDTH,
            canvas_h=SHORT_HEIGHT,
            font_path=FONT_BEBAS,
            subhead=_thumb_subhead or None,
            subhead_font_path=FONT_MONTSERRAT,
        )
        log.info(
            "compose_short_thumbnail_ok",
            headline=_thumb_headline or "(none)",
            subhead=_thumb_subhead or "(none)",
            lines=len(render_info.get("lines", [])),
            fontsize=render_info.get("fontsize", 0),
            sub_lines=len(render_info.get("subhead_lines", [])),
            sub_fontsize=render_info.get("subhead_fontsize", 0),
        )
    except Exception as exc:
        log.warning("compose_short_thumbnail_failed", error=str(exc)[:300])
        if thumb_src and os.path.isfile(thumb_src):
            import shutil
            shutil.copy2(thumb_src, thumb_path)

    # ── S130-FB3 — Prepend thumbnail card as first 0.3s of the video ──
    # Why: Meta's /PAGE_ID/video_reels endpoint does not expose a custom-cover
    # parameter at publish time. Reels covers are auto-extracted from the
    # video frame. Without this prepend, frame 0 is the first scene's Ken
    # Burns image — generic AI shot, no hook text. Prepending a 0.3s flash
    # of the designed branded thumbnail forces Meta's auto-extractor to pick
    # the branded card as the cover, while remaining short enough that
    # viewers barely register a "title flash" before content begins.
    #
    # Safe-by-default: if the prepend ffmpeg command fails for any reason
    # (codec mismatch, missing thumb, etc.), we log and SHIP THE VIDEO AS-IS.
    # That's a regression to prior auto-cover behavior, not a pipeline break.
    THUMB_PREPEND_S = 0.3
    REELS_MAX_DURATION_S = 60.0
    if (
        os.path.isfile(thumb_path)
        and os.path.isfile(final_path)
        and (total_duration + THUMB_PREPEND_S) <= REELS_MAX_DURATION_S
    ):
        final_with_thumb = os.path.join(job_dir, "short_with_thumb.mp4")
        prepend_cmd = [
            "ffmpeg", "-y",
            # input 0: looped thumbnail JPG → 0.3s vertical clip
            "-loop", "1", "-t", f"{THUMB_PREPEND_S:.3f}", "-i", thumb_path,
            # input 1: silent audio source for the prepend (48 kHz stereo)
            "-f", "lavfi", "-t", f"{THUMB_PREPEND_S:.3f}",
            "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            # input 2: the existing final video (with audio + captions + CTA)
            "-i", final_path,
            "-filter_complex",
            # v0: thumb scaled+padded to SHORT_WIDTH x SHORT_HEIGHT @ SHORT_FPS
            f"[0:v]scale={SHORT_WIDTH}:{SHORT_HEIGHT}:force_original_aspect_ratio=decrease,"
            f"pad={SHORT_WIDTH}:{SHORT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,"
            f"setsar=1,format=yuv420p,fps={SHORT_FPS}[v0];"
            # v2: existing video normalized to same fps/sar/format
            f"[2:v]fps={SHORT_FPS},format=yuv420p,setsar=1[v2];"
            # a0/a2: normalize both audio streams to 48 kHz stereo before concat
            f"[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0];"
            f"[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a2];"
            # concat the prepend + existing video into one stream
            f"[v0][a0][v2][a2]concat=n=2:v=1:a=1[v][a]",
            "-map", "[v]", "-map", "[a]",
            "-c:v", VIDEO_CODEC, "-preset", VIDEO_PRESET, "-crf", SHORT_CRF,
            "-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, "-ar", "48000",
            "-movflags", "+faststart",
            final_with_thumb,
        ]
        log.info(
            "compose_short_thumb_prepend_start",
            prepend_s=THUMB_PREPEND_S,
            pre_duration_s=round(total_duration, 2),
        )
        prepend_result = subprocess.run(
            prepend_cmd, capture_output=True, text=True, timeout=180,
        )
        if prepend_result.returncode != 0:
            log.warning(
                "compose_short_thumb_prepend_failed",
                stderr=(prepend_result.stderr[:500] if prepend_result.stderr else ""),
                msg="Shipping video as-is; Reels cover will auto-extract from scene 0 (prior behavior).",
            )
        else:
            final_path = final_with_thumb
            total_duration = total_duration + THUMB_PREPEND_S
            log.info(
                "compose_short_thumb_prepend_ok",
                out=final_with_thumb,
                final_duration_s=round(total_duration, 2),
            )
    else:
        log.info(
            "compose_short_thumb_prepend_skipped",
            thumb_exists=os.path.isfile(thumb_path) if thumb_path else False,
            video_exists=os.path.isfile(final_path) if final_path else False,
            duration_s=round(total_duration, 2),
            duration_limit_s=REELS_MAX_DURATION_S,
        )

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
