"""
pod/pipelines/xtts.py — XTTSv2 TTS inference pipeline.

Loads XTTSv2 once at module level (lazy, first call), then synthesizes speech
for each scene's tts_text using the brand-appropriate speaker reference WAV.

Speaker WAVs are baked into the Docker image at:
    /app/brand-assets/ace_ref.wav
    /app/brand-assets/tcf_ref.wav

Returns a list of per-scene WAV paths + a concatenated final audio WAV.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Optional

import structlog
import torch

log = structlog.get_logger("pipeline.xtts")

# ─────────────────────────────────────────────────────────────────────────────
# Lazy model singleton
# ─────────────────────────────────────────────────────────────────────────────
_model = None
_model_config = None


def _speaker_wav(brand: str) -> str:
    """Resolve speaker reference WAV path for a brand."""
    speakers_dir = os.environ.get("SPEAKERS_DIR", "/app/brand-assets")
    if brand == "containment_field":
        env_key = "XTTS_SPEAKER_WAV_TCF"
        default = f"{speakers_dir}/tcf_ref.wav"
    else:
        env_key = "XTTS_SPEAKER_WAV_ACE"
        default = f"{speakers_dir}/ace_ref.wav"
    path = os.environ.get(env_key, default)
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"Speaker WAV not found: {path} (brand={brand}, env={env_key}). "
            "Ensure speaker WAVs are baked into the Docker image at /app/brand-assets/."
        )
    return path


def load_model() -> None:
    """Load XTTSv2 into GPU memory. Idempotent — no-ops on repeat calls."""
    global _model, _model_config
    if _model is not None:
        return

    t0 = time.monotonic()
    log.info("xtts_loading", device="cuda" if torch.cuda.is_available() else "cpu")

    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts

    cache_dir = os.environ.get("HF_HOME", "/app/cache/huggingface")
    model_name = "tts_models/multilingual/multi-dataset/xtts_v2"

    # TTS library downloads to its own cache — we override to the volume
    # so the model persists across pod restarts.
    from TTS.utils.manage import ModelManager
    manager = ModelManager(models_file=None)

    # Check if already downloaded
    model_path = Path(cache_dir) / "tts" / "tts_models--multilingual--multi-dataset--xtts_v2"
    if not model_path.exists():
        log.info("xtts_downloading", cache_dir=cache_dir)
        # Use the TTS library's download mechanism
        from TTS.api import TTS as TTSApi
        tts_api = TTSApi(model_name=model_name, progress_bar=True)
        # Get model path from the API
        model_path = Path(tts_api.synthesizer.tts_model.config.model_dir) if hasattr(tts_api, 'synthesizer') else model_path
        del tts_api

    # Load config + model directly for maximum control
    config = XttsConfig()
    config_path = model_path / "config.json"
    if config_path.exists():
        config.load_json(str(config_path))
    else:
        # Fallback: use TTS API to handle download + config resolution
        from TTS.api import TTS as TTSApi
        tts_api = TTSApi(model_name=model_name, progress_bar=True, gpu=torch.cuda.is_available())
        # Extract model from API
        _model = tts_api.synthesizer.tts_model
        _model.eval()
        if torch.cuda.is_available():
            _model = _model.cuda()
        _model_config = _model.config
        elapsed = time.monotonic() - t0
        log.info("xtts_loaded_via_api", elapsed_s=round(elapsed, 1))
        return

    model = Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_dir=str(model_path))
    model.eval()
    if torch.cuda.is_available():
        model = model.cuda()

    _model = model
    _model_config = config
    elapsed = time.monotonic() - t0
    log.info("xtts_loaded", elapsed_s=round(elapsed, 1))


def is_loaded() -> bool:
    return _model is not None


def synthesize_scenes(
    scenes: list[dict],
    brand: str,
    job_dir: str,
    language: str = "en",
) -> dict:
    """
    Synthesize TTS audio for each scene.

    Args:
        scenes: List of scene dicts with 'index' and 'tts_text' keys.
        brand: 'ace_richie' or 'containment_field'.
        job_dir: Directory to write output WAVs into.
        language: XTTS language code.

    Returns:
        {
            "scene_wavs": ["/path/to/scene_0.wav", ...],
            "concat_wav": "/path/to/all_scenes.wav",
            "durations_s": [12.3, 8.1, ...],
            "total_duration_s": 42.5,
        }
    """
    load_model()
    assert _model is not None, "XTTS model failed to load"

    speaker_wav_path = _speaker_wav(brand)
    log.info(
        "xtts_synthesize_start",
        brand=brand,
        scene_count=len(scenes),
        speaker_wav=speaker_wav_path,
    )

    import soundfile as sf
    import numpy as np
    import subprocess

    scene_wavs: list[str] = []
    durations: list[float] = []

    # Compute speaker latents once (shared across all scenes for voice consistency)
    t0 = time.monotonic()
    gpt_cond_latent, speaker_embedding = _model.get_conditioning_latents(
        audio_path=[speaker_wav_path],
        gpt_cond_len=30,
        gpt_cond_chunk_len=4,
        max_ref_length=60,
    )
    log.info("xtts_speaker_latents", elapsed_s=round(time.monotonic() - t0, 2))

    # Sort by index to ensure ordering
    sorted_scenes = sorted(scenes, key=lambda s: s["index"])

    for scene in sorted_scenes:
        idx = scene["index"]
        text = scene["tts_text"]
        out_path = os.path.join(job_dir, f"scene_{idx:03d}.wav")

        t1 = time.monotonic()
        log.info("xtts_scene_start", index=idx, text_len=len(text))

        # XTTSv2 inference — full_sentences mode for natural prosody
        result = _model.inference(
            text=text,
            language=language,
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
            temperature=0.7,
            length_penalty=1.0,
            repetition_penalty=2.0,
            top_k=50,
            top_p=0.85,
            enable_text_splitting=True,
        )

        # Result is a dict with 'wav' key — numpy array at 24kHz
        wav_data = result["wav"]
        if isinstance(wav_data, torch.Tensor):
            wav_data = wav_data.cpu().numpy()

        # Squeeze to 1D if needed
        if wav_data.ndim > 1:
            wav_data = wav_data.squeeze()

        # Write 24kHz mono WAV
        sf.write(out_path, wav_data, 24000)

        duration = len(wav_data) / 24000.0
        durations.append(duration)
        scene_wavs.append(out_path)

        elapsed = time.monotonic() - t1
        log.info(
            "xtts_scene_done",
            index=idx,
            duration_s=round(duration, 2),
            elapsed_s=round(elapsed, 2),
            rtf=round(elapsed / max(duration, 0.1), 2),
        )

    # Concatenate all scene WAVs into one file using ffmpeg
    concat_path = os.path.join(job_dir, "all_scenes.wav")
    concat_list = os.path.join(job_dir, "concat_list.txt")

    with open(concat_list, "w") as f:
        for wav_path in scene_wavs:
            f.write(f"file '{wav_path}'\n")

    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list,
            "-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1",
            concat_path,
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )

    total_duration = sum(durations)
    log.info(
        "xtts_synthesize_done",
        scene_count=len(scene_wavs),
        total_duration_s=round(total_duration, 2),
    )

    return {
        "scene_wavs": scene_wavs,
        "concat_wav": concat_path,
        "durations_s": durations,
        "total_duration_s": total_duration,
    }
